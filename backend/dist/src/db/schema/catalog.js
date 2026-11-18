import { randomUUID } from 'node:crypto';
import { boolean, index, int, decimal, mysqlTable, text, timestamp, uniqueIndex, varchar, } from 'drizzle-orm/mysql-core';
const generatedId = () => randomUUID();
export const categories = mysqlTable('categories', {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generatedId),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 140 }).notNull(),
    sortOrder: int('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { fsp: 3 }).notNull(),
}, (table) => [
    uniqueIndex('categories_name_key').on(table.name),
    uniqueIndex('categories_slug_key').on(table.slug),
]);
export const products = mysqlTable('products', {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generatedId),
    categoryId: varchar('category_id', { length: 36 })
        .notNull()
        .references(() => categories.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 140 }).notNull(),
    description: text('description'),
    price: decimal('price', { precision: 10, scale: 2, mode: 'string' }).notNull(),
    imagePath: varchar('image_path', { length: 255 }),
    isAvailable: boolean('is_available').notNull().default(true),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { fsp: 3 }).notNull(),
}, (table) => [
    uniqueIndex('products_slug_key').on(table.slug),
    index('products_category_id_is_available_is_archived_idx').on(table.categoryId, table.isAvailable, table.isArchived),
]);
