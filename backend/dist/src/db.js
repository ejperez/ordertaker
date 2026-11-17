import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './db/schema/index.js';
export function createDatabase(client) {
    // Workspaces resolve postgres.js through separate paths; runtime clients remain compatible.
    return drizzle({ client: client, schema });
}
