import { randomUUID } from 'node:crypto';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { userRole } from './enums.js';
const generatedId = () => randomUUID();
export const users = pgTable('users', {
    id: text('id').primaryKey().$defaultFn(generatedId),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('OWNER'),
    createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3 }).notNull(),
}, (table) => [uniqueIndex('users_email_key').on(table.email)]);
export const adminSessions = pgTable('admin_sessions', {
    id: text('id').primaryKey().$defaultFn(generatedId),
    tokenHash: text('token_hash').notNull(),
    userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    expiresAt: timestamp('expires_at', { precision: 3 }).notNull(),
    createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('admin_sessions_token_hash_key').on(table.tokenHash),
    index('admin_sessions_user_id_expires_at_idx').on(table.userId, table.expiresAt),
]);
