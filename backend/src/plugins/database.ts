import type { FastifyPluginAsync } from 'fastify';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { createDatabase } from '../db.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof createDatabase>;
  }
}

export const databasePlugin: FastifyPluginAsync = async (app) => {
  const client = mysql.createPool(env.DATABASE_URL);
  app.decorate('db', createDatabase(client));
  app.addHook('onClose', async () => {
    await client.end();
  });
};
