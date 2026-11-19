import { pgEnum } from 'drizzle-orm/pg-core';
export const userRole = pgEnum('UserRole', ['OWNER']);
export const fulfillmentType = pgEnum('FulfillmentType', ['DELIVERY', 'PICKUP']);
export const orderStatus = pgEnum('OrderStatus', [
    'PENDING',
    'IN_KITCHEN',
    'OUT_FOR_DELIVERY',
    'READY_FOR_PICKUP',
    'DELIVERED',
    'PICKED_UP',
    'CANCELLED',
]);
export const paymentMethod = pgEnum('PaymentMethod', ['COD', 'QR']);
export const paymentStatus = pgEnum('PaymentStatus', [
    'UNPAID',
    'AWAITING_VERIFICATION',
    'PAID',
    'REJECTED',
    'REFUNDED',
]);
export const paymentActorType = pgEnum('PaymentActorType', ['CUSTOMER', 'OWNER', 'SYSTEM']);
export const messageSenderType = pgEnum('MessageSenderType', ['CUSTOMER', 'OWNER']);
