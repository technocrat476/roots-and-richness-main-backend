import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  image: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1']
  },
size: { type: String },
variantId: { type: String },
});
const shippingSchema = new mongoose.Schema({
  order_id: { type: String },
  reference_id: { type: String },   // ID from shipping partner
  awb_number: { type: String },     // Air Waybill for tracking
  courier: { type: String },        // Courier name if provided
  status: { type: String, enum: ["pushed", "assigned", "pickup_scheduled"], default: "pending" }, // shipping partner status
  label_url: { type: String },      // if label PDF is generated
}, { _id: false });

const shippingAddressSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true
  },
  email: { 
    type: String, 
    required: true 
  },
  address: {
    type: String,
    required: true
  },
  city: {
    type: String,
    required: true
  },
  state: {
    type: String,
    required: true
  },
  postalCode: {
    type: String,
    required: true
  },
  country: {
    type: String,
    required: true,
    default: "India"
  },
  phone: {
    type: String,
    required: true
  }
});

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  orderId: { type: String, required: true, unique: true },
  orderItems: [orderItemSchema],
  shippingAddress: shippingAddressSchema,
  shipping: shippingSchema,
  paymentMethod: {
    type: String,
    required: true,
    enum: ['stripe', 'razorpay', 'cod']
  },
  invoice: {
    pdfUrl: { type: String },          // optional - S3/url or local path
    generatedAt: { type: Date },
    breakdown: { type: Object }        // store numeric breakdown used to render
  },
  paymentResult: {
    id: String,
    status: String,
    update_time: String,
    email_address: String
  },
  itemsPrice: {
    type: Number,
    required: true,
    default: 0.0
  },
  taxPrice: {
    type: Number,
    required: true,
    default: 0.0
  },
  shippingPrice: {
    type: Number,
    required: true,
    default: 0.0
  },
  codFee: {
    type: Number,
    required: true,
    default: 0.0
  },
  totalPrice: {
    type: Number,
    required: true,
    default: 0.0
  },
  couponCode: {
    type: String,
    default: ''
  },
  discountAmount: {
    type: Number,
    default: 0
  },
  isPaid: {
    type: Boolean,
    required: true,
    default: false
  },
  paidAt: {
    type: Date
  },
  isDelivered: {
    type: Boolean,
    required: true,
    default: false
  },
  deliveredAt: {
    type: Date
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  trackingNumber: {
    type: String,
    default: ''
  },
  courierPartner: {
    type: String,
    default: ''
  },
  shippingDetails: {
    type: Object
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Generate order number
orderSchema.pre('save', function(next) {
  if (!this.orderNumber) {
    this.orderNumber = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  }
  next();
});

export default mongoose.model('Order', orderSchema);