/* server.js — Final Render-optimized and corrected version */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import mongoSanitize from 'express-mongo-sanitize';
import xssClean from 'xss-clean';
import hpp from 'hpp';
import connectDB from './config/database.js';
import errorHandler from './middleware/errorHandler.js';

// Routes
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import orderRoutes from './routes/orders.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
// NOTE: payments.js should export a default router AND a named `webhookHandler`
// e.g. export default router; export const webhookHandler = async (req, res) => { ... }
import paymentRoutes, { webhookHandler } from './routes/payments.js';
import blogRoutes from './routes/blog.js';
import couponRoutes from './routes/coupons.js';
import uploadRoutes from './routes/upload.js';
import subscriberRoutes from './routes/subscribers.js';
import contactRouter from './routes/contact.js';
import trackRouter from './routes/track.js';

const app = express();
const PORT = process.env.PORT || 5000;

/* ──────────────────────────────────────────
   Render-specific: trust proxy so req.ip and req.secure are correct
────────────────────────────────────────── */
app.set('trust proxy', 1); // REQUIRED on Render

// remove X-Powered-By
app.disable('x-powered-by');

/* ──────────────────────────────────────────
   Connect DB
────────────────────────────────────────── */
connectDB();

/* ──────────────────────────────────────────
   Security headers (single unified helmet config)
────────────────────────────────────────── */
// Build dynamic CSP lists from envs (these will be merged into directives)
const frontendOrigin = process.env.FRONTEND_URL;
const stripeOrigin = 'https://js.stripe.com';
const fontsOrigin = 'https://fonts.googleapis.com';
const fontsGStatic = 'https://fonts.gstatic.com';
const possibleImgCdn = process.env.IMG_CDN_URL; // optional S3/Cloud CDN domain
const connectSrcList = [
  "'self'",
  frontendOrigin,
  'https://api.stripe.com',
  process.env.API_THIRD_PARTY // add other third-party API origins via env
].filter(Boolean);

const imgSrcList = ["'self'", 'data:', possibleImgCdn].filter(Boolean);

app.use(
  helmet({
    // many sub-headers enabled by default in Helmet v5+
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer-when-downgrade' },
  })
);

// HSTS: safe on Render (HTTPS terminated at edge)
if (process.env.NODE_ENV === 'production') {
  app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true, preload: true }));
}

// Content-Security-Policy: start in report-only mode to avoid breaking features.
// Set CSP_REPORT_ONLY=0 in Render when you have a working policy.
const cspReportOnly = process.env.CSP_REPORT_ONLY !== '0'; // default true
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", stripeOrigin, frontendOrigin, "'unsafe-eval'"], // unsafe-eval optional for some bundlers; remove if not needed
      styleSrc: ["'self'", fontsOrigin, "'unsafe-inline'"], // unsafe-inline often needed for fonts; remove after audits
      fontSrc: ["'self'", fontsGStatic],
      imgSrc: imgSrcList,
      connectSrc: connectSrcList,
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      // add reportUri/reportTo if you have a reporting endpoint
    },
    reportOnly: cspReportOnly
  })
);

/* ──────────────────────────────────────────
   CORS (allowlist with regex support)
────────────────────────────────────────── */
// Build allowlist dynamically from envs. Add custom domains with comma-separated env or JSON.
const allowlist = new Set(
  [
    process.env.FRONTEND_URL,
    process.env.FRONTEND_ALT, // optional
    // allow the Render service URL as fallback if present (example)
    process.env.FRONTEND_RENDER_URL, // optional
  ]
    .filter(Boolean)
);

// option: allow subdomains of a domain via regex (e.g., admin subdomain)
const allowlistRegexStrings = (process.env.CORS_ALLOW_REGEX || '').split(',').filter(Boolean); // e.g. "https://.*\\.mydomain\\.com"
const allowlistRegexes = allowlistRegexStrings.map((s) => new RegExp(s));

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow non-browser or curl/postman
    if (allowlist.has(origin)) return callback(null, true);
    // test regexes
    for (const re of allowlistRegexes) {
      if (re.test(origin)) return callback(null, true);
    }
    return callback(new Error('CORS blocked: origin not allowed'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token']
};

app.use(cors(corsOptions));
// Preflight for all routes
app.options('*', cors(corsOptions));

/* ──────────────────────────────────────────
   Compression after security headers and CORS
────────────────────────────────────────── */
app.use(compression());

/* ──────────────────────────────────────────
   Body parsing & cookie parser
   NOTE: Stripe-like webhooks require raw body to verify signature.
   We'll mount webhookHandler with express.raw() before express.json()
────────────────────────────────────────── */

// 1) Webhook route (UNLIMITED / UNPARSED JSON) — mount before express.json() and before rate-limit middleware
// Ensure payments.js exports named `webhookHandler`, else remove this block and handle inside payments router.
if (webhookHandler) {
  // raw body for signature verification (type depends on provider; many use application/json)
  app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), webhookHandler);
}

/* 2) JSON/body parser for all other routes */
const GLOBAL_JSON_LIMIT = process.env.JSON_LIMIT || '10mb';
app.use(express.json({ limit: GLOBAL_JSON_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: GLOBAL_JSON_LIMIT }));
app.use(cookieParser());

/* ──────────────────────────────────────────
   PhonePe Webhook
────────────────────────────────────────── */
app.post('/api/payments/phonepe/webhook', express.raw({ type: 'application/json' }), webhookHandler);

/* ──────────────────────────────────────────
   Input Hardening (NoSQL injection, XSS, HPP)
────────────────────────────────────────── */
app.use(mongoSanitize());
app.use(xssClean());
app.use(hpp());

/* ──────────────────────────────────────────
   Logging
────────────────────────────────────────── */
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

/* ──────────────────────────────────────────
   Rate limiting & slowDown
   - global light limiter
   - per-route example for auth
   - payment webhook is mounted above and intentionally NOT rate-limited
────────────────────────────────────────── */

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.GLOBAL_RATE_LIMIT_MAX || '200', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', globalLimiter);

// slowDown to add cost to abusive clients
app.use(
  '/api/',
  slowDown({
    windowMs: 60 * 1000,
    delayAfter: 20,
    delayMs: 300
  })
);

// per-route stricter limiters (apply only to public auth endpoints)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '6', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, try again later.' }
});

/* ──────────────────────────────────────────
   Mount routes
   NOTE: webhook must be mounted above (done earlier) — avoid duplicate routes.
────────────────────────────────────────── */

app.get('/health', (req, res) => res.json({ success: true, timestamp: Date.now() }));

// Sensitive: apply authLimiter to auth routes
app.use('/api/auth', authLimiter, authRoutes);

// Payment route (non-webhook endpoints go through this router)
// payment webhook already mounted at /api/payments/webhook (raw + no limiter)
app.use('/api/payments', paymentRoutes);

// Other routes (protected by global limiter)
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/subscribe', subscriberRoutes);
app.use('/api/contact', contactRouter);
app.use('/api', trackRouter);

/* ──────────────────────────────────────────
   404 handler + centralized error handler
────────────────────────────────────────── */
app.use('*', (req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// centralized error handler (make sure it hides stack traces in production)
app.use(errorHandler);

/* ──────────────────────────────────────────
   Start server
────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} on port ${PORT}`);
});

export default app;
