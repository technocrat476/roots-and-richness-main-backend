import express from "express";
import Subscriber from "../models/Subscriber.js";
import { sendWelcomeEmail } from "../utils/email.js";

const router = express.Router();

// @desc Subscribe user to newsletter
// @route POST /api/subscribe
router.post("/", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    // Check if already subscribed
    let subscriber = await Subscriber.findOne({ email });
    if (subscriber) {
      return res.status(200).json({
        success: true,
        message: "You are already subscribed!",
      });
    }

    // Save subscriber
    subscriber = new Subscriber({ email });
    await subscriber.save();

    // Send welcome email
    await sendWelcomeEmail({ email, name: "Subscriber" });

    res.status(201).json({
      success: true,
      message: "Thank you for subscribing!",
    });
  } catch (error) {
    console.error("❌ Subscription error:", error);
    res.status(500).json({
      success: false,
      message: "Server error, please try again later",
    });
  }
});

export default router;
