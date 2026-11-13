import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import * as schema from './db/schema/index.js';

export type AppDatabase = PostgresJsDatabase<typeof schema>;

export function createDatabase(client: ReturnType<typeof postgres>): AppDatabase {
  // Workspaces resolve postgres.js through separate paths; runtime clients remain compatible.
  return drizzle({ client: client as never, schema });
}
