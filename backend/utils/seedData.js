import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Blog from '../models/Blog.js';
import Coupon from '../models/Coupon.js';
import connectDB from '../config/database.js';

dotenv.config();

// Sample data
const users = [
  {
    name: 'Admin User',
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD || 'admin123',
    role: 'admin',
    isEmailVerified: true
  },
  {
    name: 'John Doe',
    email: 'john@example.com',
    password: 'password123',
    role: 'user',
    isEmailVerified: true
  },
  {
    name: 'Jane Smith',
    email: 'jane@example.com',
    password: 'password123',
    role: 'user',
    isEmailVerified: true
  }
];

const products = [
  {
    name: 'Wireless Bluetooth Headphones',
    description: 'High-quality wireless headphones with noise cancellation and long battery life.',
    price: 99.99,
    originalPrice: 129.99,
    discount: 23,
    category: 'Electronics',
    subcategory: 'Audio',
    brand: 'TechSound',
    images: [
      {
        url: 'https://images.pexels.com/photos/3394650/pexels-photo-3394650.jpeg',
        alt: 'Wireless Bluetooth Headphones'
      }
    ],
    stock: 50,
    sku: 'WBH-001',
    weight: 0.3,
    tags: ['wireless', 'bluetooth', 'headphones', 'audio'],
    features: [
      'Active Noise Cancellation',
      '30-hour battery life',
      'Quick charge technology',
      'Premium sound quality'
    ],
    specifications: [
      { name: 'Battery Life', value: '30 hours' },
      { name: 'Charging Time', value: '2 hours' },
      { name: 'Bluetooth Version', value: '5.0' },
      { name: 'Weight', value: '300g' }
    ],
    isFeatured: true,
    seoTitle: 'Best Wireless Bluetooth Headphones - Premium Audio Experience',
    seoDescription: 'Experience premium audio with our wireless Bluetooth headphones featuring noise cancellation and 30-hour battery life.',
    seoKeywords: ['wireless headphones', 'bluetooth headphones', 'noise cancellation']
  },
  {
    name: 'Smart Fitness Watch',
    description: 'Advanced fitness tracking watch with heart rate monitoring, GPS, and smartphone connectivity.',
    price: 199.99,
    originalPrice: 249.99,
    discount: 20,
    category: 'Electronics',
    subcategory: 'Wearables',
    brand: 'FitTech',
    images: [
      {
        url: 'https://images.pexels.com/photos/437037/pexels-photo-437037.jpeg',
        alt: 'Smart Fitness Watch'
      }
    ],
    stock: 30,
    sku: 'SFW-002',
    weight: 0.05,
    tags: ['smartwatch', 'fitness', 'health', 'gps'],
    features: [
      'Heart rate monitoring',
      'GPS tracking',
      'Water resistant',
      'Sleep tracking',
      'Smartphone notifications'
    ],
    specifications: [
      { name: 'Display', value: '1.4" AMOLED' },
      { name: 'Battery Life', value: '7 days' },
      { name: 'Water Resistance', value: '5ATM' },
      { name: 'Connectivity', value: 'Bluetooth 5.0' }
    ],
    isFeatured: true,
    seoTitle: 'Smart Fitness Watch with GPS and Heart Rate Monitor',
    seoDescription: 'Track your fitness goals with our advanced smartwatch featuring GPS, heart rate monitoring, and 7-day battery life.',
    seoKeywords: ['smart watch', 'fitness tracker', 'heart rate monitor', 'gps watch']
  },
  {
    name: 'Organic Cotton T-Shirt',
    description: 'Comfortable and sustainable organic cotton t-shirt available in multiple colors.',
    price: 29.99,
    originalPrice: 39.99,
    discount: 25,
    category: 'Clothing',
    subcategory: 'T-Shirts',
    brand: 'EcoWear',
    images: [
      {
        url: 'https://images.pexels.com/photos/1040945/pexels-photo-1040945.jpeg',
        alt: 'Organic Cotton T-Shirt'
      }
    ],
    stock: 100,
    sku: 'OCT-003',
    weight: 0.2,
    tags: ['organic', 'cotton', 't-shirt', 'sustainable'],
    features: [
      '100% organic cotton',
      'Pre-shrunk fabric',
      'Comfortable fit',
      'Available in multiple colors'
    ],
    specifications: [
      { name: 'Material', value: '100% Organic Cotton' },
      { name: 'Fit', value: 'Regular' },
      { name: 'Care', value: 'Machine washable' },
      { name: 'Origin', value: 'Sustainably sourced' }
    ],
    isFeatured: false,
    seoTitle: 'Organic Cotton T-Shirt - Sustainable and Comfortable',
    seoDescription: 'Shop our eco-friendly organic cotton t-shirts. Comfortable, sustainable, and available in multiple colors.',
    seoKeywords: ['organic cotton', 't-shirt', 'sustainable clothing', 'eco-friendly']
  }
];

const blogs = [
  {
    title: 'The Future of Sustainable Fashion',
    content: `
      <p>Sustainable fashion is no longer just a trend—it's becoming a necessity. As consumers become more environmentally conscious, the fashion industry is responding with innovative solutions that prioritize both style and sustainability.</p>
      
      <h3>What is Sustainable Fashion?</h3>
      <p>Sustainable fashion refers to clothing, shoes, and accessories that are manufactured, marketed, and used in the most sustainable manner possible. This takes into account both environmental and socio-economic aspects.</p>
      
      <h3>Key Principles of Sustainable Fashion</h3>
      <ul>
        <li><strong>Eco-friendly materials:</strong> Using organic, recycled, or biodegradable materials</li>
        <li><strong>Ethical production:</strong> Ensuring fair wages and safe working conditions</li>
        <li><strong>Durability:</strong> Creating high-quality items that last longer</li>
        <li><strong>Circular economy:</strong> Designing for reuse, repair, and recycling</li>
      </ul>
      
      <h3>The Impact of Fast Fashion</h3>
      <p>The fast fashion industry has significant environmental and social impacts. It's responsible for 10% of global carbon emissions and is the second-largest consumer of water worldwide. Additionally, the industry often relies on cheap labor in developing countries.</p>
      
      <h3>How to Shop More Sustainably</h3>
      <p>Here are some tips for making more sustainable fashion choices:</p>
      <ol>
        <li>Buy less, choose well</li>
        <li>Look for sustainable certifications</li>
        <li>Support ethical brands</li>
        <li>Care for your clothes properly</li>
        <li>Consider second-hand and vintage options</li>
      </ol>
      
      <p>The future of fashion lies in sustainability. By making conscious choices, we can support a more ethical and environmentally friendly industry.</p>
    `,
    excerpt: 'Explore how sustainable fashion is reshaping the industry and learn how to make more eco-conscious clothing choices.',
    category: 'Fashion',
    tags: ['sustainability', 'fashion', 'environment', 'ethical'],
    status: 'published',
    publishedAt: new Date(),
    seoTitle: 'The Future of Sustainable Fashion - Eco-Friendly Clothing Guide',
    seoDescription: 'Discover the future of sustainable fashion and learn how to make eco-conscious clothing choices that benefit both you and the environment.',
    seoKeywords: ['sustainable fashion', 'eco-friendly clothing', 'ethical fashion', 'green fashion']
  },
  {
    title: 'Top 10 Tech Gadgets for 2024',
    content: `
      <p>Technology continues to evolve at a rapid pace, bringing us innovative gadgets that make our lives easier, more productive, and more enjoyable. Here are the top 10 tech gadgets that are making waves in 2024.</p>
      
      <h3>1. AI-Powered Smart Speakers</h3>
      <p>The latest generation of smart speakers features advanced AI capabilities, better sound quality, and improved privacy controls.</p>
      
      <h3>2. Foldable Smartphones</h3>
      <p>Foldable phones have become more durable and affordable, offering the convenience of a tablet in a pocket-sized device.</p>
      
      <h3>3. Wireless Charging Stations</h3>
      <p>Multi-device wireless charging stations that can power your phone, earbuds, and smartwatch simultaneously.</p>
      
      <h3>4. VR Fitness Equipment</h3>
      <p>Virtual reality fitness equipment that makes working out more engaging and fun.</p>
      
      <h3>5. Smart Home Security Systems</h3>
      <p>Advanced security systems with AI-powered threat detection and smartphone integration.</p>
      
      <h3>6. Portable Projectors</h3>
      <p>Compact projectors that can display high-quality images anywhere, perfect for presentations or entertainment.</p>
      
      <h3>7. Health Monitoring Wearables</h3>
      <p>Advanced wearables that can monitor various health metrics and provide personalized insights.</p>
      
      <h3>8. Electric Scooters</h3>
      <p>Eco-friendly electric scooters with improved battery life and smart connectivity features.</p>
      
      <h3>9. Smart Kitchen Appliances</h3>
      <p>Kitchen appliances that can be controlled remotely and offer recipe suggestions based on available ingredients.</p>
      
      <h3>10. Noise-Canceling Earbuds</h3>
      <p>Premium earbuds with advanced noise cancellation and superior sound quality.</p>
      
      <p>These gadgets represent the cutting edge of consumer technology, offering new ways to enhance our daily lives through innovation and convenience.</p>
    `,
    excerpt: 'Discover the most innovative and useful tech gadgets that are defining 2024, from AI-powered devices to sustainable technology.',
    category: 'Technology',
    tags: ['technology', 'gadgets', '2024', 'innovation'],
    status: 'published',
    publishedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    seoTitle: 'Top 10 Tech Gadgets for 2024 - Latest Technology Trends',
    seoDescription: 'Explore the top 10 tech gadgets of 2024, featuring the latest innovations in AI, wearables, smart home technology, and more.',
    seoKeywords: ['tech gadgets 2024', 'latest technology', 'smart devices', 'innovation']
  }
];

const coupons = [
  {
    code: 'WELCOME10',
    description: 'Welcome discount for new customers',
    type: 'percentage',
    value: 10,
    minimumAmount: 50,
    maximumDiscount: 20,
    usageLimit: 1000,
    userLimit: 1,
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    isActive: true
  },
  {
    code: 'SAVE25',
    description: 'Save $25 on orders over $100',
    type: 'fixed',
    value: 25,
    minimumAmount: 100,
    usageLimit: 500,
    userLimit: 1,
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days from now
    isActive: true
  }
];

// Seed function
const seedData = async () => {
  try {
    await connectDB();

    // Clear existing data
    await User.deleteMany({});
    await Product.deleteMany({});
    await Blog.deleteMany({});
    await Coupon.deleteMany({});

    console.log('Existing data cleared');

    // Create users
    const createdUsers = await User.create(users);
    console.log('Users created');

    // Add createdBy to products and blogs
    const adminUser = createdUsers.find(user => user.role === 'admin');

    const productsWithCreator = products.map(product => ({
      ...product,
      createdBy: adminUser._id
    }));

    const blogsWithAuthor = blogs.map(blog => ({
      ...blog,
      author: adminUser._id
    }));

    const couponsWithCreator = coupons.map(coupon => ({
      ...coupon,
      createdBy: adminUser._id
    }));

    // Create products, blogs, and coupons
    await Product.create(productsWithCreator);
    console.log('Products created');

    await Blog.create(blogsWithAuthor);
    console.log('Blogs created');

    await Coupon.create(couponsWithCreator);
    console.log('Coupons created');

    console.log('Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

// Run seed function if called directly
if (process.argv[2] === '--seed') {
  seedData();
}

export default seedData;