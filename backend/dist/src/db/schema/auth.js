import { randomUUID } from 'node:crypto';
import { index, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar, } from 'drizzle-orm/mysql-core';
import { userRoleValues } from './enums.js';
const generatedId = () => randomUUID();
export const users = mysqlTable('users', {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generatedId),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: mysqlEnum('role', userRoleValues).notNull().default('OWNER'),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { fsp: 3 }).notNull(),
}, (table) => [uniqueIndex('users_email_key').on(table.email)]);
export const adminSessions = mysqlTable('admin_sessions', {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generatedId),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    userId: varchar('user_id', { length: 36 })
        .notNull()
        .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    expiresAt: timestamp('expires_at', { fsp: 3 }).notNull(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('admin_sessions_token_hash_key').on(table.tokenHash),
    index('admin_sessions_user_id_expires_at_idx').on(table.userId, table.expiresAt),
]);
