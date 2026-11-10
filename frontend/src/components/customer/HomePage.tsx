import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, apiUrl } from '../../api';
import type { CartLine, Category, Product } from '../../types';
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
