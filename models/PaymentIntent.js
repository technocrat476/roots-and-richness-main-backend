import mongoose from 'mongoose';
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
  customerInfo: { type: Object, required: true },
  totals: {
    itemsPrice: Number,
    shippingPrice: Number,
    discountAmount: Number,
    codFee: Number,
    tax: Number,
    total: Number,
    totalPaise: Number
  },
  provider: { type: String, enum: ['phonepe','razorpay','stripe','none'], default: 'phonepe' },
  status: { type: String, enum: ['pending','initiated','paid','failed','expired'], default: 'pending' },
  attempts: [PaymentAttemptSchema],
  expiresAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});
export default mongoose.models.PaymentIntent || mongoose.model('PaymentIntent', PaymentIntentSchema);
