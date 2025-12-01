import express from 'express';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import { protect, admin } from '../middleware/auth.js';
//import { validateOrder } from '../middleware/validateOrder.js';
import { validateGuestOrder } from '../middleware/validateGuestOrder.js';
import { sendEmail } from '../utils/email.js';
import { sendOrderConfirmation } from '../utils/email.js';
import { shippedEmailTemplate } from '../utils/email.js';
import { ShippingAPI } from "../services/shipping.js";
import { calculateInvoice } from "../utils/invoiceCalculator.js"
import { generateInvoicePDF, savePdfToLocal } from "../services/invoiceGenerator.js"
import path from "path";
import fs from "fs-extra";

const router = express.Router();

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
router.post('/', validateGuestOrder, async (req, res) => {
  try {
    const {
      orderItems,
      shippingAddress,
      customerInfo,
      paymentMethod,
      couponCode,
      discountAmount
    } = req.body;
const finalShippingAddress = shippingAddress || {
  fullName: `${customerInfo.firstName} ${customerInfo.lastName}`,
  email: shippingAddress?.email || customerInfo.email,
  address: customerInfo.address,
  city: customerInfo.city,
  state: customerInfo.state,
  postalCode: customerInfo.pincode,
  country: customerInfo.country || "India",  // or default "India"
  phone: customerInfo.phone,
};

    if (orderItems && orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No order items'
      });
    }

    // Verify products exist and have sufficient stock
    let itemsPrice = 0;
    const bulkOps = [];
    const finalOrderItems = []; // ✅ new array to push corrected items

for (const item of orderItems) {
  const product = await Product.findById(item.product);
  if (!product) {
    return res.status(404).json({ success: false, message: `Product not found: ${item.product}` });
  }

  let unitPrice;
  let variantSize;
  let targetVariant;

  if (item.variantId) {
    // ✅ Product detail page
    targetVariant = product.variants.id(item.variantId);
  } else if (item.size && item.size !== "default") {
    // ✅ fallback via size
    targetVariant = product.variants.find(v => v.size === item.size);
  } else {
    // ✅ Products page → default to first variant
    targetVariant = product.variants[0];
  }

  if (!targetVariant) {
    return res.status(400).json({ success: false, message: `No valid variant found for ${product.name}` });
  }

  unitPrice = targetVariant.price;
  variantSize = targetVariant.size;

  if (targetVariant.stock < item.quantity) {
    return res.status(400).json({ success: false, message: `Insufficient stock for ${product.name} (${variantSize}). Available: ${targetVariant.stock}` });
  }

  bulkOps.push({
    updateOne: {
      filter: { _id: product._id, 'variants._id': targetVariant._id },
      update: { $inc: { 'variants.$.stock': -item.quantity } }
    }
  });

  finalOrderItems.push({
    product: product._id,
    name: variantSize ? `${product.name} - ${variantSize}` : product.name,
    image: product.images?.[0]?.url || "",
    price: Number(unitPrice) || 0,
    quantity: Number(item.quantity) || 0,
    variant: variantSize || "default"
  });

  itemsPrice += unitPrice * item.quantity;
}

    const taxPrice = 0;
    const shippingPrice = itemsPrice > 499 ? 0 : 99;
    const method = paymentMethod.toLowerCase();
    const codFee = method === "cod" ? 50 : 0;
    const discount = discountAmount || 0;
    const totalPrice = itemsPrice + taxPrice + shippingPrice + codFee - discount;

    const order = new Order({
      orderId: req.body.orderId,
      orderItems: finalOrderItems,
      user: req.user ? req.user._id : null,
      shippingAddress: finalShippingAddress,
      paymentMethod: method,
      itemsPrice,
      taxPrice,
      shippingPrice,
      codFee,
      totalPrice,
      couponCode,
      discountAmount
    });

    const createdOrder = await order.save();
    //if (bulkOps.length) await Product.bulkWrite(bulkOps);
       if (bulkOps.length) {
  await Product.bulkWrite(bulkOps);

  // 🔧 Sync parent stock with variant totals
  for (const item of finalOrderItems) {
    const product = await Product.findById(item.product);
    if (product) {
      const totalStock = product.variants.reduce((sum, v) => sum + (v.stock || 0), 0);
      if (totalStock === 0 && product.isActive) {
      product.isActive = false;
      await product.save();
      }
    }
  }
}
    
    // 🚚 Push to Shipping Partner
    try {
const pushResp = await ShippingAPI.pushOrder({
  order_id: createdOrder.orderId,
  order_date: new Date(createdOrder.createdAt).toISOString().split("T")[0],
  order_type: "NON ESSENTIALS", // or "ESSENTIALS", if applicable
  consignee_name: finalShippingAddress.fullName,
  consignee_phone: finalShippingAddress.phone,
  consignee_email: finalShippingAddress.email,
  consignee_address_line_one: finalShippingAddress.address,
  consignee_address_line_two: finalShippingAddress.addressLine2 || "",
  consignee_city: finalShippingAddress.city,
  consignee_state: finalShippingAddress.state,
  consignee_pin_code: finalShippingAddress.postalCode,

  product_detail: createdOrder.orderItems.map((item) => ({
    name: item.name,
    sku_number: item.product.toString(),
    quantity: item.quantity,
    unit_price: item.price,
    discount: 0,
    hsn: "",
    product_category: "Other",
  })),

  payment_type: createdOrder.paymentMethod === "cod" ? "COD" : "PREPAID",
  cod_amount:
    createdOrder.paymentMethod === "cod"
      ? createdOrder.totalPrice.toString()
      : "",
  weight: 500, // in grams (adjust based on order)
  length: 10,
  width: 10,
  height: 5,
  warehouse_id: process.env.SHIPPING_WAREHOUSE_ID || "",
});
      createdOrder.shipping = {
        order_id: pushResp.data.order_id,
        reference_id: pushResp.data.reference_id,
        awb_number: pushResp.data.awb_number || null,
        status: "pushed"
      };
      await createdOrder.save();

    } catch (err) {
      console.error("❌ Shipping API failed:", err.message);
    }
// 2. Auto-assign courier
//try {
//  const assignResp = await ShippingAPI.autoAssignCourier(createdOrder.shipping.reference_id);
//  createdOrder.shipping.courier = assignResp.data.courier_name || null;
//  createdOrder.shipping.status = "assigned";
//  await createdOrder.save();
//} catch (err) {
//  console.error("❌ Courier assignment failed:", err.message);
//}

// 3. Schedule pickup
//try {
//  await ShippingAPI.schedulePickup(createdOrder.orderId);
//  createdOrder.shipping.status = "pickup_scheduled";
//  await createdOrder.save();
//} catch (err) {
//  console.error("❌ Pickup scheduling failed:", err.message);
//}
try {
  console.log("📧 Sending email to:", finalShippingAddress.email);
  if (finalShippingAddress.email) {
  await sendOrderConfirmation(createdOrder, {
    name: finalShippingAddress.fullName,
   email: finalShippingAddress.email,
 });
}
  console.log("✅ Order confirmation email sent");
} catch (err) {
  console.error("❌ Failed to send order confirmation email:", err.message);
}
    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order: createdOrder
    });

  } catch (error) {
    console.error("❌ Order creation error:", error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email')
      .populate('orderItems.product', 'name images');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user owns the order or is admin
    if (order.user._id.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this order'
      });
    }

    res.status(200).json({
      success: true,
      order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Update order to paid
// @route   PUT /api/orders/:id/pay
// @access  Private
router.put('/:id/pay', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user owns the order
    if (order.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this order'
      });
    }

    order.isPaid = true;
    order.paidAt = Date.now();
    order.status = 'processing';
    order.paymentResult = {
      id: req.body.id,
      status: req.body.status,
      update_time: req.body.update_time,
      email_address: req.body.email_address
    };

    const updatedOrder = await order.save();

    // Send confirmation email
    try {
      await sendEmail({
        email: req.user.email,
        subject: 'Order Confirmation',
        message: `Your order #${order._id} has been confirmed and payment received. Total amount: $${order.totalPrice}`
      });
    } catch (emailError) {
      console.error('Failed to send confirmation email:', emailError);
    }

    res.status(200).json({
      success: true,
      message: 'Order updated to paid',
      order: updatedOrder
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
router.get('/user/myorders', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const orders = await Order.find({ user: req.user.id })
      .populate('orderItems.product', 'name images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Order.countDocuments({ user: req.user.id });

    res.status(200).json({
      success: true,
      count: orders.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin
router.get('/', protect, admin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build query
    let query = {};

    // Status filter
    if (req.query.status) {
      query.status = req.query.status;
    }

// Search filter
if (req.query.search) {
  const searchRegex = new RegExp(req.query.search, "i");
  query.$or = [
    { orderId: searchRegex },
    { "shippingAddress.fullName": searchRegex },
    { "shippingAddress.email": searchRegex },
    { "shippingAddress.phone": searchRegex },
  ];
}

    // Payment status filter
    if (req.query.isPaid !== undefined) {
      query.isPaid = req.query.isPaid === 'true';
    }

    // Date range filter
    if (req.query.startDate || req.query.endDate) {
      query.createdAt = {};
      if (req.query.startDate) {
        query.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        query.createdAt.$lte = new Date(req.query.endDate);
      }
    }

    const orders = await Order.find(query)
      .populate('user', 'name email')
      .populate('orderItems.product', 'name images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Order.countDocuments(query);

    res.status(200).json({
      success: true,
      count: orders.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
router.put('/:id/status', protect, admin, async (req, res) => {
  try {
    console.log("Update order called:", req.params.id, req.body);
    const { status } = req.body;

    const order = await Order.findById(req.params.id).populate('user', 'name email');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    order.status = status;


    // ✅ Handle "shipped"
    if (status === "shipped") {
      try {
        const shippingData = await ShippingAPI.getOrderDetail(order.shipping.order_id);

        order.trackingNumber = shippingData.awbNumber;
        order.courierPartner = shippingData.courierPartner;
        order.shippingDetails = shippingData;

        // Send premium shipped email
        await sendEmail({
          email: order.shippingAddress.email,
          subject: "🎉 Your Order Has Been Shipped 🚚",
          html: shippedEmailTemplate({
            orderId: order.orderId,
            courierPartner: shippingData.courierPartner,
            trackingNumber: shippingData.awbNumber,
            
          }),
        });
      } catch (err) {
        console.error("❌ Error fetching shipping details:", err.message);
      }
    }

    if (status === "delivered") {
      order.isDelivered = true;
      order.deliveredAt = Date.now();
    }

    const updatedOrder = await order.save();
    //const trackingNumber = shippingDetails?.awb_number || null;
    //const courierPartner = shippingDetails?.courier_name || "Our Courier Partner";

    // Send status update email
   /* try {
      let emailMessage = `Your order #${order._id} status has been updated to: ${status}`;
      if (trackingNumber) {
        emailMessage += `\nTracking Number: ${trackingNumber}`;
      }

      await sendEmail({
        email: order.user.email,
        subject: 'Order Status Update',
        message: emailMessage
      });
    } catch (emailError) {
      console.error('Failed to send status update email:', emailError);
    } */

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      order: updatedOrder
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Cancel order
// @route   PUT /api/orders/:id/cancel
// @access  Private
router.put('/:id/cancel', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user owns the order
    if (order.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this order'
      });
    }

    // Check if order can be cancelled
    if (order.status === 'delivered' || order.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be cancelled'
      });
    }

    order.status = 'cancelled';
    await order.save();
if (order.shipping?.reference_id && order.shipping?.awb_number) {
  try {
    await ShippingAPI.cancelOrder(order.orderId, order.shipping.awb_number);
    order.shipping.status = "cancelled";
  } catch (err) {
    console.error("❌ Failed to cancel with shipping partner:", err.message);
  }
}
    // Restore product stock
    for (let item of order.orderItems) {
      await Product.findByIdAndUpdate(
  { _id: item.product, "variants.size": item.variant },
  { $inc: { "variants.$.stock": item.quantity } }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Order cancelled successfully',
      order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Invoice generation
// @route   GET /api/:id/invoice
// @access  Private
router.get('/:id/invoice', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // Normalize order items before invoice calculation
    order.items = order.orderItems?.map(it => ({
      ...it,
      qty: Number(it.quantity ?? it.qty ?? 1),
      price: Number(it.price ?? it.mrp ?? 0),
      gstPercent: Number(it.gstPercent ?? it.gst ?? 5),
    })) ?? [];

    // Calculate invoice
  const invoiceCalc = calculateInvoice(order, {
    gstRate: 5, // IGST %
    shippingFee: order.shippingPrice ?? order.shippingCharge ?? 99,
    shippingThreshold: 499,
    codCharge: order.codFee ?? 50,
    discountAmount: order.discountAmount ?? 0
});

    // Template payload
    const templateData = {
      company: {
        name: 'Roots and Richness',
        address: 'Indira Nagar, Ballari, Karnataka',
        gstin: 'Your GSTIN',
        logoUrl: 'https://ik.imagekit.io/rrcdn/Favicons/android-chrome-512x512.png?updatedAt=1758825398241',
        email: 'rootsnrichness@gmail.com',
        phone: '+91-XXXXXXXXXX'
      },
      order: {
        _id: order._id,
        orderId: order.orderId,
        orderNumber: order.orderNumber || order._id.toString().slice(-6).toUpperCase(),
        date: (new Date(order.createdAt)).toLocaleDateString('en-IN'),
      },
      customer: {
        name: order.shippingAddress?.fullName || "N/A",
        address: order.shippingAddress?.address || "N/A",
        city: order.shippingAddress?.city || "N/A",
        state: order.shippingAddress?.state || "N/A",
        pin: order.shippingAddress?.postalCode || "N/A",
        country: order.shippingAddress?.country || "N/A",        
        phone: order.shippingAddress?.phone || "N/A"
      },
      shipping: {
        name: order.shippingAddress?.fullName || "N/A",
        address: order.shippingAddress?.address || "N/A",
        city: order.shippingAddress?.city || "N/A",
        state: order.shippingAddress?.state || "N/A",
        pin: order.shippingAddress?.postalCode || "N/A",
        country: order.shippingAddress?.country || "N/A",
        phone: order.shippingAddress?.phone || "N/A"
      },
      invoice: invoiceCalc
    };

    // Generate PDF buffer
    const pdfBuffer = await generateInvoicePDF(templateData);

    // Save PDF temporarily
    const savedPath = await savePdfToLocal(pdfBuffer, order._id);

    // Send file
    res.sendFile(savedPath, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=invoice_${order.orderNumber || order._id}.pdf`
      }
    });

    // Cleanup after response finishes
    res.on("finish", async () => {
      try {
        await fs.unlink(savedPath);
        console.log(`Temporary invoice deleted: ${savedPath}`);
      } catch (err) {
        console.error("Error cleaning up invoice file:", err);
      }
    });

  } catch (err) {
    console.error('Invoice generation error', err);
    res.status(500).json({ message: 'Failed to generate invoice' });
  }
});
export default router;