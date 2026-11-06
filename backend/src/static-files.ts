import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../public/uploads');

export async function registerStaticFiles(app: FastifyInstance): Promise<void> {
  await app.register(fastifyStatic, {
    root: uploadsDirectory,
    prefix: '/uploads/',
    index: false,
    immutable: true,
    maxAge: '1y',
    setHeaders(response) {
      response.header('X-Content-Type-Options', 'nosniff');
    },
  });
}
