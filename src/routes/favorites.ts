import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest } from '../types';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/v1/favorites
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const favorites = await prisma.favorite.findMany({
    where: { userId: req.user!.sub },
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      bag: {
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
          isActive: true,
          isSoldOut: true,
          restaurant: {
            select: {
              id: true,
              name: true,
              addressLine1: true,
              city: true,
              latitude: true,
              longitude: true,
              ratingAvg: true,
              ratingCount: true,
            },
          },
        },
      },
    },
  });

  const bags = favorites.map(f => ({
    ...f.bag,
    savingsPercent: Math.round((1 - f.bag.priceCurrent / f.bag.priceOriginal) * 100),
    isFavorited: true,
    favoritedAt: f.createdAt,
  }));

  res.json({ success: true, data: bags });
});

// POST /api/v1/favorites/:bagId
router.post('/:bagId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { bagId } = req.params;

  // Check if bag exists
  const bag = await prisma.bag.findUnique({ where: { id: bagId } });
  if (!bag) {
    return res.status(404).json({ success: false, error: 'Bag not found' });
  }

  // Check if already favorited
  const existing = await prisma.favorite.findUnique({
    where: { userId_bagId: { userId: req.user!.sub, bagId } },
  });

  if (existing) {
    // Already favorited, return success
    return res.json({ success: true, data: { isFavorited: true } });
  }

  await prisma.favorite.create({
    data: {
      userId: req.user!.sub,
      bagId,
    },
  });

  res.status(201).json({ success: true, data: { isFavorited: true } });
});

// DELETE /api/v1/favorites/:bagId
router.delete('/:bagId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { bagId } = req.params;

  await prisma.favorite.deleteMany({
    where: {
      userId: req.user!.sub,
      bagId,
    },
  });

  res.json({ success: true, data: { isFavorited: false } });
});

export default router;
