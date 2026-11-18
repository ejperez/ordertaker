import { json, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const storeSettings = mysqlTable('store_settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: json('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { fsp: 3 }).notNull(),
});
