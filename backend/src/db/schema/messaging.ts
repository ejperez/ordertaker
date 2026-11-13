import { randomUUID } from 'node:crypto';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { orders } from './orders.js';
import { messageSenderType } from './enums.js';

const generatedId = () => randomUUID();

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey().$defaultFn(generatedId),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    senderType: messageSenderType('sender_type').notNull(),
    senderName: text('sender_name').notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
  },
  (table) => [index('messages_order_id_created_at_idx').on(table.orderId, table.createdAt)],
);

export type Message = typeof messages.$inferSelect;
