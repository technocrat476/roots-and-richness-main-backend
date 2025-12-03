// services/orderService.js
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import { customAlphabet } from 'nanoid';
import { ShippingAPI } from "../services/shipping.js";
import { sendOrderConfirmation } from '../utils/email.js';
const nanoidShort = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 8);
function makePublicOrderId() { return `PHNPE_${nanoidShort()}`; }

/**
 * Create or reuse an order from an "intent" object.
 * - idempotent by merchantOrderId or intentId
 * - updates existing order if found
 * - returns the saved order document (mongoose doc)
 *
 * Options:
 *   { pushToShipping: true, sendEmail: true }
 */
export async function createOrderFromIntent({ merchantOrderId, intent, paymentMeta = {}, options = {} }) {
  if (!intent) throw new Error('intent required');

  const { pushToShipping = true, sendEmail = true } = options;

  // Helper: normalize/ensure shippingAddress has required fields
  function buildShippingAddress(intent) {
    const s = intent.shippingAddress || {};
    const c = intent.customerInfo || {};

    const fullName = s.fullName || c.fullName || `${(c.firstName||'').trim()} ${(c.lastName||'').trim()}`.trim();
    const email = s.email || c.email || (c.emailAddress || '');
    const address = s.address || c.address || c.street || '';
    const city = s.city || c.city || '';
    const state = s.state || c.state || '';
    const postalCode = s.postalCode || s.postal || c.pincode || c.postalCode || '';
    const phone = s.phone || c.phone || c.mobileNumber || c.mobile || '';
    const country = s.country || c.country || 'India';

    return {
      fullName: fullName || 'Customer',
      email: email || '',
      address: address || '',
      addressLine2: s.addressLine2 || '',
      city: city || '',
      state: state || '',
      postalCode: postalCode || '',
      phone: phone || '',
      country
    };
  }

  // Idempotency: update existing by merchantOrderId or intentId
  if (merchantOrderId) {
    const existing = await Order.findOne({ $or: [{ merchantOrderId }, { intentId: intent.intentId }] });
    if (existing) {
      // Update payment + totals safely
      existing.isPaid = true;
      existing.paidAt = existing.paidAt || new Date();
      existing.status = 'processing'; // schema-friendly
      existing.paymentProvider = paymentMeta.provider || existing.paymentProvider || 'phonepe';
      existing.paymentId = existing.paymentId || paymentMeta.paymentId || null;
      existing.gatewayOrderId = existing.gatewayOrderId || paymentMeta.gatewayOrderId || null;

      existing.itemsPrice = Number(intent.totals?.subtotal ?? existing.itemsPrice ?? 0);
      existing.taxPrice = Number(intent.totals?.tax ?? existing.taxPrice ?? 0);
      existing.shippingPrice = Number(intent.totals?.shippingFee ?? existing.shippingPrice ?? 0);
      existing.discountAmount = Number(intent.totals?.discountAmount ?? existing.discountAmount ?? 0);
      existing.totalPrice = Number(intent.totals?.total ?? existing.totalPrice ?? 0);

      // ensure public orderId format
      if (!/^PHNPE_/.test(existing.orderId || '')) {
        existing.orderId = makePublicOrderId();
      }

      // If previously shipping wasn't pushed and we now want to push, attempt below after save
      await existing.save().catch(e => console.warn('[orderService] update existing order save warning:', e));

      // If shipping push not done and pushToShipping true, try it
      if (pushToShipping && (!existing.shipping || existing.shipping.status !== 'pushed')) {
        try {
          const pushResp = await ShippingAPI.pushOrder({
            order_id: existing.orderId,
            order_date: new Date(existing.createdAt).toISOString().split('T')[0],
            order_type: "NON ESSENTIALS",
            consignee_name: existing.shippingAddress?.fullName || '',
            consignee_phone: existing.shippingAddress?.phone || '',
            consignee_email: existing.shippingAddress?.email || '',
            consignee_address_line_one: existing.shippingAddress?.address || '',
            consignee_address_line_two: existing.shippingAddress?.addressLine2 || '',
            consignee_city: existing.shippingAddress?.city || '',
            consignee_state: existing.shippingAddress?.state || '',
            consignee_pin_code: existing.shippingAddress?.postalCode || '',
            product_detail: existing.orderItems.map((item) => ({
              name: item.name,
              sku_number: item.product ? item.product.toString() : '',
              quantity: item.quantity,
              unit_price: item.price,
              discount: 0,
              hsn: "",
              product_category: "Other",
            })),
            payment_type: existing.paymentMethod === "cod" ? "COD" : "PREPAID",
            cod_amount: existing.paymentMethod === "cod" ? String(existing.totalPrice) : "",
            weight: 500,
            length: 10, width: 10, height: 5,
            warehouse_id: process.env.SHIPPING_WAREHOUSE_ID || ""
          });

          existing.shipping = {
            order_id: pushResp.data.order_id,
            reference_id: pushResp.data.reference_id,
            awb_number: pushResp.data.awb_number || null,
            status: "pushed"
          };
          await existing.save().catch(e => console.warn('[orderService] save after shipping push warning:', e));
        } catch (err) {
          console.error('[orderService] Shipping API push failed for existing order:', err?.message || err);
          existing.shipping = existing.shipping || {};
          existing.shipping.status = 'push_failed';
          existing.shipping.error = (err?.message || String(err)).slice(0, 2000);
          await existing.save().catch(e => console.warn('[orderService] save after shipping error warning:', e));
        }
      }

      // Send email if not sent previously
      if (sendEmail && !existing.emailSent) {
        try {
          await sendOrderConfirmation(existing, {
            name: existing.shippingAddress?.fullName || '',
            email: existing.shippingAddress?.email || ''
          });
          existing.emailSent = true;
          await existing.save().catch(e => console.warn('[orderService] save after email flag warning:', e));
        } catch (err) {
          console.error('[orderService] sendOrderConfirmation failed for existing order:', err?.message || err);
          // don't fail the whole flow
          existing.emailSent = existing.emailSent || false;
          existing.emailError = (err?.message || String(err)).slice(0, 2000);
          await existing.save().catch(e => console.warn('[orderService] save after email error warning:', e));
        }
      }

      return existing;
    }
  }

  // Build normalized order items from intent
  const finalOrderItems = (intent.orderItems || []).map(item => ({
    product: item.product || item.productId || item._id,
    name: item.name || item.title || '',
    image: item.image || '',
    price: Number(item.price ?? item.unitPrice ?? 0),
    quantity: Number(item.quantity ?? item.qty ?? 1),
    variant: item.variant || item.variantId || (item.size || 'default')
  }));

  const itemsPrice = Number(intent.totals?.subtotal ?? 0);
  const taxPrice = Number(intent.totals?.tax ?? 0);
  const shippingPrice = Number(intent.totals?.shippingFee ?? 0);
  const discountAmount = Number(intent.totals?.discountAmount ?? 0);
  const totalPrice = Number(intent.totals?.total ?? itemsPrice);

  const publicOrderId = makePublicOrderId();

  // Ensure shippingAddress has all required fields for Order schema
  const safeShipping = buildShippingAddress(intent);

  // Build payload with schema-friendly status
  const payload = {
    orderId: publicOrderId,
    merchantOrderId: merchantOrderId || intent.merchantOrderId || null,
    orderItems: finalOrderItems,
    user: intent.user || null,
    shippingAddress: safeShipping,
    customerInfo: intent.customerInfo || {},
    paymentMethod: paymentMeta.method || 'phonepe',
    itemsPrice,
    taxPrice,
    shippingPrice,
    codFee: 0,
    totalPrice,
    couponCode: intent.couponCode || '',
    discountAmount,
    isPaid: true,
    paidAt: new Date(),
    isDelivered: false,
    status: 'processing',
    trackingNumber: '',
    courierPartner: '',
    notes: '',
    paymentProvider: paymentMeta.provider || 'phonepe',
    intentId: intent.intentId,
    paymentId: paymentMeta.paymentId || null,
    gatewayOrderId: paymentMeta.gatewayOrderId || null,
    createdAt: new Date()
  };

  // Create order
  let created;
  try {
    const order = new Order(payload);
    created = await order.save();
  } catch (err) {
    console.error('[orderService] order.save() failed:', err);
    // surface a helpful message for the caller to reconcile
    throw err;
  }

  // Bulk reduce variant stock and sync product isActive
  const bulkOps = [];
  for (const it of finalOrderItems) {
    if (!it.product) continue;
    bulkOps.push({
      updateOne: {
        filter: { _id: it.product, 'variants.size': it.variant },
        update: { $inc: { 'variants.$.stock': -Number(it.quantity || 0) } }
      }
    });
  }

  if (bulkOps.length) {
    try {
      await Product.bulkWrite(bulkOps);

      // Sync parent product availability
      for (const it of finalOrderItems) {
        try {
          const p = await Product.findById(it.product);
          if (!p) continue;
          const totalStock = p.variants.reduce((s, v) => s + (v.stock || 0), 0);
          if (totalStock === 0 && p.isActive) {
            p.isActive = false;
            await p.save().catch(e => console.warn('[orderService] product save warning:', e));
          }
        } catch (e) {
          console.warn('[orderService] sync parent stock warning:', e);
        }
      }
    } catch (err) {
      console.warn('[orderService] bulkWrite stock adjust warning', err);
      // don't throw here — order exists; caller should set reconciliation flag if necessary
    }
  }

  // Attempt to push to shipping partner (best-effort). Record shipping info on order.
  if (pushToShipping) {
    try {
      const pushResp = await ShippingAPI.pushOrder({
        order_id: created.orderId,
        order_date: new Date(created.createdAt).toISOString().split('T')[0],
        order_type: "NON ESSENTIALS",
        consignee_name: created.shippingAddress?.fullName,
        consignee_phone: created.shippingAddress?.phone,
        consignee_email: created.shippingAddress?.email,
        consignee_address_line_one: created.shippingAddress?.address,
        consignee_address_line_two: created.shippingAddress?.addressLine2 || "",
        consignee_city: created.shippingAddress?.city,
        consignee_state: created.shippingAddress?.state,
        consignee_pin_code: created.shippingAddress?.postalCode,
        product_detail: created.orderItems.map((item) => ({
          name: item.name,
          sku_number: item.product ? item.product.toString() : '',
          quantity: item.quantity,
          unit_price: item.price,
          discount: 0,
          hsn: "",
          product_category: "Other",
        })),
        payment_type: created.paymentMethod === "cod" ? "COD" : "PREPAID",
        cod_amount: created.paymentMethod === "cod" ? String(created.totalPrice) : "",
        weight: 500,
        length: 10, width: 10, height: 5,
        warehouse_id: process.env.SHIPPING_WAREHOUSE_ID || ""
      });

      created.shipping = {
        order_id: pushResp.data.order_id,
        reference_id: pushResp.data.reference_id,
        awb_number: pushResp.data.awb_number || null,
        status: "pushed"
      };

      await created.save().catch(e => console.warn('[orderService] save after shipping push warning:', e));
    } catch (err) {
      console.error('[orderService] Shipping API push failed:', err?.message || err);
      created.shipping = created.shipping || {};
      created.shipping.status = 'push_failed';
      created.shipping.error = (err?.message || String(err)).slice(0, 2000);
      await created.save().catch(e => console.warn('[orderService] save after shipping error warning:', e));
    }
  }

  // Attempt to send order confirmation email (best-effort)
  if (sendEmail) {
    try {
      await sendOrderConfirmation(created, {
        name: created.shippingAddress?.fullName,
        email: created.shippingAddress?.email
      });
      created.emailSent = true;
      await created.save().catch(e => console.warn('[orderService] save after email flag warning:', e));
    } catch (err) {
      console.error('[orderService] sendOrderConfirmation failed:', err?.message || err);
      created.emailSent = false;
      created.emailError = (err?.message || String(err)).slice(0, 2000);
      await created.save().catch(e => console.warn('[orderService] save after email error warning:', e));
    }
  }

  return created;
}
