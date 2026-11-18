import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { createDatabase } from '../db.js';
export const databasePlugin = async (app) => {
    const client = mysql.createPool(env.DATABASE_URL);
    app.decorate('db', createDatabase(client));
    app.addHook('onClose', async () => {
        await client.end();
    });
};
