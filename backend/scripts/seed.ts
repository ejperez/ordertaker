import bcrypt from 'bcryptjs';
import postgres from 'postgres';
import { env } from '../src/config/env.js';
import { createDatabase } from '../src/db.js';
import { categories, products, storeSettings, users } from '../src/db/schema/index.js';

const ownerName = process.env.OWNER_NAME?.trim();
const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
const ownerPassword = process.env.OWNER_PASSWORD;

if (!ownerName || !ownerEmail || !ownerPassword || ownerPassword.length < 12) {
  throw new Error(
    'Set OWNER_NAME, OWNER_EMAIL, and an OWNER_PASSWORD of at least 12 characters in .env.',
  );
}

const client = postgres(env.DIRECT_URL, { prepare: false, max: 1 });
try {
  const db = createDatabase(client);
  const passwordHash = await bcrypt.hash(ownerPassword, 12);
  await db
    .insert(users)
    .values({ name: ownerName, email: ownerEmail, passwordHash, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: ownerName, passwordHash, updatedAt: new Date() },
    });

  const categoryData = [
    { name: 'Coffee', slug: 'coffee', sortOrder: 1 },
    { name: 'Pasta', slug: 'pasta', sortOrder: 2 },
  ];

  for (const data of categoryData) {
    const [category] = await db
      .insert(categories)
      .values({ ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: categories.slug,
        set: {
          name: data.name,
          sortOrder: data.sortOrder,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning();

    const starterProducts =
      category.slug === 'coffee'
        ? [
            {
              name: 'House Coffee',
              slug: 'house-coffee',
              description: 'Freshly brewed coffee.',
              price: '80.00',
            },
            {
              name: 'Iced Latte',
              slug: 'iced-latte',
              description: 'Espresso with chilled milk.',
              price: '110.00',
            },
          ]
        : [
            {
              name: 'Creamy Chicken Pasta',
              slug: 'creamy-chicken-pasta',
              description: 'Creamy sauce with chicken.',
              price: '180.00',
            },
          ];

    for (const product of starterProducts) {
      await db
        .insert(products)
        .values({
          ...product,
          categoryId: category.id,
          isAvailable: true,
          isArchived: false,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: products.slug,
          set: {
            ...product,
            categoryId: category.id,
            isAvailable: true,
            isArchived: false,
            updatedAt: new Date(),
          },
        });
    }
  }

  const settings = [
    ['store_name', 'Ordertaker'],
    ['pickup_address', 'Add your store address in the database before opening orders.'],
    ['pickup_instructions', 'Please wait for confirmation before picking up your order.'],
    ['delivery_fee', 0],
    ['qr_payment_image', ''],
    ['qr_payment_instructions', 'Contact the store for QR payment instructions.'],
    ['store_contact', ''],
  ] as const;

  for (const [key, value] of settings) {
    await db
      .insert(storeSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoNothing({ target: storeSettings.key });
  }

  console.info(`Seeded owner ${ownerEmail}, categories, starter products, and store settings.`);
} finally {
  await client.end();
}
