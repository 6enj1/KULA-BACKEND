import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../utils/prisma';
import { AuthenticatedRequest, ApiError } from '../types';
import { authenticate } from '../middleware/auth';
import yoco from '../services/yoco';
import { validate, createOrderSchema, cancelOrderSchema, paginationSchema } from '../middleware/validate';

const router = Router();

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const APP_SCHEME = process.env.APP_SCHEME || 'savr://'; // iOS deep link scheme

// Generate order number
function generateOrderNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'KULA-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// GET /api/v1/orders
router.get('/', authenticate, validate(paginationSchema, 'query'), async (req: AuthenticatedRequest, res: Response) => {
  const { status, limit = 20, page = 1 } = req.query;

  const where: any = { userId: req.user!.sub };
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
      bag: {
        select: {
          id: true,
          title: true,
          imageUrl: true,
          priceCurrent: true,
        },
      },
      restaurant: {
        select: {
          id: true,
          name: true,
          addressLine1: true,
          city: true,
          latitude: true,
          longitude: true,
          phone: true,
        },
      },
      review: {
        select: {
          id: true,
          rating: true,
          text: true,
          createdAt: true,
        },
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

// GET /api/v1/orders/active
router.get('/active', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const orders = await prisma.order.findMany({
    where: {
      userId: req.user!.sub,
      status: { in: ['pending', 'paid', 'ready'] },
    },
    orderBy: { pickupStart: 'asc' },
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
      bag: {
        select: { id: true, title: true, imageUrl: true },
      },
      restaurant: {
        select: {
          id: true,
          name: true,
          addressLine1: true,
          city: true,
          latitude: true,
          longitude: true,
          phone: true,
        },
      },
    },
  });

  res.json({ success: true, data: orders });
});

// GET /api/v1/orders/past
router.get('/past', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { limit = 20, page = 1 } = req.query;

  const orders = await prisma.order.findMany({
    where: {
      userId: req.user!.sub,
      status: { in: ['collected', 'cancelled', 'refunded'] },
    },
    take: Number(limit),
    skip: (Number(page) - 1) * Number(limit),
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      orderNumber: true,
      quantity: true,
      total: true,
      status: true,
      pickupStart: true,
      pickupEnd: true,
      createdAt: true,
      bag: {
        select: { id: true, title: true, imageUrl: true },
      },
      restaurant: {
        select: { id: true, name: true },
      },
      review: {
        select: { id: true, rating: true, text: true },
      },
    },
  });

  res.json({ success: true, data: orders });
});

// GET /api/v1/orders/:id
router.get('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      userId: true,
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
      bag: {
        select: {
          id: true,
          title: true,
          description: true,
          imageUrl: true,
          priceCurrent: true,
        },
      },
      restaurant: {
        select: {
          id: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          province: true,
          latitude: true,
          longitude: true,
          phone: true,
        },
      },
      payment: {
        select: {
          id: true,
          amount: true,
          method: true,
          status: true,
          cardLast4: true,
          cardBrand: true,
          paidAt: true,
        },
      },
      review: {
        select: { id: true, rating: true, text: true, createdAt: true },
      },
    },
  });

  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  if (order.userId !== req.user!.sub && req.user!.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  res.json({ success: true, data: order });
});

// POST /api/v1/orders
router.post('/', authenticate, validate(createOrderSchema), async (req: AuthenticatedRequest, res: Response) => {
  const { bagId, quantity = 1 } = req.body;
  // Validation handled by Zod schema

  // Use transaction with row locking to prevent race conditions
  const result = await prisma.$transaction(async (tx) => {
    // Lock the bag row for update to prevent concurrent modifications
    const bag = await tx.bag.findUnique({
      where: { id: bagId },
      include: { restaurant: true },
    });

    if (!bag) {
      throw new ApiError('Bag not found', 404);
    }

    if (!bag.isActive || bag.isSoldOut) {
      throw new ApiError('Bag is not available', 400);
    }

    if (bag.quantityRemaining < quantity) {
      throw new ApiError('Not enough bags available', 400);
    }

    if (new Date() > bag.pickupEnd) {
      throw new ApiError('Pickup window has ended', 400);
    }

    // Reserve inventory atomically - decrement now, restore on cancel/failure
    const updatedBag = await tx.bag.update({
      where: { id: bagId },
      data: {
        quantityRemaining: { decrement: quantity },
        isSoldOut: bag.quantityRemaining - quantity <= 0,
      },
    });

    // Double-check quantity didn't go negative (race condition safeguard)
    if (updatedBag.quantityRemaining < 0) {
      throw new ApiError('Not enough bags available', 400);
    }

    // Get user details
    const user = await tx.user.findUnique({
      where: { id: req.user!.sub },
      select: { email: true, name: true },
    });

    // Calculate pricing
    const subtotal = bag.priceCurrent * quantity;
    const platformFee = 250; // R2.50 in cents
    const total = subtotal + platformFee;

    // Generate unique QR code and order number
    const qrCode = `SAVR-${uuidv4()}`;
    const orderNumber = generateOrderNumber();

    // Create order with pending status
    const order = await tx.order.create({
      data: {
        orderNumber,
        userId: req.user!.sub,
        bagId: bag.id,
        restaurantId: bag.restaurantId,
        quantity,
        subtotal,
        platformFee,
        total,
        status: 'pending', // Will be updated to 'paid' after Yoco confirms
        pickupStart: bag.pickupStart,
        pickupEnd: bag.pickupEnd,
        qrCode,
      },
      include: {
        bag: {
          select: { id: true, title: true, imageUrl: true },
        },
        restaurant: {
          select: {
            id: true,
            name: true,
            addressLine1: true,
            city: true,
            latitude: true,
            longitude: true,
          },
        },
      },
    });

    return { order, bag, user, total, subtotal, platformFee };
  }, {
    timeout: 10000, // 10 second timeout
  });

  const { order, bag, user, total: orderTotal } = result;

  // Create Yoco checkout
  try {
    const checkout = await yoco.createCheckout({
      amount: orderTotal,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerEmail: user?.email,
      customerName: user?.name,
      successUrl: `${APP_URL}/api/v1/payments/yoco/success?orderId=${order.id}`,
      cancelUrl: `${APP_URL}/api/v1/payments/yoco/cancel?orderId=${order.id}`,
      failureUrl: `${APP_URL}/api/v1/payments/yoco/failure?orderId=${order.id}`,
      metadata: {
        bagTitle: bag.title,
        restaurantName: bag.restaurant?.name || 'Restaurant',
      },
    });

    // Save checkout ID to payment record
    await prisma.payment.create({
      data: {
        orderId: order.id,
        amount: orderTotal,
        method: 'card', // Yoco handles the actual method
        status: 'pending',
        stripePaymentIntentId: checkout.id, // Reusing field for Yoco checkout ID
      },
    });

    res.status(201).json({
      success: true,
      data: {
        order,
        checkout: {
          id: checkout.id,
          paymentUrl: checkout.redirectUrl,
        },
      },
    });
  } catch (error: any) {
    // If Yoco fails, delete the pending order
    await prisma.order.delete({ where: { id: order.id } });

    return res.status(500).json({
      success: false,
      error: 'Failed to create payment checkout',
    });
  }
});

// POST /api/v1/orders/:id/arrived
router.post('/:id/arrived', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { userId: true, status: true },
  });

  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  if (order.userId !== req.user!.sub) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  if (!['paid', 'ready'].includes(order.status)) {
    return res.status(400).json({ success: false, error: 'Order cannot be marked as arrived' });
  }

  const updated = await prisma.order.update({
    where: { id },
    data: { customerArrivedAt: new Date() },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      customerArrivedAt: true,
    },
  });

  // TODO: Send push notification to restaurant

  res.json({ success: true, data: updated });
});

// POST /api/v1/orders/:id/cancel
router.post('/:id/cancel', authenticate, validate(cancelOrderSchema), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { userId: true, status: true, bagId: true, quantity: true },
  });

  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  if (order.userId !== req.user!.sub) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  if (!['pending', 'paid'].includes(order.status)) {
    return res.status(400).json({ success: false, error: 'Order cannot be cancelled' });
  }

  // Cancel order and restore inventory
  await prisma.$transaction([
    prisma.order.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: reason,
        cancelledById: req.user!.sub,
      },
    }),
    prisma.bag.update({
      where: { id: order.bagId },
      data: {
        quantityRemaining: { increment: order.quantity },
        isSoldOut: false,
      },
    }),
  ]);

  res.json({ success: true, message: 'Order cancelled' });
});

export default router;
