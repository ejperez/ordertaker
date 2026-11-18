import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';
import { createDatabase } from '../src/db.js';
import { categories, products, storeSettings, users } from '../src/db/schema/index.js';
const ownerName = process.env.OWNER_NAME?.trim();
const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
const ownerPassword = process.env.OWNER_PASSWORD;
if (!ownerName || !ownerEmail || !ownerPassword || ownerPassword.length < 12) {
    throw new Error('Set OWNER_NAME, OWNER_EMAIL, and an OWNER_PASSWORD of at least 12 characters in .env.');
}
if (ownerName.length > 120 || ownerEmail.length > 254) {
    throw new Error('OWNER_NAME must be at most 120 characters and OWNER_EMAIL at most 254.');
}
const client = mysql.createPool(env.DATABASE_URL);
try {
    const db = createDatabase(client);
    const passwordHash = await bcrypt.hash(ownerPassword, 12);
    await db
        .insert(users)
        .values({ name: ownerName, email: ownerEmail, passwordHash, updatedAt: new Date() })
        .onDuplicateKeyUpdate({
        set: { name: ownerName, passwordHash, updatedAt: new Date() },
    });
    const categoryData = [
        { name: 'Coffee', slug: 'coffee', sortOrder: 1 },
        { name: 'Pasta', slug: 'pasta', sortOrder: 2 },
    ];
    for (const data of categoryData) {
        await db
            .insert(categories)
            .values({ ...data, updatedAt: new Date() })
            .onDuplicateKeyUpdate({
            set: { name: data.name, sortOrder: data.sortOrder, isActive: true, updatedAt: new Date() },
        });
        const [category] = await db
            .select()
            .from(categories)
            .where(eq(categories.slug, data.slug))
            .limit(1);
        if (!category)
            throw new Error(`Seeded category ${data.slug} could not be read`);
        const starterProducts = category.slug === 'coffee'
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
                .onDuplicateKeyUpdate({
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
    ];
    for (const [key, value] of settings) {
        const [existing] = await db
            .select({ key: storeSettings.key })
            .from(storeSettings)
            .where(eq(storeSettings.key, key))
            .limit(1);
        if (!existing)
            await db.insert(storeSettings).values({ key, value, updatedAt: new Date() });
    }
    console.info(`Seeded owner ${ownerEmail}, categories, starter products, and store settings.`);
}
finally {
    await client.end();
}
