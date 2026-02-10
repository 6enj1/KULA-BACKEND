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
      latitude: -26.1255,  // Hyde Park, Johannesburg
      longitude: 28.0347,
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

  // Create restaurants (Hyde Park, Johannesburg locations for testing)
  const restaurants = await Promise.all([
    prisma.restaurant.upsert({
      where: { slug: 'the-green-kitchen' },
      update: {},
      create: {
        ownerId: businessUser.id,
        name: 'The Green Kitchen',
        slug: 'the-green-kitchen',
        description: 'Fresh, healthy vegetarian and vegan meals made with locally sourced ingredients.',
        addressLine1: '25 Melville Rd',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: '2196',
        latitude: -26.1255,
        longitude: 28.0347,
        phone: '+27 11 325 1234',
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

  // Create more restaurants with separate business users (Hyde Park / Rosebank / Sandton area)
  const otherRestaurants = [
    { name: 'Trattoria del Centro', slug: 'trattoria-del-centro', category: 'italian', address: 'Hyde Park Corner, Jan Smuts Ave', lat: -26.1242, lng: 28.0340, rating: 4.6, count: 189 },
    { name: 'Saigon Supper Club', slug: 'saigon-supper-club', category: 'asian', address: '12 Cradock Ave, Rosebank', lat: -26.1460, lng: 28.0440, rating: 4.5, count: 156 },
    { name: 'Flour & Stone Bakery', slug: 'flour-and-stone-bakery', category: 'bakery', address: '4th Ave, Parkhurst', lat: -26.1380, lng: 28.0150, rating: 4.9, count: 312 },
    { name: 'Mama Afrika Kitchen', slug: 'mama-afrika-kitchen', category: 'african', address: '44 Jan Smuts Ave, Craighall Park', lat: -26.1350, lng: 28.0280, rating: 4.7, count: 198 },
    { name: 'Delhi Darbar', slug: 'delhi-darbar', category: 'indian', address: 'Sandton City, Rivonia Rd', lat: -26.1076, lng: 28.0567, rating: 4.4, count: 145 },
    { name: 'Sweet Obsession', slug: 'sweet-obsession', category: 'desserts', address: 'The Zone, Rosebank', lat: -26.1470, lng: 28.0410, rating: 4.8, count: 267 },
    { name: 'Col\'Cacchio', slug: 'colcacchio-hyde-park', category: 'pizza', address: 'Hyde Park Corner, William Nicol Dr', lat: -26.1248, lng: 28.0335, rating: 4.3, count: 210 },
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
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: '2196',
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

  // Create bags (surprise bags) - with pickup windows spread over the next 7 days
  const pickupWindows = Array.from({ length: 8 }, (_, i) => {
    const start = new Date();
    start.setDate(start.getDate() + 1 + (i % 7)); // spread across next 7 days
    start.setHours(11 + (i % 3) * 3, 0, 0, 0);   // 11:00, 14:00, or 17:00
    const end = new Date(start);
    end.setHours(start.getHours() + 3, 0, 0, 0);  // 3-hour pickup window
    return { start, end };
  });

  const bags = [
    { title: 'Surprise Veggie Box', desc: 'A delicious mix of fresh vegetarian dishes from our daily menu', food: 'Vegetarian', orig: 15000, curr: 5500, qty: 5, allergens: ['Gluten', 'Nuts'], badges: ['Popular', 'Best Value'] },
    { title: 'Pasta Paradise', desc: 'Assorted pasta dishes with fresh sauces and bread', food: 'Italian', orig: 18000, curr: 6500, qty: 3, allergens: ['Gluten', 'Dairy'], badges: ['Limited'] },
    { title: 'Asian Surprise Box', desc: 'A mix of stir-fry, noodles, and spring rolls', food: 'Asian', orig: 16000, curr: 5900, qty: 4, allergens: ['Fish', 'Soy'], badges: ['Popular'] },
    { title: "Baker's Basket", desc: 'Assorted freshly baked breads, pastries, and muffins', food: 'Bakery', orig: 12000, curr: 4500, qty: 8, allergens: ['Gluten', 'Eggs'], badges: ['Best Value'] },
    { title: 'African Feast Box', desc: 'Traditional pap, chakalaka, braai meat, and sides', food: 'African', orig: 17000, curr: 6000, qty: 4, allergens: [], badges: ['Popular'] },
    { title: 'Curry Combo', desc: 'Aromatic curries with rice, naan, and samosas', food: 'Indian', orig: 16000, curr: 5500, qty: 6, allergens: ['Dairy', 'Nuts'], badges: [] },
    { title: 'Sweet Treats Box', desc: 'Cakes, brownies, and artisan desserts', food: 'Desserts', orig: 10000, curr: 3900, qty: 10, allergens: ['Gluten', 'Dairy', 'Eggs'], badges: ['Best Value'] },
    { title: 'Pizza Rescue Bag', desc: 'Assorted pizza slices and garlic bread from the day', food: 'Pizza', orig: 14000, curr: 4900, qty: 6, allergens: ['Gluten', 'Dairy'], badges: ['Popular', 'Limited'] },
  ];

  for (let i = 0; i < bags.length; i++) {
    const b = bags[i];
    const restaurant = allRestaurants[i % allRestaurants.length];

    const window = pickupWindows[i];
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
        pickupStart: window.start,
        pickupEnd: window.end,
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
