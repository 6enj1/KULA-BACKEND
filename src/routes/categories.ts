import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest } from '../types';

const router = Router();

// GET /api/v1/categories
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      icon: true,
      emoji: true,
    },
  });

  res.json({ success: true, data: categories });
});

export default router;
