// utils/gstInvoiceGenerator.js
import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export const calculateInvoice = (order, opts = {}) => {
  const items = (order.items ?? []).map(it => {
    const qty = new Decimal(it.qty ?? 1);
    const mrp = new Decimal(it.price ?? 0); // Tax-inclusive MRP
    const gstPercent = new Decimal(it.gstPercent ?? 5);

    return { ...it, qty, mrp, gstPercent };
  });

  // Total MRP of goods
  const totalMrp = items.reduce((acc, it) => acc.plus(it.mrp.times(it.qty)), new Decimal(0));

  // Allocate discount proportionally
  const discountTotal = new Decimal(order.discountAmount ?? 0);
  const allocatedItems = items.map(it => {
    const proportion = totalMrp.isZero() ? new Decimal(0) : it.mrp.times(it.qty).dividedBy(totalMrp);
    const discountAllocated = discountTotal.times(proportion).toDecimalPlaces(2);
    const afterDiscount = it.mrp.times(it.qty).minus(discountAllocated).toDecimalPlaces(2);

    // Taxable value and GST
    const taxableValue = afterDiscount.dividedBy(new Decimal(1).plus(it.gstPercent.dividedBy(100))).toDecimalPlaces(2);
    const gstAmount = afterDiscount.minus(taxableValue).toDecimalPlaces(2);
    const lineTotal = afterDiscount;

    return {
      ...it,
      discountAllocated,
      afterDiscount,
      taxableValue,
      gstAmount,
      lineTotal
    };
  });

  // Goods subtotal, taxable value, total GST
  const goodsSubtotal = allocatedItems.reduce((acc, it) => acc.plus(it.mrp.times(it.qty)), new Decimal(0));
  const totalDiscount = allocatedItems.reduce((acc, it) => acc.plus(it.discountAllocated), new Decimal(0));
  const goodsTaxable = allocatedItems.reduce((acc, it) => acc.plus(it.taxableValue), new Decimal(0));
  const totalGstGoods = allocatedItems.reduce((acc, it) => acc.plus(it.gstAmount), new Decimal(0));

  // COD handling fee
  const codFee = new Decimal(order.codFee ?? 0);
  const codGstPercent = new Decimal(18);
  const codTaxable = codFee.dividedBy(new Decimal(1).plus(codGstPercent.dividedBy(100))).toDecimalPlaces(2);
  const codGst = codFee.minus(codTaxable).toDecimalPlaces(2);

  // Shipping charges (if applicable)
  const shippingFee = new Decimal(order.shippingPrice ?? 0);
  const shippingGstPercent = new Decimal(order.shippingGstPercent ?? 18);
  const shippingApplied = shippingFee.gt(0);
  const shippingTaxable = shippingApplied
    ? shippingFee.dividedBy(new Decimal(1).plus(shippingGstPercent.dividedBy(100))).toDecimalPlaces(2)
    : new Decimal(0);
  const shippingGst = shippingFee.minus(shippingTaxable).toDecimalPlaces(2);

  // Total taxable value and total GST
  const totalTaxableValue = goodsTaxable.plus(codTaxable).plus(shippingTaxable).toDecimalPlaces(2);
  const totalGst = totalGstGoods.plus(codGst).plus(shippingGst).toDecimalPlaces(2);

  // Subtotal, round off, amount payable
  const subtotal = totalTaxableValue.plus(totalGst).toDecimalPlaces(2);
  const roundOff = new Decimal(Math.round(subtotal) - subtotal).toDecimalPlaces(2);
  const amountPayable = subtotal.plus(roundOff).toDecimalPlaces(2);

  const fmt = d => new Decimal(d).toFixed(2);

  return {
    items: allocatedItems.map(it => ({
      name: it.name,
      sku: it.sku || '',
      hsn: it.hsn || '',
      qty: it.qty.toNumber(),
      mrp: fmt(it.mrp),
      discountAllocated: fmt(it.discountAllocated),
      afterDiscount: fmt(it.afterDiscount),
      taxableValue: fmt(it.taxableValue),
      gstPercent: Number(it.gstPercent),
      gstAmount: fmt(it.gstAmount),
      lineTotal: fmt(it.lineTotal)
    })),
    goodsSubtotal: fmt(goodsSubtotal),
    totalDiscount: fmt(totalDiscount),
    goodsTaxable: fmt(goodsTaxable),
    cod: {
      fee: fmt(codFee),
      taxable: fmt(codTaxable),
      gstPercent: codGstPercent.toNumber(),
      gstAmount: fmt(codGst),
      lineTotal: fmt(codFee)
    },
    shipping: {
      fee: fmt(shippingFee),
      taxable: fmt(shippingTaxable),
      gstPercent: shippingGstPercent.toNumber(),
      gstAmount: fmt(shippingGst),
      lineTotal: fmt(shippingFee)
    },
    totals: {
      totalTaxableValue: fmt(totalTaxableValue),
      totalGst: fmt(totalGst),
      subtotal: fmt(subtotal),
      roundOff: fmt(roundOff),
      amountPayable: fmt(amountPayable)
    }
  };
};

export default calculateInvoice;
