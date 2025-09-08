import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: [true, 'Please provide coupon code'],
    unique: true,
    uppercase: true,
    trim: true,
    minlength: [3, 'Coupon code must be at least 3 characters'],
    maxlength: [20, 'Coupon code cannot exceed 20 characters']
  },
  description: {
    type: String,
    required: [true, 'Please provide coupon description']
  },
  type: {
    type: String,
    required: true,
    enum: ['percentage', 'fixed'],
    default: 'percentage'
  },
  value: {
    type: Number,
    required: [true, 'Please provide coupon value'],
    min: [0, 'Coupon value cannot be negative']
  },
  minimumAmount: {
    type: Number,
    default: 0,
    min: [0, 'Minimum amount cannot be negative']
  },
  maximumDiscount: {
    type: Number,
    default: 0,
    min: [0, 'Maximum discount cannot be negative']
  },
  usageLimit: {
    type: Number,
    default: 1,
    min: [1, 'Usage limit must be at least 1']
  },
  usedCount: {
    type: Number,
    default: 0,
    min: [0, 'Used count cannot be negative']
  },
  userLimit: {
    type: Number,
    default: 1,
    min: [1, 'User limit must be at least 1']
  },
  usedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    usedAt: {
      type: Date,
      default: Date.now
    },
    orderAmount: Number
  }],
  validFrom: {
    type: Date,
    required: true,
    default: Date.now
  },
  validUntil: {
    type: Date,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  applicableCategories: [String],
  applicableProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Check if coupon is valid
couponSchema.methods.isValid = function() {
  const now = new Date();
  return (
    this.isActive &&
    this.validFrom <= now &&
    this.validUntil >= now &&
    this.usedCount < this.usageLimit
  );
};

// Calculate discount amount
couponSchema.methods.calculateDiscount = function(orderAmount) {
  if (!this.isValid() || orderAmount < this.minimumAmount) {
    return 0;
  }

  let discount = 0;
  if (this.type === 'percentage') {
    discount = (orderAmount * this.value) / 100;
    if (this.maximumDiscount > 0 && discount > this.maximumDiscount) {
      discount = this.maximumDiscount;
    }
  } else {
    discount = this.value;
  }

  return Math.min(discount, orderAmount);
};

export default mongoose.model('Coupon', couponSchema);