import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../../api';
import type { StoreInfo, TrackedOrder } from '../../types';
import {
  formatPrice,
  orderStatusLabels,
  paymentStatusLabels,
  useCustomerRealtime,
} from '../../utils';
import { ErrorNotice } from '../shared/ErrorNotice';
import { OrderMessages } from '../shared/OrderMessages';
import { PaymentResubmission } from '../shared/PaymentResubmission';

export function TrackingLinkPage() {
  const { token = '' } = useParams();
  const realtimeConnected = useCustomerRealtime(token);
  const order = useQuery({
    queryKey: ['tracked-order', token],
    queryFn: () => apiRequest<TrackedOrder>(`/orders/track/${encodeURIComponent(token)}`),
    retry: false,
    enabled: /^[A-Za-z0-9_-]{43}$/.test(token),
    refetchInterval: 30_000,
  });
  const store = useQuery({
    queryKey: ['store'],
    queryFn: () => apiRequest<StoreInfo>('/store'),
  });
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <ErrorNotice error={new Error('This tracking link is invalid.')} />
      </main>
    );
  }
  if (order.isPending) {
    return <main className="mx-auto max-w-2xl px-6 py-20 text-stone-600">Loading your order…</main>;
  }
  if (order.error || !order.data) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <ErrorNotice error={order.error ?? new Error('Order not found.')} />
        <Link className="mt-5 inline-block text-emerald-900 underline" to="/">
          Return to the menu
        </Link>
      </main>
    );
  }
  const data = order.data;
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-10 sm:px-8">
      <header className="flex items-center justify-between border-b border-stone-200 pb-5">
        <Link to="/" className="text-sm font-bold uppercase tracking-[0.16em] text-emerald-900">
          {store ? store?.data?.name : 'Ordertaker'}
        </Link>
        <span className="text-sm text-stone-500">Order tracking</span>
      </header>
      {!realtimeConnected && (
        <p className="mt-4 text-xs text-stone-500" role="status">
          Live updates are reconnecting; this page will continue refreshing.
        </p>
      )}
      <section className="mt-8 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-800">
          {data.fulfillmentType === 'DELIVERY' ? 'Delivery order' : 'Pickup order'}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-stone-900">{data.orderNumber}</h1>
        <p className="mt-2 text-sm text-stone-500">
          Placed {new Date(data.createdAt).toLocaleString()}
        </p>
        <div className="mt-6 rounded-xl bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-900">Current status</p>
          <p className="mt-1 text-xl font-semibold text-emerald-950">
            {orderStatusLabels[data.status]}
          </p>
        </div>
        <h2 className="mt-8 text-lg font-semibold text-stone-900">Status timeline</h2>
        <ol className="mt-4 space-y-4">
          {data.statusHistory.map((entry, index) => (
            <li key={`${entry.newStatus}-${entry.createdAt}-${index}`} className="flex gap-3">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-700" />
              <div>
                <p className="font-medium text-stone-900">{orderStatusLabels[entry.newStatus]}</p>
                <p className="text-sm text-stone-500">
                  {new Date(entry.createdAt).toLocaleString()}
                  {entry.note ? ` · ${entry.note}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <h2 className="mt-8 text-lg font-semibold text-stone-900">Order summary</h2>
        <div className="mt-3 divide-y divide-stone-100 rounded-xl border border-stone-200">
          {data.items.map((item, index) => (
            <div key={`${item.productName}-${index}`} className="flex justify-between gap-4 p-4">
              <span className="text-stone-700">
                {item.quantity} × {item.productName}
              </span>
              <span className="font-medium text-stone-900">{formatPrice(item.lineTotal)}</span>
            </div>
          ))}
          <div className="flex justify-between p-4 text-sm text-stone-600">
            <span>Subtotal</span>
            <span>{formatPrice(data.subtotal)}</span>
          </div>
          <div className="flex justify-between p-4 text-sm text-stone-600">
            <span>Delivery fee</span>
            <span>{formatPrice(data.deliveryFee)}</span>
          </div>
          <div className="flex justify-between p-4 font-semibold text-stone-900">
            <span>Total</span>
            <span>{formatPrice(data.total)}</span>
          </div>
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <h2 className="font-semibold text-stone-900">Fulfillment</h2>
            <p className="mt-1 text-sm text-stone-600">
              {data.fulfillmentType === 'DELIVERY'
                ? [data.block && `Block ${data.block}`, data.lot && `Lot ${data.lot}`, data.street]
                    .filter(Boolean)
                    .join(', ')
                : data.pickupAddress || 'Pickup'}
            </p>
            {data.deliveryInstructions && (
              <p className="mt-1 text-sm text-stone-600">{data.deliveryInstructions}</p>
            )}
            {data.fulfillmentType === 'PICKUP' && data.pickupInstructions && (
              <p className="mt-1 text-sm text-stone-600">{data.pickupInstructions}</p>
            )}
          </div>
          <div>
            <h2 className="font-semibold text-stone-900">Payment</h2>
            <p className="mt-1 text-sm text-stone-600">
              {data.payment?.method === 'QR' ? 'QR payment' : 'Cash on delivery / pickup'}
              {' · '}
              {data.payment ? paymentStatusLabels[data.payment.status] : 'Pending'}
            </p>
            {data.payment?.referenceNumber && (
              <p className="mt-1 text-sm text-stone-600">
                Reference: {data.payment.referenceNumber}
              </p>
            )}
            {data.payment?.verifiedAt && (
              <p className="mt-1 text-sm text-stone-600">
                {data.payment.status === 'PAID' ? 'Verified' : 'Reviewed'}{' '}
                {new Date(data.payment.verifiedAt).toLocaleString()}
              </p>
            )}
            {data.payment?.rejectionReason && (
              <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                Receipt not accepted: {data.payment.rejectionReason}
              </p>
            )}
            {data.payment?.statusHistory.length ? (
              <ol className="mt-3 space-y-2 border-l border-stone-200 pl-3">
                {data.payment.statusHistory.map((entry, index) => (
                  <li
                    key={`${entry.newStatus}-${entry.createdAt}-${index}`}
                    className="text-xs text-stone-500"
                  >
                    {paymentStatusLabels[entry.newStatus]} ·{' '}
                    {new Date(entry.createdAt).toLocaleString()}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </li>
                ))}
              </ol>
            ) : null}
            {data.payment?.method === 'QR' && data.payment.status === 'REJECTED' && (
              <PaymentResubmission
                token={token}
                instructions={store.data?.qrPaymentInstructions ?? ''}
              />
            )}
          </div>
        </div>
        <OrderMessages side="customer" trackingToken={token} />
      </section>
    </main>
  );
}
