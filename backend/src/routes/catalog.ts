import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.get('/products', async () =>
    prisma.product.findMany({
      where: { isAvailable: true, isArchived: false, category: { isActive: true } },
      include: { category: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    }),
  );

  app.get('/categories', async () =>
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  );
};
