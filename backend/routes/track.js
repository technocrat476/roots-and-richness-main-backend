// routes/track.js
import express from "express";
import { ShippingAPI } from "../services/shipping.js";

const router = express.Router();

router.get("/track-order/:awb", async (req, res) => {
  const { awb } = req.params;

  try {
    const response = await ShippingAPI.trackOrder(awb);

    // Normalized payload for frontend
    res.json({
      success: true,
      tracking: {
        orderId: response.data.order_id,
        referenceId: response.data.reference_id,
        awbNumber: response.data.awb_number,
        courier: response.data.courier,
        expectedDelivery: response.data.expected_delivery_date,
        status: response.data.current_status,
        statusTime: response.data.status_time,
        scanDetail: response.data.scan_detail || [],
      },
    });
  } catch (err) {
    // Extract message from error
    const message = err.message.includes("Shipping API Error")
      ? err.message.replace("Shipping API Error: ", "")
      : err.message;

    console.error("❌ Track order failed:", err.message);
    res.status(404).json({
      success: false,
      message, // <-- send the actual Shipping API message
    });
  }
});

export default router;
