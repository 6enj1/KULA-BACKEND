import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest, ApiError } from '../types';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/v1/users/me
router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      phone: true,
      avatarUrl: true,
      preferences: true,
      loyaltyPoints: true,
      latitude: true,
      longitude: true,
      notificationsEnabled: true,
      createdAt: true,
      restaurant: {
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  res.json({ success: true, data: user });
});

// PATCH /api/v1/users/me
router.patch('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { name, phone, avatarUrl } = req.body;

  const user = await prisma.user.update({
    where: { id: req.user!.sub },
    data: {
      ...(name && { name }),
      ...(phone !== undefined && { phone }),
      ...(avatarUrl !== undefined && { avatarUrl }),
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      phone: true,
      avatarUrl: true,
      preferences: true,
      loyaltyPoints: true,
      createdAt: true,
    },
  });

  res.json({ success: true, data: user });
});

// PATCH /api/v1/users/me/preferences
router.patch('/me/preferences', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { preferences } = req.body;

  if (!Array.isArray(preferences)) {
    return res.status(400).json({ success: false, error: 'Preferences must be an array' });
  }

  const user = await prisma.user.update({
    where: { id: req.user!.sub },
    data: { preferences },
    select: {
      id: true,
      preferences: true,
    },
  });

  res.json({ success: true, data: user });
});

// PATCH /api/v1/users/me/location
router.patch('/me/location', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { latitude, longitude } = req.body;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ success: false, error: 'Valid latitude and longitude are required' });
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ success: false, error: 'Invalid coordinates' });
  }

  const user = await prisma.user.update({
    where: { id: req.user!.sub },
    data: {
      latitude,
      longitude,
      locationUpdatedAt: new Date(),
    },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      locationUpdatedAt: true,
    },
  });

  res.json({ success: true, data: user });
});

// PATCH /api/v1/users/me/fcm-token
router.patch('/me/fcm-token', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { fcmToken } = req.body;

  const user = await prisma.user.update({
    where: { id: req.user!.sub },
    data: { fcmToken },
    select: {
      id: true,
      fcmToken: true,
    },
  });

  res.json({ success: true, data: user });
});

// PATCH /api/v1/users/me/notifications
router.patch('/me/notifications', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'enabled must be a boolean' });
  }

  const user = await prisma.user.update({
    where: { id: req.user!.sub },
    data: { notificationsEnabled: enabled },
    select: {
      id: true,
      notificationsEnabled: true,
    },
  });

  res.json({ success: true, data: user });
});

// DELETE /api/v1/users/me
router.delete('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  await prisma.user.update({
    where: { id: req.user!.sub },
    data: { deletedAt: new Date() },
  });

  res.json({ success: true, message: 'Account deleted successfully' });
});

export default router;
