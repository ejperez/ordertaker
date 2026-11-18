import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { eq } from 'drizzle-orm';
import { io as connectSocket, type Socket } from 'socket.io-client';
import { createDatabase, type AppDatabase } from '../src/db.js';
import * as schema from '../src/db/schema/index.js';
import { hashSessionToken, sessionCookieName } from '../src/auth.js';
import { env } from '../src/config/env.js';
import {
  adminSessions,
  categories,
  orders,
  payments,
  products,
  users,
} from '../src/db/schema/index.js';
import { adminOrderRoutes } from '../src/routes/admin-orders.js';
import { adminAuthRoutes } from '../src/routes/admin-auth.js';
import { adminCatalogRoutes } from '../src/routes/admin-catalog.js';
import { orderRoutes } from '../src/routes/orders.js';
import { ImageValidationError, imageStorage } from '../src/services/image-storage.js';
import { attachRealtimeServer, closeRealtimeServer } from '../src/realtime.js';
import { frontendPlugin } from '../src/plugins/frontend.js';
import { uploadsPlugin } from '../src/plugins/uploads.js';

type TestDatabase = {
  client: Pool;
  db: AppDatabase;
};

async function createTestDatabase(): Promise<TestDatabase> {
  const databaseName = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('Tests require a database name ending in _test');
  }
  const client = mysql.createPool(env.DATABASE_URL);
  try {
    const connection = await client.getConnection();
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      const [tables] = await connection.query<RowDataPacket[]>('SHOW TABLES');
      for (const table of tables) {
        const name = String(Object.values(table)[0]).replaceAll('`', '``');
        await connection.query(`DROP TABLE IF EXISTS \`${name}\``);
      }
    } finally {
      try {
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      } finally {
        connection.release();
      }
    }
  } catch (error) {
    await client.end();
    throw error;
  }
  const db = createDatabase(client);
  try {
    await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../drizzle-mysql') });
  } catch (error) {
    await client.end();
    throw error;
  }
  return { client, db };
}

test.after(async () => rm(env.UPLOADS_DIR, { recursive: true, force: true }));

async function createRouteApp(
  plugin: FastifyPluginAsync,
  prefix: string,
  db: AppDatabase,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('owner', null);
  app.decorate('db', db);
  await app.register(plugin, { prefix });
  await app.ready();
  return app;
}

async function insertOrder(db: AppDatabase, values: typeof orders.$inferInsert) {
  const order = { ...values, id: randomUUID() };
  await db.insert(orders).values(order);
  return order;
}

async function seedProduct(db: AppDatabase) {
  const categoryId = randomUUID();
  await db
    .insert(categories)
    .values({ id: categoryId, name: 'Coffee', slug: 'coffee', updatedAt: new Date() });
  const [category] = await db.select().from(categories).where(eq(categories.id, categoryId));
  const productId = randomUUID();
  await db.insert(products).values({
    id: productId,
    categoryId: category.id,
    name: 'Meal',
    slug: 'meal',
    price: '12.50',
    updatedAt: new Date(),
  });
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  await db.insert(schema.storeSettings).values({
    key: 'delivery_fee',
    value: 3.25,
    updatedAt: new Date(),
  });
  return { category, product };
}

async function createOwnerSession(db: AppDatabase) {
  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    name: 'Owner',
    email: 'owner@example.com',
    passwordHash: 'test-hash',
    updatedAt: new Date(),
  });
  const [owner] = await db.select().from(users).where(eq(users.id, userId));
  const token = randomBytes(32).toString('base64url');
  await db.insert(adminSessions).values({
    tokenHash: hashSessionToken(token),
    userId: owner.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { owner, token };
}

function adminHeaders(token?: string): Record<string, string> {
  return {
    ...(token ? { cookie: `${sessionCookieName}=${token}` } : {}),
    origin: env.FRONTEND_ORIGIN,
  };
}

function stubMethod(target: object, name: string, value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  const original = Reflect.get(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else if (original !== undefined) {
      Object.defineProperty(target, name, {
        configurable: true,
        writable: true,
        value: original,
      });
    } else Reflect.deleteProperty(target, name);
  };
}

function restoreAfter(context: TestContext, ...restoreMethods: Array<() => void>): void {
  context.after(() => {
    for (const restore of restoreMethods.reverse()) restore();
  });
}

test('checkout commits delivery COD order and items atomically, then supports idempotent retry', async (context) => {
  const { client, db } = await createTestDatabase();
  context.after(async () => client.end());
  const { product } = await seedProduct(db);
  const app = await createRouteApp(orderRoutes, '/api', db);
  context.after(() => app.close());

  const payload = {
    customerName: 'Customer',
    customerPhone: '5551234567',
    fulfillmentType: 'DELIVERY',
    block: 'A',
    lot: '1',
    paymentMethod: 'COD',
    items: [{ productId: product.id, quantity: 2 }],
  };
  const headers = { 'idempotency-key': '00000000-0000-4000-8000-000000000001' };
  const response = await app.inject({ method: 'POST', url: '/api/orders', headers, payload });
  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.subtotal, '25.00');
  assert.equal(body.deliveryFee, '3.25');
  assert.equal(body.total, '28.25');

  const savedOrders = await db.select().from(orders);
  const savedPayments = await db.select().from(payments);
  assert.equal(savedOrders.length, 1);
  assert.equal(savedPayments.length, 1);
  assert.equal((await db.select().from(schema.orderItems)).length, 1);

  const duplicate = await app.inject({ method: 'POST', url: '/api/orders', headers, payload });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().duplicate, true);
  assert.equal((await db.select().from(orders)).length, 1);

  const token = body.trackingUrl.split('/').at(-1);
  const tracked = await app.inject({ method: 'GET', url: `/api/orders/track/${token}` });
  assert.equal(tracked.statusCode, 200);
  assert.equal(tracked.json().orderNumber, body.orderNumber);

  const message = await app.inject({
    method: 'POST',
    url: `/api/orders/track/${token}/messages`,
    payload: { message: 'Please leave the order at the door.' },
  });
  assert.equal(message.statusCode, 201);
  const otherOrderMessages = await app.inject({
    method: 'GET',
    url: `/api/orders/track/${randomBytes(32).toString('base64url')}/messages`,
  });
  assert.equal(otherOrderMessages.statusCode, 404);
});

test('checkout rejects unavailable products without persisting partial records', async (context) => {
  const { client, db } = await createTestDatabase();
  context.after(async () => client.end());
  const { product } = await seedProduct(db);
  await db.update(products).set({ isAvailable: false }).where(eq(products.id, product.id));
  const app = await createRouteApp(orderRoutes, '/api', db);
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/orders',
    headers: { 'idempotency-key': '00000000-0000-4000-8000-000000000002' },
    payload: {
      customerName: 'Customer',
      customerPhone: '5551234567',
      fulfillmentType: 'PICKUP',
      paymentMethod: 'COD',
      items: [{ productId: product.id, quantity: 1 }],
    },
  });
  assert.equal(response.statusCode, 409);
  assert.equal((await db.select().from(orders)).length, 0);
  assert.equal((await db.select().from(payments)).length, 0);
});

test('MySQL migration creates product foreign key', async (context) => {
  const { client } = await createTestDatabase();
  context.after(async () => client.end());
  const [constraints] = await client.query<RowDataPacket[]>(`
    SELECT CONSTRAINT_NAME
    FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'order_items'
      AND REFERENCED_TABLE_NAME = 'products'
  `);
  assert.equal(constraints.length, 1);
});

test('admin product routes return category details through SQL joins', async (context) => {
  const { client, db } = await createTestDatabase();
  context.after(async () => client.end());
  const categoryId = randomUUID();
  await db.insert(categories).values({
    id: categoryId,
    name: 'Coffee',
    slug: `coffee-${categoryId.slice(0, 8)}`,
    updatedAt: new Date(),
  });
  const productId = randomUUID();
  await db.insert(products).values({
    id: productId,
    categoryId,
    name: 'Meal',
    slug: `meal-${productId.slice(0, 8)}`,
    price: '12.50',
    updatedAt: new Date(),
  });
  const { token } = await createOwnerSession(db);
  const app = await createRouteApp(adminCatalogRoutes, '/api/admin', db);
  context.after(() => app.close());

  const list = await app.inject({
    method: 'GET',
    url: '/api/admin/products',
    headers: adminHeaders(token),
  });
  assert.equal(list.statusCode, 200);
  const [listedProduct] = list.json();
  assert.equal(listedProduct.id, productId);
  assert.deepEqual(listedProduct.category, {
    id: categoryId,
    name: 'Coffee',
    slug: `coffee-${categoryId.slice(0, 8)}`,
    isActive: true,
  });

  const detail = await app.inject({
    method: 'GET',
    url: `/api/admin/products/${productId}`,
    headers: adminHeaders(token),
  });
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(detail.json().category, {
    id: categoryId,
    name: 'Coffee',
    slug: `coffee-${categoryId.slice(0, 8)}`,
  });
});

test('pickup QR checkout stores private proof and charges no delivery fee', async (context) => {
  const { client, db } = await createTestDatabase();
  context.after(async () => client.end());
  const { product } = await seedProduct(db);
  restoreAfter(
    context,
    stubMethod(imageStorage, 'savePaymentProof', async () => 'payment-proofs/test.png'),
  );
  const app = await createRouteApp(orderRoutes, '/api', db);
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/orders',
    headers: { 'idempotency-key': '00000000-0000-4000-8000-000000000003' },
    payload: {
      customerName: 'Customer',
      customerPhone: '5551234567',
      fulfillmentType: 'PICKUP',
      paymentMethod: 'QR',
      paymentReceipt: { data: 'eA==' },
      items: [{ productId: product.id, quantity: 2 }],
    },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().deliveryFee, '0.00');
  assert.equal(response.json().total, '25.00');
  const [payment] = await db.select().from(payments);
  assert.equal(payment.status, 'AWAITING_VERIFICATION');
  assert.equal(payment.proofImagePath, 'payment-proofs/test.png');
});

test('admin session authorizes private proof reads and payment transitions', async (context) => {
  const { client, db } = await createTestDatabase();
  context.after(async () => client.end());
  const { owner, token } = await createOwnerSession(db);
  const order = await insertOrder(db, {
    orderNumber: 'ORD-1',
    customerName: 'Customer',
    customerPhone: '5551234567',
    fulfillmentType: 'PICKUP',
    status: 'PENDING',
    paymentMethod: 'QR',
    subtotal: '25.00',
    deliveryFee: '0',
    total: '25.00',
    trackingTokenHash: createHash('sha256').update('tracking-token').digest('hex'),
    updatedAt: new Date(),
  });
  const paymentId = randomUUID();
  await db.insert(payments).values({
    id: paymentId,
    orderId: order.id,
    method: 'QR',
    status: 'AWAITING_VERIFICATION',
    amount: '25.00',
    proofImagePath: 'payment-proofs/proof.png',
    updatedAt: new Date(),
  });
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
  assert.ok(payment);

  restoreAfter(
    context,
    stubMethod(imageStorage, 'readPaymentProof', async () => ({
      bytes: Buffer.from('proof'),
      contentType: 'image/png',
    })),
  );
  const app = await createRouteApp(adminOrderRoutes, '/api/admin', db);
  context.after(() => app.close());

  const authApp = await createRouteApp(adminAuthRoutes, '/api/admin', db);
  context.after(() => authApp.close());
  const me = await authApp.inject({
    method: 'GET',
    url: '/api/admin/me',
    headers: adminHeaders(token),
  });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), {
    user: { id: owner.id, name: owner.name, email: owner.email },
  });

  const orderList = await app.inject({
    method: 'GET',
    url: '/api/admin/orders',
    headers: adminHeaders(token),
  });
  assert.equal(orderList.statusCode, 200);
  const listedOrder = orderList
    .json()
    .find((candidate: { id: string }) => candidate.id === order.id);
  assert.deepEqual(listedOrder.items, []);
  assert.equal(listedOrder.payment.status, 'AWAITING_VERIFICATION');
  assert.deepEqual(listedOrder.statusHistory, []);

  const denied = await app.inject({
    method: 'GET',
    url: `/api/admin/orders/${order.id}/payment-proof`,
    headers: adminHeaders(),
  });
  assert.equal(denied.statusCode, 401);

  const proof = await app.inject({
    method: 'GET',
    url: `/api/admin/orders/${order.id}/payment-proof`,
    headers: adminHeaders(token),
  });
  assert.equal(proof.statusCode, 200);
  assert.equal(proof.headers['cache-control'], 'private, no-store');

  const review = await app.inject({
    method: 'PATCH',
    url: `/api/admin/orders/${order.id}/payment`,
    headers: adminHeaders(token),
    payload: { status: 'PAID' },
  });
  assert.equal(review.statusCode, 200);
  assert.equal(review.json().status, 'PAID');
  assert.equal(review.json().verifiedBy.name, owner.name);
  assert.equal((await db.select().from(schema.paymentStatusHistories)).length, 1);

  const status = await app.inject({
    method: 'PATCH',
    url: `/api/admin/orders/${order.id}/status`,
    headers: adminHeaders(token),
    payload: { status: 'IN_KITCHEN' },
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().status, 'IN_KITCHEN');

  const readyForPickup = await app.inject({
    method: 'PATCH',
    url: `/api/admin/orders/${order.id}/status`,
    headers: adminHeaders(token),
    payload: { status: 'READY_FOR_PICKUP' },
  });
  assert.equal(readyForPickup.statusCode, 200);
  const invalidDeliveryTransition = await app.inject({
    method: 'PATCH',
    url: `/api/admin/orders/${order.id}/status`,
    headers: adminHeaders(token),
    payload: { status: 'OUT_FOR_DELIVERY' },
  });
  assert.equal(invalidDeliveryTransition.statusCode, 409);

  const deliveryOrder = await insertOrder(db, {
    orderNumber: 'ORD-DELIVERY',
    customerName: 'Customer',
    customerPhone: '5551234567',
    fulfillmentType: 'DELIVERY',
    status: 'PENDING',
    paymentMethod: 'COD',
    subtotal: '25.00',
    deliveryFee: '3.25',
    total: '28.25',
    trackingTokenHash: createHash('sha256').update('delivery-token').digest('hex'),
    updatedAt: new Date(),
  });
  await db.insert(payments).values({
    orderId: deliveryOrder.id,
    method: 'COD',
    status: 'UNPAID',
    amount: '28.25',
    updatedAt: new Date(),
  });

  const invalidPickupTransition = await app.inject({
    method: 'PATCH',
    url: `/api/admin/orders/${deliveryOrder.id}/status`,
    headers: adminHeaders(token),
    payload: { status: 'READY_FOR_PICKUP' },
  });
  assert.equal(invalidPickupTransition.statusCode, 409);
  const inKitchen = await app.inject({
    method: 'PATCH',
    url: `/api/admin/orders/${deliveryOrder.id}/status`,
    headers: adminHeaders(token),
    payload: { status: 'IN_KITCHEN' },
  });
  assert.equal(inKitchen.statusCode, 200);
  const outForDelivery = await app.inject({
    method: 'PATCH',
    url: `/api/admin/orders/${deliveryOrder.id}/status`,
    headers: adminHeaders(token),
    payload: { status: 'OUT_FOR_DELIVERY' },
  });
  assert.equal(outForDelivery.statusCode, 200);

  const codCollected = await app.inject({
    method: 'PATCH',
    url: `/api/admin/orders/${deliveryOrder.id}/payment`,
    headers: adminHeaders(token),
    payload: { status: 'PAID' },
  });
  assert.equal(codCollected.statusCode, 200);
  assert.equal(codCollected.json().status, 'PAID');
  const [savedCodPayment] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, deliveryOrder.id));
  assert.equal(savedCodPayment.status, 'PAID');

  const rejectedOrder = await insertOrder(db, {
    orderNumber: 'ORD-REJECT',
    customerName: 'Customer',
    customerPhone: '5551234567',
    fulfillmentType: 'PICKUP',
    status: 'PENDING',
    paymentMethod: 'QR',
    subtotal: '10.00',
    deliveryFee: '0',
    total: '10.00',
    trackingTokenHash: createHash('sha256').update('rejected-token').digest('hex'),
    updatedAt: new Date(),
  });
  await db.insert(payments).values({
    orderId: rejectedOrder.id,
    method: 'QR',
    status: 'AWAITING_VERIFICATION',
    amount: '10.00',
    updatedAt: new Date(),
  });
  const missingReason = await app.inject({
    method: 'PATCH',
    url: `/api/admin/orders/${rejectedOrder.id}/payment`,
    headers: adminHeaders(token),
    payload: { status: 'REJECTED' },
  });
  assert.equal(missingReason.statusCode, 400);
  const rejected = await app.inject({
    method: 'PATCH',
    url: `/api/admin/orders/${rejectedOrder.id}/payment`,
    headers: adminHeaders(token),
    payload: { status: 'REJECTED', rejectionReason: 'Receipt is unreadable' },
  });
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.json().rejectionReason, 'Receipt is unreadable');
});

test('Socket.IO accepts authorized tracking token and rejects invalid credentials', async (context) => {
  const { client, db } = await createTestDatabase();
  context.after(async () => client.end());
  const trackingToken = randomBytes(32).toString('base64url');
  await db.insert(orders).values({
    orderNumber: 'ORD-SOCKET',
    customerName: 'Customer',
    customerPhone: '5551234567',
    fulfillmentType: 'PICKUP',
    status: 'PENDING',
    paymentMethod: 'COD',
    subtotal: '10.00',
    deliveryFee: '0',
    total: '10.00',
    trackingTokenHash: createHash('sha256').update(trackingToken).digest('hex'),
    updatedAt: new Date(),
  });

  const server = createServer();
  attachRealtimeServer(server, db);
  context.after(async () => {
    await closeRealtimeServer();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;

  const socket = connectSocket(url, {
    path: '/api/admin/socket.io',
    auth: { role: 'customer', trackingToken },
    extraHeaders: { origin: env.FRONTEND_ORIGIN },
    transports: ['websocket'],
    forceNew: true,
  });
  context.after(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  assert.equal(socket.connected, true);

  const { token: ownerToken } = await createOwnerSession(db);
  const ownerSocket = connectSocket(url, {
    path: '/api/admin/socket.io',
    auth: { role: 'owner' },
    extraHeaders: {
      origin: env.FRONTEND_ORIGIN,
      cookie: `${sessionCookieName}=${ownerToken}`,
    },
    transports: ['websocket'],
    forceNew: true,
  });
  context.after(() => ownerSocket.close());
  await new Promise<void>((resolve, reject) => {
    ownerSocket.once('connect', resolve);
    ownerSocket.once('connect_error', reject);
  });
  assert.equal(ownerSocket.connected, true);

  socket.close();
  ownerSocket.close();
  await closeRealtimeServer();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  const invalidServer = createServer();
  attachRealtimeServer(invalidServer, db);
  context.after(async () => {
    await closeRealtimeServer();
    if (invalidServer.listening) {
      await new Promise<void>((resolve) => invalidServer.close(() => resolve()));
    }
  });
  await new Promise<void>((resolve) => invalidServer.listen(0, resolve));
  const invalidAddress = invalidServer.address();
  assert.ok(invalidAddress && typeof invalidAddress !== 'string');
  const invalidSocket: Socket = connectSocket(`http://127.0.0.1:${invalidAddress.port}`, {
    path: '/api/admin/socket.io',
    auth: { role: 'customer', trackingToken: 'invalid' },
    extraHeaders: { origin: env.FRONTEND_ORIGIN },
    transports: ['websocket'],
    forceNew: true,
  });
  context.after(() => invalidSocket.close());
  await new Promise<void>((resolve) => {
    invalidSocket.once('connect_error', () => resolve());
  });
  assert.equal(invalidSocket.connected, false);
  invalidSocket.close();
  await closeRealtimeServer();
  await new Promise<void>((resolve) => invalidServer.close(() => resolve()));
});

test('local storage exposes product images but keeps payment proofs private', async (context) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
  await assert.rejects(() => imageStorage.savePaymentProof('eA=='), ImageValidationError);
  const productImage = await imageStorage.saveProductImage(png);
  const proofPath = await imageStorage.savePaymentProof(png);

  const app = Fastify({ logger: false });
  await app.register(uploadsPlugin);
  await app.ready();
  context.after(() => app.close());

  const publicImage = await app.inject(new URL(productImage).pathname);
  assert.equal(publicImage.statusCode, 200);
  assert.match(publicImage.headers['content-type'] ?? '', /image\/png/);
  const publicProof = await app.inject(`/api/uploads/${proofPath}`);
  assert.equal(publicProof.statusCode, 404);
  assert.deepEqual(
    (await imageStorage.readPaymentProof(proofPath))?.bytes,
    Buffer.from(png, 'base64'),
  );
  await assert.rejects(
    () =>
      imageStorage.removeProductImage('https://untrusted.example/api/uploads/products/file.png'),
    ImageValidationError,
  );
});

test('production frontend serves assets and SPA routes without masking API 404s', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'ordertaker-frontend-'));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<main>storefront</main>');
  await writeFile(join(root, 'assets', 'app.js'), 'console.log("storefront")');

  const app = Fastify({ logger: false });
  await app.register(frontendPlugin, { root });
  await app.ready();
  context.after(() => app.close());

  const asset = await app.inject('/assets/app.js');
  assert.equal(asset.statusCode, 200);
  assert.match(asset.headers['content-type'] ?? '', /javascript/);

  const route = await app.inject('/admin');
  assert.equal(route.statusCode, 200);
  assert.match(route.headers['content-type'] ?? '', /text\/html/);

  const missingAsset = await app.inject('/assets/missing.js');
  assert.equal(missingAsset.statusCode, 404);
  assert.deepEqual(missingAsset.json(), { error: 'Not Found' });

  const missingApiRoute = await app.inject('/api/missing');
  assert.equal(missingApiRoute.statusCode, 404);
  assert.deepEqual(missingApiRoute.json(), { error: 'Not Found' });
});
