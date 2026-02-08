import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // Create categories (matching iOS app)
  const categories = await Promise.all([
    prisma.category.upsert({
      where: { slug: 'vegetarian' },
      update: {},
      create: { name: 'Vegetarian', slug: 'vegetarian', icon: 'leaf.fill', emoji: '🥬', sortOrder: 1 },
    }),
    prisma.category.upsert({
      where: { slug: 'bakery' },
      update: {},
      create: { name: 'Bakery', slug: 'bakery', icon: 'birthday.cake.fill', emoji: '🥐', sortOrder: 2 },
    }),
    prisma.category.upsert({
      where: { slug: 'pizza' },
      update: {},
      create: { name: 'Pizza', slug: 'pizza', icon: 'fork.knife', emoji: '🍕', sortOrder: 3 },
    }),
    prisma.category.upsert({
      where: { slug: 'african' },
      update: {},
      create: { name: 'African', slug: 'african', icon: 'flame.fill', emoji: '🍲', sortOrder: 4 },
    }),
    prisma.category.upsert({
      where: { slug: 'asian' },
      update: {},
      create: { name: 'Asian', slug: 'asian', icon: 'takeoutbag.and.cup.and.straw.fill', emoji: '🍜', sortOrder: 5 },
    }),
    prisma.category.upsert({
      where: { slug: 'desserts' },
      update: {},
      create: { name: 'Desserts', slug: 'desserts', icon: 'birthday.cake', emoji: '🍰', sortOrder: 6 },
    }),
    prisma.category.upsert({
      where: { slug: 'italian' },
      update: {},
      create: { name: 'Italian', slug: 'italian', icon: 'fork.knife', emoji: '🍝', sortOrder: 7 },
    }),
    prisma.category.upsert({
      where: { slug: 'indian' },
      update: {},
      create: { name: 'Indian', slug: 'indian', icon: 'flame', emoji: '🍛', sortOrder: 8 },
    }),
  ]);

  console.log(`Created ${categories.length} categories`);

  // Create demo consumer user
  const consumerPassword = await bcrypt.hash('password123', 12);
  const consumer = await prisma.user.upsert({
    where: { email: 'demo@savr.app' },
    update: {},
    create: {
      email: 'demo@savr.app',
      passwordHash: consumerPassword,
      name: 'Demo User',
      role: 'consumer',
      emailVerified: true,
      preferences: ['Vegetarian', 'Bakery', 'Italian'],
      loyaltyPoints: 25,
      latitude: 37.7749,  // San Francisco
      longitude: -122.4194,
    },
  });

  console.log(`Created consumer: ${consumer.email}`);

  // Create demo business user
  const businessPassword = await bcrypt.hash('business123', 12);
  const businessUser = await prisma.user.upsert({
    where: { email: 'business@savr.app' },
    update: {},
    create: {
      email: 'business@savr.app',
      passwordHash: businessPassword,
      name: 'Restaurant Owner',
      role: 'business',
      emailVerified: true,
    },
  });

  console.log(`Created business user: ${businessUser.email}`);

  // Create restaurants (San Francisco locations for testing)
  const restaurants = await Promise.all([
    prisma.restaurant.upsert({
      where: { slug: 'the-green-kitchen' },
      update: {},
      create: {
        ownerId: businessUser.id,
        name: 'The Green Kitchen',
        slug: 'the-green-kitchen',
        description: 'Fresh, healthy vegetarian and vegan meals made with locally sourced ingredients.',
        addressLine1: '1 Ferry Building',
        city: 'San Francisco',
        province: 'CA',
        postalCode: '94111',
        latitude: 37.7956,
        longitude: -122.3933,
        phone: '+1 415 123 4567',
        ratingAvg: 4.8,
        ratingCount: 234,
        isActive: true,
        isVerified: true,
        categories: {
          create: [{ categoryId: categories[0].id }],
        },
      },
    }),
  ]);

  // Create more restaurants with separate business users (San Francisco locations)
  const otherRestaurants = [
    { name: 'Bella Italia', slug: 'bella-italia', category: 'italian', address: '373 Columbus Ave', lat: 37.7985, lng: -122.4078, rating: 4.6, count: 189 },
    { name: 'Tokyo Express', slug: 'tokyo-express', category: 'asian', address: '1581 Webster St', lat: 37.7853, lng: -122.4324, rating: 4.5, count: 156 },
    { name: 'SF Bakehouse', slug: 'sf-bakehouse', category: 'bakery', address: '2325 Chestnut St', lat: 37.8003, lng: -122.4402, rating: 4.9, count: 312 },
    { name: 'Mission Kitchen', slug: 'mission-kitchen', category: 'african', address: '2889 Mission St', lat: 37.7516, lng: -122.4181, rating: 4.7, count: 198 },
    { name: 'Curry House', slug: 'curry-house', category: 'indian', address: '775 Valencia St', lat: 37.7603, lng: -122.4215, rating: 4.4, count: 145 },
    { name: 'Sweet Delights', slug: 'sweet-delights', category: 'desserts', address: '444 Castro St', lat: 37.7619, lng: -122.4350, rating: 4.8, count: 267 },
  ];

  for (const r of otherRestaurants) {
    const ownerEmail = `owner-${r.slug}@savr.app`;
    const owner = await prisma.user.upsert({
      where: { email: ownerEmail },
      update: {},
      create: {
        email: ownerEmail,
        passwordHash: businessPassword,
        name: `${r.name} Owner`,
        role: 'business',
        emailVerified: true,
      },
    });

    const cat = categories.find(c => c.slug === r.category);

    await prisma.restaurant.upsert({
      where: { slug: r.slug },
      update: {},
      create: {
        ownerId: owner.id,
        name: r.name,
        slug: r.slug,
        addressLine1: r.address,
        city: 'San Francisco',
        province: 'CA',
        postalCode: '94110',
        latitude: r.lat,
        longitude: r.lng,
        ratingAvg: r.rating,
        ratingCount: r.count,
        isActive: true,
        isVerified: true,
        categories: cat ? { create: [{ categoryId: cat.id }] } : undefined,
      },
    });
  }

  console.log(`Created ${otherRestaurants.length + 1} restaurants`);

  // Get all restaurants for bags
  const allRestaurants = await prisma.restaurant.findMany();

  // Create bags (surprise bags) - matching iOS mock data
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(17, 0, 0, 0);

  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(20, 0, 0, 0);

  const bags = [
    { title: 'Surprise Veggie Box', desc: 'A delicious mix of fresh vegetarian dishes', food: 'Vegetarian', orig: 12000, curr: 4500, qty: 5, allergens: ['Gluten', 'Nuts'], badges: ['Popular', 'Best Value'] },
    { title: 'Pasta Paradise', desc: 'Assorted pasta dishes with fresh sauces', food: 'Italian', orig: 15000, curr: 5500, qty: 3, allergens: ['Gluten', 'Dairy'], badges: ['Limited'] },
    { title: 'Sushi Selection', desc: 'Fresh sushi rolls and nigiri', food: 'Asian', orig: 18000, curr: 6500, qty: 4, allergens: ['Fish', 'Soy'], badges: ['Popular'] },
    { title: "Baker's Dozen", desc: 'Assorted freshly baked goods', food: 'Bakery', orig: 9000, curr: 3500, qty: 8, allergens: ['Gluten', 'Eggs'], badges: ['Best Value'] },
    { title: 'African Feast', desc: 'Traditional African dishes', food: 'African', orig: 14000, curr: 5000, qty: 4, allergens: [], badges: ['Popular'] },
    { title: 'Curry Combo', desc: 'Aromatic curries with rice and naan', food: 'Indian', orig: 13000, curr: 4800, qty: 6, allergens: ['Dairy', 'Nuts'], badges: [] },
    { title: 'Dessert Dreams', desc: 'Sweet treats and pastries', food: 'Desserts', orig: 8000, curr: 3000, qty: 10, allergens: ['Gluten', 'Dairy', 'Eggs'], badges: ['Best Value'] },
  ];

  for (let i = 0; i < bags.length; i++) {
    const b = bags[i];
    const restaurant = allRestaurants[i % allRestaurants.length];

    await prisma.bag.create({
      data: {
        restaurantId: restaurant.id,
        title: b.title,
        description: b.desc,
        foodType: b.food,
        priceOriginal: b.orig,
        priceCurrent: b.curr,
        quantityTotal: b.qty,
        quantityRemaining: b.qty,
        pickupStart: tomorrow,
        pickupEnd: tomorrowEnd,
        allergens: b.allergens,
        badges: b.badges,
        isActive: true,
        isSoldOut: false,
      },
    });
  }

  console.log(`Created ${bags.length} bags`);

  console.log('');
  console.log('=== Seed Complete ===');
  console.log('');
  console.log('Demo accounts:');
  console.log('  Consumer: demo@savr.app / password123');
  console.log('  Business: business@savr.app / business123');
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
