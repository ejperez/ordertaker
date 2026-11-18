import { randomUUID } from 'node:crypto';
import {
  index,
  int,
  decimal,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './auth.js';
import { products } from './catalog.js';
import { fulfillmentTypeValues, orderStatusValues, paymentMethodValues } from './enums.js';

const generatedId = () => randomUUID();

export const orders = mysqlTable(
  'orders',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generatedId),
    orderNumber: varchar('order_number', { length: 20 }).notNull(),
    customerName: varchar('customer_name', { length: 100 }).notNull(),
    customerPhone: varchar('customer_phone', { length: 24 }).notNull(),
    fulfillmentType: mysqlEnum('fulfillment_type', fulfillmentTypeValues).notNull(),
    block: varchar('block', { length: 80 }),
    lot: varchar('lot', { length: 80 }),
    street: varchar('street', { length: 160 }),
    deliveryInstructions: varchar('delivery_instructions', { length: 500 }),
    status: mysqlEnum('status', orderStatusValues).notNull().default('PENDING'),
    paymentMethod: mysqlEnum('payment_method', paymentMethodValues).notNull(),
    subtotal: decimal('subtotal', { precision: 10, scale: 2, mode: 'string' }).notNull(),
    deliveryFee: decimal('delivery_fee', { precision: 10, scale: 2, mode: 'string' })
      .notNull()
      .default('0'),
    total: decimal('total', { precision: 10, scale: 2, mode: 'string' }).notNull(),
    trackingTokenHash: varchar('tracking_token_hash', { length: 64 }).notNull(),
    idempotencyKeyHash: varchar('idempotency_key_hash', { length: 64 }),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { fsp: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('orders_order_number_key').on(table.orderNumber),
    uniqueIndex('orders_tracking_token_hash_key').on(table.trackingTokenHash),
    uniqueIndex('orders_idempotency_key_hash_key').on(table.idempotencyKeyHash),
    index('orders_status_created_at_idx').on(table.status, table.createdAt),
    index('orders_fulfillment_type_created_at_idx').on(table.fulfillmentType, table.createdAt),
  ],
);

export const orderItems = mysqlTable(
  'order_items',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generatedId),
    orderId: varchar('order_id', { length: 36 })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: varchar('product_id', { length: 36 }).references(() => products.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    productName: varchar('product_name', { length: 160 }).notNull(),
    quantity: int('quantity').notNull(),
    unitPrice: decimal('unit_price', { precision: 10, scale: 2, mode: 'string' }).notNull(),
    lineTotal: decimal('line_total', { precision: 10, scale: 2, mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('order_items_order_id_idx').on(table.orderId),
    index('order_items_product_id_idx').on(table.productId),
  ],
);

export const orderStatusHistories = mysqlTable(
  'order_status_histories',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generatedId),
    orderId: varchar('order_id', { length: 36 })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    oldStatus: mysqlEnum('old_status', orderStatusValues),
    newStatus: mysqlEnum('new_status', orderStatusValues).notNull(),
    changedByUserId: varchar('changed_by_user_id', { length: 36 }).references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    note: varchar('note', { length: 500 }),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('order_status_histories_order_id_created_at_idx').on(table.orderId, table.createdAt),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
