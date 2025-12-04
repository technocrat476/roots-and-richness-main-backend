// services/shipping.js
import dotenv from 'dotenv';
dotenv.config();
import fetch from "node-fetch";

const BASE_URL = "https://shipping-api.com/app/api/v1";
const PUBLIC_KEY = process.env.SHIPPING_PUBLIC_KEY;
const PRIVATE_KEY = process.env.SHIPPING_PRIVATE_KEY;


async function request(endpoint, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "public-key": PUBLIC_KEY,
    "private-key": PRIVATE_KEY,
    ...options.headers,
  };
if (options.body) {
    try {
      //console.log("➡️ Body:", JSON.stringify(JSON.parse(options.body), null, 2));
    } catch (err) {
      //console.log("➡️ Raw Body:", options.body);
    }
  }
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || (data && data.result === "0")) {
    console.error("❌ Shipping API error details:", {
      status: res.status,
      statusText: res.statusText,
      body: data,
    });
    throw new Error(
      `Shipping API Error: ${data?.message || res.statusText || "Unknown error"}`
    );
  }

  return data;
}

export const ShippingAPI = {
  pushOrder: (body) =>
    request("/push-order", { method: "POST", body: JSON.stringify(body) }),

  autoAssignCourier: (orderId) =>
    request("/auto-assign-order", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId }),
    }),

  schedulePickup: (orderId) =>
    request("/schedule-pickup", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId }),
    }),

  trackOrder: (awb) =>
    request(`/track-order?awb_number=${awb}`, { method: "GET" }),

  cancelOrder: (orderId, awb) =>
    request("/cancel-order", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId, awb_number: awb }),
    }),

  getLabel: (awb) =>
    request(`/get-order-label/${awb}`, { method: "GET" }),

  getOrderDetail: (orderId) =>
    request(`/get-order-detail/${orderId}`, { method: "GET" }),
};
