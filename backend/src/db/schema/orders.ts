import { randomUUID } from 'node:crypto';
import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { products } from './catalog.js';
import { fulfillmentType, orderStatus, paymentMethod } from './enums.js';

const generatedId = () => randomUUID();

export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey().$defaultFn(generatedId),
    orderNumber: text('order_number').notNull(),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    fulfillmentType: fulfillmentType('fulfillment_type').notNull(),
    block: text('block'),
    lot: text('lot'),
    street: text('street'),
    deliveryInstructions: text('delivery_instructions'),
    status: orderStatus('status').notNull().default('PENDING'),
    paymentMethod: paymentMethod('payment_method').notNull(),
    subtotal: numeric('subtotal', { precision: 10, scale: 2, mode: 'string' }).notNull(),
    deliveryFee: numeric('delivery_fee', { precision: 10, scale: 2, mode: 'string' })
      .notNull()
      .default('0'),
    total: numeric('total', { precision: 10, scale: 2, mode: 'string' }).notNull(),
    trackingTokenHash: text('tracking_token_hash').notNull(),
    idempotencyKeyHash: text('idempotency_key_hash'),
    createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('orders_order_number_key').on(table.orderNumber),
    uniqueIndex('orders_tracking_token_hash_key').on(table.trackingTokenHash),
    uniqueIndex('orders_idempotency_key_hash_key').on(table.idempotencyKeyHash),
    index('orders_status_created_at_idx').on(table.status, table.createdAt),
    index('orders_fulfillment_type_created_at_idx').on(table.fulfillmentType, table.createdAt),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: text('id').primaryKey().$defaultFn(generatedId),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: text('product_id').references(() => products.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    productName: text('product_name').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2, mode: 'string' }).notNull(),
    lineTotal: numeric('line_total', { precision: 10, scale: 2, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('order_items_order_id_idx').on(table.orderId),
    index('order_items_product_id_idx').on(table.productId),
  ],
);

export const orderStatusHistories = pgTable(
  'order_status_histories',
  {
    id: text('id').primaryKey().$defaultFn(generatedId),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    oldStatus: orderStatus('old_status'),
    newStatus: orderStatus('new_status').notNull(),
    changedByUserId: text('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    note: text('note'),
    createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('order_status_histories_order_id_created_at_idx').on(table.orderId, table.createdAt),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
