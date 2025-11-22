import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import axios from 'axios';
import Stripe from 'stripe';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { protect } from '../middleware/auth.js';
import { optionalAuth } from '../middleware/auth.js';
import Order from '../models/Order.js';
import { nanoid } from 'nanoid';
import PaymentIntent from '../models/PaymentIntent.js';

const router = express.Router();
console.log("Loaded: paymentRoutes");
// Initialize payment gateways
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
console.log("Razorpay Key ID:", process.env.RAZORPAY_KEY_ID);
console.log("Razorpay Key Secret:", process.env.RAZORPAY_KEY_SECRET);
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// -----------------------------
// 📌 PHONEPE INTEGRATION
// -----------------------------

// @desc    Create PhonePe order
// @route   POST /api/payments/phonepe/create-order
// @access  Private
// POST /api/payments/phonepe/create-order
router.post('/phonepe/create-order', async (req, res) => {
  try {
    const { intentId } = req.body;
    if (!intentId) return res.status(400).json({ success: false, message: 'Missing intentId' });

    const intent = await PaymentIntent.findOne({ intentId });
    if (!intent) return res.status(404).json({ success: false, message: 'Intent not found' });

    if (intent.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Intent not in pending state' });
    }

    const amountPaise = intent.totals.totalPaise;
    if (!amountPaise || amountPaise <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });

    // PhonePe payload
    const merchantTransactionId = `txn_${intentId}_${Date.now()}`;
    const payload = {
      merchantId: process.env.PHONEPE_MERCHANT_ID,
      merchantTransactionId,
      amount: amountPaise,
      redirectUrl: `${process.env.CLIENT_URL}/payment/success`,
      callbackUrl: `${process.env.SERVER_URL}/api/payments/phonepe/callback`,
      paymentInstrument: { type: "PAY_PAGE" }
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
    const checksum = crypto
      .createHash("sha256")
      .update(base64Payload + "/pg/v1/pay" + process.env.PHONEPE_SALT_KEY)
      .digest("hex") + "###" + process.env.PHONEPE_SALT_INDEX;

    const phonepeResp = await axios.post(
      `${process.env.PHONEPE_BASE_URL}/pg/v1/pay`,
      { request: base64Payload },
      { headers: { "X-VERIFY": checksum, "Content-Type": "application/json" } }
    );

    // Save attempt
    intent.attempts.push({
      attemptId: `att_${nanoid(8)}`,
      createdAt: new Date(),
      amountPaise,
      gatewayResponse: phonepeResp.data,
      status: 'initiated'
    });
    intent.status = 'initiated';
    await intent.save();

    // ---------------------------
    // ADD: Generate standard UPI link
    const vpa = process.env.PHONEPE_MERCHANT_VPA || "merchant@upi"; // make sure to set this in .env
    const upiLink = `upi://pay?pa=${vpa}&pn=Merchant&am=${(amountPaise / 100).toFixed(2)}&cu=INR&tid=${merchantTransactionId}`;
    // ---------------------------

    res.json({
      success: true,
      data: {
        phonepe: phonepeResp.data,  // existing PhonePe web link / payload
        upiLink,                     // NEW: standard UPI link for QR / app redirection
        merchantTransactionId
      }
    });
  } catch (err) {
    console.error('PhonePe create-order error:', err.response?.data || err.message);
    res.status(500).json({ success: false, message: 'PhonePe create failed', error: err.response?.data || err.message });
  }
});

// POST /api/payments/phonepe/initiate-intent
router.post('/phonepe/initiate-intent', async (req, res) => {
  try {
    const { orderItems, customerInfo, shippingAddress, couponCode } = req.body;

    if (!orderItems || orderItems.length === 0)
      return res.status(400).json({ success: false, message: 'No order items provided' });

    // 1️⃣ Compute totals safely on the backend
    const subtotal = orderItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const discountAmount = 0; // apply coupon logic here
    const shippingFee = subtotal > 499 ? 0 : 99;
    const codCharges = 0; // UPI/PhonePe doesn't include COD
    const total = subtotal - discountAmount + shippingFee + codCharges;
    const totalPaise = Math.round(total * 100); // convert to paise

    if (totalPaise <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });

    // 2️⃣ Create PaymentIntent
    const intent = new PaymentIntent({
      intentId: `pi_${nanoid(12)}`,
      orderItems,
      customerInfo,
      shippingAddress,
      totals: {
        itemsPrice: subtotal,
        shippingPrice: shippingFee,
        discountAmount: discountAmount,
        codFee: codCharges,
        total: total,
        totalPaise: totalPaise
        },
      status: 'pending',
      createdAt: new Date(),
      couponCode: couponCode || null
    });

    await intent.save();

    return res.json({ success: true, intentId: intent.intentId });
  } catch (err) {
    console.error('Initiate PaymentIntent error:', err);
    res.status(500).json({ success: false, message: 'PaymentIntent creation failed', error: err.message });
  }
});

// @desc    PhonePe callback
// @route   POST /api/payments/phonepe/callback
// @access  Public (PhonePe will call this)
// PhonePe callback: phonepe -> POST /api/payments/phonepe/callback
router.post('/phonepe/callback', express.json(), async (req, res) => {
  try {
    // PhonePe doc: the body contains { request: base64string, response: {...} } OR a structure the webhook uses
    const body = req.body;

    // If PhonePe sends an encoded 'request' field like create-order response, use that.
    // The verification method depends on PhonePe docs — the same salt check used earlier may apply.
    // Example: if X-VERIFY header present (adjust to actual header your PhonePe sends)
    const receivedVerifyHeader = req.headers['x-verify'] || req.headers['X-VERIFY'];

    // extract merchantTransactionId from the payload — adapt if structure differs
    const responseData = body?.data || body;
    const merchantTransactionId = responseData?.merchantTransactionId || responseData?.merchantTransactionId || responseData?.merchantTransactionId;

    if (!merchantTransactionId) {
      console.warn('PhonePe callback: missing merchantTransactionId', body);
      return res.status(400).json({ success:false, message:'Missing merchantTransactionId' });
    }

    // Parse our intentId from merchantTransactionId if we set it to include intentId earlier:
    // we used: `txn_${intentId}_${Date.now()}`
    const parts = String(merchantTransactionId).split('_');
    const intentId = parts[1];

    const intent = await PaymentIntent.findOne({ intentId });
    if (!intent) {
      console.warn('PhonePe callback: intent not found', intentId);
      return res.status(404).json({ success:false, message:'Intent not found' });
    }

    // OPTIONAL: verify signature. PhonePe webhook verification procedure must be followed precisely.
    // If PhonePe sends a checksum we can recompute similar to create-order:
    // const recomputed = crypto.createHash('sha256').update(req.body.request + '/pg/v1/pay' + process.env.PHONEPE_SALT_KEY).digest('hex') + '###' + process.env.PHONEPE_SALT_INDEX
    // if (receivedVerifyHeader && recomputed !== receivedVerifyHeader) return res.status(403).json({ success:false, message:'Invalid signature' });

    // Determine status from PhonePe response structure (adjust fields per their callback)
    const code = responseData?.code || responseData?.status || responseData?.transactionStatus;
    const transactionId = responseData?.transactionId || responseData?.txnId || responseData?.referenceId;

    // Mark attempt and intent
    const lastAttempt = intent.attempts[intent.attempts.length - 1];
    if (lastAttempt) {
      lastAttempt.gatewayResponse = responseData;
      lastAttempt.status = (code === 'PAYMENT_SUCCESS' || code === 'SUCCESS' || code === '200') ? 'success' : 'failed';
    }

    if (code === 'PAYMENT_SUCCESS' || code === 'SUCCESS' || code === '200') {
      // Create the final order now (paid)
      const order = new Order({
        merchantOrderId: `ORD_${nanoid(10)}`,
        orderItems: intent.orderItems,
        user: intent.user || null,
        shippingAddress: intent.customerInfo || {},
        payment: {
          method: 'upi',
          provider: 'phonepe',
          status: 'paid',
          gatewayPaymentId: transactionId,
          gatewayResponseRaw: responseData
        },
        itemsPrice: intent.totals.itemsPrice,
        taxPrice: intent.totals.tax,
        shippingPrice: intent.totals.shippingPrice,
        codFee: intent.totals.codFee,
        totalPrice: intent.totals.total,
        createdAt: new Date()
      });
      const createdOrder = await order.save();

      intent.status = 'paid';
      await intent.save();

      // Optionally notify fulfillment, send email, decrement stock etc.
      // ... your existing pipeline for new orders goes here ...

      return res.status(200).json({ success:true, message:'Callback processed', orderId: createdOrder._id });
    } else {
      intent.status = 'failed';
      await intent.save();
      return res.status(200).json({ success:true, message:'Payment failed', info: responseData });
    }
  } catch (err) {
    console.error('PhonePe callback error:', err);
    res.status(500).json({ success:false, message:'Callback processing error', error: err.message });
  }
});

// @desc    Create Stripe payment intent
// @route   POST /api/payments/stripe/create-intent
// @access  Private
router.post('/stripe/create-intent', protect, async (req, res) => {
  try {
    const { amount, currency = 'usd', orderId } = req.body;

    // Verify order exists and belongs to user
    const order = await Order.findById(orderId);
    if (!order || order.user.toString() !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      metadata: {
        orderId: orderId,
        userId: req.user.id
      }
    });

    res.status(200).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create payment intent',
      error: error.message
    });
  }
});

// @desc    Confirm Stripe payment
// @route   POST /api/payments/stripe/confirm
// @access  Private
router.post('/stripe/confirm', protect, async (req, res) => {
  try {
    const { paymentIntentId, orderId } = req.body;

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status === 'succeeded') {
      // Update order
      const order = await Order.findById(orderId);
      if (order && order.user.toString() === req.user.id) {
        order.isPaid = true;
        order.paidAt = Date.now();
        order.status = 'processing';
        order.paymentResult = {
          id: paymentIntent.id,
          status: paymentIntent.status,
          update_time: new Date().toISOString(),
          email_address: req.user.email
        };
        await order.save();

        res.status(200).json({
          success: true,
          message: 'Payment confirmed successfully',
          order
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }
    } else {
      res.status(400).json({
        success: false,
        message: 'Payment not successful'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to confirm payment',
      error: error.message
    });
  }
});

// @desc    Create Razorpay order
// @route   POST /api/payments/razorpay/create-order
// @access  Private
router.post('/razorpay/create-order', protect, async (req, res) => {
  try {
    const { amount, currency = 'INR', orderId } = req.body;

    // Verify order exists and belongs to user
    const order = await Order.findById(orderId);
    if (!order || order.user.toString() !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const options = {
      amount: Math.round(amount * 100), // Convert to paise
      currency,
      receipt: `order_${orderId}`,
      notes: {
        orderId: orderId,
        userId: req.user.id
      }
    };

    const razorpayOrder = await razorpay.orders.create(options);

    res.status(200).json({
      success: true,
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create Razorpay order',
      error: error.message
    });
  }
});

// @desc    Verify Razorpay payment
// @route   POST /api/payments/razorpay/verify
// @access  Private
router.post('/razorpay/verify', protect, async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId
    } = req.body;

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      // Update order
      const order = await Order.findById(orderId);
      if (order && order.user.toString() === req.user.id) {
        order.isPaid = true;
        order.paidAt = Date.now();
        order.status = 'processing';
        order.paymentResult = {
          id: razorpay_payment_id,
          status: 'completed',
          update_time: new Date().toISOString(),
          email_address: req.user.email
        };
        await order.save();

        res.status(200).json({
          success: true,
          message: 'Payment verified successfully',
          order
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: error.message
    });
  }
});

// @desc    Handle Cash on Delivery
// @route   POST /api/payments/cod/confirm
// @access  Private
router.post('/cod/confirm', protect, async (req, res) => {
  try {
    const { orderId } = req.body;

    const order = await Order.findById(orderId);
    if (!order || order.user.toString() !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // For COD, we don't mark as paid but confirm the order
    order.status = 'processing';
    order.paymentResult = {
      id: `cod_${Date.now()}`,
      status: 'pending',
      update_time: new Date().toISOString(),
      email_address: req.user.email
    };
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Cash on Delivery order confirmed',
      order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to confirm COD order',
      error: error.message
    });
  }
});

// @desc    Stripe webhook
// @route   POST /api/payments/stripe/webhook
// @access  Public
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const orderId = paymentIntent.metadata.orderId;

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

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook signature verification failed:', error.message);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

export default router;
