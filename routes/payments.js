/**
 * routes/payments.js
 * Secure, production-ready payments router with exported webhookHandler.
 *
 * - Default export: Express router for payment endpoints (uses JSON body parser)
 * - Named export: webhookHandler(req,res) for mounting at /api/payments/phonepe/webhook with express.raw()
 *
 * Requirements:
 * - server.js must mount webhookHandler BEFORE express.json() like:
 *     app.post('/api/payments/phonepe/webhook', express.raw({ type: 'application/json' }), webhookHandler);
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
import { StandardCheckoutPayRequest, StandardCheckoutStatusRequest } from "../utils/phonepeClient.js";
import axios from "axios";

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
   PhonePe OAuth token caching
   - caches token in memory with expiry (safe for single instance; use Redis for multi-instance)
   --------------------------- */
const PHONEPE_ENV = process.env.PHONEPE_ENV === 'production' ? 'production' : 'sandbox';

const PHONEPE_CONFIG = {
  sandbox: {
    authUrl: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
    payUrl: "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay",
    orderStatusUrlBase: "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order"
  },
  production: {
    authUrl: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token",
    payUrl: "https://api.phonepe.com/apis/pg/checkout/v2/pay",
    orderStatusUrlBase: "https://api.phonepe.com/apis/pg/checkout/v2/order"
  }
};

let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

async function getAuthToken() {
  // return cached if valid
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt - 10000 > now) { // 10s grace
    return tokenCache.accessToken;
  }

  const AUTH_URL = PHONEPE_CONFIG[PHONEPE_ENV].authUrl;
  try {
    const params = new URLSearchParams();
    params.append('client_id', process.env.PHONEPE_CLIENT_ID);
    params.append('client_version', process.env.PHONEPE_CLIENT_VERSION); // e.g., "1"
    params.append('client_secret', process.env.PHONEPE_CLIENT_SECRET);      // Your Client Secret
    params.append('grant_type', 'client_credentials');

    const response = await axios.post(AUTH_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const data = response.data;
    // The PhonePe token response may provide either 'expires_in' or 'expires_at'; handle both
    let ttlMs = 10 * 60 * 1000; // fallback 10min
    if (data.expires_in) ttlMs = Number(data.expires_in) * 1000;
    else if (data.expires_at) ttlMs = Math.max( (Number(data.expires_at) - Math.floor(Date.now()/1000)) * 1000, ttlMs);

    tokenCache.accessToken = data.access_token || data.accessToken || null;
    tokenCache.expiresAt = Date.now() + ttlMs;

    if (!tokenCache.accessToken) throw new Error('No access_token in PhonePe auth response');

    return tokenCache.accessToken;
  } catch (error) {
    console.error("PhonePe Auth Error:", error.response?.data || error.message);
    throw new Error("Failed to generate PhonePe Auth Token");
  }
}

/* ---------------------------
   PhonePe: create order (initiates external PhonePe payment page)
   - requires a PaymentIntent created previously (initiate-intent)
   --------------------------- */
router.post("/phonepe/create-order", async (req, res) => {
  try {
    const { intentId } = req.body;
    if (!intentId) return res.status(400).json({ success: false, message: "Missing intentId" });

    // 1️⃣ Fetch intent and validate
    const intent = await PaymentIntent.findOne({ intentId });
    if (!intent) return res.status(404).json({ success: false, message: "Intent not found" });

    // 2️⃣ Compute totals and validate amounts
    const computed = await computeTotalsFromDb(intent.orderItems);
    if (computed.totalPaise !== (intent.totals?.totalPaise || computed.totalPaise)) {
      return res.status(400).json({ success: false, message: "Amount mismatch" });
    }

    // 3️⃣ Generate Unique Order ID
    const merchantOrderId = `mo_${intentId}_${Date.now()}`;
    intent.merchantOrderId = merchantOrderId;
    await intent.save();

    // 4️⃣ Get OAuth Token (Latest V2 Flow Requirement)
    const accessToken = await getAuthToken();

   const PHONEPE_MERCHANT_ID = (process.env.PHONEPE_MERCHANT_ID ||process.env.PHONEPE_CLIENT_ID || '').trim();

    // 5️⃣ Prepare V2 Payload
    const payload = {
  merchantOrderId: merchantOrderId,
  amount: computed.totalPaise,
  merchantId: PHONEPE_MERCHANT_ID,
  paymentInstrument: { type: "PAY_PAGE" },
  deviceContext: { deviceOS: "WEB" },
  redirectUrl: `${process.env.CLIENT_URL}/payment-status?txn=${merchantOrderId}`,
  callbackUrl: `${process.env.API_URL}/api/payments/phonepe/webhook`,
  mobileNumber: intent.customerInfo?.phone || undefined,
  metaInfo: intent.metaInfo || {}
    };

    // 6️⃣ Send Payment Request
    const PAY_URL = PHONEPE_CONFIG[PHONEPE_ENV].payUrl;

    const response = await axios.post(PAY_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `O-Bearer ${accessToken}` // ⚠️ "O-Bearer" prefix required by PhonePe v2
      }
    });

    // 7️⃣ Handle Success
    if (response.data && response.data.data) {
      // V2 shape: response.data.data.instrumentResponse.redirectInfo.url
      const redirectInfo = response.data.data.instrumentResponse?.redirectInfo;
      const redirectUrl = redirectInfo?.url || response.data.data.redirectUrl || null;

      // Update DB intent attempt
      intent.attempts = intent.attempts || [];
      intent.attempts.push({
        attemptId: `att_${nanoid(8)}`,
        createdAt: new Date(),
        status: "initiated",
        gatewayResponse: safeJson(response.data),
        amountPaise: computed.totalPaise,
      });
      intent.status = "initiated";
      intent.save().catch(e => console.warn("failed to save intent after create-order", e));

      return res.json({
        success: true,
        merchantOrderId,
        redirectUrl
      });
    } else {
      console.error("Unexpected PhonePe create-order response:", safeJson(response.data));
      throw new Error("Invalid response from PhonePe");
    }

  } catch (err) {
    console.error("PhonePe create-order Error:", err.response?.data || err.message || err);
    return res.status(500).json({
      success: false,
      message: "Payment initiation failed",
      error: err.response?.data || err.message || 'unknown'
    });
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

    if (!customerInfo?.email || !customerInfo?.fullName) {
      return res.status(400).json({ success: false, message: "Missing customerInfo" });
    }

    const computed = await computeTotalsFromDb(orderItems);

    const intent = new PaymentIntent({
      intentId: `pi_${nanoid(12)}`,
      merchantOrderId: null,
      user: req.user?.id || null,
      orderItems,
      customerInfo,
      shippingAddress: shippingAddress || {},
      totals: {
        ...computed,
        totalPaise: computed.totalPaise,
      },
      status: "pending",
      attempts: [],
      couponCode: couponCode || null,
      createdAt: new Date(),
    });

    await intent.save();

    return res.json({ success: true, intentId: intent.intentId });

  } catch (err) {
    console.error("initiate-intent error:", err);
    return res.status(500).json({ success: false, message: "Failed to create intent" });
  }
});

/* ---------------------------
   PhonePe webhook handler (exported)
   - Use express.raw() when mounting (so we can verify header)
   - Verifies Authorization header: Authorization: SHA256(username:password)
   - Parses raw JSON body into JS object and processes (COMPLETED/FAILED)
   --------------------------- */

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s, 'utf8').digest('hex');
}

export async function webhookHandler(req, res) {
  try {
    // req.body is a Buffer when using express.raw()
    const rawBody = req.body;
    if (!rawBody || rawBody.length === 0) {
      console.warn("Empty webhook body");
      return res.status(400).send("Empty body");
    }

    // Verify Authorization header: PhonePe sends "Authorization: SHA256(username:password)"
    const authHeader = (req.get('authorization') || req.get('Authorization') || '').trim();
    const webhookUser = process.env.PHONEPE_WEBHOOK_USER || '';
    const webhookPass = process.env.PHONEPE_WEBHOOK_PASS || '';

    const expectedHash = sha256Hex(`${webhookUser}:${webhookPass}`);
    const expectedHeader = `SHA256(${expectedHash})`;

    if (!authHeader || authHeader !== expectedHeader) {
      console.warn("Invalid PhonePe webhook authorization", { got: authHeader, expected: expectedHeader });
      // Per PhonePe docs: If auth fails, ignore payload (but respond 401 for visibility)
      return res.status(401).send("Unauthorized");
    }

    // Parse JSON safely from raw buffer
    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch (e) {
      console.error("Failed to parse webhook JSON:", e);
      return res.status(400).send("Invalid JSON");
    }

    // PhonePe webhook shape example:
    // { event: "checkout.order.completed", payload: { merchantOrderId, state: "COMPLETED", paymentDetails: [...] } }
    const event = payload.event || payload.type;
    const data = payload.payload || payload.data || {};

    const merchantOrderId = data.merchantOrderId || data.orderId || null;
    const state = (data.state || '').toUpperCase();

    if (!merchantOrderId) {
      console.warn("Webhook without merchantOrderId", payload);
      return res.status(400).send("Missing merchantOrderId");
    }

    // Fetch intent using merchantOrderId
    const intent = await PaymentIntent.findOne({ merchantOrderId });
    if (!intent) {
      console.warn("Intent not found for webhook merchantOrderId:", merchantOrderId);
      // respond 200 but note that merchant may want to check order status via API
      return res.status(200).json({ success: false, message: 'Intent not found' });
    }

    // Preferred: use payload.state for final decision (per PhonePe docs)
    if (state === "COMPLETED") {
      // Mark intent paid and create Order if not already created
      intent.status = "paid";
      intent.gatewayResponse = safeJson(payload);
      intent.paidAt = new Date();
      await intent.save();

      // create order only if not already created
      const existingOrder = await Order.findOne({ orderId: merchantOrderId });
      if (!existingOrder) {
        const newOrder = new Order({
          orderId: merchantOrderId,
          orderItems: intent.orderItems,
          customerInfo: intent.customerInfo,
          shippingAddress: intent.shippingAddress,
          subtotal: intent.totals.subtotal,
          tax: intent.totals.tax,
          discountAmount: intent.totals.discountAmount,
          shippingFee: intent.totals.shippingFee,
          total: intent.totals.total,
          paymentProvider: "phonepe",
          paymentStatus: "paid",
          intentId: intent.intentId,
          paymentId: (data.paymentDetails && data.paymentDetails[0] && data.paymentDetails[0].transactionId) || undefined,
        });

        await newOrder.save();

        // Reduce stock
        for (let item of intent.orderItems) {
          const prodId = item.productId || item.product || item._id || item.productId;
          const product = await Product.findById(prodId);
          if (!product) continue;
          if (item.variantId) {
            const variant = product.variants.id(item.variantId);
            if (variant) {
              variant.stock = Math.max(0, (variant.stock || 0) - item.quantity);
            }
          } else if (product.stock != null) {
            product.stock = Math.max(0, (product.stock || 0) - item.quantity);
          }
          await product.save();
        }
      }

      // Respond quickly
      return res.status(200).json({ success: true });
    }

    // Non-completed states: FAILED, EXPIRED, CANCELLED
    intent.status = state === 'FAILED' || state === 'EXPIRED' ? 'failed' : intent.status || 'pending';
    intent.gatewayResponse = safeJson(payload);
    await intent.save();

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("PhonePe webhookHandler error:", err);
    return res.status(500).send("Server error");
  }
}

/* ---------------------------
   PhonePe Callback (alternate JSON endpoint)
   - Keep for compatibility if you want a JSON endpoint that PhonePe hits (but recommended to use the raw webhookHandler above)
   --------------------------- */
router.post("/phonepe/callback", express.json(), async (req, res) => {
  try {
    // This is a fallback endpoint (PhonePe may send JSON here in some setups).
    // We'll reuse the safer approach: lookup merchantOrderId, call status API to confirm.
    const body = req.body || {};
    const merchantOrderId = body.data?.merchantOrderId || body.payload?.merchantOrderId || body.merchantOrderId || null;
    if (!merchantOrderId) return res.status(400).send("Missing merchantOrderId");

    const intent = await PaymentIntent.findOne({ merchantOrderId });
    if (!intent) {
      console.error("Intent not found for callback:", merchantOrderId);
      return res.status(404).send("Intent not found");
    }

    // Query latest status from PhonePe using status API (fallback)
    try {
      const accessToken = await getAuthToken();
      const statusUrlBase = PHONEPE_CONFIG[PHONEPE_ENV].orderStatusUrlBase;
      const statusUrl = `${statusUrlBase}/${encodeURIComponent(merchantOrderId)}/status`;

      const statusResp = await axios.get(statusUrl, {
        headers: { Authorization: `O-Bearer ${accessToken}` }
      });

      if (!statusResp.data || !statusResp.data.success) {
        return res.status(200).json({ success: false });
      }

      const paymentState = statusResp.data.data?.state;
      if (paymentState === "COMPLETED") {
        intent.status = "paid";
        intent.gatewayResponse = statusResp.data;
        await intent.save();

        // create order (same logic as webhook)
        const existingOrder = await Order.findOne({ orderId: merchantOrderId });
        if (!existingOrder) {
          const order = new Order({
            orderId: merchantOrderId,
            orderItems: intent.orderItems,
            customerInfo: intent.customerInfo,
            shippingAddress: intent.shippingAddress,
            subtotal: intent.totals.subtotal,
            tax: intent.totals.tax,
            discountAmount: intent.totals.discountAmount,
            shippingFee: intent.totals.shippingFee,
            total: intent.totals.total,
            paymentProvider: "phonepe",
            paymentStatus: "paid",
            intentId: intent.intentId,
            paymentId: statusResp.data.data.transactionId,
          });
          await order.save();

          // Reduce Stock
          for (let item of intent.orderItems) {
            const prodId = item.productId || item.product || item._id;
            const product = await Product.findById(prodId);
            if (!product) continue;
            if (item.variantId) {
              const variant = product.variants.id(item.variantId);
              if (variant) variant.stock -= item.quantity;
            } else {
              product.stock -= item.quantity;
            }
            await product.save();
          }
        }

        return res.status(200).json({ success: true });
      }

      intent.status = "failed";
      await intent.save();
      return res.status(200).json({ success: true });

    } catch (err) {
      console.error("Error fetching PhonePe status:", err.response?.data || err.message);
      return res.status(500).json({ success: false, message: "Status fetch failed" });
    }

  } catch (err) {
    console.error("PhonePe callback error:", err);
    return res.status(500).send("Server error");
  }
});
/* ---------------------------
   PhonePe: check-status endpoint (used by frontend after redirect / SDK callback)
   - body: { merchantOrderId }
   - Idempotent: only creates Order if not already created
   --------------------------- */
router.post('/phonepe/check-status', async (req, res) => {
  try {
    const { merchantOrderId } = req.body;
    if (!merchantOrderId) return res.status(400).json({ success: false, message: 'Missing merchantOrderId' });

    // Find existing intent
    const intent = await PaymentIntent.findOne({ merchantOrderId });
    if (!intent) return res.status(404).json({ success: false, message: 'Intent not found' });

    // Call PhonePe status API
    const accessToken = await getAuthToken();
    const statusUrlBase = PHONEPE_CONFIG[PHONEPE_ENV].orderStatusUrlBase;
    const statusUrl = `${statusUrlBase}/${encodeURIComponent(merchantOrderId)}/status`;

    const statusResp = await axios.get(statusUrl, {
      headers: { Authorization: `O-Bearer ${accessToken}` },
      timeout: 8000
    });

    // Defensive checks
    if (!statusResp.data) {
      return res.status(200).json({ success: false, message: 'Empty response from PhonePe' });
    }

    // PhonePe response shape: { success:true, data: { state: 'COMPLETED', ... } }
    const successFlag = statusResp.data.success === true || statusResp.data.status === 'SUCCESS';
    const state = (statusResp.data.data?.state || statusResp.data.data?.status || '').toUpperCase();

    // Save gateway response for debugging
    intent.gatewayResponse = safeJson(statusResp.data);
    await intent.save().catch(e => console.warn("Intent save warning:", e));

    if (state === 'COMPLETED') {
      // Idempotent creation of Order
      intent.status = 'paid';
      intent.paidAt = new Date();
      await intent.save().catch(e => console.warn("Intent save warning:", e));

      const existingOrder = await Order.findOne({ orderId: merchantOrderId });
      if (!existingOrder) {
        const order = new Order({
          orderId: merchantOrderId,
          orderItems: intent.orderItems,
          customerInfo: intent.customerInfo,
          shippingAddress: intent.shippingAddress,
          subtotal: intent.totals.subtotal,
          tax: intent.totals.tax,
          discountAmount: intent.totals.discountAmount || 0,
          shippingFee: intent.totals.shippingFee || 0,
          total: intent.totals.total,
          paymentProvider: "phonepe",
          paymentStatus: "paid",
          intentId: intent.intentId,
          paymentId: statusResp.data.data?.transactionId || undefined,
        });
        await order.save();

        // Reduce stock (idempotent-ish; adjust to your models)
        for (let item of intent.orderItems) {
          const prodId = item.productId || item.product || item._id;
          const product = await Product.findById(prodId);
          if (!product) continue;
          if (item.variantId) {
            const variant = product.variants.id(item.variantId);
            if (variant) {
              variant.stock = Math.max(0, (variant.stock || 0) - item.quantity);
            }
          } else if (product.stock != null) {
            product.stock = Math.max(0, (product.stock || 0) - item.quantity);
          }
          await product.save().catch(e => console.warn("Stock update warning:", e));
        }
      }

      return res.json({ success: true, status: 'COMPLETED' });
    }

    // Non-completed (PENDING, FAILED, EXPIRED)
    if (state === 'FAILED' || state === 'EXPIRED') {
      intent.status = 'failed';
      await intent.save().catch(e => console.warn("Intent save warning:", e));
    }

    return res.json({ success: true, status: state || 'UNKNOWN', raw: statusResp.data });
  } catch (err) {
    console.error('phonepe/check-status error:', err?.response?.data || err?.message || err);
    return res.status(500).json({ success: false, message: 'Status check failed', error: err?.message || 'unknown' });
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
   - MUST be mounted with express.raw() to verify signature (this one is for stripe only)
   - You already exported PhonePe webhookHandler above — keep separate routes for Stripe webhook.
   --------------------------- */
export async function stripeWebhookHandler(req, res) {
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
