# E-Commerce Backend API

A complete, production-ready backend API for an e-commerce application built with Node.js, Express, and MongoDB.

## Features

### 🔐 Authentication & Authorization
- JWT-based authentication
- Role-based access control (User/Admin)
- Password hashing with bcrypt
- Password reset functionality
- Email verification

### 🛍️ Product Management
- CRUD operations for products
- Product categories and filtering
- Product search with text indexing
- Image upload with Cloudinary
- Product reviews and ratings
- Stock management
- Featured products

### 📦 Order Management
- Complete order lifecycle
- Multiple payment methods (Stripe, Razorpay, COD)
- Order status tracking
- Email notifications
- Order history

### 💳 Payment Integration
- Stripe payment processing
- Razorpay integration
- Webhook handling
- Payment verification

### 🎫 Coupon System
- Percentage and fixed amount coupons
- Usage limits and restrictions
- Minimum order requirements
- User-specific limits

### 📝 Blog System
- Blog post management
- Categories and tags
- Comments and likes
- SEO optimization

### 👥 User Management
- User profiles
- Address management
- Order history
- Account deletion

### 📊 Admin Dashboard
- Sales analytics
- User management
- Product management
- Order management
- Dashboard statistics

### 📧 Email System
- Order confirmations
- Password reset emails
- Welcome emails
- Status updates

### 🔒 Security Features
- Rate limiting
- CORS protection
- Helmet security headers
- Input validation
- Error handling

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/ecommerce
JWT_SECRET=your-super-secret-jwt-key-here
JWT_EXPIRE=7d

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password

# Payment Gateways
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_razorpay_secret

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Frontend URL
FRONTEND_URL=http://localhost:3000

# Admin Credentials
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123
```

5. Start the server:
```bash
# Development
npm run dev

# Production
npm start
```

6. Seed the database (optional):
```bash
node utils/seedData.js --seed
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile
- `PUT /api/auth/change-password` - Change password
- `POST /api/auth/forgot-password` - Forgot password
- `PUT /api/auth/reset-password/:token` - Reset password

### Products
- `GET /api/products` - Get all products
- `GET /api/products/:id` - Get single product
- `POST /api/products` - Create product (Admin)
- `PUT /api/products/:id` - Update product (Admin)
- `DELETE /api/products/:id` - Delete product (Admin)
- `POST /api/products/:id/reviews` - Add review
- `GET /api/products/categories/list` - Get categories
- `GET /api/products/featured/list` - Get featured products

### Orders
- `POST /api/orders` - Create order
- `GET /api/orders/:id` - Get order by ID
- `PUT /api/orders/:id/pay` - Update order to paid
- `GET /api/orders/user/myorders` - Get user orders
- `GET /api/orders` - Get all orders (Admin)
- `PUT /api/orders/:id/status` - Update order status (Admin)
- `PUT /api/orders/:id/cancel` - Cancel order

### Payments
- `POST /api/payments/stripe/create-intent` - Create Stripe payment intent
- `POST /api/payments/stripe/confirm` - Confirm Stripe payment
- `POST /api/payments/razorpay/create-order` - Create Razorpay order
- `POST /api/payments/razorpay/verify` - Verify Razorpay payment
- `POST /api/payments/cod/confirm` - Confirm COD order

### Coupons
- `GET /api/coupons` - Get all coupons (Admin)
- `POST /api/coupons` - Create coupon (Admin)
- `PUT /api/coupons/:id` - Update coupon (Admin)
- `DELETE /api/coupons/:id` - Delete coupon (Admin)
- `POST /api/coupons/validate` - Validate coupon
- `POST /api/coupons/apply` - Apply coupon

### Blog
- `GET /api/blog` - Get all blogs
- `GET /api/blog/:slug` - Get single blog
- `POST /api/blog` - Create blog (Admin)
- `PUT /api/blog/:id` - Update blog (Admin)
- `DELETE /api/blog/:id` - Delete blog (Admin)
- `POST /api/blog/:id/comments` - Add comment
- `POST /api/blog/:id/like` - Like/unlike blog
- `GET /api/blog/categories/list` - Get categories
- `GET /api/blog/featured/list` - Get featured blogs

### Admin
- `GET /api/admin/stats` - Get dashboard stats
- `GET /api/admin/users` - Get all users
- `PUT /api/admin/users/:id/role` - Update user role
- `DELETE /api/admin/users/:id` - Delete user
- `GET /api/admin/analytics/sales` - Get sales analytics

### Upload
- `POST /api/upload/image` - Upload single image (Admin)
- `POST /api/upload/images` - Upload multiple images (Admin)
- `DELETE /api/upload/image/:publicId` - Delete image (Admin)

## Database Models

### User
- Personal information
- Authentication data
- Role-based permissions
- Address information

### Product
- Product details
- Pricing and inventory
- Categories and tags
- Images and specifications
- Reviews and ratings

### Order
- Order items
- Shipping information
- Payment details
- Status tracking

### Blog
- Content management
- Categories and tags
- Comments and likes
- SEO optimization

### Coupon
- Discount configuration
- Usage tracking
- Validity periods
- Restrictions

## Security Features

- **Authentication**: JWT tokens with secure headers
- **Authorization**: Role-based access control
- **Rate Limiting**: Prevents API abuse
- **Input Validation**: Comprehensive request validation
- **CORS**: Configurable cross-origin requests
- **Helmet**: Security headers
- **Password Hashing**: Bcrypt with salt rounds

## Error Handling

Comprehensive error handling with:
- Custom error classes
- Validation error formatting
- Database error handling
- JWT error handling
- Development vs production error responses

## Testing

The API includes comprehensive error handling and validation. Test with tools like:
- Postman
- Insomnia
- Thunder Client
- curl

## Deployment

The backend is ready for deployment on platforms like:
- Heroku
- Railway
- DigitalOcean
- AWS
- Vercel

Make sure to:
1. Set all environment variables
2. Configure MongoDB connection
3. Set up payment webhooks
4. Configure email service
5. Set up Cloudinary for image uploads

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.