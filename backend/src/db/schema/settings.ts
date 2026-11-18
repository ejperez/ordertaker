import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const storeSettings = pgTable('store_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { precision: 3 }).notNull(),
});
