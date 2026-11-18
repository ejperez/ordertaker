import type { FastifyPluginAsync } from 'fastify';
import postgres from 'postgres';
import { env } from '../config/env.js';
import { createDatabase } from '../db.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof createDatabase>;
  }
}

export const databasePlugin: FastifyPluginAsync = async (app) => {
  const client = postgres(env.DATABASE_URL, { prepare: false, max: 5 });
  app.decorate('db', createDatabase(client));
  app.addHook('onClose', async () => {
    await client.end();
  });
};
