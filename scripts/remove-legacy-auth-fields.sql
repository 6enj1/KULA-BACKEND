-- =============================================================================
-- FUTURE MIGRATION: Remove deprecated appleId/googleId fields
-- =============================================================================
--
-- IMPORTANT: Only run this AFTER:
-- 1. migrate-auth-identities.ts has been run and verified
-- 2. All production code reads from auth_identities only
-- 3. App has been deployed and running for at least 2 weeks
-- 4. You've verified no external systems depend on these fields
--
-- This migration is IRREVERSIBLE. Make a backup first!
-- =============================================================================

-- Step 1: Verify all users have been migrated to auth_identities
-- These queries should return 0 rows before proceeding

-- Check for Apple users without auth_identity
SELECT id, email, apple_id
FROM users
WHERE apple_id IS NOT NULL
  AND id NOT IN (
    SELECT user_id FROM auth_identities WHERE provider = 'apple'
  );

-- Check for Google users without auth_identity
SELECT id, email, google_id
FROM users
WHERE google_id IS NOT NULL
  AND id NOT IN (
    SELECT user_id FROM auth_identities WHERE provider = 'google'
  );

-- If the above queries return any rows, DO NOT proceed!
-- Run migrate-auth-identities.ts first.

-- =============================================================================
-- Step 2: Drop the indexes (run these first)
-- =============================================================================

DROP INDEX IF EXISTS users_apple_id_idx;
DROP INDEX IF EXISTS users_google_id_idx;

-- =============================================================================
-- Step 3: Drop the columns
-- =============================================================================

ALTER TABLE users DROP COLUMN IF EXISTS apple_id;
ALTER TABLE users DROP COLUMN IF EXISTS google_id;

-- =============================================================================
-- Step 4: Update Prisma schema and regenerate client
-- =============================================================================
-- After running this SQL, update prisma/schema.prisma to remove:
--   appleId              String?   @unique @map("apple_id")
--   googleId             String?   @unique @map("google_id")
--   @@index([appleId])
--   @@index([googleId])
--
-- Then run: npx prisma generate

-- =============================================================================
-- Rollback (if needed - requires backup data)
-- =============================================================================
-- ALTER TABLE users ADD COLUMN apple_id VARCHAR(255) UNIQUE;
-- ALTER TABLE users ADD COLUMN google_id VARCHAR(255) UNIQUE;
-- CREATE INDEX users_apple_id_idx ON users(apple_id);
-- CREATE INDEX users_google_id_idx ON users(google_id);
--
-- To restore data, you'd need to re-populate from auth_identities:
-- UPDATE users u
-- SET apple_id = ai.provider_user_id
-- FROM auth_identities ai
-- WHERE ai.user_id = u.id AND ai.provider = 'apple';
--
-- UPDATE users u
-- SET google_id = ai.provider_user_id
-- FROM auth_identities ai
-- WHERE ai.user_id = u.id AND ai.provider = 'google';
