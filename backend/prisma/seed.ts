import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../src/config/env.js';

async function seed() {
  const ownerName = process.env.OWNER_NAME?.trim();
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.OWNER_PASSWORD;

  if (!ownerName || !ownerEmail || !ownerPassword || ownerPassword.length < 12) {
    throw new Error(
      'Set OWNER_NAME, OWNER_EMAIL, and an OWNER_PASSWORD of at least 12 characters in .env.',
    );
  }

  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const passwordHash = await bcrypt.hash(ownerPassword, 12);
    await prisma.user.upsert({
      where: { email: ownerEmail },
      update: { name: ownerName, passwordHash },
      create: { name: ownerName, email: ownerEmail, passwordHash },
    });

    const categories = [
      { name: 'Coffee', slug: 'coffee', sortOrder: 1 },
      { name: 'Pasta', slug: 'pasta', sortOrder: 2 },
    ];

    for (const categoryData of categories) {
      const category = await prisma.category.upsert({
        where: { slug: categoryData.slug },
        update: { name: categoryData.name, sortOrder: categoryData.sortOrder, isActive: true },
        create: categoryData,
      });

      const products =
        category.slug === 'coffee'
          ? [
              { name: 'House Coffee', slug: 'house-coffee', description: 'Freshly brewed coffee.' },
              {
                name: 'Iced Latte',
                slug: 'iced-latte',
                description: 'Espresso with chilled milk.',
              },
            ]
          : [
              {
                name: 'Creamy Chicken Pasta',
                slug: 'creamy-chicken-pasta',
                description: 'Creamy sauce with chicken.',
              },
            ];

      for (const [index, product] of products.entries()) {
        await prisma.product.upsert({
          where: { slug: product.slug },
          update: {
            ...product,
            categoryId: category.id,
            price: category.slug === 'coffee' ? (index === 0 ? 80 : 110) : 180,
            isAvailable: true,
            isArchived: false,
          },
          create: {
            ...product,
            categoryId: category.id,
            price: category.slug === 'coffee' ? (index === 0 ? 80 : 110) : 180,
          },
        });
      }
    }

    const settings = [
      ['store_name', 'Ordertaker'],
      ['pickup_address', 'Add your store address in the database before opening orders.'],
      ['pickup_instructions', 'Please wait for confirmation before picking up your order.'],
      ['delivery_fee', 0],
      ['qr_payment_image', null],
      ['qr_payment_instructions', 'Contact the store for QR payment instructions.'],
      ['store_contact', ''],
    ] as const;

    for (const [key, value] of settings) {
      await prisma.storeSetting.upsert({
        where: { key },
        update: {},
        create: { key, value: value === null ? Prisma.JsonNull : value },
      });
    }

    console.info(`Seeded owner ${ownerEmail}, categories, starter products, and store settings.`);
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((error: unknown) => {
  console.error('Database seeding failed:', error);
  process.exitCode = 1;
});
