import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';

import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import prisma from './utils/prisma';

// ============================================
// ENVIRONMENT VALIDATION
// ============================================
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'YOCO_SECRET_KEY',
  'YOCO_WEBHOOK_SECRET',
];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error('FATAL: Missing required environment variables:');
  missingEnvVars.forEach((envVar) => console.error(`  - ${envVar}`));
  process.exit(1);
}

// Import routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import categoryRoutes from './routes/categories';
import restaurantRoutes from './routes/restaurants';
import bagRoutes from './routes/bags';
import orderRoutes from './routes/orders';
import reviewRoutes from './routes/reviews';
import favoriteRoutes from './routes/favorites';
import addressRoutes from './routes/addresses';
import searchRoutes from './routes/search';
import businessRoutes from './routes/business';
import paymentRoutes from './routes/payments';
import uploadRoutes from './routes/uploads';

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://kula-dashboard.vercel.app']
    : ['http://localhost:5173', 'https://kula-dashboard.vercel.app'],
  credentials: true,
}));

// Rate limiting - general
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { success: false, error: 'Too many requests, please try again later' },
});
app.use(limiter);

// Strict rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: { success: false, error: 'Too many authentication attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Compression
app.use(compression());

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Health check with DB ping
app.get('/health', async (req, res) => {
  try {
    // Verify database connection
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
    });
  }
});

// Serve uploaded files
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// API Routes - Auth routes with strict rate limiting
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth/refresh', authLimiter);
app.use('/api/v1/auth/social', authLimiter);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/restaurants', restaurantRoutes);
app.use('/api/v1/bags', bagRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/reviews', reviewRoutes);
app.use('/api/v1/favorites', favoriteRoutes);
app.use('/api/v1/addresses', addressRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/business', businessRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/uploads', uploadRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
async function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Close database connection
  try {
    await prisma.$disconnect();
    console.log('Database connection closed.');
  } catch (error) {
    console.error('Error closing database connection:', error);
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const server = app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║     SAVR API Server                       ║
  ║     Running on http://localhost:${PORT}      ║
  ║     Environment: ${process.env.NODE_ENV || 'development'}            ║
  ╚═══════════════════════════════════════════╝
  `);
});

// Set keep-alive timeout for graceful shutdown
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

export default app;
