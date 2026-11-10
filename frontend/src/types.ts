export type Owner = { id: string; name: string; email: string };
export type OrderMessage = {
  id: string;
  senderType: 'CUSTOMER' | 'OWNER';
  senderName: string;
  message: string;
  createdAt: string;
};
export type Category = { id: string; name: string; slug: string; sortOrder: number; isActive: boolean };
export type Product = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  categoryId: string;
  imagePath: string | null;
  isAvailable: boolean;
  isArchived: boolean;
  category: { id: string; name: string; slug: string };
};

export type CartLine = { productId: string; quantity: number };
export type StoreInfo = {
  name: string;
  pickupAddress: string;
  pickupInstructions: string;
  deliveryFee: number;
  qrPaymentImage: string | null;
  qrPaymentInstructions: string;
};
export type OrderStatus =
  | 'PENDING'
  | 'IN_KITCHEN'
  | 'OUT_FOR_DELIVERY'
  | 'READY_FOR_PICKUP'
  | 'DELIVERED'
  | 'PICKED_UP'
  | 'CANCELLED';
export type FulfillmentType = 'DELIVERY' | 'PICKUP';
export type PaymentStatus = 'UNPAID' | 'AWAITING_VERIFICATION' | 'PAID' | 'REJECTED' | 'REFUNDED';
export type PaymentActorType = 'CUSTOMER' | 'OWNER' | 'SYSTEM';
export type PaymentHistoryEntry = {
  id: string;
  oldStatus: PaymentStatus | null;
  newStatus: PaymentStatus;
  actorType: PaymentActorType;
  note: string | null;
  createdAt: string;
  changedBy: { name: string } | null;
};
export type PaymentDetails = {
  method: 'COD' | 'QR';
  status: PaymentStatus;
  amount: string;
  referenceNumber: string | null;
  rejectionReason: string | null;
  verifiedAt: string | null;
  verifiedBy: { name: string } | null;
  statusHistory: PaymentHistoryEntry[];
};
export type ManagedOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  fulfillmentType: FulfillmentType;
  block: string | null;
  lot: string | null;
  street: string | null;
  deliveryInstructions: string | null;
  status: OrderStatus;
  paymentMethod: 'COD' | 'QR';
  subtotal: string;
  deliveryFee: string;
  total: string;
  createdAt: string;
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }>;
  payment: PaymentDetails | null;
  statusHistory: Array<{
    id: string;
    oldStatus: OrderStatus | null;
    newStatus: OrderStatus;
    note: string | null;
    createdAt: string;
    changedBy: { name: string } | null;
  }>;
};
export type TrackedPaymentHistoryEntry = Omit<PaymentHistoryEntry, 'id' | 'changedBy'>;
export type TrackedOrder = Omit<ManagedOrder, 'id' | 'items' | 'statusHistory' | 'payment'> & {
  items: Array<Omit<ManagedOrder['items'][number], 'id'>>;
  payment:
    | (Omit<PaymentDetails, 'verifiedBy' | 'statusHistory'> & {
        statusHistory: TrackedPaymentHistoryEntry[];
      })
    | null;
  statusHistory: Array<{
    oldStatus: OrderStatus | null;
    newStatus: OrderStatus;
    note: string | null;
    createdAt: string;
  }>;
  pickupAddress: string | null;
  pickupInstructions: string | null;
};
export type OrderResult =
  | { duplicate: true; orderNumber: string }
  | {
      duplicate: false;
      orderNumber: string;
      trackingUrl: string;
      fulfillmentType: 'DELIVERY' | 'PICKUP';
      paymentMethod: 'COD' | 'QR';
      items: Array<{ productName: string; quantity: number; unitPrice: string; lineTotal: string }>;
      subtotal: string;
      deliveryFee: string;
      total: string;
      qrPaymentImage: string | null;
      qrPaymentInstructions: string;
    };
