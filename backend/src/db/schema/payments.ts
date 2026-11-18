import { randomUUID } from 'node:crypto';
import { index, pgTable, text, timestamp, uniqueIndex, numeric } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { orders } from './orders.js';
import { paymentActorType, paymentMethod, paymentStatus } from './enums.js';

const generatedId = () => randomUUID();

export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey().$defaultFn(generatedId),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    method: paymentMethod('method').notNull(),
    status: paymentStatus('status').notNull().default('UNPAID'),
    amount: numeric('amount', { precision: 10, scale: 2, mode: 'string' }).notNull(),
    referenceNumber: text('reference_number'),
    proofImagePath: text('proof_image_path'),
    providerReference: text('provider_reference'),
    verifiedAt: timestamp('verified_at', { precision: 3 }),
    verifiedById: text('verified_by').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('payments_order_id_key').on(table.orderId),
    index('payments_status_created_at_idx').on(table.status, table.createdAt),
  ],
);

export const paymentStatusHistories = pgTable(
  'payment_status_histories',
  {
    id: text('id').primaryKey().$defaultFn(generatedId),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    oldStatus: paymentStatus('old_status'),
    newStatus: paymentStatus('new_status').notNull(),
    actorType: paymentActorType('actor_type').notNull(),
    changedByUserId: text('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    note: text('note'),
    createdAt: timestamp('created_at', { precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('payment_status_histories_payment_id_created_at_idx').on(
      table.paymentId,
      table.createdAt,
    ),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type PaymentStatusHistory = typeof paymentStatusHistories.$inferSelect;
