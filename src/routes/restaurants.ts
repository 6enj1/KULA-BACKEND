import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest, ApiError } from '../types';
import { authenticate, requireRole, optionalAuth } from '../middleware/auth';

const router = Router();

// Helper to calculate distance between two points (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// GET /api/v1/restaurants
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { latitude, longitude, maxDistanceKm = 20, limit = 20, page = 1 } = req.query;

  const restaurants = await prisma.restaurant.findMany({
    where: {
      isActive: true,
      deletedAt: null,
    },
    take: Number(limit),
    skip: (Number(page) - 1) * Number(limit),
    orderBy: { ratingAvg: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logoUrl: true,
      heroImageUrl: true,
      addressLine1: true,
      city: true,
      latitude: true,
      longitude: true,
      phone: true,
      ratingAvg: true,
      ratingCount: true,
      categories: {
        select: {
          category: {
            select: { id: true, name: true, icon: true },
          },
        },
      },
      openingHours: {
        select: {
          dayOfWeek: true,
          openTime: true,
          closeTime: true,
          isClosed: true,
        },
      },
      _count: {
        select: { orders: true },
      },
    },
  });

  // Calculate distances if user location provided
  const lat = Number(latitude);
  const lng = Number(longitude);
  const restaurantsWithDistance = restaurants.map(r => ({
    ...r,
    categories: r.categories.map(c => c.category),
    totalOrders: r._count.orders,
    _count: undefined,
    distanceKm: (!isNaN(lat) && !isNaN(lng))
      ? Math.round(calculateDistance(lat, lng, r.latitude, r.longitude) * 10) / 10
      : null,
  }));

  // Filter by distance if provided
  const filtered = (!isNaN(lat) && !isNaN(lng))
    ? restaurantsWithDistance.filter(r => r.distanceKm! <= Number(maxDistanceKm))
    : restaurantsWithDistance;

  res.json({ success: true, data: filtered });
});

// GET /api/v1/restaurants/:id
router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const restaurant = await prisma.restaurant.findUnique({
    where: { id, isActive: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      logoUrl: true,
      heroImageUrl: true,
      photos: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      province: true,
      postalCode: true,
      country: true,
      latitude: true,
      longitude: true,
      phone: true,
      email: true,
      website: true,
      ratingAvg: true,
      ratingCount: true,
      isVerified: true,
      categories: {
        select: {
          category: {
            select: { id: true, name: true, icon: true, emoji: true },
          },
        },
      },
      openingHours: {
        select: {
          dayOfWeek: true,
          openTime: true,
          closeTime: true,
          isClosed: true,
        },
      },
      _count: {
        select: { orders: true },
      },
    },
  });

  if (!restaurant) {
    return res.status(404).json({ success: false, error: 'Restaurant not found' });
  }

  res.json({
    success: true,
    data: {
      ...restaurant,
      categories: restaurant.categories.map(c => c.category),
      totalOrders: restaurant._count.orders,
    },
  });
});

// GET /api/v1/restaurants/:id/bags
router.get('/:id/bags', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const bags = await prisma.bag.findMany({
    where: {
      restaurantId: id,
      isActive: true,
      isSoldOut: false,
      pickupEnd: { gt: new Date() },
    },
    orderBy: { pickupStart: 'asc' },
    select: {
      id: true,
      title: true,
      description: true,
      foodType: true,
      priceOriginal: true,
      priceCurrent: true,
      quantityTotal: true,
      quantityRemaining: true,
      pickupStart: true,
      pickupEnd: true,
      badges: true,
      allergens: true,
      dietaryInfo: true,
      imageUrl: true,
    },
  });

  // Add savings percentage
  const bagsWithSavings = bags.map(bag => ({
    ...bag,
    savingsPercent: Math.round((1 - bag.priceCurrent / bag.priceOriginal) * 100),
  }));

  res.json({ success: true, data: bagsWithSavings });
});

// GET /api/v1/restaurants/:id/reviews
router.get('/:id/reviews', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { limit = 20, page = 1 } = req.query;

  const reviews = await prisma.review.findMany({
    where: {
      restaurantId: id,
      isVisible: true,
    },
    take: Number(limit),
    skip: (Number(page) - 1) * Number(limit),
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      rating: true,
      text: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
        },
      },
    },
  });

  const total = await prisma.review.count({
    where: { restaurantId: id, isVisible: true },
  });

  res.json({
    success: true,
    data: reviews,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
      hasMore: Number(page) * Number(limit) < total,
    },
  });
});

// POST /api/v1/restaurants (Business onboarding)
router.post('/', authenticate, requireRole('business'), async (req: AuthenticatedRequest, res: Response) => {
  const {
    name, description, addressLine1, addressLine2, city, province, postalCode,
    latitude, longitude, phone, email, website, categoryIds,
  } = req.body;

  // Check if user already has a restaurant
  const existing = await prisma.restaurant.findUnique({
    where: { ownerId: req.user!.sub },
  });

  if (existing) {
    return res.status(409).json({ success: false, error: 'You already have a restaurant' });
  }

  // Validate required fields
  if (!name || !addressLine1 || !city || !province || !postalCode || !latitude || !longitude) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  // Generate slug
  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let slug = baseSlug;
  let counter = 1;
  while (await prisma.restaurant.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${counter++}`;
  }

  const restaurant = await prisma.restaurant.create({
    data: {
      ownerId: req.user!.sub,
      name,
      slug,
      description,
      addressLine1,
      addressLine2,
      city,
      province,
      postalCode,
      latitude,
      longitude,
      phone,
      email,
      website,
      categories: categoryIds?.length ? {
        create: categoryIds.map((categoryId: string) => ({ categoryId })),
      } : undefined,
    },
    include: {
      categories: {
        select: {
          category: {
            select: { id: true, name: true, icon: true },
          },
        },
      },
    },
  });

  res.status(201).json({
    success: true,
    data: {
      ...restaurant,
      categories: restaurant.categories.map(c => c.category),
    },
  });
});

// GET /api/v1/restaurants/mine
router.get('/mine', authenticate, requireRole('business'), async (req: AuthenticatedRequest, res: Response) => {
  const restaurant = await prisma.restaurant.findUnique({
    where: { ownerId: req.user!.sub },
    include: {
      categories: {
        select: {
          category: {
            select: { id: true, name: true, icon: true, emoji: true },
          },
        },
      },
      openingHours: true,
    },
  });

  if (!restaurant) {
    return res.status(404).json({ success: false, error: 'Restaurant not found. Complete onboarding first.' });
  }

  res.json({
    success: true,
    data: {
      ...restaurant,
      categories: restaurant.categories.map(c => c.category),
    },
  });
});

export default router;
