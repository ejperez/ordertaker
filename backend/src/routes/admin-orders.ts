import { and, asc, desc, eq, exists, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { hasValidOrigin, requireOwner } from '../auth.js';
import { isSerializationFailure } from '../db/errors.js';
import {
  messages,
  orderItems,
  orderStatusHistories,
  orders,
  paymentStatusHistories,
  payments,
  storeSettings,
} from '../db/schema/index.js';
import { orderStatus, paymentStatus } from '../db/schema/enums.js';
import { ImageValidationError, imageStorage } from '../services/image-storage.js';
import { publishNewMessage, publishOrderUpdated } from '../realtime.js';

const orderStatuses = orderStatus.enumValues;
const paymentStatuses = paymentStatus.enumValues;
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

const validTransitions: Record<(typeof orderStatuses)[number], (typeof orderStatuses)[number][]> = {
  PENDING: ['IN_KITCHEN', 'CANCELLED'],
  IN_KITCHEN: ['OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  READY_FOR_PICKUP: ['PICKED_UP'],
  DELIVERED: [],
  PICKED_UP: [],
  CANCELLED: [],
};

const orderWithDetails = {
  items: { orderBy: [asc(orderItems.createdAt)] },
  payment: {
    columns: {
      method: true,
      status: true,
      amount: true,
      referenceNumber: true,
      rejectionReason: true,
      verifiedAt: true,
    },
    with: {
      verifiedBy: { columns: { name: true } },
      statusHistory: {
        orderBy: [asc(paymentStatusHistories.createdAt)],
        with: { changedBy: { columns: { name: true } } },
      },
    },
  },
  statusHistory: {
    orderBy: [asc(orderStatusHistories.createdAt)],
    with: { changedBy: { columns: { name: true } } },
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
    const { status, fulfillmentType, paymentStatus: paymentStatusFilter, from, to } = parsed.data;
    if (from && to && new Date(from) > new Date(to)) {
      return reply.code(400).send({ error: '`from` must be earlier than `to`' });
    }

    const conditions = [];
    if (status) conditions.push(eq(orders.status, status));
    if (fulfillmentType) conditions.push(eq(orders.fulfillmentType, fulfillmentType));
    if (from) conditions.push(gte(orders.createdAt, new Date(from)));
    if (to) conditions.push(lte(orders.createdAt, new Date(to)));
    if (paymentStatusFilter) {
      conditions.push(
        exists(
          app.db
            .select({ id: payments.id })
            .from(payments)
            .where(and(eq(payments.orderId, orders.id), eq(payments.status, paymentStatusFilter))),
        ),
      );
    }

    return app.db.query.orders.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      with: orderWithDetails,
      orderBy: [desc(orders.createdAt)],
      limit: 200,
    });
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (request, reply) => {
    const order = await app.db.query.orders.findFirst({
      where: eq(orders.id, request.params.id),
      with: orderWithDetails,
    });
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    return order;
  });

  app.get<{ Params: { id: string } }>('/orders/:id/messages', async (request, reply) => {
    const [order] = await app.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, request.params.id))
      .limit(1);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    return app.db
      .select()
      .from(messages)
      .where(eq(messages.orderId, order.id))
      .orderBy(asc(messages.createdAt))
      .limit(200);
  });

  app.post<{ Params: { id: string } }>('/orders/:id/messages', async (request, reply) => {
    const parsed = messageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid message', details: parsed.error.issues });
    }
    const [order] = await app.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, request.params.id))
      .limit(1);
    if (!order) return reply.code(404).send({ error: 'Order not found' });

    const [message] = await app.db
      .insert(messages)
      .values({
        orderId: order.id,
        senderType: 'OWNER',
        senderName: request.owner!.name,
        message: parsed.data.message,
      })
      .returning();
    publishNewMessage(order.id, message);
    return reply.code(201).send(message);
  });

  app.get<{ Params: { id: string } }>('/orders/:id/payment-proof', async (request, reply) => {
    const [payment] = await app.db
      .select({ method: payments.method, proofImagePath: payments.proofImagePath })
      .from(payments)
      .where(eq(payments.orderId, request.params.id))
      .limit(1);
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
      const result = await app.db.transaction(
        async (transaction) => {
          const [payment] = await transaction
            .select({
              id: payments.id,
              method: payments.method,
              status: payments.status,
            })
            .from(payments)
            .where(eq(payments.orderId, request.params.id))
            .limit(1);
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

          const updated = await transaction
            .update(payments)
            .set({
              status: parsed.data.status,
              verifiedAt: new Date(),
              verifiedById: request.owner!.id,
              rejectionReason:
                parsed.data.status === 'REJECTED' ? parsed.data.rejectionReason : null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(payments.id, payment.id),
                eq(payments.method, payment.method),
                eq(payments.status, payment.status),
              ),
            )
            .returning({ id: payments.id });
          if (updated.length !== 1) return { kind: 'conflict' as const };

          await transaction.insert(paymentStatusHistories).values({
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
          });

          const updatedPayment = await transaction.query.payments.findFirst({
            where: eq(payments.id, payment.id),
            columns: {
              method: true,
              status: true,
              amount: true,
              referenceNumber: true,
              rejectionReason: true,
              verifiedAt: true,
            },
            with: {
              verifiedBy: { columns: { name: true } },
              statusHistory: {
                orderBy: [asc(paymentStatusHistories.createdAt)],
                with: { changedBy: { columns: { name: true } } },
              },
            },
          });
          return { kind: 'success' as const, payment: updatedPayment };
        },
        { isolationLevel: 'serializable' },
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
      if (isSerializationFailure(error)) {
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
      const updated = await app.db.transaction(
        async (transaction) => {
          const current = await transaction.query.orders.findFirst({
            where: eq(orders.id, request.params.id),
            columns: {
              id: true,
              status: true,
              fulfillmentType: true,
              paymentMethod: true,
            },
            with: { payment: { columns: { status: true } } },
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

          const update = await transaction
            .update(orders)
            .set({ status: parsed.data.status, updatedAt: new Date() })
            .where(and(eq(orders.id, current.id), eq(orders.status, current.status)))
            .returning({ id: orders.id });
          if (update.length !== 1) return { kind: 'conflict' as const };

          await transaction.insert(orderStatusHistories).values({
            orderId: current.id,
            oldStatus: current.status,
            newStatus: parsed.data.status,
            changedByUserId: request.owner!.id,
            note: parsed.data.note || null,
          });
          const order = await transaction.query.orders.findFirst({
            where: eq(orders.id, current.id),
            with: orderWithDetails,
          });
          return { kind: 'success' as const, order };
        },
        { isolationLevel: 'serializable' },
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
      if (isSerializationFailure(error)) {
        return reply
          .code(409)
          .send({ error: 'Order status changed concurrently. Refresh and retry.' });
      }
      throw error;
    }
  });

  app.get('/settings/qr-image', async () => {
    const [setting] = await app.db
      .select({ value: storeSettings.value })
      .from(storeSettings)
      .where(eq(storeSettings.key, 'qr_payment_image'))
      .limit(1);
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
      const [oldSetting] = await app.db
        .select({ value: storeSettings.value })
        .from(storeSettings)
        .where(eq(storeSettings.key, 'qr_payment_image'))
        .limit(1);
      await app.db
        .insert(storeSettings)
        .values({ key: 'qr_payment_image', value: newImagePath, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: storeSettings.key,
          set: { value: newImagePath, updatedAt: new Date() },
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
    const [setting] = await app.db
      .select({ value: storeSettings.value })
      .from(storeSettings)
      .where(eq(storeSettings.key, 'qr_payment_image'))
      .limit(1);
    await app.db.delete(storeSettings).where(eq(storeSettings.key, 'qr_payment_image'));
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
    const [setting] = await app.db
      .select({ value: storeSettings.value })
      .from(storeSettings)
      .where(eq(storeSettings.key, 'qr_payment_instructions'))
      .limit(1);
    return { instructions: typeof setting?.value === 'string' ? setting.value : '' };
  });

  app.put('/settings/qr-instructions', async (request, reply) => {
    const parsed = qrInstructionsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid QR payment instructions', details: parsed.error.issues });
    }
    await app.db
      .insert(storeSettings)
      .values({
        key: 'qr_payment_instructions',
        value: parsed.data.instructions,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: storeSettings.key,
        set: { value: parsed.data.instructions, updatedAt: new Date() },
      });
    return { instructions: parsed.data.instructions };
  });
};
