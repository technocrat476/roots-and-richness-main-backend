import express from 'express';
import Blog from '../models/Blog.js';
import { protect, admin, optionalAuth } from '../middleware/auth.js';
import { validateBlog } from '../middleware/validation.js';
import { normalizeIncomingHtml } from '../utils/html-normalize.js';

const router = express.Router();

// @desc    Get all blogs
// @route   GET /api/blog
// @access  Public
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build query
    let query = { status: 'published' };

    // Search
    if (req.query.search) {
      query.$text = { $search: req.query.search };
    }

    // Category filter
    if (req.query.category) {
      query.category = req.query.category;
    }

    // Tag filter
    if (req.query.tag) {
      query.tags = { $in: [req.query.tag] };
    }

    // Sort options
    let sortOptions = {};
    switch (req.query.sort) {
      case 'oldest':
        sortOptions = { publishedAt: 1 };
        break;
      case 'popular':
        sortOptions = { views: -1 };
        break;
      case 'title':
        sortOptions = { title: 1 };
        break;
      default:
        sortOptions = { publishedAt: -1 };
    }

    const blogs = await Blog.find(query)
      .populate('author', 'name avatar')
      .select('-content') // Exclude full content for list view
      .sort(sortOptions)
      .skip(skip)
      .limit(limit);

    const total = await Blog.countDocuments(query);

    res.status(200).json({
      success: true,
      count: blogs.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      blogs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get blog categories
// @route   GET /api/blog/categories/list
// @access  Public
router.get('/categories/list', async (req, res) => {
  try {
    const categories = await Blog.distinct('category', { status: 'published' });
    const tags = await Blog.distinct('tags', { status: 'published' });

    res.status(200).json({
      success: true,
      categories,
      tags
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get featured blogs
// @route   GET /api/blog/featured/list
// @access  Public
router.get('/featured/list', async (req, res) => {
  try {
    const blogs = await Blog.find({ 
      status: 'published'
    })
      .populate('author', 'name avatar')
      .select('-content')
      .sort({ views: -1 })
      .limit(5);

    res.status(200).json({
      success: true,
      blogs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get recent blogs
// @route   GET /api/blog/recent/list
// @access  Public
router.get('/recent/list', async (req, res) => {
  try {
    const blogs = await Blog.find({ status: 'published' })
      .populate('author', 'name avatar')
      .select('-content')
      .sort({ publishedAt: -1 }) // latest first
      .limit(5);

    res.status(200).json({
      success: true,
      blogs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get single blog
// @route   GET /api/blog/:slug
// @access  Public
router.get('/:slug', optionalAuth, async (req, res) => {
  try {
    const blog = await Blog.findOne({ 
      slug: req.params.slug,
      status: 'published'
    })
      .populate('author', 'name avatar')
      .populate('comments.user', 'name avatar');

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: 'Blog post not found'
      });
    }

    // Increment views
    blog.views += 1;
    await blog.save();

    res.status(200).json({
      success: true,
      blog
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Create blog
// @route   POST /api/blog
// @access  Private/Admin
router.post('/', protect, admin, validateBlog, async (req, res) => {
try {
  const author = req.body.author || req.user?.name || 'Admin';

  // Normalize / decode content
  const cleanedContent = normalizeIncomingHtml(req.body.content);

  // Normalize featured shape
  const featured = (req.body.featured === true || req.body.featured === 'true');

  // Normalize featuredImage
  const featuredImage = typeof req.body.featuredImage === 'string'
    ? { url: req.body.featuredImage, alt: req.body.title || 'Blog image' }
    : (req.body.featuredImage || { url: '', alt: req.body.title || 'Blog image' });

  const payload = {
    title: req.body.title,
    slug: req.body.slug,
    excerpt: req.body.excerpt || '',
    content: cleanedContent,
    author,
    category: req.body.category || 'General',
    featuredImage,
    status: req.body.status || 'draft',
    featured,
    publishedAt: req.body.status === 'published' ? (req.body.publishedAt || new Date()) : req.body.publishedAt,
  };

  const blog = await Blog.create(payload);
  res.status(201).json({ success: true, message: 'Blog created successfully', blog });
  } catch (error) {
    console.error("Create blog error:", error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Update blog
// @route   PUT /api/blog/:id
// @access  Private/Admin
router.put('/:id', protect, admin, async (req, res) => {
try {
  const blog = await Blog.findById(req.params.id);
  if (!blog) return res.status(404).json({ success: false, message: 'Blog not found' });

  const cleanedContent = normalizeIncomingHtml(req.body.content ?? blog.content ?? '');
  const featured = (req.body.featured === true || req.body.featured === 'true');

  let featuredImage = blog.featuredImage || { url: '', alt: '' };
  if (typeof req.body.featuredImage === 'string') {
    featuredImage = { url: req.body.featuredImage, alt: req.body.featuredImageAlt || req.body.title || blog.title || 'Blog image' };
  } else if (req.body.featuredImage && typeof req.body.featuredImage === 'object') {
    featuredImage = {
      url: req.body.featuredImage.url || featuredImage.url,
      alt: req.body.featuredImage.alt || featuredImage.alt,
    };
  }

  // publishedAt logic unchanged
  let publishedAt = blog.publishedAt;
  if (req.body.status === 'published' && blog.status !== 'published') publishedAt = new Date();
  if (req.body.publishedAt) publishedAt = req.body.publishedAt;

  const payload = {
    title: req.body.title ?? blog.title,
    slug: req.body.slug ?? blog.slug,
    excerpt: req.body.excerpt ?? blog.excerpt,
    content: cleanedContent,
    author: req.body.author || blog.author || req.user?.name || 'Admin',
    category: req.body.category ?? blog.category ?? 'General',
    featuredImage,
    status: req.body.status ?? blog.status,
    featured,
    publishedAt,
  };

  const updatedBlog = await Blog.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
  res.status(200).json({ success: true, message: 'Blog updated successfully', blog: updatedBlog });
  } catch (error) {
    console.error("Update blog error:", error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Delete blog
// @route   DELETE /api/blog/:id
// @access  Private/Admin
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: 'Blog not found'
      });
    }

    await blog.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Blog deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Add comment to blog
// @route   POST /api/blog/:id/comments
// @access  Private
router.post('/:id/comments', protect, async (req, res) => {
  try {
    const { comment } = req.body;

    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Comment is required'
      });
    }

    const blog = await Blog.findById(req.params.id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: 'Blog not found'
      });
    }

    const newComment = {
      user: req.user.id,
      name: req.user.name,
      comment: comment.trim()
    };

    blog.comments.push(newComment);
    await blog.save();

    res.status(201).json({
      success: true,
      message: 'Comment added successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Like/Unlike blog
// @route   POST /api/blog/:id/like
// @access  Private
router.post('/:id/like', protect, async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);

    if (!blog) {
      return res.status(404).json({
        success: false,
        message: 'Blog not found'
      });
    }

    const likeIndex = blog.likes.findIndex(
      like => like.user.toString() === req.user.id
    );

    if (likeIndex > -1) {
      // Unlike
      blog.likes.splice(likeIndex, 1);
      await blog.save();

      res.status(200).json({
        success: true,
        message: 'Blog unliked',
        liked: false,
        likesCount: blog.likes.length
      });
    } else {
      // Like
      blog.likes.push({ user: req.user.id });
      await blog.save();

      res.status(200).json({
        success: true,
        message: 'Blog liked',
        liked: true,
        likesCount: blog.likes.length
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get blog by id
// @route   GET /api/blog/admin/:id
// @access  Private/Admin
router.get('/admin/:id', protect, admin, async (req, res) => {
  console.log("📩 Incoming request for blog:", req.params.id);
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ success: false, message: 'Blog not found' });
    }
    res.json({ success: true, blog });
  } catch (error) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

export default router;