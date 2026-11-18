import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { hasValidOrigin, requireOwner } from '../auth.js';
import { categories, products } from '../db/schema/index.js';
import { isUniqueViolation } from '../db/errors.js';
import { imageStorage } from '../services/image-storage.js';
const categorySchema = z.object({
    name: z.string().trim().min(1).max(80),
    slug: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .optional(),
    sortOrder: z.number().int().min(0).max(10000).default(0),
    isActive: z.boolean().default(true),
});
const productSchema = z.object({
    name: z.string().trim().min(1).max(120),
    slug: z
        .string()
        .trim()
        .min(1)
        .max(140)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    price: z.number().finite().positive().max(99999999.99).multipleOf(0.01),
    categoryId: z.string().min(1).max(40),
    isAvailable: z.boolean().default(true),
});
const availabilitySchema = z.object({ isAvailable: z.boolean() });
const categoryAvailabilitySchema = z.object({ isActive: z.boolean() });
const archiveSchema = z.object({ isArchived: z.boolean() });
const imageSchema = z.object({ data: z.string().min(1).max(7_000_000) });
function makeSlug(value) {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 140)
        .replace(/^-|-$/g, '');
}
function sendValidationError(reply, error) {
    return reply.code(400).send({ error: 'Invalid request', details: error.issues });
}
function handleUniqueError(error, reply) {
    if (isUniqueViolation(error)) {
        return reply
            .code(409)
            .send({ error: 'A category or product with that name or slug already exists' });
    }
    throw error;
}
function originAllowed(request) {
    return hasValidOrigin(request);
}
export const adminCatalogRoutes = async (app) => {
    app.addHook('preHandler', requireOwner);
    app.addHook('preHandler', async (request, reply) => {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !originAllowed(request)) {
            await reply.code(403).send({ error: 'Request origin is not allowed' });
        }
    });
    app.get('/categories', async () => app.db.query.categories.findMany({
        orderBy: [asc(categories.sortOrder), asc(categories.name)],
    }));
    app.post('/categories', async (request, reply) => {
        const parsed = categorySchema.safeParse(request.body);
        if (!parsed.success)
            return sendValidationError(reply, parsed.error);
        const data = { ...parsed.data, slug: parsed.data.slug ?? makeSlug(parsed.data.name) };
        if (!data.slug)
            return reply.code(400).send({ error: 'Category name must contain letters or numbers' });
        try {
            const id = randomUUID();
            await app.db.insert(categories).values({ id, ...data, updatedAt: new Date() });
            const [category] = await app.db
                .select()
                .from(categories)
                .where(eq(categories.id, id))
                .limit(1);
            if (!category)
                throw new Error('Inserted category could not be read');
            return reply.code(201).send(category);
        }
        catch (error) {
            return handleUniqueError(error, reply);
        }
    });
    app.put('/categories/:id', async (request, reply) => {
        const parsed = categorySchema.safeParse(request.body);
        if (!parsed.success)
            return sendValidationError(reply, parsed.error);
        const data = { ...parsed.data, slug: parsed.data.slug ?? makeSlug(parsed.data.name) };
        if (!data.slug)
            return reply.code(400).send({ error: 'Category name must contain letters or numbers' });
        try {
            await app.db
                .update(categories)
                .set({ ...data, updatedAt: new Date() })
                .where(eq(categories.id, request.params.id));
            const [category] = await app.db
                .select()
                .from(categories)
                .where(eq(categories.id, request.params.id))
                .limit(1);
            if (!category)
                return reply.code(404).send({ error: 'Category not found' });
            return category;
        }
        catch (error) {
            return handleUniqueError(error, reply);
        }
    });
    app.patch('/categories/:id/availability', async (request, reply) => {
        const parsed = categoryAvailabilitySchema.safeParse(request.body);
        if (!parsed.success)
            return sendValidationError(reply, parsed.error);
        await app.db
            .update(categories)
            .set({ ...parsed.data, updatedAt: new Date() })
            .where(eq(categories.id, request.params.id));
        const [category] = await app.db
            .select()
            .from(categories)
            .where(eq(categories.id, request.params.id))
            .limit(1);
        if (!category)
            return reply.code(404).send({ error: 'Category not found' });
        return category;
    });
    app.delete('/categories/:id', async (request, reply) => {
        const [category] = await app.db
            .select({ id: categories.id })
            .from(categories)
            .where(eq(categories.id, request.params.id))
            .limit(1);
        if (!category)
            return reply.code(404).send({ error: 'Category not found' });
        const [product] = await app.db
            .select({ id: products.id })
            .from(products)
            .where(eq(products.categoryId, category.id))
            .limit(1);
        if (product) {
            return reply.code(409).send({ error: 'Move this category’s products before deleting it' });
        }
        await app.db.delete(categories).where(eq(categories.id, category.id));
        return reply.code(204).send();
    });
    app.get('/products', async (request) => {
        const rows = await app.db
            .select()
            .from(products)
            .innerJoin(categories, eq(products.categoryId, categories.id))
            .where(request.query.includeArchived === 'true' ? undefined : eq(products.isArchived, false))
            .orderBy(desc(products.updatedAt));
        return rows.map(({ products: product, categories: category }) => ({
            ...product,
            category: {
                id: category.id,
                name: category.name,
                slug: category.slug,
                isActive: category.isActive,
            },
        }));
    });
    app.get('/products/:id', async (request, reply) => {
        const [row] = await app.db
            .select()
            .from(products)
            .innerJoin(categories, eq(products.categoryId, categories.id))
            .where(eq(products.id, request.params.id))
            .limit(1);
        if (!row)
            return reply.code(404).send({ error: 'Product not found' });
        return {
            ...row.products,
            category: {
                id: row.categories.id,
                name: row.categories.name,
                slug: row.categories.slug,
            },
        };
    });
    app.post('/products', async (request, reply) => {
        const parsed = productSchema.safeParse(request.body);
        if (!parsed.success)
            return sendValidationError(reply, parsed.error);
        const [category] = await app.db
            .select({ id: categories.id })
            .from(categories)
            .where(eq(categories.id, parsed.data.categoryId))
            .limit(1);
        if (!category)
            return reply.code(400).send({ error: 'Select an existing category' });
        const data = { ...parsed.data, slug: parsed.data.slug ?? makeSlug(parsed.data.name) };
        if (!data.slug)
            return reply.code(400).send({ error: 'Product name must contain letters or numbers' });
        try {
            const id = randomUUID();
            await app.db
                .insert(products)
                .values({ id, ...data, price: parsed.data.price.toFixed(2), updatedAt: new Date() });
            const [product] = await app.db.select().from(products).where(eq(products.id, id)).limit(1);
            if (!product)
                throw new Error('Inserted product could not be read');
            return reply.code(201).send(product);
        }
        catch (error) {
            return handleUniqueError(error, reply);
        }
    });
    app.put('/products/:id', async (request, reply) => {
        const parsed = productSchema.safeParse(request.body);
        if (!parsed.success)
            return sendValidationError(reply, parsed.error);
        const [category] = await app.db
            .select({ id: categories.id })
            .from(categories)
            .where(eq(categories.id, parsed.data.categoryId))
            .limit(1);
        if (!category)
            return reply.code(400).send({ error: 'Select an existing category' });
        const data = { ...parsed.data, slug: parsed.data.slug ?? makeSlug(parsed.data.name) };
        if (!data.slug)
            return reply.code(400).send({ error: 'Product name must contain letters or numbers' });
        try {
            await app.db
                .update(products)
                .set({ ...data, price: parsed.data.price.toFixed(2), updatedAt: new Date() })
                .where(eq(products.id, request.params.id));
            const [product] = await app.db
                .select()
                .from(products)
                .where(eq(products.id, request.params.id))
                .limit(1);
            if (!product)
                return reply.code(404).send({ error: 'Product not found' });
            return product;
        }
        catch (error) {
            return handleUniqueError(error, reply);
        }
    });
    app.patch('/products/:id/availability', async (request, reply) => {
        const parsed = availabilitySchema.safeParse(request.body);
        if (!parsed.success)
            return sendValidationError(reply, parsed.error);
        await app.db
            .update(products)
            .set({ ...parsed.data, updatedAt: new Date() })
            .where(eq(products.id, request.params.id));
        const [product] = await app.db
            .select()
            .from(products)
            .where(eq(products.id, request.params.id))
            .limit(1);
        if (!product)
            return reply.code(404).send({ error: 'Product not found' });
        return product;
    });
    app.patch('/products/:id/archive', async (request, reply) => {
        const parsed = archiveSchema.safeParse(request.body);
        if (!parsed.success)
            return sendValidationError(reply, parsed.error);
        await app.db
            .update(products)
            .set({ ...parsed.data, updatedAt: new Date() })
            .where(eq(products.id, request.params.id));
        const [product] = await app.db
            .select()
            .from(products)
            .where(eq(products.id, request.params.id))
            .limit(1);
        if (!product)
            return reply.code(404).send({ error: 'Product not found' });
        return product;
    });
    app.delete('/products/:id', async (request, reply) => {
        await app.db
            .update(products)
            .set({ isArchived: true, isAvailable: false, updatedAt: new Date() })
            .where(eq(products.id, request.params.id));
        const [product] = await app.db
            .select()
            .from(products)
            .where(eq(products.id, request.params.id))
            .limit(1);
        if (!product)
            return reply.code(404).send({ error: 'Product not found' });
        return product;
    });
    app.post('/products/:id/image', { bodyLimit: 7_100_000 }, async (request, reply) => {
        const parsed = imageSchema.safeParse(request.body);
        if (!parsed.success)
            return sendValidationError(reply, parsed.error);
        const [oldProduct] = await app.db
            .select({ id: products.id, imagePath: products.imagePath })
            .from(products)
            .where(eq(products.id, request.params.id))
            .limit(1);
        if (!oldProduct)
            return reply.code(404).send({ error: 'Product not found' });
        const imagePath = await imageStorage.saveProductImage(parsed.data.data);
        try {
            await app.db
                .update(products)
                .set({ imagePath, updatedAt: new Date() })
                .where(eq(products.id, oldProduct.id));
            const [product] = await app.db
                .select()
                .from(products)
                .where(eq(products.id, oldProduct.id))
                .limit(1);
            if (!product) {
                await imageStorage.removeProductImage(imagePath);
                return reply.code(404).send({ error: 'Product not found' });
            }
            if (oldProduct.imagePath) {
                try {
                    await imageStorage.removeProductImage(oldProduct.imagePath);
                }
                catch (error) {
                    request.log.error(error, 'Could not remove replaced product image');
                }
            }
            return product;
        }
        catch (error) {
            await imageStorage.removeProductImage(imagePath);
            throw error;
        }
    });
};
