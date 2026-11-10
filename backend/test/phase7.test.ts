import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { io as connectSocket, type Socket } from 'socket.io-client';
import { env } from '../src/config/env.js';
import { prisma } from '../src/db.js';
import { adminOrderRoutes } from '../src/routes/admin-orders.js';
import { orderRoutes } from '../src/routes/orders.js';
import { imageStorage } from '../src/services/image-storage.js';
import { attachRealtimeServer, closeRealtimeServer } from '../src/realtime.js';

type CheckoutOrderData = {
  fulfillmentType: 'DELIVERY' | 'PICKUP';
  paymentMethod: 'COD' | 'QR';
  subtotal: Prisma.Decimal;
  deliveryFee: Prisma.Decimal;
  total: Prisma.Decimal;
  items: {
    create: Array<{
      productId: string;
      productName: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
    }>;
  };
  payment: {
    create: {
      status: string;
      proofImagePath: string | null;
    };
  };
};

function stubMethod(target: object, name: string, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(target, name);
  const originalValue = Reflect.get(target, name) as unknown;
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
  return () => {
    if (original?.value !== undefined) Object.defineProperty(target, name, original);
    else if (typeof originalValue === 'function') {
      Object.defineProperty(target, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: originalValue,
      });
    } else Reflect.deleteProperty(target, name);
  };
}

function restoreAfter(context: TestContext, ...restoreMethods: Array<() => void>): void {
  context.after(() => {
    for (const restore of restoreMethods.reverse()) restore();
  });
}

function stubOwnerSession(context: TestContext): void {
  restoreAfter(
    context,
    stubMethod(prisma.adminSession, 'findFirst', async () => ({
      user: { id: 'owner-1', name: 'Owner', email: 'owner@example.com' },
    })),
  );
}

async function createRouteApp(
  plugin: FastifyPluginAsync,
  prefix: string,
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('owner', null);
  await app.register(plugin, { prefix });
  await app.ready();
  return app;
}

function adminHeaders(): Record<string, string> {
  return {
    cookie: 'ordertaker_admin=test-session',
    origin: env.FRONTEND_ORIGIN,
  };
}

test('guest checkout recalculates totals for delivery and pickup with COD and QR', async (context) => {
  const savedOrders: CheckoutOrderData[] = [];
  let orderLookups = 0;
  restoreAfter(
    context,
    stubMethod(prisma.order, 'findUnique', async () =>
      orderLookups++ < 4 ? null : { orderNumber: 'ORD-1' },
    ),
    stubMethod(prisma, '$transaction', async (work: (transaction: object) => Promise<unknown>) =>
      work({
        product: {
          findMany: async () => [
            { id: 'product-1', name: 'Meal', price: new Prisma.Decimal('12.50') },
          ],
        },
        storeSetting: {
          findUnique: async () => ({ value: '3.25' }),
          findMany: async () => [],
        },
        order: {
          create: async ({ data }: { data: CheckoutOrderData }) => {
            savedOrders.push(data);
            return {
              id: `order-${savedOrders.length}`,
              orderNumber: `ORD-${savedOrders.length}`,
              fulfillmentType: data.fulfillmentType,
              paymentMethod: data.paymentMethod,
              items: data.items.create,
              subtotal: data.subtotal,
              deliveryFee: data.deliveryFee,
              total: data.total,
            };
          },
        },
      }),
    ),
    stubMethod(imageStorage, 'savePaymentProof', async () => 'payment-proofs/test.png'),
  );
  const app = await createRouteApp(orderRoutes, '/api');
  context.after(() => app.close());

  const scenarios = [
    { fulfillmentType: 'DELIVERY', paymentMethod: 'COD' },
    { fulfillmentType: 'PICKUP', paymentMethod: 'COD' },
    { fulfillmentType: 'DELIVERY', paymentMethod: 'QR' },
    { fulfillmentType: 'PICKUP', paymentMethod: 'QR' },
  ] as const;

  for (const [index, scenario] of scenarios.entries()) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: {
        'idempotency-key': `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      },
      payload: {
        customerName: 'Customer',
        customerPhone: '5551234567',
        ...scenario,
        ...(scenario.fulfillmentType === 'DELIVERY' ? { block: 'A', lot: '1' } : {}),
        ...(scenario.paymentMethod === 'QR' ? { paymentReceipt: { data: 'eA==' } } : {}),
        items: [{ productId: 'product-1', quantity: 2 }],
      },
    });

    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.subtotal, '25.00');
    assert.equal(body.deliveryFee, scenario.fulfillmentType === 'DELIVERY' ? '3.25' : '0.00');
    assert.equal(body.total, scenario.fulfillmentType === 'DELIVERY' ? '28.25' : '25.00');
    assert.match(body.trackingUrl, /^\/track\/[A-Za-z0-9_-]{43}$/);
    assert.equal(savedOrders[index].paymentMethod, scenario.paymentMethod);
    assert.equal(
      savedOrders[index].payment.create.status,
      scenario.paymentMethod === 'QR' ? 'AWAITING_VERIFICATION' : 'UNPAID',
    );
    assert.equal(
      savedOrders[index].payment.create.proofImagePath,
      scenario.paymentMethod === 'QR' ? 'payment-proofs/test.png' : null,
    );
  }

  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/orders',
    headers: {
      'idempotency-key': '00000000-0000-4000-8000-000000000001',
    },
    payload: {
      customerName: 'Customer',
      customerPhone: '5551234567',
      fulfillmentType: 'DELIVERY',
      block: 'A',
      lot: '1',
      paymentMethod: 'COD',
      items: [{ productId: 'product-1', quantity: 2 }],
    },
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().duplicate, true);
  assert.equal(savedOrders.length, 4);
});

test('checkout rejects a product that became unavailable', async (context) => {
  restoreAfter(
    context,
    stubMethod(prisma.order, 'findUnique', async () => null),
    stubMethod(prisma, '$transaction', async (work: (transaction: object) => Promise<unknown>) =>
      work({ product: { findMany: async () => [] } }),
    ),
  );
  const app = await createRouteApp(orderRoutes, '/api');
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/orders',
    headers: { 'idempotency-key': '00000000-0000-4000-8000-000000000101' },
    payload: {
      customerName: 'Customer',
      customerPhone: '5551234567',
      fulfillmentType: 'PICKUP',
      paymentMethod: 'COD',
      items: [{ productId: 'product-1', quantity: 1 }],
    },
  });

  assert.equal(response.statusCode, 409);
});

test('checkout rejects missing delivery details, missing QR proof, and invalid uploaded image data', async (context) => {
  restoreAfter(
    context,
    stubMethod(prisma.order, 'findUnique', async () => null),
  );
  const app = await createRouteApp(orderRoutes, '/api');
  context.after(() => app.close());
  const base = {
    customerName: 'Customer',
    customerPhone: '5551234567',
    items: [{ productId: 'product-1', quantity: 1 }],
  };

  for (const payload of [
    { ...base, fulfillmentType: 'DELIVERY', paymentMethod: 'COD' },
    { ...base, fulfillmentType: 'PICKUP', paymentMethod: 'QR' },
    {
      ...base,
      fulfillmentType: 'PICKUP',
      paymentMethod: 'QR',
      paymentReceipt: { data: Buffer.from('not an image').toString('base64') },
    },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'idempotency-key': '00000000-0000-4000-8000-000000000099' },
      payload,
    });
    assert.equal(response.statusCode, 400, `${response.statusCode}: ${response.body}`);
  }

  await assert.rejects(
    imageStorage.saveProductImage(Buffer.from('not an image').toString('base64')),
    /Only JPEG, PNG, and WebP images are supported/,
  );
});

test('tracking tokens cannot read another order’s messages', async (context) => {
  const validToken = 'B'.repeat(43);
  const validHash = createHash('sha256').update(validToken).digest('hex');
  restoreAfter(
    context,
    stubMethod(
      prisma.order,
      'findUnique',
      async ({ where }: { where: { trackingTokenHash: string } }) =>
        where.trackingTokenHash === validHash ? { id: 'order-b', customerName: 'Buyer' } : null,
    ),
    stubMethod(prisma.message, 'findMany', async () => []),
    stubMethod(prisma.message, 'create', async ({ data }: { data: { message: string } }) => ({
      id: 'message-1',
      senderType: 'CUSTOMER',
      senderName: 'Buyer',
      message: data.message,
      createdAt: new Date(),
    })),
  );
  const app = await createRouteApp(orderRoutes, '/api');
  context.after(() => app.close());

  const unauthorized = await app.inject({
    method: 'GET',
    url: `/api/orders/track/${'A'.repeat(43)}/messages`,
  });
  const authorized = await app.inject({
    method: 'GET',
    url: `/api/orders/track/${validToken}/messages`,
  });

  assert.equal(unauthorized.statusCode, 404);
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(authorized.json(), []);

  const unauthorizedMessage = await app.inject({
    method: 'POST',
    url: `/api/orders/track/${'A'.repeat(43)}/messages`,
    payload: { message: 'Hello' },
  });
  const authorizedMessage = await app.inject({
    method: 'POST',
    url: `/api/orders/track/${validToken}/messages`,
    payload: { message: 'Hello' },
  });
  assert.equal(unauthorizedMessage.statusCode, 404);
  assert.equal(authorizedMessage.statusCode, 201);
});

test('admin status endpoint enforces every transition in the workflow', async (context) => {
  stubOwnerSession(context);
  let currentStatus = '';
  let nextStatus = '';
  let fulfillmentType: 'DELIVERY' | 'PICKUP' = 'DELIVERY';
  let paymentMethod = 'COD';
  let paymentStatus = 'UNPAID';

  restoreAfter(
    context,
    stubMethod(prisma, '$transaction', async (work: (transaction: object) => Promise<unknown>) => {
      let reads = 0;
      return work({
        order: {
          findUnique: async () =>
            ++reads === 1
              ? {
                  id: 'order-1',
                  status: currentStatus,
                  fulfillmentType,
                  paymentMethod,
                  payment: { status: paymentStatus },
                }
              : { id: 'order-1', status: nextStatus },
          updateMany: async () => ({ count: 1 }),
        },
        orderStatusHistory: { create: async () => ({}) },
      });
    }),
  );
  const app = await createRouteApp(adminOrderRoutes, '/api/admin');
  context.after(() => app.close());

  const transitions: Record<string, string[]> = {
    PENDING: ['IN_KITCHEN', 'CANCELLED'],
    IN_KITCHEN: ['OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'CANCELLED'],
    OUT_FOR_DELIVERY: ['DELIVERED'],
    READY_FOR_PICKUP: ['PICKED_UP'],
    DELIVERED: [],
    PICKED_UP: [],
    CANCELLED: [],
  };
  const statuses = Object.keys(transitions);

  for (const from of statuses) {
    for (const to of statuses) {
      currentStatus = from;
      nextStatus = to;
      fulfillmentType = to === 'READY_FOR_PICKUP' ? 'PICKUP' : 'DELIVERY';
      paymentMethod = 'COD';
      paymentStatus = 'UNPAID';

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/admin/orders/order-1/status',
        headers: adminHeaders(),
        payload: { status: to },
      });

      assert.equal(
        response.statusCode,
        transitions[from].includes(to) ? 200 : 409,
        `Unexpected result for ${from} -> ${to}`,
      );
    }
  }

  currentStatus = 'IN_KITCHEN';
  nextStatus = 'OUT_FOR_DELIVERY';
  fulfillmentType = 'PICKUP';
  const mismatchedFulfillment = await app.inject({
    method: 'PATCH',
    url: '/api/admin/orders/order-1/status',
    headers: adminHeaders(),
    payload: { status: nextStatus },
  });
  assert.equal(mismatchedFulfillment.statusCode, 409);

  currentStatus = 'PENDING';
  nextStatus = 'IN_KITCHEN';
  fulfillmentType = 'DELIVERY';
  paymentMethod = 'QR';
  paymentStatus = 'AWAITING_VERIFICATION';
  const unpaidQr = await app.inject({
    method: 'PATCH',
    url: '/api/admin/orders/order-1/status',
    headers: adminHeaders(),
    payload: { status: nextStatus },
  });
  assert.equal(unpaidQr.statusCode, 409);
});

test('payment review requires rejection reasons and supports QR decisions and COD collection', async (context) => {
  stubOwnerSession(context);
  let method = 'QR';
  let currentStatus = 'AWAITING_VERIFICATION';
  let nextStatus = 'PAID';
  let rejectionReason: string | null = null;
  restoreAfter(
    context,
    stubMethod(prisma, '$transaction', async (work: (transaction: object) => Promise<unknown>) => {
      let reads = 0;
      return work({
        payment: {
          findUnique: async () =>
            ++reads === 1
              ? { id: 'payment-1', method, status: currentStatus }
              : {
                  method,
                  status: nextStatus,
                  amount: new Prisma.Decimal('28.25'),
                  referenceNumber: null,
                  rejectionReason: nextStatus === 'REJECTED' ? rejectionReason : null,
                  verifiedAt: new Date(),
                  verifiedBy: { name: 'Owner' },
                  statusHistory: [],
                },
          updateMany: async () => ({ count: 1 }),
        },
        paymentStatusHistory: { create: async () => ({}) },
      });
    }),
  );
  const app = await createRouteApp(adminOrderRoutes, '/api/admin');
  context.after(() => app.close());

  const missingReason = await app.inject({
    method: 'PATCH',
    url: '/api/admin/orders/order-1/payment',
    headers: adminHeaders(),
    payload: { status: 'REJECTED' },
  });
  assert.equal(missingReason.statusCode, 400);

  for (const scenario of [
    { method: 'QR', currentStatus: 'AWAITING_VERIFICATION', nextStatus: 'PAID' },
    {
      method: 'QR',
      currentStatus: 'AWAITING_VERIFICATION',
      nextStatus: 'REJECTED',
      rejectionReason: 'Receipt is unreadable',
    },
    { method: 'COD', currentStatus: 'UNPAID', nextStatus: 'PAID' },
  ]) {
    method = scenario.method;
    currentStatus = scenario.currentStatus;
    nextStatus = scenario.nextStatus;
    rejectionReason = scenario.rejectionReason ?? null;

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/orders/order-1/payment',
      headers: adminHeaders(),
      payload: {
        status: scenario.nextStatus,
        ...(scenario.rejectionReason ? { rejectionReason: scenario.rejectionReason } : {}),
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, scenario.nextStatus);
  }
});

test('admin route protects payment proofs and image storage rejects invalid file content', async (context) => {
  await assert.rejects(
    imageStorage.readPaymentProof('../outside.png'),
    /Invalid stored payment proof path/,
  );
  stubOwnerSession(context);
  restoreAfter(
    context,
    stubMethod(prisma.payment, 'findUnique', async () => ({
      method: 'QR',
      proofImagePath: 'payment-proofs/123e4567-e89b-42d3-a456-426614174000.png',
    })),
    stubMethod(imageStorage, 'readPaymentProof', async () => ({
      bytes: Buffer.from('private receipt'),
      contentType: 'image/png',
    })),
  );
  const app = await createRouteApp(adminOrderRoutes, '/api/admin');
  context.after(() => app.close());

  const unauthorized = await app.inject({
    method: 'GET',
    url: '/api/admin/orders/order-1/payment-proof',
  });
  const authorized = await app.inject({
    method: 'GET',
    url: '/api/admin/orders/order-1/payment-proof',
    headers: adminHeaders(),
  });

  assert.equal(unauthorized.statusCode, 401);
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.headers['cache-control'], 'private, no-store');
  assert.equal(authorized.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(authorized.rawPayload, Buffer.from('private receipt'));
});

test('admin routes and Socket.IO authenticate owner and customer sessions', async (context) => {
  const trackingToken = 'B'.repeat(43);
  const trackingHash = createHash('sha256').update(trackingToken).digest('hex');
  restoreAfter(
    context,
    stubMethod(prisma.adminSession, 'findFirst', async () => ({
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'owner-1', name: 'Owner' },
    })),
    stubMethod(
      prisma.order,
      'findUnique',
      async ({ where }: { where: { trackingTokenHash: string } }) =>
        where.trackingTokenHash === trackingHash ? { id: 'order-b' } : null,
    ),
    stubMethod(prisma.order, 'findMany', async () => []),
  );

  const app = await createRouteApp(adminOrderRoutes, '/api/admin');
  context.after(() => app.close());
  const unauthorizedRoute = await app.inject({ method: 'GET', url: '/api/admin/orders' });
  const authorizedRoute = await app.inject({
    method: 'GET',
    url: '/api/admin/orders',
    headers: adminHeaders(),
  });
  assert.equal(unauthorizedRoute.statusCode, 401);
  assert.equal(authorizedRoute.statusCode, 200);

  const server = createServer();
  attachRealtimeServer(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const socketUrl = `http://127.0.0.1:${address.port}`;
  const clients: Socket[] = [];
  context.after(async () => {
    clients.forEach((client) => client.disconnect());
    await closeRealtimeServer();
  });

  const openSocket = async (
    auth: Record<string, unknown>,
    cookie?: string,
  ): Promise<{ socket: Socket; error: string | null }> => {
    const socket = connectSocket(socketUrl, {
      path: '/api/admin/socket.io',
      auth,
      extraHeaders: {
        origin: env.FRONTEND_ORIGIN,
        ...(cookie ? { cookie } : {}),
      },
      reconnection: false,
      timeout: 3000,
      transports: ['websocket'],
    });
    clients.push(socket);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket authentication timed out')), 4000);
      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve({ socket, error: null });
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timeout);
        resolve({ socket, error: error.message });
      });
    });
  };

  const anonymousOwner = await openSocket({ role: 'owner' });
  const otherCustomer = await openSocket({ role: 'customer', trackingToken: 'A'.repeat(43) });
  const validCustomer = await openSocket({ role: 'customer', trackingToken });
  const validOwner = await openSocket({ role: 'owner' }, 'ordertaker_admin=valid-session');

  assert.equal(anonymousOwner.error, 'Authentication required');
  assert.equal(otherCustomer.error, 'Authentication required');
  assert.equal(validCustomer.socket.connected, true);
  assert.equal(validOwner.socket.connected, true);
});

test('production configuration refuses an insecure frontend origin', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', 'await import("./src/config/env.ts")'],
    {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/ordertaker_test',
        FRONTEND_ORIGIN: 'http://store.example.com',
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FRONTEND_ORIGIN must use HTTPS in production/);
});
