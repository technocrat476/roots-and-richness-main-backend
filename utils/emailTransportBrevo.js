// utils/emailTransportBrevo.js
import fetch from 'node-fetch'; // If Node 18+, you can remove this and use global fetch

export const createTransporter = () => {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY missing in env');

  return {
    sendMail: async (mailOptions) => {
      const body = {
        sender: {
          name: "Roots and Richness",
          email: process.env.EMAIL_FROM || "no-reply@rootsandrichness.in"
        },
        to: [{ email: mailOptions.to }],
        subject: mailOptions.subject,
        htmlContent: mailOptions.html,
        textContent: mailOptions.text || undefined,
      };

      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("Brevo API error:", err);
        throw new Error(`Brevo send failed: ${res.status} ${err}`);
      }

      const data = await res.json();
      return { messageId: data.messageId || null };
    }
  };
};
