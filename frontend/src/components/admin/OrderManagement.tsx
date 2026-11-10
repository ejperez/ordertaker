import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type CSSProperties } from 'react';
import { apiBlobRequest, apiRequest, jsonBody } from '../../api';
import { ErrorNotice } from '../shared/ErrorNotice';
import { OrderMessages } from '../shared/OrderMessages';
import type { ManagedOrder, OrderStatus, PaymentDetails, PaymentStatus } from '../../types';
import { formatPrice, nextOrderStatuses, orderStatuses, orderStatusLabels, paymentStatusLabels } from '../../utils';

function DraggableOrderCard({
  order,
  onOpen,
  onStatusChange,
}: {
  order: ManagedOrder;
  onOpen: (order: ManagedOrder) => void;
  onStatusChange: (order: ManagedOrder, status: OrderStatus) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: order.id,
  });
  const style: CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};
  const allowedStatuses = nextOrderStatuses(order);

  return (
    <article
      ref={setNodeRef}
      style={{ ...style, opacity: isDragging ? 0.5 : 1 }}
      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-stone-900">{order.orderNumber}</p>
          <p className="mt-1 text-sm text-stone-700">{order.customerName}</p>
          <a className="text-sm text-emerald-900 underline" href={`tel:${order.customerPhone}`}>
            {order.customerPhone}
          </a>
        </div>
        <button
          className="cursor-grab rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 active:cursor-grabbing"
          aria-label={`Drag order ${order.orderNumber}`}
          {...listeners}
          {...attributes}
        >
          Move
        </button>
      </div>
      <p className="mt-3 text-xs text-stone-500">{new Date(order.createdAt).toLocaleString()}</p>
      <p className="mt-2 text-sm font-medium text-stone-700">
        {order.fulfillmentType === 'DELIVERY' ? 'Delivery' : 'Pickup'} ·{' '}
        {order.fulfillmentType === 'DELIVERY'
          ? [order.block && `Block ${order.block}`, order.lot && `Lot ${order.lot}`, order.street]
              .filter(Boolean)
              .join(', ')
          : 'Store pickup'}
      </p>
      <p className="mt-2 line-clamp-2 text-sm text-stone-600">
        {order.items.map((item) => `${item.quantity} × ${item.productName}`).join(', ')}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-stone-900">{formatPrice(order.total)}</span>
        <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-700">
          {order.payment?.method === 'QR' ? 'QR' : 'COD'} ·{' '}
          {order.payment ? paymentStatusLabels[order.payment.status] : 'Pending'}
        </span>
      </div>
      <button
        className="mt-3 text-sm font-semibold text-emerald-900 underline"
        onClick={() => onOpen(order)}
      >
        View details
      </button>
      {allowedStatuses.length > 0 && (
        <label className="mt-3 block text-xs font-medium text-stone-600">
          Update status
          <select
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm"
            value=""
            onChange={(event) => {
              if (event.target.value) onStatusChange(order, event.target.value as OrderStatus);
            }}
          >
            <option value="">Choose next status</option>
            {allowedStatuses.map((status) => (
              <option key={status} value={status}>
                {orderStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
      )}
    </article>
  );
}

function OrderColumn({
  status,
  orders,
  onOpen,
  onStatusChange,
}: {
  status: OrderStatus;
  orders: ManagedOrder[];
  onOpen: (order: ManagedOrder) => void;
  onStatusChange: (order: ManagedOrder, status: OrderStatus) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={`w-72 shrink-0 rounded-xl p-3 transition-colors ${
        isOver ? 'bg-emerald-100' : 'bg-stone-100'
      }`}
      aria-label={`${orderStatusLabels[status]} orders`}
    >
      <h3 className="px-1 pb-3 font-semibold text-stone-800">
        {orderStatusLabels[status]}{' '}
        <span className="text-sm text-stone-500">({orders.length})</span>
      </h3>
      <div className="space-y-3">
        {orders.map((order) => (
          <DraggableOrderCard
            key={order.id}
            order={order}
            onOpen={onOpen}
            onStatusChange={onStatusChange}
          />
        ))}
        {orders.length === 0 && <p className="px-1 py-5 text-sm text-stone-500">No orders</p>}
      </div>
    </section>
  );
}

function OrderDetails({
  order,
  onClose,
  onStatusChange,
}: {
  order: ManagedOrder;
  onClose: () => void;
  onStatusChange: (order: ManagedOrder, status: OrderStatus) => void;
}) {
  const allowedStatuses = nextOrderStatuses(order);
  const paymentProof = useQuery({
    queryKey: ['admin-order-payment-proof', order.id],
    queryFn: () => apiBlobRequest(`/admin/orders/${order.id}/payment-proof`),
    enabled: order.paymentMethod === 'QR',
    retry: false,
  });
  const [paymentProofUrl, setPaymentProofUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!paymentProof.data) {
      setPaymentProofUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(paymentProof.data);
    setPaymentProofUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [paymentProof.data]);

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-stone-950/40 p-0 sm:items-center sm:p-5">
      <section className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-800">
              {order.fulfillmentType === 'DELIVERY' ? 'Delivery' : 'Pickup'} order
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-stone-900">{order.orderNumber}</h2>
          </div>
          <button
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-stone-50 p-4">
            <h3 className="font-semibold text-stone-900">Customer</h3>
            <p className="mt-2 text-sm text-stone-700">{order.customerName}</p>
            <a className="text-sm text-emerald-900 underline" href={`tel:${order.customerPhone}`}>
              {order.customerPhone}
            </a>
          </div>
          <div className="rounded-lg bg-stone-50 p-4">
            <h3 className="font-semibold text-stone-900">Fulfillment</h3>
            <p className="mt-2 text-sm text-stone-700">
              {order.fulfillmentType === 'DELIVERY'
                ? [
                    order.block && `Block ${order.block}`,
                    order.lot && `Lot ${order.lot}`,
                    order.street,
                  ]
                    .filter(Boolean)
                    .join(', ')
                : 'Store pickup'}
            </p>
            {order.deliveryInstructions && (
              <p className="mt-1 text-sm text-stone-600">{order.deliveryInstructions}</p>
            )}
          </div>
        </div>
        <h3 className="mt-6 font-semibold text-stone-900">Items</h3>
        <div className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between gap-3 p-3 text-sm">
              <span className="text-stone-700">
                {item.quantity} × {item.productName}
              </span>
              <span className="font-medium text-stone-900">{formatPrice(item.lineTotal)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between text-sm text-stone-600">
          <span>Subtotal + delivery fee</span>
          <span>
            {formatPrice(order.subtotal)} + {formatPrice(order.deliveryFee)}
          </span>
        </div>
        <div className="mt-2 flex justify-between font-semibold text-stone-900">
          <span>Total</span>
          <span>{formatPrice(order.total)}</span>
        </div>
        <p className="mt-3 text-sm text-stone-700">
          Payment: {order.payment?.method === 'QR' ? 'QR' : 'COD'} ·{' '}
          {order.payment ? paymentStatusLabels[order.payment.status] : 'Pending'}
        </p>
        {order.payment?.referenceNumber && (
          <p className="mt-1 text-sm text-stone-600">
            Reference number: {order.payment.referenceNumber}
          </p>
        )}
        {order.payment?.verifiedAt && (
          <p className="mt-1 text-sm text-stone-600">
            {order.payment.status === 'PAID' ? 'Verified/collected' : 'Reviewed'} by{' '}
            {order.payment.verifiedBy?.name ?? 'owner'} on{' '}
            {new Date(order.payment.verifiedAt).toLocaleString()}
          </p>
        )}
        {order.payment?.rejectionReason && (
          <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            Rejection reason: {order.payment.rejectionReason}
          </p>
        )}
        {order.payment?.statusHistory.length ? (
          <section className="mt-4">
            <h3 className="font-semibold text-stone-900">Payment audit history</h3>
            <ol className="mt-2 space-y-2">
              {order.payment.statusHistory.map((entry) => (
                <li key={entry.id} className="text-sm text-stone-600">
                  <span className="font-medium text-stone-800">
                    {paymentStatusLabels[entry.newStatus]}
                  </span>
                  {' · '}
                  {entry.actorType === 'OWNER'
                    ? (entry.changedBy?.name ?? 'Owner')
                    : entry.actorType === 'CUSTOMER'
                      ? 'Customer'
                      : 'System'}
                  {' · '}
                  {new Date(entry.createdAt).toLocaleString()}
                  {entry.note ? ` · ${entry.note}` : ''}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        {order.payment && <PaymentReviewControls order={order} onComplete={onClose} />}
        {order.paymentMethod === 'QR' &&
          order.payment?.status !== 'PAID' &&
          order.status === 'PENDING' && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              QR payment must be verified before this order can enter the kitchen.
            </p>
          )}
        {order.paymentMethod === 'QR' && (
          <section className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-4">
            <h3 className="font-semibold text-stone-900">Payment receipt</h3>
            {paymentProof.isPending ? (
              <p className="mt-2 text-sm text-stone-600">Loading receipt…</p>
            ) : paymentProofUrl ? (
              <a
                className="mt-3 inline-block"
                href={paymentProofUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open payment receipt for ${order.orderNumber} in a new tab`}
              >
                <img
                  className="max-h-96 max-w-full rounded-lg border border-stone-200 bg-white object-contain"
                  src={paymentProofUrl}
                  alt={`QR payment receipt for order ${order.orderNumber}`}
                />
                <span className="mt-2 block text-sm font-medium text-emerald-900 underline">
                  Open receipt full size
                </span>
              </a>
            ) : (
              <ErrorNotice
                error={paymentProof.error ?? new Error('Payment receipt is unavailable.')}
              />
            )}
          </section>
        )}
        <h3 className="mt-6 font-semibold text-stone-900">Status history</h3>
        <ol className="mt-3 space-y-3">
          {order.statusHistory.map((entry) => (
            <li key={entry.id} className="text-sm">
              <span className="font-medium text-stone-800">
                {orderStatusLabels[entry.newStatus]}
              </span>
              <span className="text-stone-500">
                {' '}
                · {new Date(entry.createdAt).toLocaleString()}
                {entry.changedBy ? ` · ${entry.changedBy.name}` : ''}
                {entry.note ? ` · ${entry.note}` : ''}
              </span>
            </li>
          ))}
        </ol>
        <OrderMessages side="owner" orderId={order.id} />
        {allowedStatuses.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {allowedStatuses.map((status) => (
              <button
                key={status}
                className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white"
                onClick={() => onStatusChange(order, status)}
              >
                {orderStatusLabels[status]}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PaymentReviewControls({
  order,
  onComplete,
}: {
  order: ManagedOrder;
  onComplete: () => void;
}) {
  const queryClient = useQueryClient();
  const [rejectionReason, setRejectionReason] = useState('');
  const review = useMutation({
    mutationFn: ({ status, reason }: { status: 'PAID' | 'REJECTED'; reason?: string }) =>
      apiRequest<PaymentDetails>(`/admin/orders/${order.id}/payment`, {
        method: 'PATCH',
        body: jsonBody({ status, ...(reason ? { rejectionReason: reason } : {}) }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      onComplete();
    },
  });
  const canReviewQr =
    order.payment?.method === 'QR' && order.payment.status === 'AWAITING_VERIFICATION';
  const canCollectCod = order.payment?.method === 'COD' && order.payment.status === 'UNPAID';

  if (!canReviewQr && !canCollectCod) return null;

  return (
    <section className="mt-4 rounded-lg border border-stone-200 p-4">
      <h3 className="font-semibold text-stone-900">
        {canReviewQr ? 'Review QR payment' : 'Cash collection'}
      </h3>
      {canReviewQr && (
        <label className="mt-3 block text-sm font-medium text-stone-700">
          Rejection reason (required to reject)
          <textarea
            className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2"
            rows={2}
            maxLength={500}
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
          />
        </label>
      )}
      <ErrorNotice error={review.error} />
      <div className="mt-3 flex flex-wrap gap-2">
        {canReviewQr && (
          <>
            <button
              className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={review.isPending}
              onClick={() => review.mutate({ status: 'PAID' })}
            >
              Approve payment
            </button>
            <button
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-50"
              disabled={review.isPending || !rejectionReason.trim()}
              onClick={() => review.mutate({ status: 'REJECTED', reason: rejectionReason.trim() })}
            >
              Reject payment
            </button>
          </>
        )}
        {canCollectCod && (
          <button
            className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={review.isPending}
            onClick={() => review.mutate({ status: 'PAID' })}
          >
            Mark cash collected
          </button>
        )}
      </div>
    </section>
  );
}

export function AdminOrdersBoard() {
  const queryClient = useQueryClient();
  const [fulfillment, setFulfillment] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<ManagedOrder | null>(null);
  const params = new URLSearchParams();
  if (fulfillment) params.set('fulfillmentType', fulfillment);
  if (paymentStatus) params.set('paymentStatus', paymentStatus);
  if (statusFilter) params.set('status', statusFilter);
  if (fromDate) params.set('from', new Date(`${fromDate}T00:00:00`).toISOString());
  if (toDate) params.set('to', new Date(`${toDate}T23:59:59.999`).toISOString());
  const queryString = params.toString();
  const orders = useQuery({
    queryKey: ['admin-orders', queryString],
    queryFn: () =>
      apiRequest<ManagedOrder[]>(`/admin/orders${queryString ? `?${queryString}` : ''}`),
    refetchInterval: 30_000,
  });
  const updateStatus = useMutation({
    mutationFn: ({ order, status }: { order: ManagedOrder; status: OrderStatus }) =>
      apiRequest<ManagedOrder>(`/admin/orders/${order.id}/status`, {
        method: 'PATCH',
        body: jsonBody({ status }),
      }),
    onSuccess: async () => {
      setSelectedOrder(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const order = orders.data?.find((item) => item.id === event.active.id);
    const status = String(event.over.id) as OrderStatus;
    if (order && orderStatuses.includes(status) && nextOrderStatuses(order).includes(status)) {
      updateStatus.mutate({ order, status });
    }
  }

  return (
    <section className="mt-5">
      <div className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-medium text-stone-600">
          Status
          <select
            className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {orderStatuses.map((status) => (
              <option key={status} value={status}>
                {orderStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-stone-600">
          Fulfillment
          <select
            className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm"
            value={fulfillment}
            onChange={(event) => setFulfillment(event.target.value)}
          >
            <option value="">Delivery and pickup</option>
            <option value="DELIVERY">Delivery</option>
            <option value="PICKUP">Pickup</option>
          </select>
        </label>
        <label className="text-xs font-medium text-stone-600">
          Payment
          <select
            className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm"
            value={paymentStatus}
            onChange={(event) => setPaymentStatus(event.target.value)}
          >
            <option value="">All payment states</option>
            {(['UNPAID', 'AWAITING_VERIFICATION', 'PAID', 'REJECTED', 'REFUNDED'] as const).map(
              (status) => (
                <option key={status} value={status}>
                  {paymentStatusLabels[status]}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="text-xs font-medium text-stone-600">
          From
          <input
            className="mt-1 block w-full rounded-lg border border-stone-300 p-2 text-sm"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </label>
        <label className="text-xs font-medium text-stone-600">
          To
          <input
            className="mt-1 block w-full rounded-lg border border-stone-300 p-2 text-sm"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </label>
      </div>
      <ErrorNotice error={orders.error ?? updateStatus.error} />
      {orders.isPending ? (
        <p className="py-8 text-stone-600">Loading orders…</p>
      ) : (
        <DndContext onDragEnd={onDragEnd}>
          <div className="mt-5 flex items-start gap-4 overflow-x-auto pb-5">
            {orderStatuses.map((status) => (
              <OrderColumn
                key={status}
                status={status}
                orders={orders.data?.filter((order) => order.status === status) ?? []}
                onOpen={setSelectedOrder}
                onStatusChange={(order, nextStatus) =>
                  updateStatus.mutate({ order, status: nextStatus })
                }
              />
            ))}
          </div>
        </DndContext>
      )}
      {selectedOrder && (
        <OrderDetails
          key={selectedOrder.id}
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStatusChange={(order, status) => updateStatus.mutate({ order, status })}
        />
      )}
    </section>
  );
}

export function AdminPaymentsReview() {
  const queryClient = useQueryClient();
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | ''>('AWAITING_VERIFICATION');
  const [selectedOrder, setSelectedOrder] = useState<ManagedOrder | null>(null);
  const queryString = paymentFilter ? `?paymentStatus=${paymentFilter}` : '';
  const orders = useQuery({
    queryKey: ['admin-orders', 'payment-review', paymentFilter],
    queryFn: () => apiRequest<ManagedOrder[]>(`/admin/orders${queryString}`),
    refetchInterval: 30_000,
  });
  const updateStatus = useMutation({
    mutationFn: ({ order, status }: { order: ManagedOrder; status: OrderStatus }) =>
      apiRequest<ManagedOrder>(`/admin/orders/${order.id}/status`, {
        method: 'PATCH',
        body: jsonBody({ status }),
      }),
    onSuccess: async () => {
      setSelectedOrder(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });

  return (
    <section className="mt-5">
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <label className="block max-w-sm text-xs font-medium text-stone-600">
          Payment status
          <select
            className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm"
            value={paymentFilter}
            onChange={(event) => setPaymentFilter(event.target.value as PaymentStatus | '')}
          >
            <option value="AWAITING_VERIFICATION">Awaiting QR verification</option>
            <option value="UNPAID">Unpaid COD</option>
            <option value="PAID">Paid / collected</option>
            <option value="REJECTED">Rejected QR payments</option>
            <option value="REFUNDED">Refunded</option>
            <option value="">All payment statuses</option>
          </select>
        </label>
      </div>
      <ErrorNotice error={orders.error ?? updateStatus.error} />
      {orders.isPending ? (
        <p className="py-8 text-stone-600">Loading payments…</p>
      ) : orders.data?.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {orders.data.map((order) => (
            <article key={order.id} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold text-stone-900">{order.orderNumber}</h2>
                  <p className="mt-1 text-sm text-stone-700">{order.customerName}</p>
                  <p className="text-sm text-stone-500">
                    {order.payment?.method === 'QR' ? 'QR payment' : 'Cash on delivery / pickup'}
                  </p>
                </div>
                <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-700">
                  {order.payment ? paymentStatusLabels[order.payment.status] : 'No payment'}
                </span>
              </div>
              <p className="mt-3 font-semibold text-stone-900">{formatPrice(order.total)}</p>
              {order.payment?.referenceNumber && (
                <p className="mt-2 text-sm text-stone-600">
                  Reference: {order.payment.referenceNumber}
                </p>
              )}
              {order.payment?.verifiedAt && (
                <p className="mt-1 text-xs text-stone-500">
                  Reviewed {new Date(order.payment.verifiedAt).toLocaleString()}
                  {order.payment.verifiedBy ? ` by ${order.payment.verifiedBy.name}` : ''}
                </p>
              )}
              <button
                className="mt-4 rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-emerald-900"
                onClick={() => setSelectedOrder(order)}
              >
                Review payment
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">
          No payments match this filter.
        </p>
      )}
      {selectedOrder && (
        <OrderDetails
          key={selectedOrder.id}
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStatusChange={(order, status) => updateStatus.mutate({ order, status })}
        />
      )}
    </section>
  );
}
