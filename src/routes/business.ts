import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest } from '../types';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// All routes require business role
router.use(authenticate, requireRole('business'));

// GET /api/v1/business/bags
router.get('/bags', async (req: AuthenticatedRequest, res: Response) => {
  const restaurant = await prisma.restaurant.findUnique({
    where: { ownerId: req.user!.sub },
    select: { id: true },
  });

  if (!restaurant) {
    return res.status(404).json({ success: false, error: 'Restaurant not found' });
  }

  const bags = await prisma.bag.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'desc' },
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
      createdAt: true,
      _count: {
        select: { orders: true },
      },
    },
  });

  const bagsWithStats = bags.map(bag => ({
    ...bag,
    totalOrders: bag._count.orders,
    _count: undefined,
    savingsPercent: Math.round((1 - bag.priceCurrent / bag.priceOriginal) * 100),
  }));

  res.json({ success: true, data: bagsWithStats });
});

// GET /api/v1/business/orders
router.get('/orders', async (req: AuthenticatedRequest, res: Response) => {
  const { status, limit = 20, page = 1 } = req.query;

  const restaurant = await prisma.restaurant.findUnique({
    where: { ownerId: req.user!.sub },
    select: { id: true },
  });

  if (!restaurant) {
    return res.status(404).json({ success: false, error: 'Restaurant not found' });
  }

  const where: any = { restaurantId: restaurant.id };
  if (status) {
    where.status = status;
  }

  const orders = await prisma.order.findMany({
    where,
    take: Number(limit),
    skip: (Number(page) - 1) * Number(limit),
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      orderNumber: true,
      quantity: true,
      subtotal: true,
      platformFee: true,
      total: true,
      status: true,
      pickupStart: true,
      pickupEnd: true,
      qrCode: true,
      customerArrivedAt: true,
      qrScannedAt: true,
      createdAt: true,
      user: {
        select: { id: true, name: true, avatarUrl: true },
      },
      bag: {
        select: { id: true, title: true, imageUrl: true },
      },
    },
  });

  const total = await prisma.order.count({ where });

  res.json({
    success: true,
    data: orders,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
      hasMore: Number(page) * Number(limit) < total,
    },
  });
});

// GET /api/v1/business/orders/pending
router.get('/orders/pending', async (req: AuthenticatedRequest, res: Response) => {
  const restaurant = await prisma.restaurant.findUnique({
    where: { ownerId: req.user!.sub },
    select: { id: true },
  });

  if (!restaurant) {
    return res.status(404).json({ success: false, error: 'Restaurant not found' });
  }

  const orders = await prisma.order.findMany({
    where: {
      restaurantId: restaurant.id,
      status: { in: ['paid', 'ready'] },
    },
    orderBy: [{ customerArrivedAt: 'desc' }, { pickupStart: 'asc' }],
    select: {
      id: true,
      orderNumber: true,
      quantity: true,
      total: true,
      status: true,
      pickupStart: true,
      pickupEnd: true,
      qrCode: true,
      customerArrivedAt: true,
      createdAt: true,
      user: {
        select: { id: true, name: true, avatarUrl: true, phone: true },
      },
      bag: {
        select: { id: true, title: true },
      },
    },
  });

  res.json({ success: true, data: orders });
});

// PATCH /api/v1/business/orders/:id/status
router.patch('/orders/:id/status', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['ready', 'collected', 'cancelled'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { ownerId: req.user!.sub },
    select: { id: true },
  });

  const order = await prisma.order.findUnique({
    where: { id },
    select: { restaurantId: true, status: true },
  });

  if (!order || order.restaurantId !== restaurant?.id) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  const updateData: any = { status };
  if (status === 'collected') {
    updateData.qrScannedAt = new Date();
  }
  if (status === 'cancelled') {
    updateData.cancelledAt = new Date();
    updateData.cancelledById = req.user!.sub;
  }

  const updated = await prisma.order.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      qrScannedAt: true,
    },
  });

  // TODO: Send push notification to customer

  res.json({ success: true, data: updated });
});

// POST /api/v1/business/orders/:id/scan
router.post('/orders/:id/scan', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { qrCode } = req.body;

  if (!qrCode) {
    return res.status(400).json({ success: false, error: 'QR code is required' });
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { ownerId: req.user!.sub },
    select: { id: true },
  });

  if (!restaurant) {
    return res.status(404).json({ success: false, error: 'Restaurant not found' });
  }

  // Find order by QR code
  const order = await prisma.order.findUnique({
    where: { qrCode },
    select: {
      id: true,
      restaurantId: true,
      status: true,
      orderNumber: true,
      user: { select: { name: true } },
      bag: { select: { title: true } },
    },
  });

  if (!order) {
    return res.status(404).json({ success: false, error: 'Invalid QR code' });
  }

  if (order.restaurantId !== restaurant.id) {
    return res.status(403).json({ success: false, error: 'Order belongs to another restaurant' });
  }

  if (!['paid', 'ready'].includes(order.status)) {
    return res.status(400).json({
      success: false,
      error: `Order cannot be collected (status: ${order.status})`,
    });
  }

  // Mark as collected
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      status: 'collected',
      qrScannedAt: new Date(),
    },
  });

  res.json({
    success: true,
    data: {
      id: updated.id,
      orderNumber: order.orderNumber,
      status: 'collected',
      customerName: order.user.name,
      bagTitle: order.bag.title,
    },
    message: 'Order marked as collected',
  });
});

// GET /api/v1/business/analytics
router.get('/analytics', async (req: AuthenticatedRequest, res: Response) => {
  const { startDate, endDate } = req.query;

  const restaurant = await prisma.restaurant.findUnique({
    where: { ownerId: req.user!.sub },
    select: { id: true },
  });

  if (!restaurant) {
    return res.status(404).json({ success: false, error: 'Restaurant not found' });
  }

  const start = startDate ? new Date(String(startDate)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(String(endDate)) : new Date();

  // Get order stats
  const orders = await prisma.order.findMany({
    where: {
      restaurantId: restaurant.id,
      createdAt: { gte: start, lte: end },
    },
    select: {
      status: true,
      total: true,
      platformFee: true,
      createdAt: true,
    },
  });

  const totalOrders = orders.length;
  const completedOrders = orders.filter(o => o.status === 'collected').length;
  const cancelledOrders = orders.filter(o => ['cancelled', 'refunded'].includes(o.status)).length;
  const totalRevenue = orders
    .filter(o => o.status === 'collected')
    .reduce((sum, o) => sum + o.total, 0);
  const platformFees = orders
    .filter(o => o.status === 'collected')
    .reduce((sum, o) => sum + o.platformFee, 0);
  const netRevenue = totalRevenue - platformFees;

  // Get top bags
  const topBags = await prisma.order.groupBy({
    by: ['bagId'],
    where: {
      restaurantId: restaurant.id,
      status: 'collected',
      createdAt: { gte: start, lte: end },
    },
    _count: { id: true },
    _sum: { total: true },
    orderBy: { _count: { id: 'desc' } },
    take: 5,
  });

  const bagDetails = await prisma.bag.findMany({
    where: { id: { in: topBags.map(b => b.bagId) } },
    select: { id: true, title: true },
  });

  res.json({
    success: true,
    data: {
      period: { start, end },
      summary: {
        totalOrders,
        completedOrders,
        cancelledOrders,
        totalRevenue,
        platformFees,
        netRevenue,
        avgOrderValue: completedOrders > 0 ? Math.round(totalRevenue / completedOrders) : 0,
        avgRating: restaurant ? await prisma.restaurant.findUnique({
          where: { id: restaurant.id },
          select: { ratingAvg: true },
        }).then(r => r?.ratingAvg || 0) : 0,
      },
      topBags: topBags.map(b => {
        const details = bagDetails.find(d => d.id === b.bagId);
        return {
          bagId: b.bagId,
          title: details?.title || 'Unknown',
          orderCount: b._count.id,
          revenue: b._sum.total || 0,
        };
      }),
    },
  });
});

// GET /api/v1/business/payouts
router.get('/payouts', async (req: AuthenticatedRequest, res: Response) => {
  const { limit = 10, page = 1 } = req.query;

  const restaurant = await prisma.restaurant.findUnique({
    where: { ownerId: req.user!.sub },
    select: { id: true },
  });

  if (!restaurant) {
    return res.status(404).json({ success: false, error: 'Restaurant not found' });
  }

  const payouts = await prisma.payout.findMany({
    where: { restaurantId: restaurant.id },
    take: Number(limit),
    skip: (Number(page) - 1) * Number(limit),
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      orderCount: true,
      grossAmount: true,
      platformFees: true,
      netAmount: true,
      processedAt: true,
      createdAt: true,
    },
  });

  res.json({ success: true, data: payouts });
});

export default router;
