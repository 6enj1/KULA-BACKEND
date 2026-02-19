import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest, ApiError } from '../types';
import { authenticate, requireRole, optionalAuth } from '../middleware/auth';

const router = Router();

// Helper to calculate distance
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// GET /api/v1/bags
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const {
    latitude, longitude, maxDistanceKm = 10, minPrice, maxPrice,
    foodTypes, minRating, pickupTime, search, sort = 'distance',
    limit = 20, page = 1,
  } = req.query;

  // Build where clause
  const where: any = {
    isActive: true,
    isSoldOut: false,
    pickupEnd: { gt: new Date() },
    restaurant: {
      isActive: true,
      deletedAt: null,
    },
  };

  // Price filter (in cents)
  if (minPrice) where.priceCurrent = { ...where.priceCurrent, gte: Number(minPrice) };
  if (maxPrice) where.priceCurrent = { ...where.priceCurrent, lte: Number(maxPrice) };

  // Food type filter
  if (foodTypes) {
    const types = String(foodTypes).split(',');
    where.foodType = { in: types };
  }

  // Rating filter
  if (minRating) {
    where.restaurant.ratingAvg = { gte: Number(minRating) };
  }

  // Bounding box pre-filter: eliminate restaurants outside maxDistance at DB level
  // 1 degree latitude ≈ 111 km; 1 degree longitude ≈ 111 * cos(lat) km
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!isNaN(lat) && !isNaN(lng)) {
    const maxDist = Number(maxDistanceKm);
    const latDelta = maxDist / 111;
    const lngDelta = maxDist / (111 * Math.cos(lat * Math.PI / 180));
    where.restaurant = {
      ...where.restaurant,
      latitude: { gte: lat - latDelta, lte: lat + latDelta },
      longitude: { gte: lng - lngDelta, lte: lng + lngDelta },
    };
  }

  // Pickup time filter
  const now = new Date();
  if (pickupTime === 'now') {
    where.pickupStart = { lte: now };
    where.pickupEnd = { gt: now };
  } else if (pickupTime === 'today') {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    where.pickupEnd = { lte: endOfDay, gt: now };
  } else if (pickupTime === 'tomorrow') {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const endOfTomorrow = new Date(tomorrow);
    endOfTomorrow.setHours(23, 59, 59, 999);
    where.pickupStart = { gte: tomorrow, lte: endOfTomorrow };
  }

  // Search filter
  if (search) {
    where.OR = [
      { title: { contains: String(search), mode: 'insensitive' } },
      { foodType: { contains: String(search), mode: 'insensitive' } },
      { restaurant: { name: { contains: String(search), mode: 'insensitive' } } },
    ];
  }

  const bags = await prisma.bag.findMany({
    where,
    take: Number(limit),
    skip: (Number(page) - 1) * Number(limit),
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
      restaurant: {
        select: {
          id: true,
          name: true,
          slug: true,
          addressLine1: true,
          city: true,
          latitude: true,
          longitude: true,
          ratingAvg: true,
          ratingCount: true,
          logoUrl: true,
        },
      },
    },
  });

  // Get user's favorites if authenticated
  const favoriteIds = req.user
    ? (await prisma.favorite.findMany({
        where: { userId: req.user.sub },
        select: { bagId: true },
      })).map(f => f.bagId)
    : [];

  // Transform and add calculated fields (lat/lng already parsed above for bounding box)

  let results = bags.map(bag => ({
    ...bag,
    savingsPercent: Math.round((1 - bag.priceCurrent / bag.priceOriginal) * 100),
    isFavorited: favoriteIds.includes(bag.id),
    distanceKm: (!isNaN(lat) && !isNaN(lng) && bag.restaurant)
      ? Math.round(calculateDistance(lat, lng, bag.restaurant.latitude, bag.restaurant.longitude) * 10) / 10
      : null,
  }));

  // Filter by distance
  if (!isNaN(lat) && !isNaN(lng)) {
    results = results.filter(b => b.distanceKm !== null && b.distanceKm <= Number(maxDistanceKm));
  }

  // Sort
  if (sort === 'distance' && !isNaN(lat) && !isNaN(lng)) {
    results.sort((a, b) => (a.distanceKm || 999) - (b.distanceKm || 999));
  } else if (sort === 'price') {
    results.sort((a, b) => a.priceCurrent - b.priceCurrent);
  } else if (sort === 'savings') {
    results.sort((a, b) => b.savingsPercent - a.savingsPercent);
  } else if (sort === 'rating') {
    results.sort((a, b) => (b.restaurant?.ratingAvg || 0) - (a.restaurant?.ratingAvg || 0));
  }

  const total = await prisma.bag.count({ where });

  res.json({
    success: true,
    data: results,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
      hasMore: Number(page) * Number(limit) < total,
    },
  });
});

// GET /api/v1/bags/personalized
router.get('/personalized', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { latitude, longitude, limit = 10 } = req.query;

  // Get user preferences
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { preferences: true, latitude: true, longitude: true },
  });

  const lat = Number(latitude) || user?.latitude;
  const lng = Number(longitude) || user?.longitude;

  // Build where clause favoring user preferences
  const where: any = {
    isActive: true,
    isSoldOut: false,
    pickupEnd: { gt: new Date() },
    restaurant: { isActive: true, deletedAt: null },
  };

  if (user?.preferences?.length) {
    where.foodType = { in: user.preferences };
  }

  const bags = await prisma.bag.findMany({
    where,
    take: Number(limit),
    orderBy: { priceCurrent: 'asc' },
    select: {
      id: true,
      title: true,
      description: true,
      foodType: true,
      priceOriginal: true,
      priceCurrent: true,
      quantityRemaining: true,
      pickupStart: true,
      pickupEnd: true,
      badges: true,
      imageUrl: true,
      restaurant: {
        select: {
          id: true,
          name: true,
          latitude: true,
          longitude: true,
          ratingAvg: true,
          ratingCount: true,
        },
      },
    },
  });

  const results = bags.map(bag => ({
    ...bag,
    savingsPercent: Math.round((1 - bag.priceCurrent / bag.priceOriginal) * 100),
    distanceKm: (lat && lng && bag.restaurant)
      ? Math.round(calculateDistance(lat, lng, bag.restaurant.latitude, bag.restaurant.longitude) * 10) / 10
      : null,
  }));

  // Sort by savings (best deals first)
  results.sort((a, b) => b.savingsPercent - a.savingsPercent);

  res.json({ success: true, data: results });
});

// GET /api/v1/bags/:id
router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { latitude, longitude } = req.query;

  const bag = await prisma.bag.findUnique({
    where: { id },
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
      isActive: true,
      isSoldOut: true,
      restaurant: {
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          logoUrl: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          province: true,
          latitude: true,
          longitude: true,
          phone: true,
          ratingAvg: true,
          ratingCount: true,
        },
      },
    },
  });

  if (!bag) {
    return res.status(404).json({ success: false, error: 'Bag not found' });
  }

  // Check if favorited
  const isFavorited = req.user
    ? !!(await prisma.favorite.findUnique({
        where: { userId_bagId: { userId: req.user.sub, bagId: id } },
      }))
    : false;

  // Calculate distance
  const lat = Number(latitude);
  const lng = Number(longitude);
  const distanceKm = (!isNaN(lat) && !isNaN(lng) && bag.restaurant)
    ? Math.round(calculateDistance(lat, lng, bag.restaurant.latitude, bag.restaurant.longitude) * 10) / 10
    : null;

  res.json({
    success: true,
    data: {
      ...bag,
      savingsPercent: Math.round((1 - bag.priceCurrent / bag.priceOriginal) * 100),
      isFavorited,
      distanceKm,
    },
  });
});

// POST /api/v1/bags (Business creates bag)
router.post('/', authenticate, requireRole('business'), async (req: AuthenticatedRequest, res: Response) => {
  const restaurant = await prisma.restaurant.findUnique({
    where: { ownerId: req.user!.sub },
  });

  if (!restaurant) {
    return res.status(404).json({ success: false, error: 'Restaurant not found' });
  }

  const {
    title, description, foodType, priceOriginal, priceCurrent,
    quantityTotal, pickupStart, pickupEnd, allergens, dietaryInfo, imageUrl,
  } = req.body;

  // Validate required fields
  if (!title || !description || !foodType || !priceOriginal || !priceCurrent || !quantityTotal || !pickupStart || !pickupEnd) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  // Validate pricing
  if (priceCurrent > priceOriginal) {
    return res.status(400).json({ success: false, error: 'Current price cannot exceed original price' });
  }

  // Validate pickup window
  const start = new Date(pickupStart);
  const end = new Date(pickupEnd);
  if (end <= start) {
    return res.status(400).json({ success: false, error: 'Pickup end must be after pickup start' });
  }

  // Auto-assign badges
  const badges: string[] = [];
  const savingsPercent = Math.round((1 - priceCurrent / priceOriginal) * 100);
  if (savingsPercent >= 50) badges.push('Best Value');
  if (quantityTotal <= 5) badges.push('Limited');

  const bag = await prisma.bag.create({
    data: {
      restaurantId: restaurant.id,
      title,
      description,
      foodType,
      priceOriginal,
      priceCurrent,
      quantityTotal,
      quantityRemaining: quantityTotal,
      pickupStart: start,
      pickupEnd: end,
      allergens: allergens || [],
      dietaryInfo: dietaryInfo || [],
      badges,
      imageUrl,
    },
  });

  res.status(201).json({ success: true, data: bag });
});

// PATCH /api/v1/bags/:id (Business updates bag)
router.patch('/:id', authenticate, requireRole('business'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  // Verify ownership
  const restaurant = await prisma.restaurant.findUnique({
    where: { ownerId: req.user!.sub },
  });

  const bag = await prisma.bag.findUnique({
    where: { id },
    select: { restaurantId: true },
  });

  if (!bag || bag.restaurantId !== restaurant?.id) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  const updateData = { ...req.body };
  delete updateData.id;
  delete updateData.restaurantId;

  const updated = await prisma.bag.update({
    where: { id },
    data: updateData,
  });

  res.json({ success: true, data: updated });
});

// DELETE /api/v1/bags/:id
router.delete('/:id', authenticate, requireRole('business'), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const restaurant = await prisma.restaurant.findUnique({
    where: { ownerId: req.user!.sub },
  });

  const bag = await prisma.bag.findUnique({
    where: { id },
    select: { restaurantId: true },
  });

  if (!bag || bag.restaurantId !== restaurant?.id) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  await prisma.bag.delete({ where: { id } });

  res.json({ success: true, message: 'Bag deleted' });
});

export default router;
