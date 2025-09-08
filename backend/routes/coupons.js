import express from 'express';
import Coupon from '../models/Coupon.js';
import { protect, admin } from '../middleware/auth.js';
import { validateCoupon } from '../middleware/validation.js';

const router = express.Router();

// @desc    Get all coupons
// @route   GET /api/coupons
// @access  Private/Admin
router.get('/', protect, admin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const coupons = await Coupon.find()
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Coupon.countDocuments();

    res.status(200).json({
      success: true,
      count: coupons.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      coupons
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Create coupon
// @route   POST /api/coupons
// @access  Private/Admin
router.post('/', protect, admin, validateCoupon, async (req, res) => {
  try {
    req.body.createdBy = req.user.id;
    
    const coupon = await Coupon.create(req.body);

    res.status(201).json({
      success: true,
      message: 'Coupon created successfully',
      coupon
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Update coupon
// @route   PUT /api/coupons/:id
// @access  Private/Admin
router.put('/:id', protect, admin, async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true
      }
    );

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Coupon updated successfully',
      coupon
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Delete coupon
// @route   DELETE /api/coupons/:id
// @access  Private/Admin
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    await coupon.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Coupon deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Validate coupon
// @route   POST /api/coupons/validate
// @access  Private
router.post('/validate', protect, async (req, res) => {
  try {
    const { code, orderAmount } = req.body;

    if (!code || !orderAmount) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code and order amount are required'
      });
    }

    const coupon = await Coupon.findOne({ 
      code: code.toUpperCase(),
      isActive: true 
    });

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Invalid coupon code'
      });
    }

    // Check if coupon is valid
    if (!coupon.isValid()) {
      return res.status(400).json({
        success: false,
        message: 'Coupon has expired or reached usage limit'
      });
    }

    // Check minimum amount
    if (orderAmount < coupon.minimumAmount) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount of $${coupon.minimumAmount} required`
      });
    }

    // Check user usage limit
    const userUsage = coupon.usedBy.filter(
      usage => usage.user.toString() === req.user.id
    ).length;

    if (userUsage >= coupon.userLimit) {
      return res.status(400).json({
        success: false,
        message: 'You have reached the usage limit for this coupon'
      });
    }

    // Calculate discount
    const discountAmount = coupon.calculateDiscount(orderAmount);

    res.status(200).json({
      success: true,
      message: 'Coupon is valid',
      coupon: {
        code: coupon.code,
        description: coupon.description,
        type: coupon.type,
        value: coupon.value,
        discountAmount,
        minimumAmount: coupon.minimumAmount,
        maximumDiscount: coupon.maximumDiscount
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Apply coupon to order
// @route   POST /api/coupons/apply
// @access  Private
router.post('/apply', protect, async (req, res) => {
  try {
    const { code, orderAmount, orderId } = req.body;

    const coupon = await Coupon.findOne({ 
      code: code.toUpperCase(),
      isActive: true 
    });

    if (!coupon || !coupon.isValid()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired coupon'
      });
    }

    // Check user usage limit
    const userUsage = coupon.usedBy.filter(
      usage => usage.user.toString() === req.user.id
    ).length;

    if (userUsage >= coupon.userLimit) {
      return res.status(400).json({
        success: false,
        message: 'Coupon usage limit exceeded'
      });
    }

    const discountAmount = coupon.calculateDiscount(orderAmount);

    if (discountAmount === 0) {
      return res.status(400).json({
        success: false,
        message: 'Coupon cannot be applied to this order'
      });
    }

    // Record coupon usage
    coupon.usedBy.push({
      user: req.user.id,
      orderAmount,
      usedAt: new Date()
    });
    coupon.usedCount += 1;
    await coupon.save();

    res.status(200).json({
      success: true,
      message: 'Coupon applied successfully',
      discountAmount,
      coupon: {
        code: coupon.code,
        description: coupon.description
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

export default router;