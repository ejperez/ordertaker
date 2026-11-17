import { randomUUID } from 'node:crypto';
import { boolean, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, } from 'drizzle-orm/pg-core';
const generatedId = () => randomUUID();
export const categories = pgTable('categories', {
    id: text('id').primaryKey().$defaultFn(generatedId),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3 }).notNull(),
}, (table) => [
    uniqueIndex('categories_name_key').on(table.name),
    uniqueIndex('categories_slug_key').on(table.slug),
]);
export const products = pgTable('products', {
    id: text('id').primaryKey().$defaultFn(generatedId),
    categoryId: text('category_id')
        .notNull()
        .references(() => categories.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    price: numeric('price', { precision: 10, scale: 2, mode: 'string' }).notNull(),
    imagePath: text('image_path'),
    isAvailable: boolean('is_available').notNull().default(true),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3 }).notNull(),
}, (table) => [
    uniqueIndex('products_slug_key').on(table.slug),
    index('products_category_id_is_available_is_archived_idx').on(table.categoryId, table.isAvailable, table.isArchived),
]);
