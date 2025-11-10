import mongoose from 'mongoose';

const blogSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please provide blog title'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters'],
    index: true // ✅ Speeds up title search & listing
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  content: {
    type: String,
    required: [true, 'Please provide blog content']
  },
  excerpt: {
    type: String,
    maxlength: [500, 'Excerpt cannot exceed 500 characters']
  },
  featuredImage: {
    url: String,
    alt: String
  },
  author: {
    type: String,
    required: true,
    index: true // ✅ For author-based filters
  },
  category: {
    type: String,
    required: true,
    enum: [
      'Health & Wellness',
      'Sustainability',
      'Products',
      'Technology',
      'Lifestyle',
      'Health',
      'Business',
      'Travel',
      'Food',
      'Fashion',
      'Sports',
      'Entertainment',
      'Education'
      ],
      index: true // ✅ For category filtering
    },
    tags: [{ type: String, index: true }], // ✅ Helps tag-based related blogs
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true // ✅ For status filtering in admin
    },
    publishedAt: {
      type: Date,
      index: true // ✅ For sorting by publish date
    },
    views: {
      type: Number,
      default: 0,
      index: true // ✅ For popular posts
  },
  likes: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    name: {
      type: String,
      required: true
    },
    comment: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  seoTitle: String,
  seoDescription: String,
  seoKeywords: [String],
  readingTime: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Generate slug from title
blogSchema.pre('save', function(next) {
  if (this.isModified('title')) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .replace(/\s+/g, '-');
  }
  
  // Calculate reading time (average 200 words per minute)
  if (this.isModified('content')) {
    const wordCount = this.content.split(/\s+/).length;
    this.readingTime = Math.ceil(wordCount / 200);
  }
  
  next();
});

// 🧭 Compound Indexes
blogSchema.index({ category: 1, status: 1, publishedAt: -1 }); // ✅ For category listings
blogSchema.index({ status: 1, publishedAt: -1 });              // ✅ For homepage “recent posts”
blogSchema.index({ views: -1, publishedAt: -1 });              // ✅ For trending/popular posts

// 🕵️ Full-text search for SEO + user search
blogSchema.index({
  title: 'text',
  content: 'text',
  tags: 'text',
  category: 'text'
});

export default mongoose.model('Blog', blogSchema);