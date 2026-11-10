import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { consumeMessageAttempt, consumeOrderAttempt } from '../rate-limit.js';
import { ImageValidationError, imageStorage } from '../services/image-storage.js';
import { publishNewMessage, publishOrderCreated, publishOrderUpdated } from '../realtime.js';

const checkoutSchema = z
  .object({
    customerName: z.string().trim().min(1).max(100),
    customerPhone: z
      .string()
      .trim()
      .min(7)
      .max(24)
      .regex(/^\+?[0-9][0-9 ()-]*[0-9]$/, 'Enter a valid contact number'),
    fulfillmentType: z.enum(['DELIVERY', 'PICKUP']),
    block: z.string().trim().max(80).optional(),
    lot: z.string().trim().max(80).optional(),
    street: z.string().trim().max(160).optional(),
    deliveryInstructions: z.string().trim().max(500).optional(),
    paymentMethod: z.enum(['COD', 'QR']),
    referenceNumber: z.string().trim().max(100).optional(),
    paymentReceipt: z.object({ data: z.string().min(1).max(7_000_000) }).optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1).max(40),
          quantity: z.number().int().min(1).max(50),
        }),
      )
      .min(1)
      .max(30),
  })
  .superRefine((data, context) => {
    const productIds = data.items.map((item) => item.productId);
    if (new Set(productIds).size !== productIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Each product may only appear once in the cart',
      });
    }
    if (data.fulfillmentType === 'DELIVERY') {
      if (!data.block?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['block'],
          message: 'Block is required for delivery',
        });
      }
      if (!data.lot?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['lot'],
          message: 'Lot is required for delivery',
        });
      }
    }
    if (data.paymentMethod === 'QR' && !data.paymentReceipt) {
      context.addIssue({
        code: 'custom',
        path: ['paymentReceipt'],
        message: 'A payment receipt image is required for QR payment',
      });
    }
    if (data.paymentMethod === 'COD' && data.paymentReceipt) {
      context.addIssue({
        code: 'custom',
        path: ['paymentReceipt'],
        message: 'A payment receipt is only accepted for QR payment',
      });
    }
    if (data.paymentMethod === 'COD' && data.referenceNumber) {
      context.addIssue({
        code: 'custom',
        path: ['referenceNumber'],
        message: 'A payment reference number is only accepted for QR payment',
      });
    }
  });

const paymentResubmissionSchema = z.object({
  referenceNumber: z.string().trim().max(100).optional(),
  paymentReceipt: z.object({ data: z.string().min(1).max(7_000_000) }),
});
const customerMessageSchema = z.object({ message: z.string().trim().min(1).max(2000) });

type CheckoutData = z.infer<typeof checkoutSchema>;

const idempotencyKeySchema = z.string().uuid();
const maxOrderAmountCents = 9_999_999_999;

class OrderAmountError extends Error {}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function moneyToCents(value: string | number): number | null {
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) return null;
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(`${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`);
}

function createOrderNumber(): string {
  return `ORD-${randomBytes(8).toString('hex').toUpperCase()}`;
}

function createTrackingToken(): string {
  return randomBytes(32).toString('base64url');
}

function unavailableReply(reply: FastifyReply) {
  return reply.code(409).send({
    error: 'One or more items are no longer available. Refresh the menu and review your cart.',
  });
}

export const orderRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { token: string } }>('/orders/track/:token', async (request, reply) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) {
      return reply.code(404).send({ error: 'Order not found' });
    }

    const order = await prisma.order.findUnique({
      where: { trackingTokenHash: hashValue(request.params.token) },
      select: {
        orderNumber: true,
        customerName: true,
        customerPhone: true,
        fulfillmentType: true,
        block: true,
        lot: true,
        street: true,
        deliveryInstructions: true,
        status: true,
        paymentMethod: true,
        subtotal: true,
        deliveryFee: true,
        total: true,
        createdAt: true,
        items: {
          select: { productName: true, quantity: true, unitPrice: true, lineTotal: true },
          orderBy: { createdAt: 'asc' },
        },
        payment: {
          select: {
            method: true,
            status: true,
            amount: true,
            referenceNumber: true,
            rejectionReason: true,
            verifiedAt: true,
            statusHistory: {
              select: {
                oldStatus: true,
                newStatus: true,
                actorType: true,
                note: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        statusHistory: {
          select: { oldStatus: true, newStatus: true, note: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!order) return reply.code(404).send({ error: 'Order not found' });

    const pickupSettings =
      order.fulfillmentType === 'PICKUP'
        ? await prisma.storeSetting.findMany({
            where: { key: { in: ['pickup_address', 'pickup_instructions'] } },
          })
        : [];
    const pickupValues = new Map(pickupSettings.map((setting) => [setting.key, setting.value]));

    return {
      ...order,
      pickupAddress:
        typeof pickupValues.get('pickup_address') === 'string'
          ? pickupValues.get('pickup_address')
          : null,
      pickupInstructions:
        typeof pickupValues.get('pickup_instructions') === 'string'
          ? pickupValues.get('pickup_instructions')
          : null,
    };
  });

  app.get<{ Params: { token: string } }>(
    '/orders/track/:token/messages',
    async (request, reply) => {
      if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      const order = await prisma.order.findUnique({
        where: { trackingTokenHash: hashValue(request.params.token) },
        select: { id: true },
      });
      if (!order) return reply.code(404).send({ error: 'Order not found' });
      return prisma.message.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
    },
  );

  app.post<{ Params: { token: string } }>(
    '/orders/track/:token/messages',
    async (request, reply) => {
      if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      const retryAfter = consumeMessageAttempt(request);
      if (retryAfter > 0) {
        reply.header('Retry-After', String(retryAfter));
        return reply.code(429).send({ error: 'Too many messages. Try again later.' });
      }
      const parsed = customerMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid message', details: parsed.error.issues });
      }
      const order = await prisma.order.findUnique({
        where: { trackingTokenHash: hashValue(request.params.token) },
        select: { id: true, customerName: true },
      });
      if (!order) return reply.code(404).send({ error: 'Order not found' });

      const message = await prisma.message.create({
        data: {
          orderId: order.id,
          senderType: 'CUSTOMER',
          senderName: order.customerName,
          message: parsed.data.message,
        },
      });
      publishNewMessage(order.id, message);
      return reply.code(201).send(message);
    },
  );

  app.post<{ Params: { token: string } }>(
    '/orders/track/:token/payment',
    { bodyLimit: 7_200_000 },
    async (request, reply) => {
      if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      const retryAfter = consumeOrderAttempt(request);
      if (retryAfter > 0) {
        reply.header('Retry-After', String(retryAfter));
        return reply.code(429).send({ error: 'Too many payment attempts. Try again later.' });
      }

      const parsed = paymentResubmissionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid payment resubmission', details: parsed.error.issues });
      }

      let newProofPath: string | null = null;
      let previousProofPath: string | null = null;
      let committed = false;
      try {
        newProofPath = await imageStorage.savePaymentProof(parsed.data.paymentReceipt.data);
        const result = await prisma.$transaction(
          async (transaction) => {
            const payment = await transaction.payment.findFirst({
              where: {
                method: 'QR',
                order: { trackingTokenHash: hashValue(request.params.token) },
              },
              select: { id: true, orderId: true, status: true, proofImagePath: true },
            });
            if (!payment) return { kind: 'missing' as const };
            if (payment.status !== 'REJECTED') return { kind: 'invalid' as const };

            const updated = await transaction.payment.updateMany({
              where: { id: payment.id, method: 'QR', status: 'REJECTED' },
              data: {
                status: 'AWAITING_VERIFICATION',
                referenceNumber: parsed.data.referenceNumber?.trim() || null,
                proofImagePath: newProofPath,
                verifiedAt: null,
                verifiedById: null,
                rejectionReason: null,
              },
            });
            if (updated.count !== 1) return { kind: 'conflict' as const };

            await transaction.paymentStatusHistory.create({
              data: {
                paymentId: payment.id,
                oldStatus: 'REJECTED',
                newStatus: 'AWAITING_VERIFICATION',
                actorType: 'CUSTOMER',
                note: 'Customer submitted an updated receipt and optional reference number.',
              },
            });
            return {
              kind: 'success' as const,
              orderId: payment.orderId,
              previousProofPath: payment.proofImagePath,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        if (result.kind === 'missing') return reply.code(404).send({ error: 'Order not found' });
        if (result.kind === 'invalid') {
          return reply.code(409).send({ error: 'Only rejected QR payments can be resubmitted' });
        }
        if (result.kind === 'conflict') {
          return reply
            .code(409)
            .send({ error: 'Payment status changed concurrently. Refresh and retry.' });
        }

        committed = true;
        previousProofPath = result.previousProofPath;
        publishOrderUpdated(result.orderId, 'payment:updated', {
          status: 'AWAITING_VERIFICATION',
        });
        if (previousProofPath) {
          try {
            await imageStorage.removePaymentProof(previousProofPath);
          } catch (error) {
            request.log.error(error, 'Could not remove replaced payment receipt');
          }
        }
        return { status: 'AWAITING_VERIFICATION' };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          return reply
            .code(409)
            .send({ error: 'Payment status changed concurrently. Refresh and retry.' });
        }
        if (error instanceof ImageValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      } finally {
        if (!committed && newProofPath) {
          try {
            await imageStorage.removePaymentProof(newProofPath);
          } catch (error) {
            request.log.error(error, 'Could not remove unclaimed payment receipt');
          }
        }
      }
    },
  );

  app.post('/orders', { bodyLimit: 7_200_000 }, async (request, reply) => {
    const retryAfter = consumeOrderAttempt(request);
    if (retryAfter > 0) {
      reply.header('Retry-After', String(retryAfter));
      return reply.code(429).send({ error: 'Too many order attempts. Try again later.' });
    }

    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid checkout details', details: parsed.error.issues });
    }
    const keyResult = idempotencyKeySchema.safeParse(request.headers['idempotency-key']);
    if (!keyResult.success) {
      return reply.code(400).send({ error: 'A valid Idempotency-Key UUID header is required' });
    }

    const data: CheckoutData = parsed.data;
    const idempotencyKeyHash = hashValue(keyResult.data.toLowerCase());
    const existing = await prisma.order.findUnique({
      where: { idempotencyKeyHash },
      select: { orderNumber: true },
    });
    if (existing) {
      return reply.send({ duplicate: true, orderNumber: existing.orderNumber });
    }

    const productIds = data.items.map((item) => item.productId);
    let paymentProofPath: string | null = null;
    try {
      if (data.paymentMethod === 'QR' && data.paymentReceipt) {
        paymentProofPath = await imageStorage.savePaymentProof(data.paymentReceipt.data);
      }

      const created = await prisma.$transaction(
        async (transaction) => {
          const products = await transaction.product.findMany({
            where: {
              id: { in: productIds },
              isAvailable: true,
              isArchived: false,
              category: { isActive: true },
            },
            select: { id: true, name: true, price: true },
          });
          if (products.length !== productIds.length) return null;

          const productById = new Map(products.map((product) => [product.id, product]));
          const orderItems: Array<{
            productId: string;
            productName: string;
            quantity: number;
            unitPriceCents: number;
            lineTotalCents: number;
          }> = [];
          let subtotalCents = 0;
          for (const item of data.items) {
            const product = productById.get(item.productId);
            if (!product) return null;
            const unitPriceCents = moneyToCents(product.price.toFixed(2));
            if (unitPriceCents === null || unitPriceCents <= 0) {
              throw new Error(`Product ${product.id} has an invalid configured price`);
            }
            const lineTotalCents = unitPriceCents * item.quantity;
            subtotalCents += lineTotalCents;
            if (!Number.isSafeInteger(subtotalCents) || subtotalCents > maxOrderAmountCents) {
              throw new OrderAmountError('Order total exceeds the supported maximum');
            }
            orderItems.push({
              productId: product.id,
              productName: product.name,
              quantity: item.quantity,
              unitPriceCents,
              lineTotalCents,
            });
          }

          const deliveryFeeSetting =
            data.fulfillmentType === 'DELIVERY'
              ? await transaction.storeSetting.findUnique({ where: { key: 'delivery_fee' } })
              : null;
          const rawDeliveryFee = deliveryFeeSetting?.value;
          const deliveryFeeCents =
            data.fulfillmentType === 'PICKUP'
              ? 0
              : typeof rawDeliveryFee === 'number' || typeof rawDeliveryFee === 'string'
                ? moneyToCents(rawDeliveryFee)
                : rawDeliveryFee === undefined || rawDeliveryFee === null
                  ? 0
                  : null;
          if (deliveryFeeCents === null) {
            throw new Error(
              'Configured delivery fee must be a non-negative amount with at most two decimal places',
            );
          }
          const totalCents = subtotalCents + deliveryFeeCents;
          if (!Number.isSafeInteger(totalCents) || totalCents > maxOrderAmountCents) {
            throw new OrderAmountError('Order total exceeds the supported maximum');
          }

          const trackingToken = createTrackingToken();
          const paymentStatus = data.paymentMethod === 'QR' ? 'AWAITING_VERIFICATION' : 'UNPAID';
          const order = await transaction.order.create({
            data: {
              orderNumber: createOrderNumber(),
              customerName: data.customerName,
              customerPhone: data.customerPhone,
              fulfillmentType: data.fulfillmentType,
              block: data.fulfillmentType === 'DELIVERY' ? data.block?.trim() || null : null,
              lot: data.fulfillmentType === 'DELIVERY' ? data.lot?.trim() || null : null,
              street: data.fulfillmentType === 'DELIVERY' ? data.street?.trim() || null : null,
              deliveryInstructions:
                data.fulfillmentType === 'DELIVERY'
                  ? data.deliveryInstructions?.trim() || null
                  : null,
              paymentMethod: data.paymentMethod,
              subtotal: centsToDecimal(subtotalCents),
              deliveryFee: centsToDecimal(deliveryFeeCents),
              total: centsToDecimal(totalCents),
              trackingTokenHash: hashValue(trackingToken),
              idempotencyKeyHash,
              items: {
                create: orderItems.map((item) => ({
                  productId: item.productId,
                  productName: item.productName,
                  quantity: item.quantity,
                  unitPrice: centsToDecimal(item.unitPriceCents),
                  lineTotal: centsToDecimal(item.lineTotalCents),
                })),
              },
              payment: {
                create: {
                  method: data.paymentMethod,
                  status: paymentStatus,
                  amount: centsToDecimal(totalCents),
                  referenceNumber:
                    data.paymentMethod === 'QR' ? data.referenceNumber?.trim() || null : null,
                  proofImagePath: paymentProofPath,
                  statusHistory: {
                    create: {
                      newStatus: paymentStatus,
                      actorType: data.paymentMethod === 'QR' ? 'CUSTOMER' : 'SYSTEM',
                      note:
                        data.paymentMethod === 'QR'
                          ? 'Customer submitted payment proof at checkout.'
                          : 'Cash payment is due at delivery or pickup.',
                    },
                  },
                },
              },
              statusHistory: { create: { newStatus: 'PENDING' } },
            },
            include: { items: true },
          });

          const storeSettings = await transaction.storeSetting.findMany({
            where: { key: { in: ['qr_payment_image', 'qr_payment_instructions'] } },
          });
          const settings = new Map(storeSettings.map((setting) => [setting.key, setting.value]));
          const qrPaymentImage = settings.get('qr_payment_image');
          const qrPaymentInstructions = settings.get('qr_payment_instructions');

          return {
            order,
            trackingToken,
            qrPaymentImage: typeof qrPaymentImage === 'string' ? qrPaymentImage : null,
            qrPaymentInstructions:
              typeof qrPaymentInstructions === 'string' ? qrPaymentInstructions : '',
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (!created) {
        await imageStorage.removePaymentProof(paymentProofPath);
        paymentProofPath = null;
        return unavailableReply(reply);
      }
      paymentProofPath = null;
      publishOrderCreated(created.order.id, created.order.orderNumber);

      return reply.code(201).send({
        duplicate: false,
        orderNumber: created.order.orderNumber,
        trackingUrl: `/track/${created.trackingToken}`,
        fulfillmentType: created.order.fulfillmentType,
        paymentMethod: created.order.paymentMethod,
        items: created.order.items.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toFixed(2),
          lineTotal: item.lineTotal.toFixed(2),
        })),
        subtotal: created.order.subtotal.toFixed(2),
        deliveryFee: created.order.deliveryFee.toFixed(2),
        total: created.order.total.toFixed(2),
        qrPaymentImage: created.qrPaymentImage,
        qrPaymentInstructions: created.qrPaymentInstructions,
      });
    } catch (error) {
      if (paymentProofPath) {
        try {
          await imageStorage.removePaymentProof(paymentProofPath);
        } catch (cleanupError) {
          request.log.error(cleanupError, 'Could not remove unclaimed payment receipt');
        }
      }
      if (error instanceof ImageValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      if (error instanceof OrderAmountError) {
        return reply.code(400).send({ error: error.message });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicateOrder = await prisma.order.findUnique({
          where: { idempotencyKeyHash },
          select: { orderNumber: true },
        });
        if (duplicateOrder) {
          return reply.send({ duplicate: true, orderNumber: duplicateOrder.orderNumber });
        }
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        return reply
          .code(409)
          .send({ error: 'The menu changed during checkout. Please try again.' });
      }
      throw error;
    }
  });
};
