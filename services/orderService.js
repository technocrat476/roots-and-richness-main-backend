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
 * - Used by PhonePe check-status
 * - Idempotent by merchantOrderId / intentId
 * - Also responsible for stock reduction (one-time via intent.stockAdjusted)
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

  const safeShipping = buildShippingAddress(intent);

  const shouldAdjustStock = !intent.stockAdjusted; // 👈 one-time guard

  // ----------------------------------
  // 1) Idempotency: reuse existing order
  // ----------------------------------
  if (merchantOrderId) {
    const existing = await Order.findOne({
      $or: [
        { merchantOrderId },
        { intentId: intent.intentId }
      ]
    });

    if (existing) {
      // Update payment + totals safely
      existing.isPaid = true;
      existing.paidAt = existing.paidAt || new Date();
      existing.status = 'processing';
      existing.paymentProvider = paymentMeta.provider || existing.paymentProvider || 'phonepe';
      existing.paymentId = existing.paymentId || paymentMeta.paymentId || null;
      existing.gatewayOrderId = existing.gatewayOrderId || paymentMeta.gatewayOrderId || null;

      // Prefer totals from intent if present
      if (intent.totals) {
        existing.itemsPrice = Number(intent.totals.subtotal ?? existing.itemsPrice ?? 0);
        existing.taxPrice = Number(intent.totals.tax ?? existing.taxPrice ?? 0);
        existing.shippingPrice = Number(intent.totals.shippingFee ?? existing.shippingPrice ?? 0);
        existing.discountAmount = Number(intent.totals.discountAmount ?? existing.discountAmount ?? 0);
        existing.totalPrice = Number(intent.totals.total ?? existing.totalPrice ?? 0);
      }

      // ensure public orderId format
      if (!/^PHNPE_/.test(existing.orderId || '')) {
        existing.orderId = makePublicOrderId();
      }

      await existing.save().catch(e =>
        console.warn('[orderService] update existing order save warning:', e)
      );

      // Optional safety: if somehow stock wasn't adjusted earlier for this intent, do it once now
      if (shouldAdjustStock) {
        try {
          // Reuse logic similar to /orders route
          const bulkOps = [];

          for (const item of existing.orderItems || []) {
            const product = await Product.findById(item.product);
            if (!product) continue;

            const targetVariant = product.variants.find(
              v => v.size === item.variant || v._id?.toString() === item.variantId
            );

            if (targetVariant && typeof targetVariant.stock === 'number') {
              bulkOps.push({
                updateOne: {
                  filter: { _id: product._id, 'variants._id': targetVariant._id },
                  update: { $inc: { 'variants.$.stock': -Number(item.quantity || 0) } }
                }
              });
            }
          }

          if (bulkOps.length) {
            await Product.bulkWrite(bulkOps);

            // sync parent stock / isActive
            for (const item of existing.orderItems || []) {
              const product = await Product.findById(item.product);
              if (!product) continue;

              const totalStock = Array.isArray(product.variants)
                ? product.variants.reduce((sum, v) => sum + (v.stock || 0), 0)
                : (product.stock || 0);

              if (totalStock === 0 && product.isActive) {
                product.isActive = false;
                await product.save().catch(e =>
                  console.warn('[orderService] product save warning (existing):', e)
                );
              }
            }
          }

          intent.stockAdjusted = true;
          await intent.save().catch(e =>
            console.warn('[orderService] intent save after stockAdjusted (existing) warning:', e)
          );
        } catch (err) {
          console.warn('[orderService] stock adjust safety (existing) warning:', err);
        }
      }

      // Shipping push + email remain same
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
          await existing.save().catch(e =>
            console.warn('[orderService] save after shipping push warning (existing):', e)
          );
        } catch (err) {
          console.error('[orderService] Shipping API push failed for existing order:', err?.message || err);
          existing.shipping = existing.shipping || {};
          existing.shipping.status = 'push_failed';
          existing.shipping.error = (err?.message || String(err)).slice(0, 2000);
          await existing.save().catch(e =>
            console.warn('[orderService] save after shipping error warning (existing):', e)
          );
        }
      }

      if (sendEmail && !existing.emailSent) {
        try {
          await sendOrderConfirmation(existing, {
            name: existing.shippingAddress?.fullName || '',
            email: existing.shippingAddress?.email || ''
          });
          existing.emailSent = true;
          await existing.save().catch(e =>
            console.warn('[orderService] save after email flag warning (existing):', e)
          );
        } catch (err) {
          console.error('[orderService] sendOrderConfirmation failed for existing order:', err?.message || err);
          existing.emailSent = existing.emailSent || false;
          existing.emailError = (err?.message || String(err)).slice(0, 2000);
          await existing.save().catch(e =>
            console.warn('[orderService] save after email error warning (existing):', e)
          );
        }
      }

      return existing;
    }
  }

  // ----------------------------------
  // 2) New order from intent (PhonePe success)
  // ----------------------------------

  // Build final order items + stock bulkOps using SAME logic as /orders route
  const bulkOps = [];
  const finalOrderItems = [];
  let itemsPriceFromVariants = 0;

  for (const item of (intent.orderItems || [])) {
    const productId = item.product || item.productId || item._id;
    if (!productId) continue;

    const product = await Product.findById(productId);
    if (!product) {
      console.warn('[orderService] product not found for intent item:', productId);
      continue;
    }

    let unitPrice;
    let variantSize;
    let targetVariant;

    if (item.variantId) {
      // product detail page path
      targetVariant = product.variants.id(item.variantId);
    } else if (item.size && item.size !== "default") {
      // fallback via size
      targetVariant = product.variants.find(v => v.size === item.size);
    } else {
      // default to first variant
      targetVariant = product.variants[0];
    }

    if (!targetVariant) {
      console.warn('[orderService] No valid variant found for', product.name);
      continue;
    }

    unitPrice = targetVariant.price;
    variantSize = targetVariant.size;

    // Build bulkOps for stock decrement
    bulkOps.push({
      updateOne: {
        filter: { _id: product._id, 'variants._id': targetVariant._id },
        update: { $inc: { 'variants.$.stock': -Number(item.quantity || 0) } }
      }
    });

    finalOrderItems.push({
      product: product._id,
      name: variantSize ? `${product.name} - ${variantSize}` : product.name,
      image: product.images?.[0]?.url || item.image || "",
      price: Number(unitPrice) || 0,
      quantity: Number(item.quantity) || 0,
      variant: variantSize || "default"
    });

    itemsPriceFromVariants += unitPrice * (item.quantity || 0);
  }

  // Prefer totals from intent.totals (computed at initiate-intent), but fall back safely
  const itemsPrice = Number(intent.totals?.subtotal ?? itemsPriceFromVariants ?? 0);
  const taxPrice = Number(intent.totals?.tax ?? 0);
  const shippingPrice = Number(intent.totals?.shippingFee ?? (itemsPrice > 499 ? 0 : 99));
  const discountAmount = Number(intent.totals?.discountAmount ?? 0);
  const totalPrice = Number(intent.totals?.total ?? (itemsPrice + taxPrice + shippingPrice - discountAmount));

  const publicOrderId = makePublicOrderId();

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

  let created;
  try {
    const order = new Order(payload);
    created = await order.save();
  } catch (err) {
    console.error('[orderService] order.save() failed:', err);
    throw err;
  }

  // ----------------------------------
  // 3) Adjust stock (one time per intent)
  // ----------------------------------
  if (shouldAdjustStock && bulkOps.length) {
    try {
      await Product.bulkWrite(bulkOps);

      // sync parent product availability
      for (const item of finalOrderItems) {
        const product = await Product.findById(item.product);
        if (!product) continue;

        const totalStock = product.variants.reduce((sum, v) => sum + (v.stock || 0), 0);
        if (totalStock === 0 && product.isActive) {
          product.isActive = false;
          await product.save().catch(e =>
            console.warn('[orderService] product save warning (new):', e)
          );
        }
      }

      intent.stockAdjusted = true;
      await intent.save().catch(e =>
        console.warn('[orderService] intent save after stockAdjusted (new) warning:', e)
      );
    } catch (err) {
      console.warn('[orderService] bulkWrite stock adjust warning (new):', err);
    }
  }

  // ----------------------------------
  // 4) Push to shipping partner
  // ----------------------------------
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

      await created.save().catch(e =>
        console.warn('[orderService] save after shipping push warning:', e)
      );
    } catch (err) {
      console.error('[orderService] Shipping API push failed:', err?.message || err);
      created.shipping = created.shipping || {};
      created.shipping.status = 'push_failed';
      created.shipping.error = (err?.message || String(err)).slice(0, 2000);
      await created.save().catch(e =>
        console.warn('[orderService] save after shipping error warning:', e)
      );
    }
  }

  // ----------------------------------
  // 5) Send order confirmation email
  // ----------------------------------
  if (sendEmail) {
    try {
      await sendOrderConfirmation(created, {
        name: created.shippingAddress?.fullName,
        email: created.shippingAddress?.email
      });
      created.emailSent = true;
      await created.save().catch(e =>
        console.warn('[orderService] save after email flag warning:', e)
      );
    } catch (err) {
      console.error('[orderService] sendOrderConfirmation failed:', err?.message || err);
      created.emailSent = false;
      created.emailError = (err?.message || String(err)).slice(0, 2000);
      await created.save().catch(e =>
        console.warn('[orderService] save after email error warning:', e)
      );
    }
  }

  return created;
}
