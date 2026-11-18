import postgres from 'postgres';
import { env } from '../config/env.js';
import { createDatabase } from '../db.js';
export const databasePlugin = async (app) => {
    const client = postgres(env.DATABASE_URL, { prepare: false, max: 5 });
    app.decorate('db', createDatabase(client));
    app.addHook('onClose', async () => {
        await client.end();
    });
};
