import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { apiBlobRequest, apiRequest, apiUrl, jsonBody } from './api';

type Owner = { id: string; name: string; email: string };
type OrderMessage = {
  id: string;
  senderType: 'CUSTOMER' | 'OWNER';
  senderName: string;
  message: string;
  createdAt: string;
};
type Category = { id: string; name: string; slug: string; sortOrder: number; isActive: boolean };
type Product = {
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

type CartLine = { productId: string; quantity: number };
type StoreInfo = {
  name: string;
  pickupAddress: string;
  pickupInstructions: string;
  deliveryFee: number;
  qrPaymentImage: string | null;
  qrPaymentInstructions: string;
};
type OrderStatus =
  | 'PENDING'
  | 'IN_KITCHEN'
  | 'OUT_FOR_DELIVERY'
  | 'READY_FOR_PICKUP'
  | 'DELIVERED'
  | 'PICKED_UP'
  | 'CANCELLED';
type FulfillmentType = 'DELIVERY' | 'PICKUP';
type PaymentStatus = 'UNPAID' | 'AWAITING_VERIFICATION' | 'PAID' | 'REJECTED' | 'REFUNDED';
type PaymentActorType = 'CUSTOMER' | 'OWNER' | 'SYSTEM';
type PaymentHistoryEntry = {
  id: string;
  oldStatus: PaymentStatus | null;
  newStatus: PaymentStatus;
  actorType: PaymentActorType;
  note: string | null;
  createdAt: string;
  changedBy: { name: string } | null;
};
type PaymentDetails = {
  method: 'COD' | 'QR';
  status: PaymentStatus;
  amount: string;
  referenceNumber: string | null;
  rejectionReason: string | null;
  verifiedAt: string | null;
  verifiedBy: { name: string } | null;
  statusHistory: PaymentHistoryEntry[];
};
type ManagedOrder = {
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
type TrackedPaymentHistoryEntry = Omit<PaymentHistoryEntry, 'id' | 'changedBy'>;
type TrackedOrder = Omit<ManagedOrder, 'id' | 'items' | 'statusHistory' | 'payment'> & {
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
type OrderResult =
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

const cartStorageKey = 'ordertaker-cart-v1';
const checkoutKeyStorageKey = 'ordertaker-checkout-key-v1';
const orderStatuses: OrderStatus[] = [
  'PENDING',
  'IN_KITCHEN',
  'OUT_FOR_DELIVERY',
  'READY_FOR_PICKUP',
  'DELIVERED',
  'PICKED_UP',
  'CANCELLED',
];
const orderStatusLabels: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  IN_KITCHEN: 'In the kitchen',
  OUT_FOR_DELIVERY: 'Out for delivery',
  READY_FOR_PICKUP: 'Ready for pickup',
  DELIVERED: 'Delivered',
  PICKED_UP: 'Picked up',
  CANCELLED: 'Cancelled',
};
const paymentStatusLabels: Record<PaymentStatus, string> = {
  UNPAID: 'Unpaid',
  AWAITING_VERIFICATION: 'Awaiting verification',
  PAID: 'Paid',
  REJECTED: 'Rejected',
  REFUNDED: 'Refunded',
};

function nextOrderStatuses(
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

function readCart(): CartLine[] {
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

function formatPrice(value: number | string): string {
  return `₱${Number(value).toFixed(2)}`;
}

function ErrorNotice({ error }: { error: unknown }) {
  if (!(error instanceof Error)) return null;
  return (
    <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      {error.message}
    </p>
  );
}

function useOwnerRealtime(): boolean {
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

function useCustomerRealtime(token: string): boolean {
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

function HomePage({
  cart,
  addToCart,
  updateQuantity,
  cartStorageError,
}: {
  cart: CartLine[];
  addToCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  cartStorageError: string | null;
}) {
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiRequest<Category[]>('/categories'),
  });
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => apiRequest<Product[]>('/products'),
  });
  const [categoryFilter, setCategoryFilter] = useState('all');
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const visibleProducts =
    products.data?.filter(
      (product) => categoryFilter === 'all' || product.categoryId === categoryFilter,
    ) ?? [];
  const productGroups =
    categories.data
      ?.map((category) => ({
        category,
        products: visibleProducts.filter((product) => product.categoryId === category.id),
      }))
      .filter((group) => group.products.length > 0) ?? [];

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-10 sm:px-8">
      <header className="flex items-center justify-between border-b border-stone-200 pb-6">
        <Link to="/" className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-900">
          Neighborhood Coffee &amp; Pasta
        </Link>
        <div className="flex items-center gap-4">
          <Link
            to="/checkout"
            className="rounded-full bg-emerald-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Cart ({cartCount})
          </Link>
          <Link to="/admin" className="text-sm font-semibold text-stone-600 hover:text-emerald-900">
            Owner sign in
          </Link>
        </div>
      </header>
      <section className="py-14 sm:py-20">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-800">
          Made nearby, made with care
        </p>
        <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight text-stone-900 sm:text-6xl">
          Good food, close to home.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-8 text-stone-600">
          Browse today’s coffee and pasta selection from your neighborhood kitchen.
        </p>
      </section>

      <section aria-labelledby="menu-heading">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-800">
              The menu
            </p>
            <h2 id="menu-heading" className="mt-2 text-3xl font-semibold text-stone-900">
              Fresh from our kitchen
            </h2>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Filter menu by category">
            <button
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                categoryFilter === 'all'
                  ? 'bg-emerald-900 text-white'
                  : 'bg-white text-stone-700 ring-1 ring-stone-200'
              }`}
              onClick={() => setCategoryFilter('all')}
            >
              All
            </button>
            {categories.data?.map((category) => (
              <button
                key={category.id}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  categoryFilter === category.id
                    ? 'bg-emerald-900 text-white'
                    : 'bg-white text-stone-700 ring-1 ring-stone-200'
                }`}
                onClick={() => setCategoryFilter(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>

        <ErrorNotice error={categories.error ?? products.error} />
        {cartStorageError && <ErrorNotice error={new Error(cartStorageError)} />}
        {products.isPending ? (
          <p className="py-12 text-stone-600">Loading the menu…</p>
        ) : visibleProducts.length ? (
          <div className="mt-8 space-y-10">
            {productGroups.map(({ category, products: groupProducts }) => (
              <section key={category.id} aria-labelledby={`category-${category.id}`}>
                <h3
                  id={`category-${category.id}`}
                  className="mb-4 text-xl font-semibold text-stone-900"
                >
                  {category.name}
                </h3>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {groupProducts.map((product) => (
                    <article
                      key={product.id}
                      className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"
                    >
                      {product.imagePath ? (
                        <img
                          className="h-52 w-full bg-stone-100 object-cover"
                          src={`${apiUrl}${product.imagePath}`}
                          alt={product.name}
                        />
                      ) : (
                        <div
                          className="flex h-52 items-center justify-center bg-emerald-50 text-4xl text-emerald-900"
                          aria-hidden="true"
                        >
                          {product.category.name === 'Coffee' ? '☕' : '🍽'}
                        </div>
                      )}
                      <div className="p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
                          {product.category.name}
                        </p>
                        <div className="mt-2 flex items-start justify-between gap-4">
                          <h3 className="text-lg font-semibold text-stone-900">{product.name}</h3>
                          <span className="shrink-0 font-semibold text-stone-900">
                            ₱{Number(product.price).toFixed(2)}
                          </span>
                        </div>
                        {product.description && (
                          <p className="mt-2 text-sm leading-6 text-stone-600">
                            {product.description}
                          </p>
                        )}
                        {!product.isAvailable && (
                          <p className="mt-3 text-sm font-semibold text-amber-800">
                            Currently unavailable
                          </p>
                        )}
                        <div className="mt-4 flex items-center justify-between gap-3">
                          {cart.some((item) => item.productId === product.id) && (
                            <div className="flex items-center gap-2 text-sm">
                              <button
                                className="h-8 w-8 rounded-full border border-stone-300"
                                aria-label={`Decrease ${product.name} quantity`}
                                onClick={() =>
                                  updateQuantity(
                                    product.id,
                                    (cart.find((item) => item.productId === product.id)?.quantity ??
                                      1) - 1,
                                  )
                                }
                              >
                                −
                              </button>
                              <span>
                                {cart.find((item) => item.productId === product.id)?.quantity}
                              </span>
                              <button
                                className="h-8 w-8 rounded-full border border-stone-300"
                                aria-label={`Increase ${product.name} quantity`}
                                disabled={
                                  (cart.find((item) => item.productId === product.id)?.quantity ??
                                    0) >= 50
                                }
                                onClick={() =>
                                  updateQuantity(
                                    product.id,
                                    (cart.find((item) => item.productId === product.id)?.quantity ??
                                      0) + 1,
                                  )
                                }
                              >
                                +
                              </button>
                            </div>
                          )}
                          <button
                            className="rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
                            disabled={!product.isAvailable}
                            onClick={() => addToCart(product.id)}
                          >
                            {cart.some((item) => item.productId === product.id)
                              ? 'Add another'
                              : 'Add to cart'}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <p className="mt-8 rounded-xl bg-white p-8 text-center text-stone-600">
            {products.error
              ? 'The menu could not be loaded.'
              : 'There are no available items right now.'}
          </p>
        )}
      </section>
    </main>
  );
}

function CheckoutPage({
  cart,
  updateQuantity,
  removeFromCart,
  onOrderPlaced,
  cartStorageError,
}: {
  cart: CartLine[];
  updateQuantity: (productId: string, quantity: number) => void;
  removeFromCart: (productId: string) => void;
  onOrderPlaced: () => void;
  cartStorageError: string | null;
}) {
  const queryClient = useQueryClient();
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => apiRequest<Product[]>('/products'),
  });
  const store = useQuery({
    queryKey: ['store'],
    queryFn: () => apiRequest<StoreInfo>('/store'),
  });
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [block, setBlock] = useState('');
  const [lot, setLot] = useState('');
  const [street, setStreet] = useState('');
  const [deliveryInstructions, setDeliveryInstructions] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'COD' | 'QR'>('COD');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [paymentReceipt, setPaymentReceipt] = useState<File | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  const productById = new Map((products.data ?? []).map((product) => [product.id, product]));
  const cartProducts = cart.map((line) => ({ line, product: productById.get(line.productId) }));
  const hasUnavailableItems = cartProducts.some(({ product }) => !product || !product.isAvailable);
  const subtotal = cartProducts.reduce((sum, { line, product }) => {
    if (!product) return sum;
    return sum + Math.round(Number(product.price) * 100) * line.quantity;
  }, 0);
  const deliveryFee =
    fulfillmentType === 'DELIVERY' && store.data
      ? Math.round(Number(store.data.deliveryFee) * 100)
      : 0;

  const submitOrder = useMutation({
    mutationFn: async () => {
      if (paymentMethod === 'QR' && !paymentReceipt) {
        throw new Error('Upload your QR payment receipt before placing the order.');
      }
      if (paymentReceipt && paymentReceipt.size > 5 * 1024 * 1024) {
        throw new Error('Choose a payment receipt image smaller than 5 MB.');
      }
      if (!idempotencyKey.current) {
        const savedKey = window.localStorage.getItem(checkoutKeyStorageKey);
        idempotencyKey.current =
          savedKey &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(savedKey)
            ? savedKey
            : crypto.randomUUID();
        window.localStorage.setItem(checkoutKeyStorageKey, idempotencyKey.current);
      }
      return apiRequest<OrderResult>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current },
        body: jsonBody({
          customerName,
          customerPhone,
          fulfillmentType,
          ...(fulfillmentType === 'DELIVERY' ? { block, lot, street, deliveryInstructions } : {}),
          paymentMethod,
          ...(paymentMethod === 'QR' ? { referenceNumber } : {}),
          ...(paymentMethod === 'QR' && paymentReceipt
            ? { paymentReceipt: { data: await imageData(paymentReceipt) } }
            : {}),
          items: cart.map(({ productId, quantity }) => ({ productId, quantity })),
        }),
      });
    },
    onSuccess: (order) => {
      setResult(order);
      onOrderPlaced();
    },
    onError: async (error) => {
      if (
        error instanceof Error &&
        (error.message.includes('no longer available') || error.message.includes('menu changed'))
      ) {
        await queryClient.invalidateQueries({ queryKey: ['products'] });
      }
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitOrder.mutate();
  }

  if (result) {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-5 py-10 sm:px-8">
        <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-9">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-800">
            {result.duplicate ? 'Order already received' : 'Thank you for your order'}
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-stone-900">Order {result.orderNumber}</h1>
          {result.duplicate ? (
            <p className="mt-4 leading-7 text-stone-600">
              This checkout was already submitted, so we did not create another order. If you did
              not save the tracking link from the first confirmation, please contact the store.
            </p>
          ) : (
            <>
              <p className="mt-4 leading-7 text-stone-600">
                Your {result.fulfillmentType.toLowerCase()} order has been received. Keep the
                private tracking link below to check for order updates.
              </p>
              <div className="mt-6 divide-y divide-stone-100 rounded-xl border border-stone-200">
                {result.items.map((item, index) => (
                  <div
                    key={`${item.productName}-${index}`}
                    className="flex justify-between gap-4 p-4"
                  >
                    <span className="text-stone-700">
                      {item.quantity} × {item.productName}
                    </span>
                    <span className="font-medium text-stone-900">
                      {formatPrice(item.lineTotal)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between p-4 text-sm text-stone-600">
                  <span>Subtotal</span>
                  <span>{formatPrice(result.subtotal)}</span>
                </div>
                <div className="flex justify-between p-4 text-sm text-stone-600">
                  <span>Delivery fee</span>
                  <span>{formatPrice(result.deliveryFee)}</span>
                </div>
                <div className="flex justify-between p-4 font-semibold text-stone-900">
                  <span>Total</span>
                  <span>{formatPrice(result.total)}</span>
                </div>
              </div>
              {result.paymentMethod === 'QR' && (
                <div className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
                  <h2 className="font-semibold">Payment receipt received</h2>
                  <p className="mt-2">
                    Your receipt was submitted with the order and is awaiting verification.
                  </p>
                </div>
              )}
              <Link
                className="mt-6 inline-flex rounded-lg bg-emerald-900 px-4 py-3 font-semibold text-white"
                to={result.trackingUrl}
              >
                View order tracking
              </Link>
            </>
          )}
          <Link className="mt-5 block text-sm font-semibold text-emerald-900 underline" to="/">
            Return to the menu
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 pb-5">
        <Link to="/" className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-900">
          Neighborhood Coffee &amp; Pasta
        </Link>
        <Link to="/" className="text-sm font-semibold text-emerald-900">
          ← Continue shopping
        </Link>
      </header>
      <h1 className="mt-8 text-3xl font-semibold text-stone-900">Guest checkout</h1>
      {cartStorageError && <ErrorNotice error={new Error(cartStorageError)} />}
      <ErrorNotice error={products.error ?? store.error ?? submitOrder.error} />
      {cart.length === 0 ? (
        <section className="mt-6 rounded-xl bg-white p-8 text-center">
          <p className="text-stone-600">Your cart is empty.</p>
          <Link className="mt-4 inline-block font-semibold text-emerald-900 underline" to="/">
            Browse the menu
          </Link>
        </section>
      ) : (
        <div className="mt-6 grid items-start gap-8 lg:grid-cols-[1fr_0.85fr]">
          <div className="space-y-6">
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="text-xl font-semibold text-stone-900">Your cart</h2>
              <div className="mt-4 divide-y divide-stone-100">
                {cartProducts.map(({ line, product }) => (
                  <div
                    key={line.productId}
                    className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-36 flex-1">
                      <p className="font-medium text-stone-900">
                        {product?.name ?? 'Menu item unavailable'}
                      </p>
                      <p className="mt-1 text-sm text-stone-500">
                        {product
                          ? `${formatPrice(product.price)} each · ${formatPrice(Number(product.price) * line.quantity)}`
                          : 'No longer on the menu'}
                        {product && !product.isAvailable ? ' · Unavailable' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="h-8 w-8 rounded-full border border-stone-300"
                        aria-label={`Decrease ${product?.name ?? 'item'} quantity`}
                        onClick={() => updateQuantity(line.productId, line.quantity - 1)}
                      >
                        −
                      </button>
                      <span className="min-w-5 text-center">{line.quantity}</span>
                      <button
                        className="h-8 w-8 rounded-full border border-stone-300 disabled:opacity-40"
                        aria-label={`Increase ${product?.name ?? 'item'} quantity`}
                        disabled={line.quantity >= 50}
                        onClick={() => updateQuantity(line.productId, line.quantity + 1)}
                      >
                        +
                      </button>
                      <button
                        className="ml-2 text-sm text-red-800 underline"
                        onClick={() => removeFromCart(line.productId)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex justify-between border-t border-stone-200 pt-4 font-semibold text-stone-900">
                <span>Cart subtotal</span>
                <span>{formatPrice(subtotal / 100)}</span>
              </div>
            </section>

            <form id="checkout-form" className="space-y-6" onSubmit={submit}>
              <section className="rounded-xl border border-stone-200 bg-white p-5">
                <h2 className="text-xl font-semibold text-stone-900">Contact details</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium text-stone-700">
                    Name
                    <input
                      className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2.5"
                      required
                      maxLength={100}
                      autoComplete="name"
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
                    />
                  </label>
                  <label className="text-sm font-medium text-stone-700">
                    Contact number
                    <input
                      className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2.5"
                      required
                      maxLength={24}
                      type="tel"
                      autoComplete="tel"
                      value={customerPhone}
                      onChange={(event) => setCustomerPhone(event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-stone-200 bg-white p-5">
                <h2 className="text-xl font-semibold text-stone-900">Delivery or pickup</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {(['DELIVERY', 'PICKUP'] as const).map((type) => (
                    <label
                      key={type}
                      className={`cursor-pointer rounded-lg border p-4 ${
                        fulfillmentType === type
                          ? 'border-emerald-800 bg-emerald-50'
                          : 'border-stone-200'
                      }`}
                    >
                      <input
                        className="mr-2 accent-emerald-900"
                        type="radio"
                        name="fulfillment"
                        value={type}
                        checked={fulfillmentType === type}
                        onChange={() => setFulfillmentType(type)}
                      />
                      <span className="font-semibold text-stone-900">
                        {type === 'DELIVERY' ? 'Delivery' : 'Pickup'}
                      </span>
                    </label>
                  ))}
                </div>
                {fulfillmentType === 'DELIVERY' ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium text-stone-700">
                      Block
                      <input
                        className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2.5"
                        required
                        maxLength={80}
                        value={block}
                        onChange={(event) => setBlock(event.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-stone-700">
                      Lot
                      <input
                        className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2.5"
                        required
                        maxLength={80}
                        value={lot}
                        onChange={(event) => setLot(event.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-stone-700 sm:col-span-2">
                      Street or phase (optional)
                      <input
                        className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2.5"
                        maxLength={160}
                        value={street}
                        onChange={(event) => setStreet(event.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-stone-700 sm:col-span-2">
                      Delivery instructions or landmarks (optional)
                      <textarea
                        className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2.5"
                        rows={2}
                        maxLength={500}
                        value={deliveryInstructions}
                        onChange={(event) => setDeliveryInstructions(event.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg bg-stone-50 p-4 text-sm leading-6 text-stone-700">
                    <p className="font-semibold text-stone-900">Pickup location</p>
                    <p>
                      {store.data?.pickupAddress || 'Pickup address has not been configured yet.'}
                    </p>
                    <p className="mt-2">{store.data?.pickupInstructions}</p>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-stone-200 bg-white p-5">
                <h2 className="text-xl font-semibold text-stone-900">Payment</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ['COD', 'Cash on delivery / pickup'],
                      ['QR', 'QR payment'],
                    ] as const
                  ).map(([method, label]) => (
                    <label
                      key={method}
                      className={`cursor-pointer rounded-lg border p-4 ${
                        paymentMethod === method
                          ? 'border-emerald-800 bg-emerald-50'
                          : 'border-stone-200'
                      }`}
                    >
                      <input
                        className="mr-2 accent-emerald-900"
                        type="radio"
                        name="payment"
                        value={method}
                        checked={paymentMethod === method}
                        onChange={() => setPaymentMethod(method)}
                      />
                      <span className="font-semibold text-stone-900">{label}</span>
                    </label>
                  ))}
                </div>
                {paymentMethod === 'QR' && (
                  <div className="mt-4 rounded-lg bg-stone-50 p-4 text-sm leading-6 text-stone-700">
                    <img
                      className="mb-3 w-56 max-w-full rounded-lg bg-white object-contain"
                      src={
                        store.data?.qrPaymentImage
                          ? `${apiUrl}${store.data.qrPaymentImage}`
                          : '/qr-payment-placeholder.svg'
                      }
                      alt={
                        store.data?.qrPaymentImage
                          ? 'Store QR payment code'
                          : 'Demonstration QR placeholder, not a payment code'
                      }
                    />
                    {!store.data?.qrPaymentImage && (
                      <p className="font-semibold text-amber-900">
                        Demo image only — do not use it to make a payment.
                      </p>
                    )}
                    {store.data?.qrPaymentInstructions ||
                      'The store has not configured QR payment instructions yet.'}
                    <label className="mt-4 block font-medium text-stone-800">
                      Payment reference number (if available)
                      <input
                        className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5"
                        maxLength={100}
                        value={referenceNumber}
                        onChange={(event) => setReferenceNumber(event.target.value)}
                      />
                      <span className="mt-1 block text-xs font-normal text-stone-500">
                        Enter the transaction/reference number shown by your payment app.
                      </span>
                    </label>
                    <label className="mt-4 block font-medium text-stone-800">
                      Payment receipt (required)
                      <input
                        className="mt-2 block w-full text-sm"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        required
                        onChange={(event) => setPaymentReceipt(event.target.files?.[0] ?? null)}
                      />
                      <span className="mt-1 block text-xs font-normal text-stone-500">
                        Upload a JPEG, PNG, or WebP receipt image up to 5 MB. It is stored privately
                        with your payment.
                      </span>
                    </label>
                  </div>
                )}
              </section>
            </form>
          </div>

          <aside className="rounded-xl border border-stone-200 bg-white p-5 lg:sticky lg:top-6">
            <h2 className="text-xl font-semibold text-stone-900">Order review</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4 text-stone-600">
                <dt>Subtotal</dt>
                <dd>{formatPrice(subtotal / 100)}</dd>
              </div>
              <div className="flex justify-between gap-4 text-stone-600">
                <dt>Fulfillment</dt>
                <dd>{fulfillmentType === 'DELIVERY' ? 'Delivery' : 'Pickup'}</dd>
              </div>
              <div className="flex justify-between gap-4 text-stone-600">
                <dt>{fulfillmentType === 'DELIVERY' ? 'Delivery fee' : 'Pickup fee'}</dt>
                <dd>{formatPrice(deliveryFee / 100)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-stone-200 pt-3 text-base font-semibold text-stone-900">
                <dt>Total</dt>
                <dd>{formatPrice((subtotal + deliveryFee) / 100)}</dd>
              </div>
            </dl>
            {customerName.trim() && (
              <div className="mt-5 border-t border-stone-200 pt-4 text-sm text-stone-600">
                <p className="font-semibold text-stone-900">Contact</p>
                <p>{customerName}</p>
                <p>{customerPhone}</p>
              </div>
            )}
            {fulfillmentType === 'DELIVERY' && (block.trim() || lot.trim()) && (
              <div className="mt-4 text-sm text-stone-600">
                <p className="font-semibold text-stone-900">Delivery address</p>
                <p>
                  {[block.trim() && `Block ${block}`, lot.trim() && `Lot ${lot}`, street.trim()]
                    .filter(Boolean)
                    .join(', ')}
                </p>
                {deliveryInstructions.trim() && <p>{deliveryInstructions}</p>}
              </div>
            )}
            {fulfillmentType === 'PICKUP' && (
              <div className="mt-4 text-sm text-stone-600">
                <p className="font-semibold text-stone-900">Pickup location</p>
                <p>{store.data?.pickupAddress || 'Not configured'}</p>
              </div>
            )}
            <p className="mt-4 text-sm text-stone-600">
              Payment: {paymentMethod === 'COD' ? 'Cash on delivery / pickup' : 'QR payment'}
            </p>
            {hasUnavailableItems && (
              <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">
                Remove unavailable items or refresh the menu before placing your order.
              </p>
            )}
            {submitOrder.error && (
              <div className="mt-4">
                <ErrorNotice error={submitOrder.error} />
              </div>
            )}
            <p className="mt-4 text-xs leading-5 text-stone-500">
              Prices and availability are confirmed by the store when you place the order.
            </p>
            <button
              className="mt-4 w-full rounded-lg bg-emerald-900 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              form="checkout-form"
              disabled={
                submitOrder.isPending ||
                products.isFetching ||
                store.isFetching ||
                hasUnavailableItems ||
                cart.length === 0
              }
            >
              {submitOrder.isPending ? 'Placing order…' : 'Place order'}
            </button>
          </aside>
        </div>
      )}
    </main>
  );
}

function TrackingLinkPage() {
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
          Neighborhood Coffee &amp; Pasta
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

function OrderMessages({
  side,
  orderId,
  trackingToken,
}: {
  side: 'owner' | 'customer';
  orderId?: string;
  trackingToken?: string;
}) {
  const queryClient = useQueryClient();
  const [messageText, setMessageText] = useState('');
  const identifier = side === 'owner' ? (orderId ?? '') : (trackingToken ?? '');
  const messagesPath =
    side === 'owner'
      ? `/admin/orders/${encodeURIComponent(identifier)}/messages`
      : `/orders/track/${encodeURIComponent(identifier)}/messages`;
  const queryKey =
    side === 'owner'
      ? (['order-messages', 'owner', identifier] as const)
      : (['order-messages', 'customer', identifier] as const);
  const messages = useQuery({
    queryKey,
    queryFn: () => apiRequest<OrderMessage[]>(messagesPath),
    enabled: Boolean(identifier),
    refetchInterval: 30_000,
  });
  const send = useMutation({
    mutationFn: () =>
      apiRequest<OrderMessage>(messagesPath, {
        method: 'POST',
        body: jsonBody({ message: messageText }),
      }),
    onSuccess: async () => {
      setMessageText('');
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send.mutate();
  }

  return (
    <section className="mt-8 border-t border-stone-200 pt-6">
      <h2 className="text-lg font-semibold text-stone-900">Order messages</h2>
      <div
        className="mt-3 max-h-72 space-y-3 overflow-y-auto rounded-xl bg-stone-50 p-4"
        aria-live="polite"
      >
        {messages.isPending ? (
          <p className="text-sm text-stone-500">Loading messages…</p>
        ) : messages.data?.length ? (
          messages.data.map((entry) => (
            <article
              key={entry.id}
              className={`max-w-[90%] rounded-lg p-3 text-sm ${
                (side === 'owner' && entry.senderType === 'OWNER') ||
                (side === 'customer' && entry.senderType === 'CUSTOMER')
                  ? 'ml-auto bg-emerald-100 text-emerald-950'
                  : 'bg-white text-stone-800'
              }`}
            >
              <p className="font-semibold">{entry.senderName}</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{entry.message}</p>
              <time className="mt-2 block text-xs text-stone-500">
                {new Date(entry.createdAt).toLocaleString()}
              </time>
            </article>
          ))
        ) : (
          <p className="text-sm text-stone-500">No messages yet.</p>
        )}
      </div>
      <ErrorNotice error={messages.error ?? send.error} />
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <label className="sr-only" htmlFor={`message-${side}-${identifier}`}>
          Write a message
        </label>
        <input
          id={`message-${side}-${identifier}`}
          className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2.5 text-sm"
          value={messageText}
          maxLength={2000}
          required
          placeholder="Write a message…"
          onChange={(event) => setMessageText(event.target.value)}
        />
        <button
          className="rounded-lg bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={send.isPending || !messageText.trim()}
        >
          {send.isPending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}

function PaymentResubmission({ token, instructions }: { token: string; instructions: string }) {
  const queryClient = useQueryClient();
  const [referenceNumber, setReferenceNumber] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const resubmit = useMutation({
    mutationFn: async () => {
      if (!receipt) throw new Error('Choose an updated payment receipt.');
      if (receipt.size > 5 * 1024 * 1024) {
        throw new Error('Choose a payment receipt image smaller than 5 MB.');
      }
      return apiRequest<{ status: PaymentStatus }>(
        `/orders/track/${encodeURIComponent(token)}/payment`,
        {
          method: 'POST',
          body: jsonBody({
            referenceNumber,
            paymentReceipt: { data: await imageData(receipt) },
          }),
        },
      );
    },
    onSuccess: async () => {
      setReceipt(null);
      setReferenceNumber('');
      await queryClient.invalidateQueries({ queryKey: ['tracked-order', token] });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resubmit.mutate();
  }

  return (
    <form className="mt-4 rounded-lg border border-red-200 bg-white p-3" onSubmit={submit}>
      <h3 className="font-semibold text-stone-900">Submit an updated payment</h3>
      {instructions && (
        <p className="mt-1 whitespace-pre-wrap text-sm text-stone-600">{instructions}</p>
      )}
      <label className="mt-3 block text-sm font-medium text-stone-700">
        New payment reference number (if available)
        <input
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2"
          maxLength={100}
          value={referenceNumber}
          onChange={(event) => setReferenceNumber(event.target.value)}
        />
      </label>
      <label className="mt-3 block text-sm font-medium text-stone-700">
        Updated receipt image
        <input
          className="mt-1 block w-full text-sm"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
        />
        <span className="mt-1 block text-xs font-normal text-stone-500">
          JPEG, PNG, or WebP up to 5 MB. This receipt is stored privately.
        </span>
      </label>
      <ErrorNotice error={resubmit.error} />
      {resubmit.isSuccess && (
        <p className="mt-3 text-sm text-emerald-800" role="status">
          Updated receipt submitted. The store will review it shortly.
        </p>
      )}
      <button
        className="mt-3 rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        disabled={resubmit.isPending}
      >
        {resubmit.isPending ? 'Submitting…' : 'Submit updated receipt'}
      </button>
    </form>
  );
}

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

function AdminOrdersBoard() {
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

function AdminPaymentsReview() {
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

function QrImageSettings() {
  const queryClient = useQueryClient();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [instructionsText, setInstructionsText] = useState('');
  const image = useQuery({
    queryKey: ['admin-qr-image'],
    queryFn: () => apiRequest<{ imagePath: string | null }>('/admin/settings/qr-image'),
  });
  const instructions = useQuery({
    queryKey: ['admin-qr-instructions'],
    queryFn: () => apiRequest<{ instructions: string }>('/admin/settings/qr-instructions'),
  });
  useEffect(() => {
    if (instructions.data) setInstructionsText(instructions.data.instructions);
  }, [instructions.data]);
  const saveInstructions = useMutation({
    mutationFn: () =>
      apiRequest<{ instructions: string }>('/admin/settings/qr-instructions', {
        method: 'PUT',
        body: jsonBody({ instructions: instructionsText }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-qr-instructions'] }),
        queryClient.invalidateQueries({ queryKey: ['store'] }),
      ]);
    },
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!imageFile) throw new Error('Select a QR payment image first.');
      if (imageFile.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.');
      return apiRequest<{ imagePath: string }>('/admin/settings/qr-image', {
        method: 'PUT',
        body: jsonBody({ data: await imageData(imageFile) }),
      });
    },
    onSuccess: () => {
      setImageFile(null);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-qr-image'] }),
        queryClient.invalidateQueries({ queryKey: ['store'] }),
      ]);
    },
  });
  const remove = useMutation({
    mutationFn: () => apiRequest('/admin/settings/qr-image', { method: 'DELETE' }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-qr-image'] }),
        queryClient.invalidateQueries({ queryKey: ['store'] }),
      ]),
  });

  return (
    <section className="mt-5 max-w-2xl rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="text-xl font-semibold text-stone-900">QR payment image</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        This image is displayed to customers when they choose QR payment. Use only a payment QR for
        the store account.
      </p>
      <ErrorNotice
        error={
          image.error ??
          instructions.error ??
          upload.error ??
          remove.error ??
          saveInstructions.error
        }
      />
      <label className="mt-4 block text-sm font-medium text-stone-700">
        Customer payment instructions
        <textarea
          className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2.5"
          rows={4}
          maxLength={1000}
          value={instructionsText}
          onChange={(event) => setInstructionsText(event.target.value)}
          placeholder="Add instructions for customers paying by QR."
        />
      </label>
      <button
        className="mt-3 rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 disabled:opacity-50"
        disabled={saveInstructions.isPending || instructions.isPending}
        onClick={() => saveInstructions.mutate()}
      >
        {saveInstructions.isPending ? 'Saving instructions…' : 'Save instructions'}
      </button>
      {image.data?.imagePath ? (
        <img
          className="mt-4 max-h-72 max-w-full rounded-lg border border-stone-200 object-contain"
          src={`${apiUrl}${image.data.imagePath}`}
          alt="Current store QR payment code"
        />
      ) : (
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          No store QR image configured. Checkout will show the demo placeholder.
        </p>
      )}
      <label className="mt-5 block text-sm font-medium text-stone-700">
        {image.data?.imagePath ? 'Replace QR image' : 'Upload QR image'}
        <input
          className="mt-2 block w-full text-sm"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="rounded-lg bg-emerald-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50"
          disabled={!imageFile || upload.isPending}
          onClick={() => upload.mutate()}
        >
          {upload.isPending ? 'Saving…' : 'Save QR image'}
        </button>
        {image.data?.imagePath && (
          <button
            className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-semibold text-red-800 disabled:opacity-50"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove current image
          </button>
        )}
      </div>
    </section>
  );
}

function AdminLogin({ onLogin }: { onLogin: (owner: Owner) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () =>
      apiRequest<{ user: Owner }>('/admin/login', {
        method: 'POST',
        body: jsonBody({ email, password }),
      }),
    onSuccess: ({ user }) => onLogin(user),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <Link to="/" className="text-sm font-semibold text-emerald-900">
        ← Back to the menu
      </Link>
      <section className="mt-8 rounded-2xl border border-stone-200 bg-white p-7 shadow-sm sm:p-9">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-800">
          Owner dashboard
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-stone-900">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Use the owner account configured for this store.
        </p>
        <form className="mt-7 space-y-5" onSubmit={submit}>
          <label className="block text-sm font-medium text-stone-700">
            Email
            <input
              className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2.5"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium text-stone-700">
            Password
            <input
              className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2.5"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <ErrorNotice error={login.error} />
          <button
            className="w-full rounded-lg bg-emerald-900 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            disabled={login.isPending}
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}

function imageData(file: File): Promise<string> {
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

function ProductEditor({
  product,
  categories,
  onClose,
}: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? '');
  const [isAvailable, setIsAvailable] = useState(product?.isAvailable ?? true);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  useEffect(() => {
    if (!imagePreview) return;
    return () => URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);
  const imageSrc = imagePreview ?? (product?.imagePath ? `${apiUrl}${product.imagePath}` : null);
  const save = useMutation({
    mutationFn: async () => {
      if (image && image.size > 5 * 1024 * 1024) {
        throw new Error('Choose an image smaller than 5 MB');
      }
      const payload = {
        name,
        description: description.trim() || null,
        price: Number(price),
        categoryId,
        isAvailable,
      };
      const saved = await apiRequest<Product>(
        product ? `/admin/products/${product.id}` : '/admin/products',
        { method: product ? 'PUT' : 'POST', body: jsonBody(payload) },
      );
      if (image) {
        const data = await imageData(image);
        await apiRequest(`/admin/products/${saved.id}/image`, {
          method: 'POST',
          body: jsonBody({ data }),
        });
      }
      return saved;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-stone-950/40 p-0 sm:items-center sm:p-5">
      <section className="max-h-[95vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold text-stone-900">
            {product ? 'Edit product' : 'Add product'}
          </h2>
          <button
            className="rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-100"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <label className="text-sm font-medium text-stone-700 sm:col-span-2">
            Product name
            <input
              className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-stone-700">
            Price (₱)
            <input
              className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2"
              required
              min="0.01"
              step="0.01"
              type="number"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-stone-700">
            Category
            <select
              className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2"
              required
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-stone-700 sm:col-span-2">
            Description
            <textarea
              className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2"
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-stone-700 sm:col-span-2">
            Product image (JPEG, PNG or WebP; up to 5 MB)
            <input
              className="mt-1.5 block w-full text-sm"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setImage(selected);
                setImagePreview(selected ? URL.createObjectURL(selected) : null);
              }}
            />
          </label>
          {imageSrc && (
            <img
              className="h-24 w-24 rounded-lg object-cover"
              src={imageSrc}
              alt="Product image preview"
            />
          )}
          <label className="flex items-center gap-2 text-sm text-stone-700 sm:col-span-2">
            <input
              checked={isAvailable}
              type="checkbox"
              onChange={(event) => setIsAvailable(event.target.checked)}
            />
            Available to customers
          </label>
          <div className="sm:col-span-2">
            <ErrorNotice error={save.error} />
            <button
              className="mt-3 w-full rounded-lg bg-emerald-900 px-4 py-3 font-semibold text-white disabled:opacity-60"
              disabled={save.isPending || categories.length === 0}
            >
              {save.isPending ? 'Saving…' : 'Save product'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CategoryEditor({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(category?.name ?? '');
  const [sortOrder, setSortOrder] = useState(category?.sortOrder ?? 0);
  const save = useMutation({
    mutationFn: () =>
      apiRequest<Category>(category ? `/admin/categories/${category.id}` : '/admin/categories', {
        method: category ? 'PUT' : 'POST',
        body: jsonBody({ name, sortOrder, isActive: category?.isActive ?? true }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
  });
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <label className="min-w-52 flex-1 text-sm font-medium text-stone-700">
        Category name
        <input
          className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="w-28 text-sm font-medium text-stone-700">
        Sort order
        <input
          className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2"
          type="number"
          min="0"
          max="10000"
          value={sortOrder}
          onChange={(event) => setSortOrder(Number(event.target.value))}
        />
      </label>
      <div className="flex gap-2">
        <button className="rounded-lg bg-emerald-900 px-4 py-2 font-semibold text-white">
          {category ? 'Save changes' : 'Add category'}
        </button>
        <button type="button" className="rounded-lg px-3 py-2 text-stone-600" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div className="w-full">
        <ErrorNotice error={save.error} />
      </div>
    </form>
  );
}

function AdminDashboard({ owner }: { owner: Owner }) {
  const queryClient = useQueryClient();
  const realtimeConnected = useOwnerRealtime();
  const [section, setSection] = useState<'orders' | 'payments' | 'products' | 'categories' | 'qr'>(
    'orders',
  );
  const [editingProduct, setEditingProduct] = useState<Product | null | undefined>(undefined);
  const [editingCategory, setEditingCategory] = useState<Category | null | undefined>(undefined);
  const [showArchived, setShowArchived] = useState(false);
  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: () => apiRequest<Category[]>('/admin/categories'),
  });
  const products = useQuery({
    queryKey: ['admin-products', showArchived],
    queryFn: () =>
      apiRequest<Product[]>(`/admin/products${showArchived ? '?includeArchived=true' : ''}`),
    enabled: section === 'products',
  });
  const logout = useMutation({
    mutationFn: () => apiRequest('/admin/logout', { method: 'POST' }),
    onSuccess: async () => {
      queryClient.setQueryData<{ user: Owner } | null>(['admin-session'], null);
      queryClient.removeQueries({ queryKey: ['admin-categories'] });
      queryClient.removeQueries({ queryKey: ['admin-products'] });
    },
  });
  const archive = useMutation({
    mutationFn: ({ product, archived }: { product: Product; archived: boolean }) =>
      apiRequest(`/admin/products/${product.id}/archive`, {
        method: 'PATCH',
        body: jsonBody({ isArchived: archived }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-products'] }),
  });
  const toggleProduct = useMutation({
    mutationFn: ({ product, available }: { product: Product; available: boolean }) =>
      apiRequest(`/admin/products/${product.id}/availability`, {
        method: 'PATCH',
        body: jsonBody({ isAvailable: available }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
  const toggleCategory = useMutation({
    mutationFn: ({ category, active }: { category: Category; active: boolean }) =>
      apiRequest(`/admin/categories/${category.id}/availability`, {
        method: 'PATCH',
        body: jsonBody({ isActive: active }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
  const deleteCategory = useMutation({
    mutationFn: (category: Category) =>
      apiRequest(`/admin/categories/${category.id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-categories'] }),
  });

  return (
    <>
      <main className="min-h-screen w-full px-5 py-8 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 pb-5">
          <div>
            <Link to="/" className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-900">
              Neighborhood Coffee &amp; Pasta
            </Link>
            <p className="mt-1 text-sm text-stone-600">Signed in as {owner.name}</p>
          </div>
          <button
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sign out
          </button>
        </header>
        {!realtimeConnected && (
          <p className="mt-3 text-xs text-stone-500" role="status">
            Live updates are reconnecting; order and payment lists will continue refreshing.
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-800">
              Store management
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-stone-900">
              {section === 'orders'
                ? 'Orders'
                : section === 'payments'
                  ? 'Payment review'
                  : section === 'qr'
                    ? 'QR payment settings'
                    : 'Your menu'}
            </h1>
          </div>
          {section === 'products' ? (
            <button
              className="rounded-lg bg-emerald-900 px-4 py-2.5 font-semibold text-white"
              onClick={() => setEditingProduct(null)}
              disabled={!categories.data?.length}
            >
              Add product
            </button>
          ) : section === 'categories' ? (
            <button
              className="rounded-lg bg-emerald-900 px-4 py-2.5 font-semibold text-white"
              onClick={() => setEditingCategory(null)}
            >
              Add category
            </button>
          ) : null}
        </div>

        <nav className="mt-7 flex gap-2 border-b border-stone-200" aria-label="Admin sections">
          {(['orders', 'payments', 'products', 'categories', 'qr'] as const).map((item) => (
            <button
              key={item}
              className={`border-b-2 px-4 py-3 text-sm font-semibold capitalize ${
                section === item
                  ? 'border-emerald-900 text-emerald-900'
                  : 'border-transparent text-stone-500'
              }`}
              onClick={() => setSection(item)}
            >
              {item === 'qr' ? 'QR payment' : item === 'payments' ? 'Payments' : item}
            </button>
          ))}
        </nav>

        <div className="mt-5">
          <ErrorNotice error={logout.error ?? categories.error} />
          {section === 'orders' ? (
            <AdminOrdersBoard />
          ) : section === 'payments' ? (
            <AdminPaymentsReview />
          ) : section === 'qr' ? (
            <QrImageSettings />
          ) : section === 'products' ? (
            <>
              {categories.data?.length === 0 && (
                <p className="mb-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
                  Create a category before adding products.
                </p>
              )}
              <label className="mb-4 flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />
                Show archived products
              </label>
              <ErrorNotice error={products.error ?? archive.error ?? toggleProduct.error} />
              {products.isPending ? (
                <p className="py-8 text-stone-600">Loading products…</p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
                  {products.data?.length ? (
                    <div className="divide-y divide-stone-100">
                      {products.data.map((product) => (
                        <article key={product.id} className="flex flex-wrap items-center gap-4 p-4">
                          {product.imagePath ? (
                            <img
                              className="h-16 w-16 rounded-lg object-cover"
                              src={`${apiUrl}${product.imagePath}`}
                              alt=""
                            />
                          ) : (
                            <div className="h-16 w-16 rounded-lg bg-emerald-50" />
                          )}
                          <div className="min-w-40 flex-1">
                            <h2 className="font-semibold text-stone-900">{product.name}</h2>
                            <p className="mt-1 text-sm text-stone-500">
                              {product.category.name} · ₱{Number(product.price).toFixed(2)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                product.isArchived
                                  ? 'bg-stone-100 text-stone-600'
                                  : product.isAvailable
                                    ? 'bg-emerald-50 text-emerald-900'
                                    : 'bg-amber-50 text-amber-900'
                              }`}
                            >
                              {product.isArchived
                                ? 'Archived'
                                : product.isAvailable
                                  ? 'Available'
                                  : 'Unavailable'}
                            </span>
                            {!product.isArchived && (
                              <button
                                className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                                onClick={() =>
                                  toggleProduct.mutate({ product, available: !product.isAvailable })
                                }
                              >
                                {product.isAvailable ? 'Set unavailable' : 'Set available'}
                              </button>
                            )}
                            <button
                              className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                              onClick={() => setEditingProduct(product)}
                            >
                              Edit
                            </button>
                            <button
                              className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                              onClick={() =>
                                archive.mutate({ product, archived: !product.isArchived })
                              }
                            >
                              {product.isArchived ? 'Restore' : 'Archive'}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="p-8 text-center text-stone-600">No products found.</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <ErrorNotice error={toggleCategory.error ?? deleteCategory.error} />
              {editingCategory !== undefined && (
                <div className="mb-4">
                  <CategoryEditor
                    key={editingCategory?.id ?? 'new'}
                    category={editingCategory}
                    onClose={() => setEditingCategory(undefined)}
                  />
                </div>
              )}
              <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
                {categories.data?.map((category) => (
                  <article
                    key={category.id}
                    className="flex flex-wrap items-center gap-4 border-b border-stone-100 p-4 last:border-0"
                  >
                    <div className="min-w-32 flex-1">
                      <h2 className="font-semibold text-stone-900">{category.name}</h2>
                      <p className="mt-1 text-sm text-stone-500">
                        /{category.slug} · Order {category.sortOrder}
                      </p>
                    </div>
                    <span className="text-sm text-stone-600">
                      {category.isActive ? 'Active' : 'Hidden'}
                    </span>
                    <button
                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                      onClick={() =>
                        toggleCategory.mutate({ category, active: !category.isActive })
                      }
                    >
                      {category.isActive ? 'Hide' : 'Show'}
                    </button>
                    <button
                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                      onClick={() => setEditingCategory(category)}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-red-800"
                      onClick={() => {
                        if (window.confirm(`Delete “${category.name}”?`))
                          deleteCategory.mutate(category);
                      }}
                    >
                      Delete
                    </button>
                  </article>
                ))}
                {!categories.data?.length && (
                  <p className="p-8 text-center text-stone-600">No categories yet.</p>
                )}
              </div>
            </>
          )}
        </div>
      </main>
      {editingProduct !== undefined && categories.data && (
        <ProductEditor
          key={editingProduct?.id ?? 'new'}
          product={editingProduct}
          categories={categories.data}
          onClose={() => setEditingProduct(undefined)}
        />
      )}
    </>
  );
}

function AdminPage() {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ['admin-session'],
    queryFn: () => apiRequest<{ user: Owner } | null>('/admin/me'),
    retry: false,
    staleTime: 30_000,
  });
  if (session.isPending) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-20 text-stone-600">Checking owner session…</main>
    );
  }
  if (!session.data) {
    return (
      <AdminLogin
        onLogin={(owner) => queryClient.setQueryData(['admin-session'], { user: owner })}
      />
    );
  }
  return <AdminDashboard owner={session.data.user} />;
}

function NotFoundPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-3xl font-semibold text-stone-900">Page not found</h1>
      <Link className="mt-4 inline-block text-emerald-800 underline" to="/">
        Return to menu
      </Link>
    </main>
  );
}

export default function App() {
  const [cart, setCart] = useState<CartLine[]>(readCart);
  const [cartStorageError, setCartStorageError] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(cartStorageKey, JSON.stringify(cart));
      setCartStorageError(null);
    } catch (error) {
      console.error('Could not save the cart:', error);
      setCartStorageError('Your cart could not be saved in this browser.');
    }
  }, [cart]);

  function addToCart(productId: string) {
    setCart((current) => {
      const existing = current.find((item) => item.productId === productId);
      if (existing) {
        return current.map((item) =>
          item.productId === productId
            ? { ...item, quantity: Math.min(item.quantity + 1, 50) }
            : item,
        );
      }
      return [...current, { productId, quantity: 1 }];
    });
  }

  function updateQuantity(productId: string, quantity: number) {
    if (quantity <= 0) {
      setCart((current) => current.filter((item) => item.productId !== productId));
      return;
    }
    setCart((current) =>
      current.map((item) =>
        item.productId === productId ? { ...item, quantity: Math.min(quantity, 50) } : item,
      ),
    );
  }

  function removeFromCart(productId: string) {
    setCart((current) => current.filter((item) => item.productId !== productId));
  }

  function clearCartAfterOrder() {
    setCart([]);
    try {
      window.localStorage.removeItem(checkoutKeyStorageKey);
    } catch (error) {
      console.error('Could not clear the saved checkout key:', error);
      setCartStorageError('Your order was placed, but browser storage could not be cleared.');
    }
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <HomePage
            cart={cart}
            addToCart={addToCart}
            updateQuantity={updateQuantity}
            cartStorageError={cartStorageError}
          />
        }
      />
      <Route
        path="/checkout"
        element={
          <CheckoutPage
            cart={cart}
            updateQuantity={updateQuantity}
            removeFromCart={removeFromCart}
            onOrderPlaced={clearCartAfterOrder}
            cartStorageError={cartStorageError}
          />
        }
      />
      <Route path="/track/:token" element={<TrackingLinkPage />} />
      <Route path="/admin/*" element={<AdminPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
