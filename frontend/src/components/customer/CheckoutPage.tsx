import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, jsonBody } from '../../api';
import type { CartLine, OrderResult, Product, StoreInfo } from '../../types';
import { checkoutKeyStorageKey, formatPrice, imageData } from '../../utils';
import { ErrorNotice } from '../shared/ErrorNotice';

export function CheckoutPage({
  cart,
  updateQuantity,
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
      <main className="mx-auto min-h-screen max-w-3xl p-2">
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
    <main className="mx-auto min-h-screen max-w-6xl">
      <header className="sticky top-0 p-4 bg-white p-2">
        <Link to="/" className="text-sm font-semibold text-emerald-900">
          ← Back to menu
        </Link>
      </header>
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
        <div className="mb-24 grid items-start gap-8 lg:grid-cols-[1fr_0.85fr]">
          <div className="space-y-2">
            <section className="p-4 bg-white">
              <h2 className="text-md font-semibold text-stone-900">Order summary</h2>
              <div className="mt-4 divide-y divide-stone-100">
                {cartProducts.map(({ line, product }) => (
                  <div
                    key={line.productId}
                    className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-36 flex-1 text-sm">
                      <div className="flex gap-2">
                        {product && (
                          <div>
                            <img
                              className="w-12 bg-stone-100 aspect-square rounded-md"
                              src={product.imagePath ?? undefined}
                              alt={product.name}
                            />
                          </div>
                        )}
                        <div>
                          <p className="text-stone-900">
                            {product?.name ?? 'Menu item unavailable'}
                          </p>
                          <p className="mt-1 text-sm text-stone-500">
                            {product ? formatPrice(product.price) : 'No longer on the menu'}
                            {product && !product.isAvailable ? ' · Unavailable' : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center text-xs border border-emerald-900 rounded-full">
                      <button
                        className="h-6 w-6 rounded-full"
                        aria-label={`Decrease ${product?.name ?? 'item'} quantity`}
                        onClick={() => updateQuantity(line.productId, line.quantity - 1)}
                      >
                        −
                      </button>
                      <span className="min-w-5 text-center">{line.quantity}</span>
                      <button
                        className="h-6 w-6 rounded-full disabled:opacity-40"
                        aria-label={`Increase ${product?.name ?? 'item'} quantity`}
                        disabled={line.quantity >= 50}
                        onClick={() => updateQuantity(line.productId, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <form id="checkout-form" className="space-y-2" onSubmit={submit}>
              <section className="bg-white p-4">
                <h2 className="font-semibold text-stone-900">Contact details</h2>
                <div className="mt-4 grid gap-4 grid-cols-2">
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

              <section className="bg-white p-4">
                <h2 className="font-semibold text-stone-900">Delivery or pickup</h2>
                <div className="mt-4 grid gap-3 grid-cols-2">
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
                  <div className="mt-4 grid gap-4 grid-cols-2">
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
                    <label className="text-sm font-medium text-stone-700 col-span-2">
                      Street or phase (optional)
                      <input
                        className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2.5"
                        maxLength={160}
                        value={street}
                        onChange={(event) => setStreet(event.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-stone-700 col-span-2">
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

              <section className="bg-white p-4">
                <h2 className="font-semibold text-stone-900">Payment</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ['COD', 'Cash on delivery / pickup'],
                      ['QR', 'QR payment (GCash, Maya, Bank)'],
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
                  <div className="flex flex-col text-center justify-center items-center mt-4 rounded-lg bg-stone-50 p-4 text-sm leading-6 text-stone-700">
                    <img
                      className="mb-3 w-56 max-w-full rounded-lg bg-white object-contain"
                      src={
                        store.data?.qrPaymentImage
                          ? store.data.qrPaymentImage
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
                    <label className="mt-4 block font-medium text-stone-800 text-left">
                      Payment receipt (required)
                      <input
                        className="mt-2 block w-full text-sm border border-emerald-800 bg-emerald-50 rounded-lg p-4"
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

          <aside className="fixed bottom-0 left-0 right-0 pb-[env(safe-area-inset-bottom)] bg-white px-4 py-4 rounded-t-2xl rounded-tr-2xl shadow-[0_-2px_4px_rgba(0,0,0,0.06)]">
            <dl className="text-sm">
              <div className="flex justify-between gap-4 text-base text-stone-900">
                <dt>Total</dt>
                <dd>{formatPrice((subtotal + deliveryFee) / 100)}</dd>
              </div>
            </dl>
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
            <button
              className="mb-2 mt-2 w-full rounded-full bg-emerald-900 p-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
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
