// routes/contact-smtp.js
import express from 'express';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

const router = express.Router();
const limiter = rateLimit({ windowMs: 60*1000, max: 6 });

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// verify transporter on start (optional)
transporter.verify().then(() => console.log('SMTP ready')).catch(err => console.warn('SMTP verify failed', err));

router.post(
  '/',
  limiter,
  [
    body('name').trim().isLength({ min: 2 }),
    body('email').isEmail(),
    body('subject').trim().isLength({ min: 3 }),
    body('message').trim().isLength({ min: 5 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const { name, email, phone = '', subject, message } = req.body;

      const mailOptions = {
        to: process.env.CONTACT_TO,
        from: `"Message" <${process.env.EMAIL_USER}>`,
        subject: `Website Contact: ${subject}`,
        text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\n\n${message}`,
        html: `<p><strong>Name:</strong> ${name}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p><strong>Phone:</strong> ${phone}</p>
               <p><strong>Message:</strong></p>
               <div>${message.replace(/\n/g, '<br/>')}</div>`
      };

      await transporter.sendMail(mailOptions);
      return res.json({ success: true, message: 'Message sent' });
    } catch (err) {
      console.error('Contact send error:', err);
      return res.status(500).json({ success: false, message: 'Failed to send message' });
    }
  }
);

export default router;
