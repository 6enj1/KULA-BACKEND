import { Router, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../utils/prisma';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AuthenticatedRequest, ApiError } from '../types';
import { authenticate } from '../middleware/auth';
import { UserRole } from '@prisma/client';
import { validate, loginSchema, registerSchema, socialAuthSchema, refreshTokenSchema } from '../middleware/validate';

const router = Router();

// ============================================
// CONFIGURATION
// ============================================

// Your Apple app bundle ID (audience for Apple tokens)
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'ZenziAI.KULA';

// Your Google OAuth client ID (audience for Google tokens)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

// Apple JWKS client for fetching public keys
const appleJwksClient = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache: true,
  cacheMaxAge: 86400000, // 24 hours
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

// Google OAuth client for token verification
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ============================================
// TOKEN VERIFICATION HELPERS
// ============================================

interface AppleTokenPayload {
  iss: string;           // https://appleid.apple.com
  sub: string;           // Stable Apple user ID
  aud: string;           // Your app bundle ID
  exp: number;           // Expiration timestamp
  iat: number;           // Issued at timestamp
  email?: string;
  email_verified?: string | boolean; // Apple returns "true" as string
}

interface VerifiedAppleToken {
  sub: string;
  email?: string;
  emailVerified: boolean;
}

interface VerifiedGoogleToken {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/**
 * Get Apple's public signing key by key ID (kid)
 */
function getAppleSigningKey(kid: string): Promise<string> {
  return new Promise((resolve, reject) => {
    appleJwksClient.getSigningKey(kid, (err, key) => {
      if (err) {
        reject(err);
        return;
      }
      const signingKey = key?.getPublicKey();
      if (!signingKey) {
        reject(new Error('No signing key found'));
        return;
      }
      resolve(signingKey);
    });
  });
}

/**
 * Verify Apple identity token with REAL cryptographic verification
 * - Fetches Apple's public keys via JWKS
 * - Verifies JWT signature
 * - Checks issuer, audience, and expiration
 */
async function verifyAppleToken(identityToken: string): Promise<VerifiedAppleToken> {
  try {
    // Decode header to get key ID (kid)
    const header = jwt.decode(identityToken, { complete: true })?.header;
    if (!header?.kid) {
      throw new Error('Invalid Apple token: missing key ID in header');
    }

    // Fetch the public key from Apple's JWKS
    const publicKey = await getAppleSigningKey(header.kid);

    // Verify the token with full cryptographic verification
    const decoded = jwt.verify(identityToken, publicKey, {
      algorithms: ['RS256'],
      issuer: 'https://appleid.apple.com',
      audience: APPLE_BUNDLE_ID,
    }) as AppleTokenPayload;

    // Additional validation
    if (!decoded.sub) {
      throw new Error('Invalid Apple token: missing sub claim');
    }

    // Check expiration (jwt.verify does this, but double-check)
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now) {
      throw new Error('Apple token has expired');
    }

    // Apple returns email_verified as string "true" or boolean
    const emailVerified = decoded.email_verified === true || decoded.email_verified === 'true';

    // Token verified successfully

    return {
      sub: decoded.sub,
      email: decoded.email,
      emailVerified,
    };
  } catch (error) {
    // Apple token verification failed
    if (error instanceof jwt.JsonWebTokenError) {
      throw new ApiError('Invalid Apple token: signature verification failed', 401);
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new ApiError('Apple token has expired', 401);
    }
    throw new ApiError('Invalid Apple token', 401);
  }
}

/**
 * Verify Google ID token with REAL verification via Google's library
 * - Verifies signature against Google's public keys
 * - Checks issuer, audience, and expiration
 */
async function verifyGoogleToken(idToken: string): Promise<VerifiedGoogleToken> {
  try {
    // Use Google's official library for verification
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      throw new Error('Invalid Google token: no payload');
    }

    if (!payload.sub || !payload.email) {
      throw new Error('Invalid Google token: missing required claims');
    }

    // Verify issuer (Google library does this, but double-check)
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss || '')) {
      throw new Error('Invalid Google token: wrong issuer');
    }

    // Google token verified successfully

    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name,
    };
  } catch (error) {
    // Google token verification failed
    throw new ApiError('Invalid Google token', 401);
  }
}

// ============================================
// HELPER: Generate and store tokens
// ============================================

async function generateAndStoreTokens(user: { id: string; email: string; role: UserRole; restaurant?: { id: string } | null }, req: AuthenticatedRequest) {
  const tokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    restaurantId: user.restaurant?.id,
  };

  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  // Store refresh token
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: await bcrypt.hash(refreshToken, 10),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      ipAddress: req.ip,
      deviceInfo: req.get('user-agent'),
    },
  });

  return { accessToken, refreshToken };
}

// ============================================
// HELPER: Find or create user by provider
// ============================================

interface ProviderProfile {
  provider: 'apple' | 'google';
  providerUserId: string;  // Stable ID (sub claim)
  email: string;
  emailVerified: boolean;  // Whether provider verified the email
  name?: string;
}

/**
 * Find or create a user by OAuth provider.
 * Uses a database transaction to prevent race conditions.
 * Only links by email if the provider has verified the email.
 */
async function findOrCreateUserByProvider(profile: ProviderProfile) {
  const { provider, providerUserId, email, emailVerified, name } = profile;

  // Looking up user by provider identity

  // Use a transaction to prevent race conditions when two requests
  // try to create/link the same user simultaneously
  return await prisma.$transaction(async (tx) => {
    // Step 1: Check if we already have this provider identity linked
    // auth_identities is the SINGLE SOURCE OF TRUTH
    const existingIdentity = await tx.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            preferences: true,
            loyaltyPoints: true,
            avatarUrl: true,
            latitude: true,
            longitude: true,
            restaurant: { select: { id: true } },
            createdAt: true,
          },
        },
      },
    });

    if (existingIdentity) {
      return { user: existingIdentity.user, isNewUser: false };
    }

    // Step 2: ONLY link by email if the provider has verified the email
    // This prevents account takeover via unverified email claims
    if (emailVerified) {
      const existingUser = await tx.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          preferences: true,
          loyaltyPoints: true,
          avatarUrl: true,
          latitude: true,
          longitude: true,
          passwordHash: true,
          restaurant: { select: { id: true } },
          createdAt: true,
        },
      });

      if (existingUser) {
        // Found existing user by verified email, linking provider identity

        // Link this provider to existing user (upsert to handle case where identity already exists)
        await tx.authIdentity.upsert({
          where: {
            userId_provider: {
              userId: existingUser.id,
              provider,
            },
          },
          update: {
            providerUserId, // Update to latest provider user ID
            email,
          },
          create: {
            userId: existingUser.id,
            provider,
            providerUserId,
            email,
          },
        });

        // DEPRECATED: Also update legacy fields for backward compatibility
        // TODO: Remove after migration - these fields will be dropped from schema
        const legacyField = provider === 'apple' ? 'appleId' : 'googleId';
        await tx.user.update({
          where: { id: existingUser.id },
          data: { [legacyField]: providerUserId },
        });

        // Remove sensitive fields
        const { passwordHash: _, ...userResponse } = existingUser;
        return { user: userResponse, isNewUser: false };
      }
    } else {
      // Email not verified by provider - cannot link by email
      // Check if this email already exists - if so, don't create duplicate
      const existingUser = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (existingUser) {
        // Email exists but provider didn't verify it - can't link
        throw new ApiError(
          'An account with this email already exists. Please sign in with your original method, or verify your email with this provider.',
          409
        );
      }
    }

    // Step 3: Create new user with this provider

    const newUser = await tx.user.create({
      data: {
        email,
        name: name || email.split('@')[0],
        role: 'consumer',
        emailVerified: emailVerified, // Only mark as verified if provider verified it
        // DEPRECATED: Legacy fields - still written for backward compatibility
        // TODO: Remove after migration - these fields will be dropped from schema
        [provider === 'apple' ? 'appleId' : 'googleId']: providerUserId,
        // auth_identities is the source of truth
        authIdentities: {
          create: {
            provider,
            providerUserId,
            email,
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        preferences: true,
        loyaltyPoints: true,
        avatarUrl: true,
        latitude: true,
        longitude: true,
        restaurant: { select: { id: true } },
        createdAt: true,
      },
    });

    return { user: newUser, isNewUser: true };
  }, {
    // Transaction options
    maxWait: 5000, // Max time to wait for transaction slot
    timeout: 10000, // Max transaction duration
    isolationLevel: 'Serializable', // Strongest isolation to prevent race conditions
  });
}

// ============================================
// POST /api/v1/auth/register
// ============================================

router.post('/register', validate(registerSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password, name, role = 'consumer' } = req.body;
    // Validation handled by Zod schema

    // Check if user exists (use auth_identities as source of truth for providers)
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        passwordHash: true,
        authIdentities: {
          select: { provider: true },
        },
      },
    });

    if (existingUser) {
      // Check if user has social auth via auth_identities (single source of truth)
      const hasSocialAuth = existingUser.authIdentities.some(
        i => i.provider === 'apple' || i.provider === 'google'
      );

      // User exists - check if they're trying to add password to social account
      if (!existingUser.passwordHash && hasSocialAuth) {
        // Allow adding password to existing social auth account

        const passwordHash = await bcrypt.hash(password, 12);

        // Also upgrade role if registering as business
        const updateData: any = { passwordHash };
        if (role === 'business') {
          updateData.role = 'business';
        }

        const updatedUser = await prisma.user.update({
          where: { id: existingUser.id },
          data: updateData,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            preferences: true,
            loyaltyPoints: true,
            latitude: true,
            longitude: true,
            createdAt: true,
          },
        });

        // Create email auth identity
        await prisma.authIdentity.upsert({
          where: {
            userId_provider: {
              userId: existingUser.id,
              provider: 'email',
            },
          },
          update: {},
          create: {
            userId: existingUser.id,
            provider: 'email',
            providerUserId: email, // For email, the provider ID is the email itself
            email,
          },
        });

        const { accessToken, refreshToken } = await generateAndStoreTokens(updatedUser, req);

        return res.json({
          success: true,
          data: {
            user: updatedUser,
            accessToken,
            refreshToken,
            expiresIn: 900,
          },
          message: 'Password added to your account. You can now sign in with email or social.',
        });
      }

      // User already has a password
      throw new ApiError('Email already registered. Please sign in instead.', 409);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role,
        authIdentities: {
          create: {
            provider: 'email',
            providerUserId: email,
            email,
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        preferences: true,
        loyaltyPoints: true,
        latitude: true,
        longitude: true,
        createdAt: true,
      },
    });

    const { accessToken, refreshToken } = await generateAndStoreTokens(user, req);

    res.status(201).json({
      success: true,
      data: {
        user,
        accessToken,
        refreshToken,
        expiresIn: 900,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    throw error;
  }
});

// ============================================
// POST /api/v1/auth/login
// ============================================

router.post('/login', validate(loginSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password } = req.body;
    // Validation handled by Zod schema

    // Find user (use auth_identities as source of truth for providers)
    const user = await prisma.user.findUnique({
      where: { email, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        passwordHash: true,
        preferences: true,
        loyaltyPoints: true,
        avatarUrl: true,
        latitude: true,
        longitude: true,
        restaurant: { select: { id: true } },
        createdAt: true,
        authIdentities: {
          select: { provider: true },
        },
      },
    });

    if (!user) {
      throw new ApiError('Invalid email or password', 401);
    }

    // Check if user has a password
    if (!user.passwordHash) {
      // User exists but signed up via social auth - check auth_identities (single source of truth)
      const socialProviders = user.authIdentities
        .filter(i => i.provider === 'apple' || i.provider === 'google')
        .map(i => i.provider === 'apple' ? 'Apple' : 'Google');

      const providerList = socialProviders.length > 0
        ? socialProviders.join(' or ')
        : 'social';

      throw new ApiError(
        `This account uses ${providerList} sign-in. Please use that method, or register with email to add a password.`,
        401
      );
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new ApiError('Invalid email or password', 401);
    }

    // Remove passwordHash from response
    const { passwordHash: _, ...userResponse } = user;

    const { accessToken, refreshToken } = await generateAndStoreTokens(userResponse, req);

    res.json({
      success: true,
      data: {
        user: userResponse,
        accessToken,
        refreshToken,
        expiresIn: 900,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    throw error;
  }
});

// ============================================
// POST /api/v1/auth/social
// ============================================

router.post('/social', validate(socialAuthSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { provider, token, name, email: providedEmail } = req.body;
    // Validation handled by Zod schema

    let providerUserId: string;
    let email: string;
    let emailVerified: boolean = false;
    let displayName: string | undefined = name;

    // Verify token and extract stable user ID
    if (provider === 'apple') {
      const appleData = await verifyAppleToken(token);
      providerUserId = appleData.sub;
      emailVerified = appleData.emailVerified;

      // Apple only provides email on first sign-in
      // If not in token, must be provided by frontend (cached from first sign-in)
      email = appleData.email || providedEmail;

      if (!email) {
        // Try to find existing user by Apple ID
        const existingIdentity = await prisma.authIdentity.findUnique({
          where: {
            provider_providerUserId: {
              provider: 'apple',
              providerUserId,
            },
          },
          include: { user: true },
        });

        if (existingIdentity) {
          email = existingIdentity.user.email;
          emailVerified = true; // Existing user, email was verified on first sign-in
        } else {
          throw new ApiError(
            'Email is required for first-time Apple sign-in. Please allow email access.',
            400
          );
        }
      }
    } else {
      // Google
      const googleData = await verifyGoogleToken(token);
      providerUserId = googleData.sub;
      email = googleData.email;
      emailVerified = googleData.emailVerified;
      displayName = displayName || googleData.name;
    }

    // Find or create user
    const { user, isNewUser } = await findOrCreateUserByProvider({
      provider,
      providerUserId,
      email,
      emailVerified,
      name: displayName,
    });

    const { accessToken, refreshToken } = await generateAndStoreTokens(user, req);

    res.json({
      success: true,
      data: {
        user,
        accessToken,
        refreshToken,
        expiresIn: 900,
        isNewUser,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    throw error;
  }
});

// ============================================
// POST /api/v1/auth/refresh
// ============================================

router.post('/refresh', validate(refreshTokenSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { refreshToken } = req.body;
    // Validation handled by Zod schema

    // Verify token
    const payload = verifyRefreshToken(refreshToken);

    // Find user
    const user = await prisma.user.findUnique({
      where: { id: payload.sub, deletedAt: null },
      select: {
        id: true,
        email: true,
        role: true,
        restaurant: { select: { id: true } },
      },
    });

    if (!user) {
      throw new ApiError('User not found', 404);
    }

    // Generate new tokens
    const tokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      restaurantId: user.restaurant?.id,
    };

    const newAccessToken = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);

    // Store new refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: await bcrypt.hash(newRefreshToken, 10),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        ipAddress: req.ip,
        deviceInfo: req.get('user-agent'),
      },
    });

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 900,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    return res.status(401).json({ success: false, error: 'Invalid refresh token' });
  }
});

// ============================================
// POST /api/v1/auth/logout
// ============================================

router.post('/logout', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Revoke all refresh tokens for this user
    await prisma.refreshToken.updateMany({
      where: { userId: req.user!.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    throw error;
  }
});

// ============================================
// GET /api/v1/auth/providers (Get linked providers for current user)
// ============================================

router.get('/providers', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // auth_identities is the SINGLE SOURCE OF TRUTH for linked providers
    // Legacy appleId/googleId fields are deprecated and no longer read
    const identities = await prisma.authIdentity.findMany({
      where: { userId: req.user!.sub },
      select: {
        provider: true,
        email: true,
        createdAt: true,
      },
    });

    const providers: Array<{ provider: string; email: string | null; linkedAt: Date | null }> = identities.map(i => ({
      provider: i.provider,
      email: i.email,
      linkedAt: i.createdAt,
    }));

    res.json({
      success: true,
      data: providers,
    });
  } catch (error) {
    throw error;
  }
});

export default router;
