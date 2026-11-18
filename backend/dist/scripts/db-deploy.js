import mysql from 'mysql2/promise';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { resolve } from 'node:path';
import { env } from '../src/config/env.js';
import { createDatabase } from '../src/db.js';
const client = mysql.createPool(env.DATABASE_URL);
try {
    const [tables] = await client.query(`
    SELECT TABLE_NAME AS tableName
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
      AND TABLE_NAME <> '__drizzle_migrations'
  `);
    const [historyTables] = await client.query(`
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = '__drizzle_migrations'
  `);
    let migrationCount = 0;
    if (historyTables.length > 0) {
        const [history] = await client.query('SELECT COUNT(*) AS migrationCount FROM `__drizzle_migrations`');
        migrationCount = Number(history[0]?.migrationCount ?? 0);
    }
    if (tables.length > 0 && historyTables.length === 0) {
        throw new Error('Refusing to migrate a non-empty MySQL database without Drizzle history.');
    }
    if (tables.length > 0 && migrationCount === 0) {
        throw new Error('Refusing to migrate a partially initialized MySQL database.');
    }
    if (tables.length === 0 && migrationCount > 0) {
        throw new Error('Refusing to migrate MySQL history without application tables.');
    }
    await migrate(createDatabase(client), {
        migrationsFolder: resolve(import.meta.dirname, '../drizzle-mysql'),
    });
    console.info('Drizzle migrations applied.');
}
finally {
    await client.end();
}
