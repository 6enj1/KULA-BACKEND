import { Router, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthenticatedRequest } from '../types';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/v1/addresses
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const addresses = await prisma.address.findMany({
    where: { userId: req.user!.sub },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      label: true,
      addressType: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      province: true,
      postalCode: true,
      country: true,
      latitude: true,
      longitude: true,
      isDefault: true,
    },
  });

  res.json({ success: true, data: addresses });
});

// POST /api/v1/addresses
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const {
    label, addressType = 'other', addressLine1, addressLine2,
    city, province, postalCode, latitude, longitude, isDefault,
  } = req.body;

  if (!label || !addressLine1 || !city || !province || !postalCode) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  // If setting as default, unset other defaults
  if (isDefault) {
    await prisma.address.updateMany({
      where: { userId: req.user!.sub, isDefault: true },
      data: { isDefault: false },
    });
  }

  const address = await prisma.address.create({
    data: {
      userId: req.user!.sub,
      label,
      addressType,
      addressLine1,
      addressLine2,
      city,
      province,
      postalCode,
      latitude,
      longitude,
      isDefault: isDefault || false,
    },
  });

  res.status(201).json({ success: true, data: address });
});

// PATCH /api/v1/addresses/:id
router.patch('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const address = await prisma.address.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!address || address.userId !== req.user!.sub) {
    return res.status(404).json({ success: false, error: 'Address not found' });
  }

  const { isDefault, ...updateData } = req.body;

  // If setting as default, unset other defaults
  if (isDefault) {
    await prisma.address.updateMany({
      where: { userId: req.user!.sub, isDefault: true },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.address.update({
    where: { id },
    data: {
      ...updateData,
      ...(isDefault !== undefined && { isDefault }),
    },
  });

  res.json({ success: true, data: updated });
});

// PATCH /api/v1/addresses/:id/default
router.patch('/:id/default', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const address = await prisma.address.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!address || address.userId !== req.user!.sub) {
    return res.status(404).json({ success: false, error: 'Address not found' });
  }

  // Unset other defaults
  await prisma.address.updateMany({
    where: { userId: req.user!.sub, isDefault: true },
    data: { isDefault: false },
  });

  const updated = await prisma.address.update({
    where: { id },
    data: { isDefault: true },
  });

  res.json({ success: true, data: updated });
});

// DELETE /api/v1/addresses/:id
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const address = await prisma.address.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!address || address.userId !== req.user!.sub) {
    return res.status(404).json({ success: false, error: 'Address not found' });
  }

  await prisma.address.delete({ where: { id } });

  res.json({ success: true, message: 'Address deleted' });
});

export default router;
