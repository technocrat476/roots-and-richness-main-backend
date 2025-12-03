import mongoose from 'mongoose';
const ShippingSchema = new mongoose.Schema({
  fullName: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  addressLine2: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  postalCode: { type: String, default: '' },
  country: { type: String, default: 'India' }
}, { _id: false });

const PaymentAttemptSchema = new mongoose.Schema({
  attemptId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  amountPaise: Number,
  gatewayResponse: mongoose.Schema.Types.Mixed,
  status: { type: String, enum: ['initiated','processing','success','failed'], default: 'initiated' }
});

const PaymentIntentSchema = new mongoose.Schema({
  intentId: { type: String, required: true, unique: true }, // generate (nanoid/uuid)
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  orderItems: { type: Array, required: true },
  merchantOrderId: { type: String, index: true },
  shippingAddress: { type: ShippingSchema, default: {} },
  customerInfo: { type: Object, required: true },
  totals: {
    subtotal: { type: Number, default: 0 },
    shippingFee: Number,
    discountAmount: Number,
    codFee: Number,
    tax: Number,
    total: Number,
    totalPaise: Number
  },
  provider: { type: String, enum: ['phonepe','razorpay','stripe','none'], default: 'phonepe' },
  status: { type: String, enum: ['pending','initiated','paid','failed','expired'], default: 'pending' },
  stockAdjusted: { type: Boolean, default: false },
  attempts: [PaymentAttemptSchema],
  expiresAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});
export default mongoose.models.PaymentIntent || mongoose.model('PaymentIntent', PaymentIntentSchema);
