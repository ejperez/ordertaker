import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.get('/products', async () =>
    prisma.product.findMany({
      where: { isArchived: false, category: { isActive: true } },
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

  app.get('/store', async () => {
    const settings = await prisma.storeSetting.findMany({
      where: {
        key: {
          in: [
            'store_name',
            'pickup_address',
            'pickup_instructions',
            'delivery_fee',
            'qr_payment_image',
            'qr_payment_instructions',
          ],
        },
      },
    });
    const values = new Map(settings.map((setting) => [setting.key, setting.value]));
    const stringSetting = (key: string, fallback = '') => {
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
