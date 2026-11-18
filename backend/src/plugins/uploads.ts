import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env.js';

export const uploadsPlugin: FastifyPluginAsync = async (app) => {
  await mkdir(join(env.UPLOADS_DIR, 'public'), { recursive: true });
  await app.register(fastifyStatic, {
    root: join(env.UPLOADS_DIR, 'public'),
    prefix: '/api/uploads/',
    decorateReply: false,
    index: false,
    redirect: false,
  });
};
