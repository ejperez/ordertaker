import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { hasValidOrigin, requireOwner } from '../auth.js';
import { prisma } from '../db.js';
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

function makeSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 140)
    .replace(/^-|-$/g, '');
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: 'Invalid request', details: error.issues });
}

function handleUniqueError(error: unknown, reply: FastifyReply) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return reply
      .code(409)
      .send({ error: 'A category or product with that name or slug already exists' });
  }
  throw error;
}

function originAllowed(request: FastifyRequest) {
  return hasValidOrigin(request);
}

export const adminCatalogRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireOwner);
  app.addHook('preHandler', async (request, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !originAllowed(request)) {
      await reply.code(403).send({ error: 'Request origin is not allowed' });
    }
  });

  app.get('/categories', async () =>
    prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
  );

  app.post('/categories', async (request, reply) => {
    const parsed = categorySchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const data = { ...parsed.data, slug: parsed.data.slug ?? makeSlug(parsed.data.name) };
    if (!data.slug)
      return reply.code(400).send({ error: 'Category name must contain letters or numbers' });
    try {
      return reply.code(201).send(await prisma.category.create({ data }));
    } catch (error) {
      return handleUniqueError(error, reply);
    }
  });

  app.put<{ Params: { id: string } }>('/categories/:id', async (request, reply) => {
    const parsed = categorySchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const data = { ...parsed.data, slug: parsed.data.slug ?? makeSlug(parsed.data.name) };
    if (!data.slug)
      return reply.code(400).send({ error: 'Category name must contain letters or numbers' });
    try {
      return await prisma.category.update({ where: { id: request.params.id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.code(404).send({ error: 'Category not found' });
      }
      return handleUniqueError(error, reply);
    }
  });

  app.patch<{ Params: { id: string } }>('/categories/:id/availability', async (request, reply) => {
    const parsed = categoryAvailabilitySchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    try {
      return await prisma.category.update({ where: { id: request.params.id }, data: parsed.data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.code(404).send({ error: 'Category not found' });
      }
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>('/categories/:id', async (request, reply) => {
    const category = await prisma.category.findUnique({
      where: { id: request.params.id },
      include: { _count: { select: { products: true } } },
    });
    if (!category) return reply.code(404).send({ error: 'Category not found' });
    if (category._count.products > 0) {
      return reply.code(409).send({ error: 'Move this category’s products before deleting it' });
    }
    await prisma.category.delete({ where: { id: category.id } });
    return reply.code(204).send();
  });

  app.get<{ Querystring: { includeArchived?: string } }>('/products', async (request) =>
    prisma.product.findMany({
      where: request.query.includeArchived === 'true' ? {} : { isArchived: false },
      include: { category: { select: { id: true, name: true, slug: true, isActive: true } } },
      orderBy: [{ updatedAt: 'desc' }],
    }),
  );

  app.get<{ Params: { id: string } }>('/products/:id', async (request, reply) => {
    const product = await prisma.product.findUnique({
      where: { id: request.params.id },
      include: { category: { select: { id: true, name: true, slug: true } } },
    });
    if (!product) return reply.code(404).send({ error: 'Product not found' });
    return product;
  });

  app.post('/products', async (request, reply) => {
    const parsed = productSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId } });
    if (!category) return reply.code(400).send({ error: 'Select an existing category' });
    const data = { ...parsed.data, slug: parsed.data.slug ?? makeSlug(parsed.data.name) };
    if (!data.slug)
      return reply.code(400).send({ error: 'Product name must contain letters or numbers' });
    try {
      return reply.code(201).send(await prisma.product.create({ data }));
    } catch (error) {
      return handleUniqueError(error, reply);
    }
  });

  app.put<{ Params: { id: string } }>('/products/:id', async (request, reply) => {
    const parsed = productSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId } });
    if (!category) return reply.code(400).send({ error: 'Select an existing category' });
    const data = { ...parsed.data, slug: parsed.data.slug ?? makeSlug(parsed.data.name) };
    if (!data.slug)
      return reply.code(400).send({ error: 'Product name must contain letters or numbers' });
    try {
      return await prisma.product.update({ where: { id: request.params.id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.code(404).send({ error: 'Product not found' });
      }
      return handleUniqueError(error, reply);
    }
  });

  app.patch<{ Params: { id: string } }>('/products/:id/availability', async (request, reply) => {
    const parsed = availabilitySchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    try {
      return await prisma.product.update({ where: { id: request.params.id }, data: parsed.data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.code(404).send({ error: 'Product not found' });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>('/products/:id/archive', async (request, reply) => {
    const parsed = archiveSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    try {
      return await prisma.product.update({ where: { id: request.params.id }, data: parsed.data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.code(404).send({ error: 'Product not found' });
      }
      throw error;
    }
  });

  app.delete<{ Params: { id: string } }>('/products/:id', async (request, reply) => {
    try {
      const product = await prisma.product.update({
        where: { id: request.params.id },
        data: { isArchived: true, isAvailable: false },
      });
      return product;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.code(404).send({ error: 'Product not found' });
      }
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>(
    '/products/:id/image',
    { bodyLimit: 7_100_000 },
    async (request, reply) => {
      const parsed = imageSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      const oldProduct = await prisma.product.findUnique({
        where: { id: request.params.id },
        select: { id: true, imagePath: true },
      });
      if (!oldProduct) return reply.code(404).send({ error: 'Product not found' });

      const imagePath = await imageStorage.saveProductImage(parsed.data.data);
      try {
        const product = await prisma.product.update({
          where: { id: oldProduct.id },
          data: { imagePath },
        });
        if (oldProduct.imagePath) {
          try {
            await imageStorage.removeProductImage(oldProduct.imagePath);
          } catch (error) {
            request.log.error(error, 'Could not remove replaced product image');
          }
        }
        return product;
      } catch (error) {
        await imageStorage.removeProductImage(imagePath);
        throw error;
      }
    },
  );
};
