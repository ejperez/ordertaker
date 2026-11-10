import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, apiUrl, jsonBody } from '../../api';
import type { CartLine, OrderResult, Product, StoreInfo } from '../../types';
import { checkoutKeyStorageKey, formatPrice, imageData } from '../../utils';
import { ErrorNotice } from '../shared/ErrorNotice';

export function CheckoutPage({
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
