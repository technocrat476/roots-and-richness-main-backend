import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import axios from 'axios';
import Stripe from 'stripe';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { protect } from '../middleware/auth.js';
import Order from '../models/Order.js';

const router = express.Router();

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
router.post('/phonepe/create-order', protect, async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    // Verify order exists and belongs to user
    const order = await Order.findById(orderId);
    if (!order || order.user.toString() !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const payload = {
      merchantId: process.env.PHONEPE_MERCHANT_ID,
      merchantTransactionId: `txn_${orderId}_${Date.now()}`,
      amount: Math.round(amount * 100), // paise
      redirectUrl: `${process.env.CLIENT_URL}/payment/success`,
      callbackUrl: `${process.env.SERVER_URL}/api/payments/phonepe/callback`,
      paymentInstrument: { type: "UPI_INTENT" }
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");

    const checksum = crypto
      .createHash("sha256")
      .update(base64Payload + "/pg/v1/pay" + process.env.PHONEPE_SALT_KEY)
      .digest("hex") + "###" + process.env.PHONEPE_SALT_INDEX;

    const response = await axios.post(
      `${process.env.PHONEPE_BASE_URL}/pg/v1/pay`,
      { request: base64Payload },
      { headers: { "X-VERIFY": checksum, "Content-Type": "application/json" } }
    );

    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create PhonePe order',
      error: error.message
    });
  }
});

// @desc    PhonePe callback
// @route   POST /api/payments/phonepe/callback
// @access  Public (PhonePe will call this)
router.post('/phonepe/callback', async (req, res) => {
  try {
    const data = req.body; // PhonePe sends status + transaction info
    const { merchantTransactionId, transactionId, code, message } = data;

    if (code === 'PAYMENT_SUCCESS') {
      // Extract orderId from merchantTransactionId
      const orderId = merchantTransactionId.split('_')[1];

      const order = await Order.findById(orderId);
      if (order && !order.isPaid) {
        order.isPaid = true;
        order.paidAt = Date.now();
        order.status = 'processing';
        order.paymentResult = {
          id: transactionId,
          status: 'completed',
          update_time: new Date().toISOString(),
          gateway: "PhonePe"
        };
        await order.save();
      }
    }

    // Always respond 200 to PhonePe
    res.status(200).json({ success: true, message: 'Callback received' });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'PhonePe callback failed',
      error: error.message
    });
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
