/**
 * routes/payments.js
 * Secure, production-ready payments router with exported webhookHandler.
 *
 * - Default export: Express router for payment endpoints (uses JSON body parser)
 * - Named export: webhookHandler(req,res) for mounting at /api/payments/webhook with express.raw()
 *
 * Requirements:
 * - server.js must mount webhookHandler BEFORE express.json() like:
 *     app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), webhookHandler);
 *
 * Models used: Product, Order, PaymentIntent, User (via protect middleware)
 */

import express from 'express';
import Stripe from 'stripe';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import PaymentIntent from '../models/PaymentIntent.js';
import { protect } from '../middleware/auth.js';
import { optionalAuth } from '../middleware/auth.js'; // if available (guest checkout)
import rateLimit from 'express-rate-limit';
import { COUPON_RULES } from "../utils/couponRules.js";

const router = express.Router();
router.use(express.json());

// Initialize SDKs (do NOT log secrets)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Rate limit: extra protection for create-intent endpoints
const createIntentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many create-intent requests, try later' }
});

/* ---------------------------
   Utility helpers
   --------------------------- */

function safeJson(obj) {
  try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
}

// Basic validation for orderItems array
function validateOrderItemsShape(orderItems) {
  if (!Array.isArray(orderItems) || orderItems.length === 0)
    return 'orderItems must be a non-empty array';

  for (const item of orderItems) {
    const productId = item.productId || item._id || item.id || item.product;

    if (!productId)
      return 'Each order item must include productId';

    // Normalize productId to be consistent for DB operations
    item.productId = productId;

    if (!item.quantity || typeof item.quantity !== 'number' || item.quantity < 1)
      return 'Each order item must include a valid quantity (>=1)';

    if (item.variant && typeof item.variant !== 'string')
      return 'variant must be a string';
  }

  return null;
}

/* ---------------------------
   Helper: compute totals server-side
   - reads Product model
   - matches variant price when variant provided, else uses product.price
   - ensures sufficient stock
   - returns { subtotal, shippingFee, total, totalPaise, breakdownItems }
   --------------------------- */
async function computeTotalsFromDb(orderItems) {
  let subtotal = 0.0;
  const breakdownItems = [];

  // fetch all product ids in single query
  const productIds = [...new Set(orderItems.map(i => i.productId))];
  const products = await Product.find({ _id: { $in: productIds } });

  const productMap = new Map(products.map(p => [String(p._id), p]));

  for (const item of orderItems) {
    const product = productMap.get(String(item.productId));
    if (!product) throw new Error(`Product not found: ${item.productId}`);

    // find variant if provided
    let unitPrice = product.price;
    let stockAvailable = product.stock ?? 0;

    if (item.variant) {
      const variant = (product.variants || []).find(v => String(v.size) === String(item.variant) || String(v._id) === String(item.variant));
      if (!variant) throw new Error(`Variant not found for product ${product._id}`);
      unitPrice = variant.price;
      stockAvailable = variant.stock ?? stockAvailable;
    }

    // Check stock
    if (stockAvailable < item.quantity) {
      throw new Error(`Insufficient stock for product ${product._id}. Available: ${stockAvailable}`);
    }

    const lineTotal = Number((unitPrice * item.quantity).toFixed(2));
    subtotal += lineTotal;

    breakdownItems.push({
      productId: product._id,
      name: product.name,
      sku: product.sku,
      unitPrice,
      quantity: item.quantity,
      lineTotal
    });
  }

  // Shipping policy: free over 499, else 99 (your existing logic)
  const shippingFee = subtotal > 499 ? 0 : 99;
  const tax = 0; // if you have tax rules, compute here
  const total = Number((subtotal + shippingFee + tax).toFixed(2));
  const totalPaise = Math.round(total * 100);

  return {
    subtotal,
    shippingFee,
    tax,
    total,
    totalPaise,
    breakdownItems
  };
}

/* ---------------------------
   PhonePe: create order (initiates external PhonePe payment page)
   - requires a PaymentIntent created previously (initiate-intent)
   - safe: validates the intent belongs to user (if user available) and is pending
   --------------------------- */
router.post('/phonepe/create-order', createIntentLimiter, optionalAuth, async (req, res) => {
  try {
    const { intentId } = req.body;
    if (!intentId) return res.status(400).json({ success: false, message: 'Missing intentId' });

    const intent = await PaymentIntent.findOne({ intentId });
    if (!intent) return res.status(404).json({ success: false, message: 'Intent not found' });

    if (intent.user && req.user && String(intent.user) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Permission denied for this intent' });
    }

    if (intent.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Intent not in pending state' });
    }

    // Recompute totals from DB
    const computed = await computeTotalsFromDb(intent.orderItems);
    if (computed.totalPaise !== intent.totals.totalPaise) {
      intent.status = 'failed';
      await intent.save();
      return res.status(400).json({ success: false, message: 'Amount mismatch with server records' });
    }

    const merchantTransactionId = `txn_${intentId}_${Date.now()}`;
    const payload = {
      merchantId: process.env.PHONEPE_MERCHANT_ID,
      merchantTransactionId,
      amount: computed.totalPaise,
      redirectUrl: `${process.env.CLIENT_URL}/order-confirmation`,
      callbackUrl: `${process.env.SERVER_URL}/api/payments/phonepe/callback`,
      paymentInstrument: { type: "PAY_PAGE" }
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const checksum = crypto
      .createHash('sha256')
      .update(base64Payload + "/pg/v1/pay" + (process.env.PHONEPE_SALT_KEY || ''))
      .digest('hex') + "###" + (process.env.PHONEPE_SALT_INDEX || '');

    const phonepeResp = await fetch(`${process.env.PHONEPE_BASE_URL}/pg/v1/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum
      },
      body: JSON.stringify({ request: base64Payload })
    }).then(r => r.json());

    console.log('🔥 PhonePe response:', phonepeResp);
    console.log('🔥 PhonePe redirectUrl:', payload.redirectUrl);

    // Save attempt
    intent.attempts.push({
      attemptId: `att_${nanoid(8)}`,
      createdAt: new Date(),
      amountPaise: computed.totalPaise,
      gatewayResponse: safeJson(phonepeResp),
      status: phonepeResp.success ? 'initiated' : 'failed'
    });
    intent.status = phonepeResp.success ? 'initiated' : 'failed';
    await intent.save();

    if (phonepeResp.success) {
      const vpa = process.env.PHONEPE_MERCHANT_VPA || 'merchant@upi';
      const upiLink = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent('Roots & Richness')}&am=${(computed.totalPaise / 100).toFixed(2)}&cu=INR&tid=${merchantTransactionId}`;
      return res.json({
        success: true,
        data: { phonepe: phonepeResp, upiLink, merchantTransactionId }
      });
    } else {
      // Payment page could not be created
      return res.status(400).json({
        success: false,
        message: 'PhonePe order creation failed',
        info: phonepeResp
      });
    }

  } catch (err) {
    console.error('phonepe/create-order error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'PhonePe order creation failed' });
  }
});

/* ---------------------------
   Initiate intent (create PaymentIntent record)
   - public (optionalAuth supports guest users)
   - computes totals server-side (prevents price tampering)
   --------------------------- */
router.post('/phonepe/initiate-intent', createIntentLimiter, optionalAuth, async (req, res) => {
  try {
    const { orderItems, customerInfo, shippingAddress, couponCode } = req.body;

    const v = validateOrderItemsShape(orderItems);
    if (v) return res.status(400).json({ success: false, message: v });

    // Ensure customerInfo minimal shape
        if (customerInfo && !customerInfo.fullName) {
  customerInfo.fullName = `${customerInfo.firstName || ''} ${customerInfo.lastName || ''}`.trim();
}
    if (!customerInfo || !customerInfo.email || !customerInfo.fullName) {
      return res.status(400).json({ success: false, message: 'Missing customerInfo (email, fullName)' });
    }

    // Compute totals from DB (secure)
    const computed = await computeTotalsFromDb(orderItems);

    // Create PaymentIntent with link to user if present
    const newIntent = new PaymentIntent({
      intentId: `pi_${nanoid(12)}`,
      user: req.user?.id || null,
      orderItems,
      customerInfo,
      shippingAddress: shippingAddress || {},
      totals: {
        itemsPrice: computed.subtotal,
        shippingPrice: computed.shippingFee,
        discountAmount: computed.discountAmount,
        codFee: 0,
        tax: computed.tax,
        total: computed.total,
        totalPaise: computed.totalPaise
      },
      status: 'pending',
      createdAt: new Date(),
      couponCode: couponCode || null,
      attempts: []
    });

    await newIntent.save();

    return res.json({ success: true, intentId: newIntent.intentId });
  } catch (err) {
    console.error('initiate-intent error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Failed to create payment intent' });
  }
});

/* ---------------------------
   PhonePe Callback (webhook)
   - public endpoint (PhonePe will call)
   - MUST verify signature per PhonePe docs — implementation below attempts a verification if header present.
   --------------------------- */
router.post("/phonepe/callback", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const SALT_KEY = process.env.PHONEPE_SALT_KEY;
    const SALT_INDEX = process.env.PHONEPE_SALT_INDEX;

    // PhonePe sends JSON
    const callbackBodyStr = req.body.toString();
    const callbackJson = JSON.parse(callbackBodyStr);

    const data = callbackJson.data;
    if (!data || !data.merchantTransactionId) {
      console.error("❌ Callback missing merchantTransactionId");
      return res.status(400).send("Invalid callback");
    }

    const merchantTransactionId = data.merchantTransactionId;

    // ----------------------------
    // 🔒 1. Fetch intent
    // ----------------------------
    const intent = await PaymentIntent.findOne({ intentId: merchantTransactionId });
    if (!intent) {
      console.error("❌ PaymentIntent not found for callback:", merchantTransactionId);
      return res.status(404).send("Intent not found");
    }

    // ----------------------------
    // 🔒 2. Prevent replay attacks
    // ----------------------------
    if (intent.status === "paid") {
      console.log("ℹ️ Callback replay ignored — already processed:", merchantTransactionId);
      return res.status(200).json({ success: true });
    }

    // ----------------------------
    // 🔒 3. Verify PhonePe signature
    // ----------------------------
    const receivedSignature = req.headers["x-verify"];
    if (!receivedSignature) {
      console.error("❌ Missing x-verify header");
      return res.status(401).send("Signature missing");
    }

    // Callback payload verification uses /pg/v1/status
    // VERY IMPORTANT: PhonePe documentation requires this
    const base64Body = Buffer.from(callbackBodyStr).toString("base64");
    const verificationString = base64Body + "/pg/v1/status" + SALT_KEY;

    const computedHash = crypto
      .createHash("sha256")
      .update(verificationString)
      .digest("hex");

    const computedVerify = `${computedHash}###${SALT_INDEX}`;

    // Constant-time compare
    const validSignature = crypto.timingSafeEqual(
      Buffer.from(computedVerify),
      Buffer.from(receivedSignature)
    );

    if (!validSignature) {
      console.error("❌ Invalid PhonePe Signature!");
      return res.status(403).send("Signature invalid");
    }

    // ----------------------------
    // 🚀 4. Payment SUCCESS
    // ----------------------------
    if (data.paymentState === "COMPLETED") {
      intent.status = "paid";
      intent.gatewayResponse = data;
      await intent.save();

      // ---------------------------
      // 🛒 5. Create Order
      // ---------------------------
      const order = new Order({
        orderId: merchantTransactionId,
        orderItems: intent.orderItems,
        customerInfo: intent.customerInfo,
        shippingAddress: intent.shippingAddress,
        subtotal: intent.subtotal,
        tax: intent.tax,
        shippingFee: intent.shippingFee,
        discountAmount: intent.discountAmount,
        codCharges: 0,
        total: intent.amount / 100,
        paymentProvider: "phonepe",
        paymentId: data.transactionId,
        paymentStatus: "paid",
        intentId: merchantTransactionId,
      });

      await order.save();

      // ---------------------------
      // 📉 6. Reduce Stock
      // ---------------------------
      for (let item of intent.orderItems) {
        const product = await Product.findById(item.product);

        if (item.variantId) {
          const variant = product.variants.id(item.variantId);
          variant.stock -= item.quantity;
        } else {
          product.stock -= item.quantity;
        }

        await product.save();
      }

      console.log("✅ Order created & stock updated for:", merchantTransactionId);

      return res.status(200).json({ success: true });
    }

    // ----------------------------
    // ❌ 7. PAYMENT FAILED
    // ----------------------------
    intent.status = "failed";
    intent.gatewayResponse = data;
    await intent.save();

    console.log("❌ PhonePe payment FAILED:", data);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ PhonePe callback error:", err);
    return res.status(500).send("Server error");
  }
});
/* ---------------------------
   Stripe: Create payment intent (server-side) - requires auth
   - verifies order exists and belongs to user
   --------------------------- */
router.post('/stripe/create-intent', protect, createIntentLimiter, async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: 'Missing orderId' });

    // Verify order exists and belongs to user
    const order = await Order.findById(orderId);
    if (!order || String(order.user) !== String(req.user.id)) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Create Stripe payment intent with server-calculated amount
    const amountCents = Math.round(Number(order.totalPrice) * 100);
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'inr', // change as needed
      metadata: {
        orderId: order._id.toString(),
        userId: req.user.id
      }
    });

    return res.json({ success: true, clientSecret: pi.client_secret, paymentIntentId: pi.id });
  } catch (err) {
    console.error('stripe/create-intent error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Stripe create-intent failed' });
  }
});

/* ---------------------------
   Stripe webhook handler (exported as webhookHandler)
   - MUST be mounted with express.raw() to verify signature
   --------------------------- */
export async function webhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const rawBody = req.body; // express.raw buffer
  try {
    const event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const orderId = paymentIntent.metadata?.orderId;
      if (orderId) {
        const order = await Order.findById(orderId);
        if (order && !order.isPaid) {
          order.isPaid = true;
          order.paidAt = Date.now();
          order.status = 'processing';
          order.paymentResult = {
            id: paymentIntent.id,
            status: paymentIntent.status,
            update_time: new Date().toISOString()
          };
          await order.save();
        }
      }
    }

    // respond 200
    return res.json({ received: true });
  } catch (err) {
    console.error('stripe webhook verify failed:', err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || 'unknown'}`);
  }
}

/* ---------------------------
   Razorpay: create-order and verify
   - create-order: protected
   - verify: protected (requires user)
   --------------------------- */
router.post("/razorpay/create-order", createIntentLimiter, optionalAuth, async (req, res) => {
  try {
    const { orderItems, customerInfo, shippingAddress, couponCode } = req.body;

    // 1️⃣ Validate order items
    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return res.status(400).json({ success: false, message: "orderItems must be a non-empty array" });
    }

    const validationError = validateOrderItemsShape(orderItems);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    // 2️⃣ Compute totals
    const computed = await computeTotalsFromDb(orderItems);
    let { subtotal, shippingFee, tax } = computed;

    // 3️⃣ Apply coupon
    let discountAmount = 0;

    if (couponCode) {
      const coupon = COUPON_RULES.find(
        (c) => c.code.toUpperCase() === couponCode.toUpperCase()
      );

      if (coupon && coupon.isActive) {
        const notExpired = new Date(coupon.expiryDate) >= new Date();
        const meetsMinValue = subtotal >= (coupon.minOrderValue || 0);

        if (notExpired && meetsMinValue) {
          if (coupon.type === "percent") {
            discountAmount = Math.floor((subtotal * coupon.value) / 100);
          } else if (coupon.type === "flat") {
            discountAmount = coupon.value;
          }
        }
      }
    }

    discountAmount = Math.min(discountAmount, subtotal);

    // 4️⃣ Final total
    const finalTotal = subtotal + shippingFee - discountAmount; // NO TAX
    const totalPaise = Math.round(finalTotal * 100);

    if (totalPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid payable amount after discount"
      });
    }

    // 5️⃣ Create Razorpay order
    const rOrder = await razorpay.orders.create({
      amount: totalPaise,
      currency: "INR",
      receipt: `rzp_${nanoid(8)}`,
      notes: {
        subtotal,
        shippingFee,
        discountAmount,
        customerEmail: customerInfo?.email || "guest",
        couponCode: couponCode || "",
      }
    });

    // 6️⃣ Create PaymentIntent AFTER totals and BEFORE response
    const intent = new PaymentIntent({
      intentId: nanoid(16),
      orderItems,
      customerInfo,
      shippingAddress,
      totals: {
        subtotal,
        shippingPrice: shippingFee,
        discountAmount,
        tax,
        total: finalTotal
      },
      status: "pending",
      user: req.user ? req.user._id : null
    });

    await intent.save();

    // 7️⃣ Respond to frontend including intentId
    return res.json({
      success: true,
      orderId: rOrder.id,
      amount: rOrder.amount,
      currency: rOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
      intentId: intent.intentId   // <-- REQUIRED
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Razorpay order creation failed"
    });
  }
});
router.post('/razorpay/verify', optionalAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, intentId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !intentId) {
      return res.status(400).json({ success: false, message: 'Missing parameters' });
    }

    const intent = await PaymentIntent.findOne({ intentId });
    if (!intent) return res.status(404).json({ success: false, message: 'Payment intent not found' });

    // Verify Razorpay signature
    const bodyStr = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(bodyStr)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    // Mark intent paid
    intent.status = 'paid';
    intent.paymentId = razorpay_payment_id;
    intent.paidAt = new Date();
    await intent.save();

    // Return full intent data so frontend can create the order
    return res.json({
      success: true,
      intent: {
        intentId: intent.intentId,
        orderItems: intent.orderItems,
        totals: intent.totals,
        customerInfo: intent.customerInfo,
        shippingAddress: intent.shippingAddress,
        paymentId: intent.paymentId
      }
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Razorpay verify failed' });
  }
});
/* ---------------------------
   Cash on Delivery (COD)
   - protected route to confirm COD order
   --------------------------- */
router.post('/cod/confirm', protect, async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: 'Missing orderId' });

    const order = await Order.findById(orderId);
    if (!order || String(order.user) !== String(req.user.id)) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    order.status = 'processing';
    order.paymentResult = {
      id: `cod_${Date.now()}`,
      status: 'pending',
      update_time: new Date().toISOString(),
      email_address: req.user.email
    };
    await order.save();

    return res.json({ success: true, message: 'COD order confirmed', order });
  } catch (err) {
    console.error('cod/confirm error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'COD confirm failed' });
  }
});

router.post('/check-stock', async (req, res) => {
  try {
    const { orderItems } = req.body;

    const outOfStockItems = [];

    for (const item of orderItems) {
      const product = await Product.findById(item.product);
      if (!product) continue;

      let targetVariant;

      if (item.variantId) {
        // Explicit variantId
        targetVariant = product.variants.id(item.variantId);
      } else if (item.size && item.size !== "default") {
        // fallback via size
        targetVariant = product.variants.find(v => v.size === item.size);
      } else {
        // default variant
        targetVariant = product.variants[0];
      }

      if (!targetVariant) {
        outOfStockItems.push({
          name: product.name,
          message: "No valid variant found",
          available: 0
        });
        continue;
      }

      if (targetVariant.stock < item.quantity) {
        outOfStockItems.push({
          name: `${product.name} (${targetVariant.size})`,
          available: targetVariant.stock
        });
      }
    }

    if (outOfStockItems.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Some items are out of stock",
        items: outOfStockItems
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Stock check error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


/* ---------------------------
   Export router (default) and webhookHandler (named)
   --------------------------- */
export default router;
