import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, apiUrl } from '../../api';
import type { CartLine, Category, Product } from '../../types';
import { formatPrice } from '../../utils';
import { ErrorNotice } from '../shared/ErrorNotice';

export function HomePage({
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
  const productById = new Map((products.data ?? []).map((product) => [product.id, product]));
  const subtotalInCents = cart.reduce((total, item) => {
    const product = productById.get(item.productId);
    return product ? total + Math.round(Number(product.price) * 100) * item.quantity : total;
  }, 0);
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
    <main className="mx-auto min-h-screen max-w-6xl p-2">
      <header className="flex items-center justify-between pb-4">
        <Link to="/" className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-900">
          Ordertaker
        </Link>
      </header>

      <section className={cartCount ? 'pb-14' : ''} aria-labelledby="menu-heading">
        <div
          className="flex gap-2 overflow-x-auto min-w-0 snap-normal py-2"
          aria-label="Filter menu by category"
        >
          <button
            className={`rounded-full px-4 py-2 text-sm font-medium shrink-0 whitespace-nowrap ${
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
              className={`rounded-full px-4 py-2 text-sm font-medium shrink-0 whitespace-nowrap ${
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

        <ErrorNotice error={categories.error ?? products.error} />
        {cartStorageError && <ErrorNotice error={new Error(cartStorageError)} />}
        {products.isPending ? (
          <p className="py-12 text-stone-600">Loading the menu…</p>
        ) : visibleProducts.length ? (
          <div className="mt-5 space-y-10">
            {productGroups.map(({ category, products: groupProducts }) => (
              <section key={category.id} aria-labelledby={`category-${category.id}`}>
                <h3
                  id={`category-${category.id}`}
                  className="mb-4 text-sm font-semibold text-stone-900"
                >
                  {category.name.toUpperCase()}
                </h3>
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
                  {groupProducts.map((product) => (
                    <article key={product.id} className="overflow-hidden">
                      <div className="relative">
                        {product.imagePath ? (
                          <img
                            className="w-full bg-stone-100 aspect-square rounded-2xl"
                            src={`${apiUrl}${product.imagePath}`}
                            alt={product.name}
                          />
                        ) : (
                          <div
                            className="items-center justify-center bg-emerald-50 text-4xl text-emerald-900 aspect-square"
                            aria-hidden="true"
                          ></div>
                        )}
                        <div className="absolute bottom-1 right-1 flex items-center justify-center gap-3">
                          {cart.some((item) => item.productId === product.id) ? (
                            <div className="flex items-center gap-2 text-sm bg-white/80 text-black rounded-2xl">
                              <button
                                className="h-8 w-8"
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
                                className="h-8 w-8"
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
                          ) : (
                            <button
                              className="rounded-full h-8 w-8 bg-emerald-900/80 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-300 border border-white"
                              disabled={!product.isAvailable}
                              onClick={() => addToCart(product.id)}
                            >
                              +
                            </button>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="mt-2 flex-col font-light items-start justify-between gap-4">
                          <h3 className="text-sm text-stone-900">{product.name}</h3>
                          <span className="shrink-0 font-semibold text-stone-900">
                            ₱{Number(product.price).toFixed(2)}
                          </span>
                        </div>
                        {!product.isAvailable && (
                          <p className="mt-3 text-sm font-semibold text-amber-800">
                            Currently unavailable
                          </p>
                        )}
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

      {cartCount > 0 && (
        <footer className="fixed bottom-0 left-0 right-0 pb-[env(safe-area-inset-bottom)] bg-white p-2 rounded-t-2xl rounded-tr-2xl">
          <div className="flex items-center">
            <Link
              to="/checkout"
              className="mb-2 rounded-2xl bg-emerald-900 px-4 py-2 text-sm w-full text-center font-semibold text-white"
            >
              <div className="flex justify-between">
                <div>
                  Basket ● {cartCount} {cartCount > 1 ? 'items' : 'item'}
                </div>
                <div>{formatPrice(subtotalInCents / 100)}</div>
              </div>
            </Link>
          </div>
        </footer>
      )}
    </main>
  );
}
