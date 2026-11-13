import cors from '@fastify/cors';
import Fastify from 'fastify';
import { adminCatalogRoutes } from './routes/admin-catalog.js';
import { adminAuthRoutes } from './routes/admin-auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { adminOrderRoutes } from './routes/admin-orders.js';
import { orderRoutes } from './routes/orders.js';
import { env } from './config/env.js';
import { healthRoutes } from './routes/health.js';
import { attachRealtimeServer, closeRealtimeServer } from './realtime.js';
import { databasePlugin } from './plugins/database.js';

export async function buildApp() {
  const app = Fastify({ logger: true });
  app.decorateRequest('owner', null);
  app.addHook('onClose', async () => {
    await closeRealtimeServer();
  });

  await databasePlugin(app, {});
  await app.register(cors, {
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(adminAuthRoutes, { prefix: '/api/admin' });
  await app.register(adminCatalogRoutes, { prefix: '/api/admin' });
  await app.register(adminOrderRoutes, { prefix: '/api/admin' });
  await app.register(catalogRoutes, { prefix: '/api' });
  await app.register(orderRoutes, { prefix: '/api' });
  attachRealtimeServer(app.server, app.db);

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode =
      error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    return reply.status(statusCode).send({
      error:
        statusCode >= 500
          ? 'Internal Server Error'
          : error instanceof Error
            ? error.message
            : 'Request failed',
    });
  });

  return app;
}
