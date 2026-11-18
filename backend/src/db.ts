import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import type { Pool } from 'mysql2/promise';
import * as schema from './db/schema/index.js';

export type AppDatabase = MySql2Database<typeof schema>;

export function createDatabase(client: Pool): AppDatabase {
  return drizzle(client, { schema, mode: 'planetscale' });
}
