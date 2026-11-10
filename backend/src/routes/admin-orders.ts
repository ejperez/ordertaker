import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { hasValidOrigin, requireOwner } from '../auth.js';
import { prisma } from '../db.js';
import { ImageValidationError, imageStorage } from '../services/image-storage.js';
import { publishNewMessage, publishOrderUpdated } from '../realtime.js';

const orderStatuses = Object.values(OrderStatus);
const paymentStatuses = Object.values(PaymentStatus);
const filtersSchema = z.object({
  status: z.enum(orderStatuses).optional(),
  fulfillmentType: z.enum(['DELIVERY', 'PICKUP']).optional(),
  paymentStatus: z.enum(paymentStatuses).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
const messageSchema = z.object({ message: z.string().trim().min(1).max(2000) });
const statusSchema = z.object({
  status: z.enum(orderStatuses),
  note: z.string().trim().max(500).optional(),
});
const qrImageSchema = z.object({ data: z.string().min(1).max(7_000_000) });
const qrInstructionsSchema = z.object({ instructions: z.string().trim().max(1000) });
const paymentReviewSchema = z
  .object({
    status: z.enum(['PAID', 'REJECTED']),
    rejectionReason: z.string().trim().max(500).optional(),
  })
  .superRefine((data, context) => {
    if (data.status === 'REJECTED' && !data.rejectionReason) {
      context.addIssue({
        code: 'custom',
        path: ['rejectionReason'],
        message: 'A reason is required when rejecting a payment',
      });
    }
    if (data.status === 'PAID' && data.rejectionReason) {
      context.addIssue({
        code: 'custom',
        path: ['rejectionReason'],
        message: 'A rejection reason is only accepted when rejecting a payment',
      });
    }
  });

const validTransitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['IN_KITCHEN', 'CANCELLED'],
  IN_KITCHEN: ['OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  READY_FOR_PICKUP: ['PICKED_UP'],
  DELIVERED: [],
  PICKED_UP: [],
  CANCELLED: [],
};

const orderInclude = {
  items: { orderBy: { createdAt: 'asc' as const } },
  payment: {
    select: {
      method: true,
      status: true,
      amount: true,
      referenceNumber: true,
      rejectionReason: true,
      verifiedAt: true,
      verifiedBy: { select: { name: true } },
      statusHistory: {
        orderBy: { createdAt: 'asc' as const },
        include: { changedBy: { select: { name: true } } },
      },
    },
  },
  statusHistory: {
    orderBy: { createdAt: 'asc' as const },
    include: { changedBy: { select: { name: true } } },
  },
};

export const adminOrderRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireOwner);
  app.addHook('preHandler', async (request, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !hasValidOrigin(request)) {
      await reply.code(403).send({ error: 'Request origin is not allowed' });
    }
  });

  app.get('/orders', async (request, reply) => {
    const parsed = filtersSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid order filters', details: parsed.error.issues });
    }
    const { status, fulfillmentType, paymentStatus, from, to } = parsed.data;
    if (from && to && new Date(from) > new Date(to)) {
      return reply.code(400).send({ error: '`from` must be earlier than `to`' });
    }

    return prisma.order.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(fulfillmentType ? { fulfillmentType } : {}),
        ...(paymentStatus ? { payment: { is: { status: paymentStatus } } } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (request, reply) => {
    const order = await prisma.order.findUnique({
      where: { id: request.params.id },
      include: orderInclude,
    });
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    return order;
  });

  app.get<{ Params: { id: string } }>('/orders/:id/messages', async (request, reply) => {
    const order = await prisma.order.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    return prisma.message.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  });

  app.post<{ Params: { id: string } }>('/orders/:id/messages', async (request, reply) => {
    const parsed = messageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid message', details: parsed.error.issues });
    }
    const order = await prisma.order.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });
    if (!order) return reply.code(404).send({ error: 'Order not found' });

    const message = await prisma.message.create({
      data: {
        orderId: order.id,
        senderType: 'OWNER',
        senderName: request.owner!.name,
        message: parsed.data.message,
      },
    });
    publishNewMessage(order.id, message);
    return reply.code(201).send(message);
  });

  app.get<{ Params: { id: string } }>('/orders/:id/payment-proof', async (request, reply) => {
    const payment = await prisma.payment.findUnique({
      where: { orderId: request.params.id },
      select: { method: true, proofImagePath: true },
    });
    if (payment?.method !== 'QR' || !payment.proofImagePath) {
      return reply.code(404).send({ error: 'Payment receipt not found' });
    }

    const proof = await imageStorage.readPaymentProof(payment.proofImagePath);
    if (!proof) return reply.code(404).send({ error: 'Payment receipt not found' });

    return reply
      .type(proof.contentType)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(proof.bytes);
  });

  app.patch<{ Params: { id: string } }>('/orders/:id/payment', async (request, reply) => {
    const parsed = paymentReviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid payment review', details: parsed.error.issues });
    }

    try {
      const result = await prisma.$transaction(
        async (transaction) => {
          const payment = await transaction.payment.findUnique({
            where: { orderId: request.params.id },
            select: { id: true, method: true, status: true },
          });
          if (!payment) return { kind: 'missing' as const };

          const validQrReview =
            payment.method === 'QR' &&
            payment.status === 'AWAITING_VERIFICATION' &&
            ['PAID', 'REJECTED'].includes(parsed.data.status);
          const validCodCollection =
            payment.method === 'COD' &&
            payment.status === 'UNPAID' &&
            parsed.data.status === 'PAID';
          if (!validQrReview && !validCodCollection) {
            return { kind: 'invalid' as const, method: payment.method, status: payment.status };
          }

          const updated = await transaction.payment.updateMany({
            where: {
              id: payment.id,
              method: payment.method,
              status: payment.status,
            },
            data: {
              status: parsed.data.status,
              verifiedAt: new Date(),
              verifiedById: request.owner!.id,
              rejectionReason:
                parsed.data.status === 'REJECTED' ? parsed.data.rejectionReason : null,
            },
          });
          if (updated.count !== 1) return { kind: 'conflict' as const };

          await transaction.paymentStatusHistory.create({
            data: {
              paymentId: payment.id,
              oldStatus: payment.status,
              newStatus: parsed.data.status,
              actorType: 'OWNER',
              changedByUserId: request.owner!.id,
              note:
                parsed.data.status === 'REJECTED'
                  ? parsed.data.rejectionReason
                  : payment.method === 'COD'
                    ? 'Cash payment collected.'
                    : 'QR payment verified.',
            },
          });

          return {
            kind: 'success' as const,
            payment: await transaction.payment.findUnique({
              where: { id: payment.id },
              select: {
                method: true,
                status: true,
                amount: true,
                referenceNumber: true,
                rejectionReason: true,
                verifiedAt: true,
                verifiedBy: { select: { name: true } },
                statusHistory: {
                  orderBy: { createdAt: 'asc' },
                  include: { changedBy: { select: { name: true } } },
                },
              },
            }),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (result.kind === 'missing') return reply.code(404).send({ error: 'Payment not found' });
      if (result.kind === 'invalid') {
        return reply.code(409).send({
          error:
            result.method === 'QR'
              ? `QR payment is ${result.status}; only awaiting payments can be reviewed`
              : `COD payment is ${result.status}; only unpaid COD orders can be collected`,
        });
      }
      if (result.kind === 'conflict') {
        return reply
          .code(409)
          .send({ error: 'Payment status changed concurrently. Refresh and retry.' });
      }
      if (result.payment) {
        publishOrderUpdated(request.params.id, 'payment:updated', {
          status: result.payment.status,
        });
      }
      return result.payment;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        return reply
          .code(409)
          .send({ error: 'Payment status changed concurrently. Refresh and retry.' });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>('/orders/:id/status', async (request, reply) => {
    const parsed = statusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid order status update', details: parsed.error.issues });
    }

    try {
      const updated = await prisma.$transaction(
        async (transaction) => {
          const current = await transaction.order.findUnique({
            where: { id: request.params.id },
            select: {
              id: true,
              status: true,
              fulfillmentType: true,
              paymentMethod: true,
              payment: { select: { status: true } },
            },
          });
          if (!current) return { kind: 'missing' as const };
          if (!validTransitions[current.status].includes(parsed.data.status)) {
            return { kind: 'invalid' as const, current: current.status };
          }
          if (
            (parsed.data.status === 'OUT_FOR_DELIVERY' && current.fulfillmentType !== 'DELIVERY') ||
            (parsed.data.status === 'READY_FOR_PICKUP' && current.fulfillmentType !== 'PICKUP')
          ) {
            return { kind: 'invalid' as const, current: current.status };
          }
          if (
            parsed.data.status === 'IN_KITCHEN' &&
            current.paymentMethod === 'QR' &&
            current.payment?.status !== 'PAID'
          ) {
            return { kind: 'unpaid-qr' as const };
          }

          const update = await transaction.order.updateMany({
            where: { id: current.id, status: current.status },
            data: { status: parsed.data.status },
          });
          if (update.count !== 1) return { kind: 'conflict' as const };

          await transaction.orderStatusHistory.create({
            data: {
              orderId: current.id,
              oldStatus: current.status,
              newStatus: parsed.data.status,
              changedByUserId: request.owner!.id,
              note: parsed.data.note || null,
            },
          });
          return {
            kind: 'success' as const,
            order: await transaction.order.findUnique({
              where: { id: current.id },
              include: orderInclude,
            }),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (updated.kind === 'missing') return reply.code(404).send({ error: 'Order not found' });
      if (updated.kind === 'invalid') {
        return reply.code(409).send({
          error: `Cannot move order from ${updated.current} to ${parsed.data.status}`,
        });
      }
      if (updated.kind === 'unpaid-qr') {
        return reply
          .code(409)
          .send({ error: 'QR payment must be verified before an order enters the kitchen' });
      }
      if (updated.kind === 'conflict') {
        return reply
          .code(409)
          .send({ error: 'Order status changed concurrently. Refresh and retry.' });
      }
      if (updated.order) {
        publishOrderUpdated(updated.order.id, 'order:updated', {
          status: updated.order.status,
        });
      }
      return updated.order;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        return reply
          .code(409)
          .send({ error: 'Order status changed concurrently. Refresh and retry.' });
      }
      throw error;
    }
  });

  app.get('/settings/qr-image', async () => {
    const setting = await prisma.storeSetting.findUnique({ where: { key: 'qr_payment_image' } });
    return { imagePath: typeof setting?.value === 'string' ? setting.value : null };
  });

  app.put('/settings/qr-image', { bodyLimit: 7_100_000 }, async (request, reply) => {
    const parsed = qrImageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid QR image', details: parsed.error.issues });
    }

    let newImagePath: string | null = null;
    try {
      newImagePath = await imageStorage.saveQrPaymentImage(parsed.data.data);
      const oldSetting = await prisma.storeSetting.findUnique({
        where: { key: 'qr_payment_image' },
      });
      await prisma.storeSetting.upsert({
        where: { key: 'qr_payment_image' },
        update: { value: newImagePath },
        create: { key: 'qr_payment_image', value: newImagePath },
      });
      if (typeof oldSetting?.value === 'string') {
        try {
          await imageStorage.removeQrPaymentImage(oldSetting.value);
        } catch (error) {
          request.log.error(error, 'Could not remove replaced QR payment image');
        }
      }
      return { imagePath: newImagePath };
    } catch (error) {
      if (newImagePath) {
        try {
          await imageStorage.removeQrPaymentImage(newImagePath);
        } catch (cleanupError) {
          request.log.error(cleanupError, 'Could not remove unclaimed QR payment image');
        }
      }
      if (error instanceof ImageValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  app.delete('/settings/qr-image', async (request) => {
    const setting = await prisma.storeSetting.findUnique({ where: { key: 'qr_payment_image' } });
    await prisma.storeSetting.deleteMany({ where: { key: 'qr_payment_image' } });
    if (typeof setting?.value === 'string') {
      try {
        await imageStorage.removeQrPaymentImage(setting.value);
      } catch (error) {
        request.log.error(error, 'Could not remove deleted QR payment image');
      }
    }
    return { imagePath: null };
  });

  app.get('/settings/qr-instructions', async () => {
    const setting = await prisma.storeSetting.findUnique({
      where: { key: 'qr_payment_instructions' },
    });
    return { instructions: typeof setting?.value === 'string' ? setting.value : '' };
  });

  app.put('/settings/qr-instructions', async (request, reply) => {
    const parsed = qrInstructionsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid QR payment instructions', details: parsed.error.issues });
    }
    await prisma.storeSetting.upsert({
      where: { key: 'qr_payment_instructions' },
      update: { value: parsed.data.instructions },
      create: { key: 'qr_payment_instructions', value: parsed.data.instructions },
    });
    return { instructions: parsed.data.instructions };
  });
};
