export const userRoleValues = ['OWNER'] as const;
export const fulfillmentTypeValues = ['DELIVERY', 'PICKUP'] as const;
export const orderStatusValues = [
  'PENDING',
  'IN_KITCHEN',
  'OUT_FOR_DELIVERY',
  'READY_FOR_PICKUP',
  'DELIVERED',
  'PICKED_UP',
  'CANCELLED',
] as const;
export const paymentMethodValues = ['COD', 'QR'] as const;
export const paymentStatusValues = [
  'UNPAID',
  'AWAITING_VERIFICATION',
  'PAID',
  'REJECTED',
  'REFUNDED',
] as const;
export const paymentActorTypeValues = ['CUSTOMER', 'OWNER', 'SYSTEM'] as const;
export const messageSenderTypeValues = ['CUSTOMER', 'OWNER'] as const;

export type OrderStatus = (typeof orderStatusValues)[number];
export type PaymentStatus = (typeof paymentStatusValues)[number];
