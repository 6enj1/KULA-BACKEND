/**
 * Data Migration: Backfill auth_identities from legacy appleId/googleId fields
 *
 * This script migrates existing users with appleId or googleId to the new
 * auth_identities table, making it the single source of truth.
 *
 * Run with: npx ts-node scripts/migrate-auth-identities.ts
 *
 * Safe to run multiple times (idempotent) - uses upsert logic.
 */

// @ts-ignore - pg types not installed
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Prisma with pg adapter (same as main app)
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface MigrationStats {
  usersProcessed: number;
  appleIdentitiesCreated: number;
  googleIdentitiesCreated: number;
  emailIdentitiesCreated: number;
  skipped: number;
  errors: number;
}

async function migrateAuthIdentities(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    usersProcessed: 0,
    appleIdentitiesCreated: 0,
    googleIdentitiesCreated: 0,
    emailIdentitiesCreated: 0,
    skipped: 0,
    errors: 0,
  };

  console.log('Starting auth_identities migration...\n');

  // Find all users with legacy appleId, googleId, or passwordHash
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { appleId: { not: null } },
        { googleId: { not: null } },
        { passwordHash: { not: null } },
      ],
    },
    select: {
      id: true,
      email: true,
      appleId: true,
      googleId: true,
      passwordHash: true,
      authIdentities: {
        select: { provider: true, providerUserId: true },
      },
    },
  });

  console.log(`Found ${users.length} users to process\n`);

  for (const user of users) {
    stats.usersProcessed++;

    try {
      // Check existing identities
      const existingProviders = new Set(user.authIdentities.map(i => i.provider));
      const existingProviderIds = new Set(user.authIdentities.map(i => `${i.provider}:${i.providerUserId}`));

      // Migrate Apple identity
      if (user.appleId && !existingProviderIds.has(`apple:${user.appleId}`)) {
        await prisma.authIdentity.upsert({
          where: {
            provider_providerUserId: {
              provider: 'apple',
              providerUserId: user.appleId,
            },
          },
          update: {}, // No update needed if exists
          create: {
            userId: user.id,
            provider: 'apple',
            providerUserId: user.appleId,
            email: user.email, // Use user's email
          },
        });
        stats.appleIdentitiesCreated++;
        console.log(`  + Apple identity for user ${user.id}`);
      }

      // Migrate Google identity
      if (user.googleId && !existingProviderIds.has(`google:${user.googleId}`)) {
        await prisma.authIdentity.upsert({
          where: {
            provider_providerUserId: {
              provider: 'google',
              providerUserId: user.googleId,
            },
          },
          update: {}, // No update needed if exists
          create: {
            userId: user.id,
            provider: 'google',
            providerUserId: user.googleId,
            email: user.email, // Use user's email
          },
        });
        stats.googleIdentitiesCreated++;
        console.log(`  + Google identity for user ${user.id}`);
      }

      // Migrate Email identity (if user has password)
      if (user.passwordHash && !existingProviders.has('email')) {
        await prisma.authIdentity.upsert({
          where: {
            userId_provider: {
              userId: user.id,
              provider: 'email',
            },
          },
          update: {}, // No update needed if exists
          create: {
            userId: user.id,
            provider: 'email',
            providerUserId: user.email, // For email, providerUserId is the email
            email: user.email,
          },
        });
        stats.emailIdentitiesCreated++;
        console.log(`  + Email identity for user ${user.id}`);
      }

      if (!user.appleId && !user.googleId && !user.passwordHash) {
        stats.skipped++;
      }
    } catch (error) {
      stats.errors++;
      console.error(`  ! Error processing user ${user.id}:`, error);
    }
  }

  return stats;
}

async function verifyMigration(): Promise<void> {
  console.log('\nVerifying migration...\n');

  // Count users with legacy fields but no corresponding auth_identity
  const usersWithAppleNoIdentity = await prisma.user.count({
    where: {
      appleId: { not: null },
      authIdentities: {
        none: { provider: 'apple' },
      },
    },
  });

  const usersWithGoogleNoIdentity = await prisma.user.count({
    where: {
      googleId: { not: null },
      authIdentities: {
        none: { provider: 'google' },
      },
    },
  });

  const usersWithPasswordNoIdentity = await prisma.user.count({
    where: {
      passwordHash: { not: null },
      authIdentities: {
        none: { provider: 'email' },
      },
    },
  });

  console.log('Users with appleId but no Apple auth_identity:', usersWithAppleNoIdentity);
  console.log('Users with googleId but no Google auth_identity:', usersWithGoogleNoIdentity);
  console.log('Users with passwordHash but no Email auth_identity:', usersWithPasswordNoIdentity);

  if (usersWithAppleNoIdentity === 0 && usersWithGoogleNoIdentity === 0 && usersWithPasswordNoIdentity === 0) {
    console.log('\n All users have been migrated successfully!');
  } else {
    console.log('\n WARNING: Some users were not migrated. Run migration again.');
  }
}

async function main(): Promise<void> {
  try {
    const stats = await migrateAuthIdentities();

    console.log('\n========================================');
    console.log('Migration Complete!');
    console.log('========================================');
    console.log(`Users processed:         ${stats.usersProcessed}`);
    console.log(`Apple identities:        ${stats.appleIdentitiesCreated}`);
    console.log(`Google identities:       ${stats.googleIdentitiesCreated}`);
    console.log(`Email identities:        ${stats.emailIdentitiesCreated}`);
    console.log(`Skipped:                 ${stats.skipped}`);
    console.log(`Errors:                  ${stats.errors}`);

    await verifyMigration();
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
