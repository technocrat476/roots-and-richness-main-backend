import express from 'express';
import { protect, admin } from '../middleware/auth.js';
import Product from '../models/Product.js';

const router = express.Router();

// @route   POST /api/products
// @desc    Create a new product
// @access  Private/Admin
router.post('/', protect, admin, async (req, res) => {
  try {
    const {
      name,
      price,
      description,
      image,
      brand,
      category,
      countInStock,
    } = req.body;

    const product = new Product({
      name,
      price,
      description,
      image,
      brand,
      category,
      countInStock,
    });

    const createdProduct = await product.save();
    res.status(201).json({
      success: true,
      message: 'Product added successfully',
      product: createdProduct,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

export default router;
