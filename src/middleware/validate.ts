import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

// Validation middleware factory
export function validate<T>(schema: ZodSchema<T>, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: messages,
      });
    }
    // Replace with validated/transformed data
    // For query, we need to use Object.assign since req.query is getter-only
    if (source === 'query') {
      Object.assign(req.query, result.data);
    } else {
      req[source] = result.data as any;
    }
    next();
  };
}

// ============================================
// AUTH SCHEMAS
// ============================================
export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Password must contain at least one special character'),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  role: z.enum(['consumer', 'business']).optional().default('consumer'),
});

export const socialAuthSchema = z.object({
  provider: z.enum(['apple', 'google']),
  token: z.string().min(1, 'Token is required'),
  email: z.string().email().optional().nullable(),
  name: z.string().max(100).optional().nullable(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ============================================
// ORDER SCHEMAS
// ============================================
export const createOrderSchema = z.object({
  bagId: z.string().uuid('Invalid bag ID'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(10, 'Maximum 10 per order').optional().default(1),
});

export const cancelOrderSchema = z.object({
  reason: z.string().max(500, 'Reason too long').optional(),
});

// ============================================
// BAG SCHEMAS
// ============================================
export const createBagSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().min(1, 'Description is required').max(2000, 'Description too long'),
  foodType: z.string().min(1, 'Food type is required').max(50, 'Food type too long'),
  priceOriginal: z.number().int().min(100, 'Price must be at least R1.00'),
  priceCurrent: z.number().int().min(100, 'Price must be at least R1.00'),
  quantityTotal: z.number().int().min(1, 'Quantity must be at least 1').max(100, 'Maximum 100 per listing'),
  pickupStart: z.string().datetime('Invalid datetime format'),
  pickupEnd: z.string().datetime('Invalid datetime format'),
  allergens: z.array(z.string().max(50)).max(20).optional(),
  dietaryInfo: z.array(z.string().max(50)).max(20).optional(),
  imageUrl: z.string().url('Invalid image URL').optional(),
});

export const updateBagSchema = createBagSchema.partial();

// ============================================
// RESTAURANT SCHEMAS
// ============================================
export const createRestaurantSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name too long'),
  description: z.string().max(2000, 'Description too long').optional(),
  addressLine1: z.string().min(1, 'Address is required').max(200, 'Address too long'),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(1, 'City is required').max(100),
  province: z.string().min(1, 'Province is required').max(100),
  postalCode: z.string().min(1, 'Postal code is required').max(20),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
});

// ============================================
// SEARCH & QUERY SCHEMAS
// ============================================
export const searchQuerySchema = z.object({
  q: z.string().min(2, 'Query too short').max(100, 'Query too long').optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  page: z.coerce.number().int().min(1).optional().default(1),
});

export const bagQuerySchema = paginationSchema.extend({
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  maxDistanceKm: z.coerce.number().min(1).max(100).optional().default(10),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  foodTypes: z.string().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  pickupTime: z.enum(['now', 'today', 'tomorrow']).optional(),
  search: z.string().max(100).optional(),
  sort: z.enum(['distance', 'price', 'savings', 'rating']).optional().default('distance'),
});

// ============================================
// BUSINESS SCHEMAS
// ============================================
export const updateOrderStatusSchema = z.object({
  status: z.enum(['ready', 'collected', 'cancelled']),
});

export const scanQrSchema = z.object({
  qrCode: z.string().min(1, 'QR code is required'),
});

// ============================================
// USER SCHEMAS
// ============================================
export const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const updatePreferencesSchema = z.object({
  preferences: z.array(z.string().max(50)).max(20),
});

// ============================================
// ADDRESS SCHEMAS
// ============================================
export const createAddressSchema = z.object({
  label: z.string().min(1).max(100),
  addressType: z.enum(['home', 'work', 'other']).optional().default('other'),
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  province: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isDefault: z.boolean().optional(),
});

// ============================================
// REVIEW SCHEMAS
// ============================================
export const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().max(1000).optional(),
});
