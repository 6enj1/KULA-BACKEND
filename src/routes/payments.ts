import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest } from '../types';
import { authenticate } from '../middleware/auth';
import yoco from '../services/yoco';

const router = Router();

const APP_SCHEME = process.env.APP_SCHEME || 'savr://';

// Helper to restore inventory when order fails/cancels
async function restoreInventory(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { bagId: true, quantity: true },
  });

  if (order) {
    await prisma.bag.update({
      where: { id: order.bagId },
      data: {
        quantityRemaining: { increment: order.quantity },
        isSoldOut: false, // Mark as available again
      },
    });
  }
}

// GET /api/v1/payments/yoco/success
// Yoco redirects here after successful payment
router.get('/yoco/success', async (req: Request, res: Response) => {
  const { orderId } = req.query;

  if (!orderId) {
    return res.redirect(`${APP_SCHEME}payment/error?message=Missing order ID`);
  }

  try {
    // Get the order and payment
    const order = await prisma.order.findUnique({
      where: { id: String(orderId) },
      include: { payment: true },
    });

    if (!order) {
      return res.redirect(`${APP_SCHEME}payment/error?message=Order not found`);
    }

    // Verify payment status with Yoco
    if (order.payment?.stripePaymentIntentId) {
      const checkoutStatus = await yoco.getCheckoutStatus(order.payment.stripePaymentIntentId);

      if (checkoutStatus.status === 'successful') {
        // Update order and payment - inventory already reserved at order creation
        await prisma.$transaction([
          prisma.order.update({
            where: { id: order.id },
            data: { status: 'paid' },
          }),
          prisma.payment.update({
            where: { id: order.payment.id },
            data: {
              status: 'succeeded',
              paidAt: new Date(),
              cardLast4: checkoutStatus.paymentMethodDetails?.card?.maskedCard?.slice(-4),
              cardBrand: checkoutStatus.paymentMethodDetails?.card?.scheme,
            },
          }),
          // Award loyalty points
          prisma.user.update({
            where: { id: order.userId },
            data: { loyaltyPoints: { increment: order.quantity } },
          }),
        ]);

        // Redirect to app with success
        return res.redirect(`${APP_SCHEME}payment/success?orderId=${order.id}&orderNumber=${order.orderNumber}`);
      }
    }

    // Payment not confirmed yet, redirect to pending
    return res.redirect(`${APP_SCHEME}payment/pending?orderId=${order.id}`);
  } catch (error) {
    return res.redirect(`${APP_SCHEME}payment/error?message=Payment verification failed`);
  }
});

// GET /api/v1/payments/yoco/cancel
router.get('/yoco/cancel', async (req: Request, res: Response) => {
  const { orderId } = req.query;

  if (orderId) {
    try {
      // Restore inventory before deleting order
      await restoreInventory(String(orderId));
      // Delete the pending order
      await prisma.order.delete({
        where: { id: String(orderId) },
      });
    } catch (e) {
      // Ignore if already deleted
    }
  }

  return res.redirect(`${APP_SCHEME}payment/cancelled`);
});

// GET /api/v1/payments/yoco/failure
router.get('/yoco/failure', async (req: Request, res: Response) => {
  const { orderId } = req.query;

  if (orderId) {
    try {
      // Restore inventory before deleting order
      await restoreInventory(String(orderId));
      // Delete the order
      await prisma.order.delete({
        where: { id: String(orderId) },
      });
    } catch (e) {
      // Ignore if already deleted
    }
  }

  return res.redirect(`${APP_SCHEME}payment/failed`);
});

// POST /api/v1/payments/yoco/webhook
// Yoco sends payment confirmations here
router.post('/yoco/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['yoco-signature'] as string;
  const webhookSecret = process.env.YOCO_WEBHOOK_SECRET;

  // Webhook signature validation is REQUIRED
  if (!webhookSecret) {
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' });
  }

  const isValid = yoco.verifyWebhookSignature(
    JSON.stringify(req.body),
    signature,
    webhookSecret
  );

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { type, payload } = req.body;

  try {
    switch (type) {
      case 'payment.succeeded': {
        const checkoutId = payload.metadata?.checkoutId || payload.id;

        // Find payment by checkout ID
        const payment = await prisma.payment.findFirst({
          where: { stripePaymentIntentId: checkoutId },
          include: { order: true },
        });

        if (payment && payment.order) {
          // Inventory already reserved at order creation
          // Just update status and award points
          await prisma.$transaction([
            prisma.order.update({
              where: { id: payment.orderId },
              data: { status: 'paid' },
            }),
            prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: 'succeeded',
                paidAt: new Date(),
                stripeChargeId: payload.id, // Store Yoco payment ID
              },
            }),
            prisma.user.update({
              where: { id: payment.order.userId },
              data: { loyaltyPoints: { increment: payment.order.quantity } },
            }),
          ]);
        }
        break;
      }

      case 'payment.failed': {
        const checkoutId = payload.metadata?.checkoutId || payload.id;

        const payment = await prisma.payment.findFirst({
          where: { stripePaymentIntentId: checkoutId },
          include: { order: true },
        });

        if (payment && payment.order) {
          // Restore inventory since payment failed
          await prisma.$transaction([
            prisma.bag.update({
              where: { id: payment.order.bagId },
              data: {
                quantityRemaining: { increment: payment.order.quantity },
                isSoldOut: false,
              },
            }),
            prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: 'failed',
                failedAt: new Date(),
                failureReason: payload.failureReason || 'Payment failed',
              },
            }),
            prisma.order.delete({
              where: { id: payment.orderId },
            }),
          ]);
        }
        break;
      }

      case 'refund.succeeded': {
        const paymentId = payload.paymentId;

        const payment = await prisma.payment.findFirst({
          where: { stripeChargeId: paymentId },
          include: { order: true },
        });

        if (payment && payment.order) {
          // Restore inventory on refund
          await prisma.$transaction([
            prisma.bag.update({
              where: { id: payment.order.bagId },
              data: {
                quantityRemaining: { increment: payment.order.quantity },
                isSoldOut: false,
              },
            }),
            prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: 'refunded',
                refundedAt: new Date(),
                refundAmount: payload.amount,
                stripeRefundId: payload.id,
              },
            }),
            prisma.order.update({
              where: { id: payment.orderId },
              data: { status: 'refunded' },
            }),
          ]);
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (error) {
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GET /api/v1/payments/status/:orderId
// Check payment status for an order
router.get('/status/:orderId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { orderId } = req.params;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      userId: true,
      payment: {
        select: {
          status: true,
          paidAt: true,
        },
      },
    },
  });

  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  if (order.userId !== req.user!.sub) {
    return res.status(403).json({ success: false, error: 'Not authorized' });
  }

  res.json({
    success: true,
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      paymentStatus: order.payment?.status || 'pending',
      paidAt: order.payment?.paidAt,
    },
  });
});

export default router;
