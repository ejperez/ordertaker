import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { apiUrl } from './api';
import type { CartLine, ManagedOrder, OrderStatus, PaymentStatus } from './types';

export const cartStorageKey = 'ordertaker-cart-v1';
export const checkoutKeyStorageKey = 'ordertaker-checkout-key-v1';
export const orderStatuses: OrderStatus[] = [
  'PENDING',
  'IN_KITCHEN',
  'OUT_FOR_DELIVERY',
  'READY_FOR_PICKUP',
  'DELIVERED',
  'PICKED_UP',
  'CANCELLED',
];
export const orderStatusLabels: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  IN_KITCHEN: 'In the kitchen',
  OUT_FOR_DELIVERY: 'Out for delivery',
  READY_FOR_PICKUP: 'Ready for pickup',
  DELIVERED: 'Delivered',
  PICKED_UP: 'Picked up',
  CANCELLED: 'Cancelled',
};
export const paymentStatusLabels: Record<PaymentStatus, string> = {
  UNPAID: 'Unpaid',
  AWAITING_VERIFICATION: 'Awaiting verification',
  PAID: 'Paid',
  REJECTED: 'Rejected',
  REFUNDED: 'Refunded',
};

export function nextOrderStatuses(
  order: Pick<ManagedOrder, 'status' | 'fulfillmentType' | 'paymentMethod' | 'payment'>,
): OrderStatus[] {
  const transitions: Record<OrderStatus, OrderStatus[]> = {
    PENDING: [
      ...(order.paymentMethod === 'COD' || order.payment?.status === 'PAID'
        ? (['IN_KITCHEN'] as const)
        : []),
      'CANCELLED',
    ],
    IN_KITCHEN: [
      ...(order.fulfillmentType === 'DELIVERY' ? ['OUT_FOR_DELIVERY' as const] : []),
      ...(order.fulfillmentType === 'PICKUP' ? ['READY_FOR_PICKUP' as const] : []),
      'CANCELLED',
    ],
    OUT_FOR_DELIVERY: ['DELIVERED'],
    READY_FOR_PICKUP: ['PICKED_UP'],
    DELIVERED: [],
    PICKED_UP: [],
    CANCELLED: [],
  };
  return transitions[order.status];
}

export function readCart(): CartLine[] {
  try {
    const stored = window.localStorage.getItem(cartStorageKey);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error('Saved cart is not a list');
    return parsed.filter(
      (item): item is CartLine =>
        typeof item === 'object' &&
        item !== null &&
        'productId' in item &&
        typeof item.productId === 'string' &&
        'quantity' in item &&
        typeof item.quantity === 'number' &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        item.quantity <= 50,
    );
  } catch (error) {
    console.error('Could not read the saved cart:', error);
    return [];
  }
}

export function formatPrice(value: number | string): string {
  return `₱${Number(value).toFixed(2)}`;
}

export function useOwnerRealtime(): boolean {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const socket = io(apiUrl, {
      path: '/api/admin/socket.io',
      withCredentials: true,
      reconnection: true,
      auth: { role: 'owner' },
    });
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-messages'] });
    };
    const onConnect = () => {
      setConnected(true);
      refresh();
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('order:created', refresh);
    socket.on('order:updated', refresh);
    socket.on('payment:updated', refresh);
    socket.on('message:new', refresh);
    return () => {
      socket.disconnect();
    };
  }, [queryClient]);
  return connected;
}

export function useCustomerRealtime(token: string): boolean {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const socket = io(apiUrl, {
      path: '/api/admin/socket.io',
      withCredentials: true,
      reconnection: true,
      auth: { role: 'customer', trackingToken: token },
    });
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['tracked-order', token] });
      void queryClient.invalidateQueries({ queryKey: ['order-messages', 'customer', token] });
    };
    const onConnect = () => {
      setConnected(true);
      refresh();
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('order:updated', refresh);
    socket.on('payment:updated', refresh);
    socket.on('message:new', refresh);
    return () => {
      socket.disconnect();
      setConnected(false);
    };
  }, [queryClient, token]);
  return connected;
}

export function imageData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read the selected image'));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}
