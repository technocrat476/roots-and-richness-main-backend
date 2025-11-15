import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide product name'],
    trim: true,
    maxlength: [100, 'Product name cannot exceed 100 characters']
  },
    slug: {
      type: String,
      required: [true, 'Please provide product slug'],
      unique: true,
      index: true, // ✅ Faster PDP lookups
    },
    price: {
      type: Number,
      required: [true, 'Please provide product price'],
      min: [0, 'Price cannot be negative'],
      index: true, // ✅ Helps sorting/filtering by price
    },
  originalPrice: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0,
    min: [0, 'Discount cannot be negative'],
    max: [100, 'Discount cannot exceed 100%']
  },
  category: {
    type: String,
    required: [true, 'Please provide product category'],
    enum: [
      'Electronics',
      'Clothing',
      'Books',
      'Home & Garden',
      'Sports',
      'Beauty',
      'Toys',
      'Automotive',
      'Health',
      'Food',
      'Wood-Pressed Oils',
      'oils'
      ],
      index: true, // ✅ For category filters
  },
  subcategory: {
    type: String,
    default: '',
    index: true
  },
  description: {
    type: String,
    default: ''
  },
  tagline: {
    type: String,
    default: ''
  },
  shortDescription: {
    type: String,
    default: ''
  },
  brand: {
    type: String,
    default: '',
    index: true
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    alt: {
      type: String,
      default: ''
    }
  }],
  stock: {
    type: Number,
    required: [true, 'Please provide stock quantity'],
    min: [0, 'Stock cannot be negative'],
    default: 0
  },
  sku: {
    type: String,
    unique: true,
    required: true
  },
  weight: {
    type: Number,
    default: 0
  },
  dimensions: {
    length: Number,
    width: Number,
    height: Number
  },
 tags: [{ type: String, index: true }], // ✅ Tag-based recommendations
 features: [String],
 benefits: { type: [String], default: [] }, 	 
 howToUse: { type: [String], default: [] },
 pReview: { type: [String], default: [] },
 reviewBy: { type: [String], default: [] },
 sourceDescription: { type: [String], default: [] },
 ingredients: { type: [String], default: [] },
  specifications: [{
    name: String,
    value: String
  }],
    // Variants
    variants: [
      {
        size: { type: String, required: true }, // e.g. "500ml", "1L"
        price: { type: Number, required: true },
        originalPrice: { type: Number },
        stock: { type: Number, default: 0, min: [0, 'Stock cannot be negative'] }
      }
    ],
  reviews: [reviewSchema],
  rating: {
  type: Number,
  default: 0,
  min: [0, 'Rating cannot be negative'],
  max: [5, 'Rating cannot exceed 5'],
  index: true, // ✅ Sorting top-rated products
  },
  numReviews: {
    type: Number,
    default: 0,
    min: [0, 'Number of Reviews cannot be negative']
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  isFeatured: {
    type: Boolean,
    default: false,
    index: true
  },
  isSale: {
    type: Boolean,
    default: false,
    index: true
  },
  seoTitle: String,
  seoDescription: String,
  seoKeywords: [String],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});
productSchema.virtual("countInStock").get(function () {
  return this.variants.reduce((acc, v) => acc + v.stock, 0);
});

// Calculate average rating
productSchema.methods.calculateAverageRating = function() {
  if (this.reviews.length === 0) {
    this.rating = 0;
    this.numReviews = 0;
  } else {
    const totalRating = this.reviews.reduce((acc, review) => acc + review.rating, 0);
    this.rating = Math.round((totalRating / this.reviews.length) * 10) / 10;
    this.numReviews = this.reviews.length;
  }
};

// Pre-save middleware to calculate rating
productSchema.pre('save', function(next) {
  if (this.reviews && this.reviews.length > 0) {
  this.calculateAverageRating();
}
  next();
});

// 🧭 Compound Indexes for performance
productSchema.index({ category: 1, isActive: 1 });       // Shop listing queries
productSchema.index({ isFeatured: 1, createdAt: -1 });   // Homepage featured products
productSchema.index({ isSale: 1, createdAt: -1 });       // Sale section
productSchema.index({ createdAt: -1 });                  // New arrivals
productSchema.index({ price: 1, rating: -1 });           // Filter + sort combos

// 🕵️ Text index for search
productSchema.index({
  name: 'text',
  description: 'text',
  category: 'text',
  brand: 'text',
  tags: 'text',
});

export default mongoose.model('Product', productSchema);