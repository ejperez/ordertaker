import { and, asc, eq, inArray } from 'drizzle-orm';
import { categories, products, storeSettings } from '../db/schema/index.js';
export const catalogRoutes = async (app) => {
    app.get('/products', async () => {
        const result = await app.db
            .select({
            id: products.id,
            categoryId: products.categoryId,
            name: products.name,
            slug: products.slug,
            description: products.description,
            price: products.price,
            imagePath: products.imagePath,
            isAvailable: products.isAvailable,
            isArchived: products.isArchived,
            createdAt: products.createdAt,
            updatedAt: products.updatedAt,
            category: {
                id: categories.id,
                name: categories.name,
                slug: categories.slug,
            },
        })
            .from(products)
            .innerJoin(categories, eq(products.categoryId, categories.id))
            .where(and(eq(products.isArchived, false), eq(categories.isActive, true)))
            .orderBy(asc(categories.sortOrder), asc(products.name));
        return result;
    });
    app.get('/categories', async () => app.db.query.categories.findMany({
        where: eq(categories.isActive, true),
        orderBy: [asc(categories.sortOrder), asc(categories.name)],
    }));
    app.get('/store', async () => {
        const settings = await app.db
            .select()
            .from(storeSettings)
            .where(inArray(storeSettings.key, [
            'store_name',
            'pickup_address',
            'pickup_instructions',
            'delivery_fee',
            'qr_payment_image',
            'qr_payment_instructions',
        ]));
        const values = new Map(settings.map((setting) => [setting.key, setting.value]));
        const stringSetting = (key, fallback = '') => {
            const value = values.get(key);
            return typeof value === 'string' ? value : fallback;
        };
        const deliveryFeeValue = values.get('delivery_fee');
        const deliveryFee = Number(deliveryFeeValue ?? 0);
        if (!Number.isFinite(deliveryFee) || deliveryFee < 0) {
            throw new Error('Configured delivery fee must be a non-negative amount');
        }
        return {
            name: stringSetting('store_name', 'Ordertaker'),
            pickupAddress: stringSetting('pickup_address'),
            pickupInstructions: stringSetting('pickup_instructions'),
            deliveryFee,
            qrPaymentImage: stringSetting('qr_payment_image') || null,
            qrPaymentInstructions: stringSetting('qr_payment_instructions'),
        };
    });
};
