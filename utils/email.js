import { createTransporter } from './emailTransportBrevo.js';

// Send email function
export const sendEmail = async (options) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: `"Roots and Richness" <${process.env.EMAIL_USER}>`,
      to: options.email,
      subject: options.subject,
      text: options.message,
      html: options.html || `<p>${options.message}</p>`
    };
    
   // console.log("📨 Mail options:", mailOptions);
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
};

// Send order confirmation email
export const sendOrderConfirmation = async (order, user) => {
  const orderItemsHtml = order.orderItems.map(item => `
    <tr>
      <td style="padding: 8px; border: 1px solid #eee;">${item.name}</td>
      <td style="padding: 8px; border: 1px solid #eee; text-align: center;">${item.quantity}</td>
      <td style="padding: 8px; border: 1px solid #eee; text-align: right;">₹${item.price.toFixed(2)}</td>
      <td style="padding: 8px; border: 1px solid #eee; text-align: right;">₹${(item.price * item.quantity).toFixed(2)}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0; padding: 0;
          background-color: #f9f9f9;
          color: #333;
        }
        .container {
          width: 100%; max-width: 600px;
          margin: 20px auto;
          background: #fff;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .header {
          background: #4CAF50;
          color: white;
          padding: 20px;
          text-align: center;
        }
        .content {
          padding: 20px;
        }
        .order-table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
        }
        .summary {
          margin-top: 20px;
          text-align: right;
        }
        .summary p {
          margin: 4px 0;
        }
        .footer {
          background: #f0f0f0;
          text-align: center;
          padding: 15px;
          font-size: 12px;
          color: #777;
        }
        @media only screen and (max-width: 600px) {
          .content, .header, .footer {
            padding: 15px;
          }
          .order-table th, .order-table td {
            font-size: 14px;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>🎉 Your Order has been confirmed</h2>
        </div>
        <div class="content">
          <p>Hi <strong>${user.name || order.shippingAddress.fullName}</strong>,</p>
          <p>Thank you for your order! Here are the details:</p>

          <h3>Order #${order.orderId}</h3>
          <p><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString()}</p>
          <p><strong>Status:</strong> ${order.status}</p>

          <h3>Order Items</h3>
          <table class="order-table">
            <thead>
              <tr style="background-color: #f9f9f9;">
                <th style="padding: 8px; border: 1px solid #eee; text-align: left;">Product</th>
                <th style="padding: 8px; border: 1px solid #eee; text-align: center;">Qty</th>
                <th style="padding: 8px; border: 1px solid #eee; text-align: right;">Price</th>
                <th style="padding: 8px; border: 1px solid #eee; text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${orderItemsHtml}
            </tbody>
          </table>

<div style="margin-top: 20px;">
  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
    <tbody>
      <tr>
        <td style="padding: 6px 0; text-align: left;">Subtotal</td>
        <td style="padding: 6px 0; text-align: right;">₹${order.itemsPrice.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; text-align: left;">Shipping</td>
        <td style="padding: 6px 0; text-align: right;">
          ${order.shippingPrice > 0 ? `₹${order.shippingPrice.toFixed(2)}` : '<span style="color: #28a745;">Free</span>'}
        </td>
      </tr>
      ${
        order.codFee > 0
          ? `<tr>
               <td style="padding: 6px 0; text-align: left;">Cash on Delivery Fee</td>
               <td style="padding: 6px 0; text-align: right;">₹${order.codFee.toFixed(2)}</td>
             </tr>`
          : ''
      }
      ${
        order.discountAmount > 0
          ? `<tr>
               <td style="padding: 6px 0; text-align: left; color: #28a745;">Discount</td>
               <td style="padding: 6px 0; text-align: right; color: #28a745;">-₹${order.discountAmount.toFixed(2)}</td>
             </tr>`
          : ''
      }
      <tr style="border-top: 2px solid #ddd; font-weight: bold; font-size: 16px;">
        <td style="padding: 10px 0; text-align: left;">Total</td>
        <td style="padding: 10px 0; text-align: right;">₹${order.totalPrice.toFixed(2)}</td>
      </tr>
    </tbody>
  </table>
</div>


          <h3>Shipping Address</h3>
          <p>
            ${order.shippingAddress.fullName}<br />
            ${order.shippingAddress.address}<br />
            ${order.shippingAddress.city}, ${order.shippingAddress.state}, ${order.shippingAddress.postalCode}<br />
            ${order.shippingAddress.country}<br />
            Phone: ${order.shippingAddress.phone}
          </p>

          <p>We’ll notify you once your order has been shipped 🚚</p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} Roots and Richness. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    email: user.email || order.shippingAddress.email,
    subject: `🎉 Order Confirmation - #${order.orderId}`,
    html
  });
};

// Send password reset email
export const sendPasswordResetEmail = async (user, resetUrl) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Password Reset Request</h2>
      <p>Dear ${user.name},</p>
      <p>You are receiving this email because you (or someone else) has requested the reset of a password.</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}" 
           style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Reset Password
        </a>
      </div>
      
      <p>If the button doesn't work, you can also click on the link below:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      
      <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
      <p>This link will expire in 10 minutes.</p>
    </div>
  `;

  await sendEmail({
    email: user.email,
    subject: 'Password Reset Request',
    html
  });
};

// Send welcome email
export const sendWelcomeEmail = async (user) => {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet">
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: Arial, sans-serif;
        background-color: #f9f9f9;
        color: #333;
      }
      .container {
        width: 100%;
        max-width: 600px;
        margin: 20px auto;
        background: #ffffff;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      }
      .header {
        background-color: #1d3b2a;
        color: white;
        text-align: center;
        padding: 24px;
        font-family: 'Playfair Display', serif;
      }
      .header h1 {
        margin: 0;
        font-size: 28px;
      }
      .content {
        padding: 20px;
        text-align: center;
      }
      .content h2 {
        font-family: 'Playfair Display', serif;
        font-size: 22px;
        margin-bottom: 16px;
        color: #222;
      }
      .content p {
        font-size: 15px;
        line-height: 1.6;
        margin: 0 0 16px;
        color: #555;
      }
      .cta {
        margin: 24px 0;
      }
      .cta a {
        background-color: #d8ad54;
        color: white;
        padding: 12px 24px;
        border-radius: 6px;
        text-decoration: none;
        font-size: 16px;
        display: inline-block;
      }
      .footer {
        background: #f0f0f0;
        text-align: center;
        padding: 15px;
        font-size: 12px;
        color: #777;
      }
      @media only screen and (max-width: 600px) {
        .header h1 {
          font-size: 22px;
        }
        .content h2 {
          font-size: 18px;
        }
        .content p {
          font-size: 14px;
        }
        .cta a {
          font-size: 14px;
          padding: 10px 20px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Welcome to Roots & Richness</h1>
      </div>
      <div class="content">
        <h2>You’re officially part of the family!</h2>
        <p>
          Thank you for subscribing to our newsletter. From now on, you’ll receive
          wellness tips, traditional recipes, product updates, and exclusive offers
          directly in your inbox.
        </p>
        <p>
          We’re excited to share the purity of our farm-fresh, wood-pressed oils
          and more with you.
        </p>
        <div class="cta">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}">Shop Now</a>
        </div>
      </div>
      <div class="footer">
        © ${new Date().getFullYear()} Roots and Richness. All rights reserved.
      </div>
    </div>
  </body>
  </html>
  `;

  await sendEmail({
    email: user.email,
    subject: '🎉 Welcome to Roots & Richness Family!',
    html
  });
};

// Shipping Email

export const shippedEmailTemplate = ({ orderId, courierPartner, trackingNumber }) => `
  <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 8px; padding: 20px;">
    <h2 style="color: #d4a441; text-align: center;">Your Order is on the Way 🚚</h2>
    
    <p>Dear Customer,</p>
    <p>We’re excited to let you know that your order <strong>#${orderId}</strong> has been shipped.</p>

    <div style="background: #fafafa; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <p><strong>Courier Partner:</strong> ${courierPartner}</p>
      <p><strong>AWB Number:</strong> ${trackingNumber}</p>
      <p><a href="${process.env.FRONTEND_URL}/track-my-order" target="_blank" style="color: #d4a441; text-decoration: none; font-weight: bold;">Track Your Order</a></p>
    </div>

    <p>You can expect your order soon. Thank you for shopping with <strong>Roots and Richness</strong>.</p>

      <!-- Automated message -->
      <p style="font-size:12px; color:#999; margin-top:25px;">
        This is an automated message. Please do not reply directly.
      </p>
    </div>

    <!-- Footer -->
    <div style="background: #f4f4f4; text-align: center; padding: 15px; font-size: 12px; color: #777;">
      &copy; ${new Date().getFullYear()} Roots and Richness. All rights reserved.<br>
    </div>
  </div>
`;
