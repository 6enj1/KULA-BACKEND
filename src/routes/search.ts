import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest } from '../types';
import { authenticate, optionalAuth } from '../middleware/auth';

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

// GET /api/v1/search
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { q, latitude, longitude } = req.query;

  if (!q || String(q).length < 2) {
    return res.json({ success: true, data: { recentSearches: [], restaurants: [], suggestions: [] } });
  }

  const query = String(q).toLowerCase();
  const lat = Number(latitude);
  const lng = Number(longitude);

  // Get matching recent searches for this user
  const recentSearches = req.user
    ? await prisma.recentSearch.findMany({
        where: {
          userId: req.user.sub,
          query: { startsWith: query, mode: 'insensitive' },
        },
        take: 3,
        orderBy: { createdAt: 'desc' },
        select: { query: true },
      })
    : [];

  // Search restaurants
  const restaurants = await prisma.restaurant.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      name: { contains: query, mode: 'insensitive' },
    },
    take: 5,
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      categories: {
        take: 1,
        select: {
          category: { select: { name: true, icon: true } },
        },
      },
    },
  });

  // Search categories for suggestions
  const categories = await prisma.category.findMany({
    where: {
      isActive: true,
      name: { contains: query, mode: 'insensitive' },
    },
    take: 3,
    select: { name: true },
  });

  // Search food types in bags
  const foodTypes = await prisma.bag.findMany({
    where: {
      isActive: true,
      foodType: { contains: query, mode: 'insensitive' },
    },
    distinct: ['foodType'],
    take: 3,
    select: { foodType: true },
  });

  res.json({
    success: true,
    data: {
      recentSearches: recentSearches.map(s => s.query),
      restaurants: restaurants.map(r => ({
        id: r.id,
        name: r.name,
        subtitle: r.categories[0]?.category.name || 'Restaurant',
        icon: r.categories[0]?.category.icon || 'fork.knife',
        distanceKm: (!isNaN(lat) && !isNaN(lng))
          ? Math.round(calculateDistance(lat, lng, r.latitude, r.longitude) * 10) / 10
          : null,
      })),
      suggestions: [
        ...categories.map(c => c.name),
        ...foodTypes.map(f => f.foodType),
      ].slice(0, 5),
    },
  });
});

// GET /api/v1/search/suggestions
router.get('/suggestions', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  // Get categories
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    take: 10,
    select: { id: true, name: true, icon: true, emoji: true },
  });

  // Get recent searches
  const recentSearches = await prisma.recentSearch.findMany({
    where: { userId: req.user!.sub },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { query: true },
  });

  // Get "order again" - restaurants from past orders
  const pastOrders = await prisma.order.findMany({
    where: {
      userId: req.user!.sub,
      status: 'collected',
    },
    distinct: ['restaurantId'],
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: {
      restaurant: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
          categories: {
            take: 1,
            select: {
              category: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  res.json({
    success: true,
    data: {
      categories,
      recentSearches: recentSearches.map(s => s.query),
      orderAgain: pastOrders.map(o => ({
        id: o.restaurant.id,
        name: o.restaurant.name,
        subtitle: o.restaurant.categories[0]?.category.name || 'Restaurant',
        logoUrl: o.restaurant.logoUrl,
      })),
    },
  });
});

// GET /api/v1/search/recent
router.get('/recent', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const searches = await prisma.recentSearch.findMany({
    where: { userId: req.user!.sub },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, query: true, createdAt: true },
  });

  res.json({ success: true, data: searches });
});

// DELETE /api/v1/search/recent
router.delete('/recent', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  await prisma.recentSearch.deleteMany({
    where: { userId: req.user!.sub },
  });

  res.json({ success: true, message: 'Recent searches cleared' });
});

// POST /api/v1/search/recent (save a search)
router.post('/recent', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { query } = req.body;

  if (!query || String(query).length < 2) {
    return res.status(400).json({ success: false, error: 'Query too short' });
  }

  // Upsert - update timestamp if exists, create if not
  await prisma.recentSearch.upsert({
    where: {
      userId_query: { userId: req.user!.sub, query: String(query) },
    },
    update: { createdAt: new Date() },
    create: {
      userId: req.user!.sub,
      query: String(query),
    },
  });

  res.json({ success: true });
});

export default router;
