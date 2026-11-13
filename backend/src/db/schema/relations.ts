import { relations } from 'drizzle-orm';
import { adminSessions, users } from './auth.js';
import { categories, products } from './catalog.js';
import { messages } from './messaging.js';
import { orderItems, orderStatusHistories, orders } from './orders.js';
import { paymentStatusHistories, payments } from './payments.js';

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(adminSessions),
  verifiedPayments: many(payments, { relationName: 'paymentVerifier' }),
  changedPaymentStatuses: many(paymentStatusHistories, {
    relationName: 'paymentStatusActor',
  }),
  changedOrderStatuses: many(orderStatusHistories, { relationName: 'orderStatusActor' }),
}));

export const adminSessionsRelations = relations(adminSessions, ({ one }) => ({
  user: one(users, { fields: [adminSessions.userId], references: [users.id] }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  orderItems: many(orderItems),
}));

export const ordersRelations = relations(orders, ({ many, one }) => ({
  items: many(orderItems),
  payment: one(payments),
  statusHistory: many(orderStatusHistories),
  messages: many(messages),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

export const orderStatusHistoriesRelations = relations(orderStatusHistories, ({ one }) => ({
  order: one(orders, { fields: [orderStatusHistories.orderId], references: [orders.id] }),
  changedBy: one(users, {
    fields: [orderStatusHistories.changedByUserId],
    references: [users.id],
    relationName: 'orderStatusActor',
  }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
  verifiedBy: one(users, {
    fields: [payments.verifiedById],
    references: [users.id],
    relationName: 'paymentVerifier',
  }),
  statusHistory: many(paymentStatusHistories),
}));

export const paymentStatusHistoriesRelations = relations(paymentStatusHistories, ({ one }) => ({
  payment: one(payments, {
    fields: [paymentStatusHistories.paymentId],
    references: [payments.id],
  }),
  changedBy: one(users, {
    fields: [paymentStatusHistories.changedByUserId],
    references: [users.id],
    relationName: 'paymentStatusActor',
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  order: one(orders, { fields: [messages.orderId], references: [orders.id] }),
}));
