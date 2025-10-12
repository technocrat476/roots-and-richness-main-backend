import express from 'express';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Blog from '../models/Blog.js';
import Coupon from '../models/Coupon.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();

// @desc    Get admin dashboard stats
// @route   GET /api/admin/stats
// @access  Private/Admin
router.get('/stats', protect, admin, async (req, res) => {
  try {
    // Get date ranges
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

    // Total counts
    const totalUsers = await User.countDocuments({ role: 'user' });
    const totalProducts = await Product.countDocuments();
    const totalOrders = await Order.countDocuments();
    const totalBlogs = await Blog.countDocuments();

    // ✅ Calculate total stock across all variants
    const products = await Product.find().select("variants.stock");
    const totalStock = products.reduce((sum, p) => {
      return sum + p.variants.reduce((vSum, v) => vSum + v.stock, 0);
    }, 0);

    // Monthly stats
    const monthlyUsers = await User.countDocuments({
      role: 'user',
      createdAt: { $gte: startOfMonth }
    });

    const monthlyOrders = await Order.countDocuments({
      createdAt: { $gte: startOfMonth }
    });

    const monthlyRevenue = await Order.aggregate([
      {
        $match: {
          isPaid: true,
          createdAt: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalPrice' }
        }
      }
    ]);

    const lastMonthRevenue = await Order.aggregate([
      {
        $match: {
          isPaid: true,
          createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalPrice' }
        }
      }
    ]);

    // Order status distribution
    const orderStatusStats = await Order.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Top selling products
    const topProducts = await Order.aggregate([
      { $unwind: '$orderItems' },
      {
        $group: {
          _id: '$orderItems.product',
          totalSold: { $sum: '$orderItems.quantity' },
          revenue: { $sum: { $multiply: ['$orderItems.price', '$orderItems.quantity'] } }
        }
      },
      { $sort: { totalSold: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          name: '$product.name',
          totalSold: 1,
          revenue: 1
        }
      }
    ]);

    // Recent orders
    const recentOrders = await Order.find()
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('_id user totalPrice status createdAt');

    // Low stock products
    const lowStockProducts = await Product.find({
      stock: { $lte: 10 },
      isActive: true
    })
      .select('name stock')
      .sort({ stock: 1 })
      .limit(5);

    const currentMonthRevenue = monthlyRevenue[0]?.total || 0;
    const previousMonthRevenue = lastMonthRevenue[0]?.total || 0;
    const revenueGrowth = previousMonthRevenue > 0 
      ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue * 100).toFixed(2)
      : 0;

    res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        totalProducts,
        totalOrders,
        totalBlogs,
        totalStock,
        monthlyUsers,
        monthlyOrders,
        monthlyRevenue: currentMonthRevenue,
        revenueGrowth: parseFloat(revenueGrowth),
        orderStatusStats,
        topProducts,
        recentOrders,
        lowStockProducts
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

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private/Admin
router.get('/users', protect, admin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build query
    let query = {};

    // Search
    if (req.query.search) {
      query.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    // Role filter
    if (req.query.role) {
      query.role = req.query.role;
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      users
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Update user role
// @route   PUT /api/admin/users/:id/role
// @access  Private/Admin
router.put('/users/:id/role', protect, admin, async (req, res) => {
  try {
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User role updated successfully',
      user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
router.delete('/users/:id', protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent admin from deleting themselves
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    await user.deleteOne();

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get sales analytics
// @route   GET /api/admin/analytics/sales
// @access  Private/Admin
router.get("/analytics/sales", protect, admin, async (req, res) => {
  try {
    const period = parseInt(req.query.period) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);

    // DAILY SALES
    const dailySales = await Order.aggregate([
      {
        $match: { createdAt: { $gte: startDate } }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          totalSales: { $sum: "$totalPrice" },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

const monthlySales = await Order.aggregate([
  { $match: { createdAt: { $gte: startDate } } },
  {
    $group: {
      _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
      totalSales: { $sum: "$totalPrice" },
      orders: { $sum: 1 }
    }
  },
  { $sort: { _id: 1 } }
]);

// Send in the same format as dailySales
const monthlySalesData = monthlySales.map(item => {
  const [year, month] = item._id.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  const monthName = date.toLocaleString("default", { month: "short" }); // "Sep"
  return {
    month: `${monthName} ${year}`, // e.g., "Sep 2025"
    sales: item.totalSales,
    orders: item.orders
  };
});


    // CATEGORY SALES
const categorySales = await Order.aggregate([
  {
    $match: { createdAt: { $gte: startDate } }
  },
  { $unwind: "$orderItems" },
  {
    $addFields: {
      itemFinalPrice: {
        $multiply: [
          { $divide: [ { $multiply: ["$orderItems.price", "$orderItems.quantity"] }, "$itemsPrice" ] },
          "$totalPrice"
        ]
      }
    }
  },
  {
    $lookup: {
      from: "products",
      localField: "orderItems.product",
      foreignField: "_id",
      as: "productDetails"
    }
  },
  { $unwind: "$productDetails" },
  {
    $group: {
      _id: "$productDetails.category",
      sales: { $sum: "$itemFinalPrice" },
      itemsSold: { $sum: "$orderItems.quantity" }
    }
  },
  {
    $project: {
      _id: 0,
      category: "$_id",
      sales: 1,
      itemsSold: 1
    }
  }
]);

const productSales = await Order.aggregate([
  {
    $match: { createdAt: { $gte: startDate } }
  },
  { $unwind: "$orderItems" },
  {
    $addFields: {
      itemFinalPrice: {
        $multiply: [
          { $divide: [ { $multiply: ["$orderItems.price", "$orderItems.quantity"] }, "$itemsPrice" ] },
          "$totalPrice"
        ]
      }
    }
  },
  {
    $lookup: {
      from: "products",
      localField: "orderItems.product",
      foreignField: "_id",
      as: "productDetails"
    }
  },
  { $unwind: "$productDetails" },
  {
    $group: {
      _id: {
        product: "$productDetails.name",
        variant: "$orderItems.size"
      },
      sales: { $sum: "$itemFinalPrice" },
      quantity: { $sum: "$orderItems.quantity" }
    }
  },
  {
    $project: {
      _id: 0,
      product: "$_id.product",
      variant: "$_id.variant",
      sales: 1,
      quantity: 1
    }
  }
]);

res.json({
  success: true,
  analytics: {
    dailySales: dailySales.map(item => ({
      date: item._id,
      sales: item.totalSales,
      orders: item.orders
    })),
    categorySales: categorySales.map(item => ({
      category: item.category, // ✅ already projected
      sales: item.sales,       // ✅ use correct field
      itemsSold: item.itemsSold
    })),
   monthlySales: monthlySalesData,
   productSales: productSales.map(item => ({
      product: item.product,
      variant: item.variant,
      sales: item.sales,
      quantity: item.quantity
    }))
  }
});
  } catch (error) {
    console.error("Analytics error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
export default router;