import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest } from '../types';
import { authenticate } from '../middleware/auth';

const router = Router();

// POST /api/v1/orders/:orderId/review
router.post('/orders/:orderId/review', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { orderId } = req.params;
  const { rating, text } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, error: 'Rating must be between 1 and 5' });
  }

  // Get order
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      userId: true,
      restaurantId: true,
      status: true,
      review: { select: { id: true } },
    },
  });

  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  if (order.userId !== req.user!.sub) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  if (order.status !== 'collected') {
    return res.status(400).json({ success: false, error: 'Can only review collected orders' });
  }

  if (order.review) {
    return res.status(409).json({ success: false, error: 'Review already exists' });
  }

  // Create review
  const review = await prisma.review.create({
    data: {
      orderId,
      userId: req.user!.sub,
      restaurantId: order.restaurantId,
      rating,
      text,
    },
  });

  // Update restaurant rating (Prisma doesn't have triggers, so we do it manually)
  const stats = await prisma.review.aggregate({
    where: { restaurantId: order.restaurantId, isVisible: true },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await prisma.restaurant.update({
    where: { id: order.restaurantId },
    data: {
      ratingAvg: stats._avg.rating || 0,
      ratingCount: stats._count.rating,
    },
  });

  // Award bonus loyalty points for reviewing
  await prisma.user.update({
    where: { id: req.user!.sub },
    data: { loyaltyPoints: { increment: 5 } },
  });

  res.status(201).json({ success: true, data: review });
});

// PATCH /api/v1/reviews/:id
router.patch('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { rating, text } = req.body;

  const review = await prisma.review.findUnique({
    where: { id },
    select: { userId: true, restaurantId: true },
  });

  if (!review) {
    return res.status(404).json({ success: false, error: 'Review not found' });
  }

  if (review.userId !== req.user!.sub) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  const updated = await prisma.review.update({
    where: { id },
    data: {
      ...(rating && { rating }),
      ...(text !== undefined && { text }),
    },
  });

  // Update restaurant rating
  const stats = await prisma.review.aggregate({
    where: { restaurantId: review.restaurantId, isVisible: true },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await prisma.restaurant.update({
    where: { id: review.restaurantId },
    data: {
      ratingAvg: stats._avg.rating || 0,
      ratingCount: stats._count.rating,
    },
  });

  res.json({ success: true, data: updated });
});

// DELETE /api/v1/reviews/:id
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const review = await prisma.review.findUnique({
    where: { id },
    select: { userId: true, restaurantId: true },
  });

  if (!review) {
    return res.status(404).json({ success: false, error: 'Review not found' });
  }

  if (review.userId !== req.user!.sub && req.user!.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  await prisma.review.delete({ where: { id } });

  // Update restaurant rating
  const stats = await prisma.review.aggregate({
    where: { restaurantId: review.restaurantId, isVisible: true },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await prisma.restaurant.update({
    where: { id: review.restaurantId },
    data: {
      ratingAvg: stats._avg.rating || 0,
      ratingCount: stats._count.rating,
    },
  });

  res.json({ success: true, message: 'Review deleted' });
});

export default router;
