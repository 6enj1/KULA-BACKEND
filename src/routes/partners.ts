import { Router, Response } from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { AuthenticatedRequest, ApiError } from '../types';
import { sendInviteEmail } from '../services/email';
import { z } from 'zod';
import { validate } from '../middleware/validate';

const router = Router();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const applySchema = z.object({
  businessName: z.string().min(1, 'Business name is required').max(200),
  contactName: z.string().min(1, 'Contact name is required').max(100),
  email: z.string().email('Invalid email format'),
  phone: z.string().max(20).optional(),
  city: z.string().min(1, 'City is required').max(100),
  message: z.string().max(2000).optional(),
});

// ============================================
// POST /api/v1/partners/apply — Submit interest form (public)
// ============================================

router.post('/apply', validate(applySchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { businessName, contactName, email, phone, city, message } = req.body;

    const application = await prisma.partnerApplication.create({
      data: { businessName, contactName, email, phone, city, message },
    });

    res.status(201).json({
      success: true,
      data: { id: application.id },
      message: 'Application submitted successfully. We will review and get back to you within 24-48 hours.',
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    throw error;
  }
});

// ============================================
// GET /api/v1/partners/applications — List all applications (admin)
// ============================================

router.get('/applications', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const where = status ? { status: status as any } : {};

    const applications = await prisma.partnerApplication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: applications });
  } catch (error) {
    throw error;
  }
});

// ============================================
// POST /api/v1/partners/applications/:id/approve — Approve application (admin)
// ============================================

router.post('/applications/:id/approve', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const application = await prisma.partnerApplication.findUnique({ where: { id } });
    if (!application) {
      throw new ApiError('Application not found', 404);
    }
    if (application.status !== 'pending') {
      throw new ApiError(`Application already ${application.status}`, 400);
    }

    // Generate unique invite code
    const code = `KULA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Create invite code with 30-day expiry
    const inviteCode = await prisma.inviteCode.create({
      data: {
        code,
        email: application.email,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Update application status
    await prisma.partnerApplication.update({
      where: { id },
      data: { status: 'approved', reviewedAt: new Date() },
    });

    // Send invite email
    try {
      await sendInviteEmail(application.email, code, application.businessName);
    } catch (emailError) {
      console.error('Failed to send invite email:', emailError);
      // Don't fail the request — the code is still created
    }

    res.json({
      success: true,
      data: { inviteCode: code, email: application.email },
      message: 'Application approved and invite code sent.',
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    throw error;
  }
});

// ============================================
// POST /api/v1/partners/applications/:id/reject — Reject application (admin)
// ============================================

router.post('/applications/:id/reject', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const application = await prisma.partnerApplication.findUnique({ where: { id } });
    if (!application) {
      throw new ApiError('Application not found', 404);
    }
    if (application.status !== 'pending') {
      throw new ApiError(`Application already ${application.status}`, 400);
    }

    await prisma.partnerApplication.update({
      where: { id },
      data: { status: 'rejected', reviewedAt: new Date() },
    });

    res.json({
      success: true,
      message: 'Application rejected.',
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    throw error;
  }
});

export default router;
