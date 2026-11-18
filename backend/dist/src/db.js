import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './db/schema/index.js';
export function createDatabase(client) {
    return drizzle(client, { schema, mode: 'planetscale' });
}
