import mongoose from 'mongoose';

const blogSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please provide blog title'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
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
    required: true
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
    ]
  },
  tags: [String],
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft'
  },
  publishedAt: {
    type: Date
  },
  views: {
    type: Number,
    default: 0
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

// Index for search
blogSchema.index({
  title: 'text',
  content: 'text',
  tags: 'text'
});

export default mongoose.model('Blog', blogSchema);