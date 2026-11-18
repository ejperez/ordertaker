import { randomUUID } from 'node:crypto';
import { index, mysqlEnum, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { orders } from './orders.js';
import { messageSenderTypeValues } from './enums.js';
const generatedId = () => randomUUID();
export const messages = mysqlTable('messages', {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generatedId),
    orderId: varchar('order_id', { length: 36 })
        .notNull()
        .references(() => orders.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    senderType: mysqlEnum('sender_type', messageSenderTypeValues).notNull(),
    senderName: varchar('sender_name', { length: 120 }).notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
}, (table) => [index('messages_order_id_created_at_idx').on(table.orderId, table.createdAt)]);
