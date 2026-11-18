import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { env } from '../src/config/env.js';
import { createDatabase } from '../src/db.js';
import { adminSessions, categories, messages, orderItems, orderStatusHistories, orders, paymentStatusHistories, payments, products, storeSettings, users, } from '../src/db/schema/index.js';
const schemaTables = [
    adminSessions,
    users,
    categories,
    products,
    messages,
    orderItems,
    orderStatusHistories,
    orders,
    paymentStatusHistories,
    payments,
    storeSettings,
];
const migrationDirectory = resolve(import.meta.dirname, '../drizzle');
const journalPath = resolve(migrationDirectory, 'meta/_journal.json');
const journal = JSON.parse(await readFile(journalPath, 'utf8'));
const initialMigration = journal.entries[0];
if (!initialMigration)
    throw new Error('Drizzle migration journal is empty.');
const client = postgres(env.DIRECT_URL, { prepare: false, max: 1 });
try {
    const [schemaState] = await client `
    SELECT
      (SELECT count(*)::int FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename = ANY(ARRAY[
          'admin_sessions', 'users', 'categories', 'products', 'messages',
          'order_items', 'order_status_histories', 'orders',
          'payment_status_histories', 'payments', 'store_settings'
        ])) AS table_count,
      (SELECT count(*)::int FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        AND t.typname = ANY(ARRAY[
          'FulfillmentType', 'MessageSenderType', 'OrderStatus', 'PaymentActorType',
          'PaymentMethod', 'PaymentStatus', 'UserRole'
        ])) AS enum_count,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass('public.order_items')
          AND confrelid = to_regclass('public.products')
          AND contype = 'f'
      ) AS has_product_foreign_key,
      to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS has_migration_history
  `;
    const expectedColumns = schemaTables.map((table) => {
        const config = getTableConfig(table);
        return { table: config.name, columns: config.columns.map((column) => column.name) };
    });
    const actualColumnRows = await client `
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
    const actualColumns = new Map();
    for (const row of actualColumnRows) {
        const columns = actualColumns.get(row.table_name) ?? new Set();
        columns.add(row.column_name);
        actualColumns.set(row.table_name, columns);
    }
    const hasExpectedColumns = expectedColumns.every(({ table, columns }) => columns.every((column) => actualColumns.get(table)?.has(column)));
    const [indexState] = await client `
    SELECT count(*)::int AS unique_index_count
    FROM pg_indexes i
    JOIN pg_class c ON c.relname = i.indexname
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = i.schemaname
    JOIN pg_index pi ON pi.indexrelid = c.oid
    WHERE i.schemaname = 'public'
      AND pi.indisunique
      AND i.indexname = ANY(ARRAY[
        'users_email_key', 'admin_sessions_token_hash_key',
        'categories_name_key', 'categories_slug_key', 'products_slug_key',
        'orders_order_number_key', 'orders_tracking_token_hash_key',
        'orders_idempotency_key_hash_key', 'payments_order_id_key'
      ])
  `;
    const [migrationCount] = schemaState.has_migration_history
        ? await client `SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`
        : [{ count: 0 }];
    if (migrationCount.count === 0) {
        if (schemaState.table_count === 0 && schemaState.enum_count === 0) {
            // Empty database: Drizzle will create the schema from the migration.
        }
        else if (schemaState.table_count === 11 &&
            schemaState.enum_count === 7 &&
            schemaState.has_product_foreign_key &&
            hasExpectedColumns &&
            indexState.unique_index_count === 9) {
            const migrationSql = await readFile(resolve(migrationDirectory, `${initialMigration.tag}.sql`), 'utf8');
            const hash = createHash('sha256').update(migrationSql).digest('hex');
            await client `CREATE SCHEMA IF NOT EXISTS drizzle`;
            await client `
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `;
            await client `
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        SELECT ${hash}, ${initialMigration.when}
        WHERE NOT EXISTS (
          SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${hash}
        )
      `;
            console.info('Recorded existing complete schema as the initial Drizzle baseline.');
        }
        else {
            throw new Error(`Refusing to migrate partial database schema (${schemaState.table_count}/11 tables, ${schemaState.enum_count}/7 enums, expected columns: ${hasExpectedColumns}, unique indexes: ${indexState.unique_index_count}/9, product foreign key: ${schemaState.has_product_foreign_key}).`);
        }
    }
    await migrate(createDatabase(client), { migrationsFolder: migrationDirectory });
    console.info('Drizzle migrations applied.');
}
finally {
    await client.end();
}
