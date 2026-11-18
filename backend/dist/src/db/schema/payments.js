import { randomUUID } from 'node:crypto';
import { index, mysqlEnum, mysqlTable, decimal, timestamp, uniqueIndex, varchar, } from 'drizzle-orm/mysql-core';
import { users } from './auth.js';
import { orders } from './orders.js';
import { paymentActorTypeValues, paymentMethodValues, paymentStatusValues } from './enums.js';
const generatedId = () => randomUUID();
export const payments = mysqlTable('payments', {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generatedId),
    orderId: varchar('order_id', { length: 36 })
        .notNull()
        .references(() => orders.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    method: mysqlEnum('method', paymentMethodValues).notNull(),
    status: mysqlEnum('status', paymentStatusValues).notNull().default('UNPAID'),
    amount: decimal('amount', { precision: 10, scale: 2, mode: 'string' }).notNull(),
    referenceNumber: varchar('reference_number', { length: 100 }),
    proofImagePath: varchar('proof_image_path', { length: 255 }),
    providerReference: varchar('provider_reference', { length: 255 }),
    verifiedAt: timestamp('verified_at', { fsp: 3 }),
    verifiedById: varchar('verified_by', { length: 36 }).references(() => users.id, {
        onDelete: 'set null',
        onUpdate: 'cascade',
    }),
    rejectionReason: varchar('rejection_reason', { length: 500 }),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { fsp: 3 }).notNull(),
}, (table) => [
    uniqueIndex('payments_order_id_key').on(table.orderId),
    index('payments_status_created_at_idx').on(table.status, table.createdAt),
]);
export const paymentStatusHistories = mysqlTable('payment_status_histories', {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generatedId),
    paymentId: varchar('payment_id', { length: 36 })
        .notNull()
        .references(() => payments.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    oldStatus: mysqlEnum('old_status', paymentStatusValues),
    newStatus: mysqlEnum('new_status', paymentStatusValues).notNull(),
    actorType: mysqlEnum('actor_type', paymentActorTypeValues).notNull(),
    changedByUserId: varchar('changed_by_user_id', { length: 36 }).references(() => users.id, {
        onDelete: 'set null',
        onUpdate: 'cascade',
    }),
    note: varchar('note', { length: 500 }),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
}, (table) => [
    index('payment_status_histories_payment_id_created_at_idx').on(table.paymentId, table.createdAt),
]);
