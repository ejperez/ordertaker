import cors from '@fastify/cors';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { healthRoutes } from './routes/health.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: env.FRONTEND_ORIGIN,
  });
  await app.register(healthRoutes, { prefix: '/api' });

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
