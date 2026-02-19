import 'dotenv/config';
import prisma from '../src/utils/prisma';
import crypto from 'crypto';

async function main() {
  const code = 'KULA-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const email = 'benjaminmalemo12@gmail.com';

  // Create approved application
  await prisma.partnerApplication.create({
    data: {
      businessName: 'Test Restaurant',
      contactName: 'Benjamin Malemo',
      email,
      city: 'Johannesburg',
      message: 'Testing the invite flow',
      status: 'approved',
      reviewedAt: new Date(),
    },
  });

  // Create invite code (30-day expiry)
  await prisma.inviteCode.create({
    data: {
      code,
      email,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  console.log('\n✅ Invite created!');
  console.log(`   Code: ${code}`);
  console.log(`   Email: ${email}`);
  console.log(`   Register: https://dashboard.kulasave.co.za/dashboard/register?code=${code}`);
  console.log(`   Local: http://localhost:5173/dashboard/register?code=${code}\n`);

  await prisma.$disconnect();
}

main().catch(console.error);
