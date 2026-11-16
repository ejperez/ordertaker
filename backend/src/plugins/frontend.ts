import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';
import { extname, resolve } from 'node:path';

type FrontendPluginOptions = {
  root?: string;
};

export const frontendPlugin: FastifyPluginAsync<FrontendPluginOptions> = async (
  app,
  { root = resolve(import.meta.dirname, '../../../../frontend/dist') },
) => {
  await app.register(fastifyStatic, { root, prefix: '/' });

  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (
      request.method !== 'GET' ||
      pathname === '/api' ||
      pathname.startsWith('/api/') ||
      extname(pathname)
    ) {
      return reply.code(404).send({ error: 'Not Found' });
    }

    return reply.type('text/html').sendFile('index.html');
  });
};
