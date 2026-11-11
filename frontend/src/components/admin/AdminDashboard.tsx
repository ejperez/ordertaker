import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, apiUrl, jsonBody } from '../../api';
import type { Category, Owner, Product } from '../../types';
import { useOwnerRealtime } from '../../utils';
import { ErrorNotice } from '../shared/ErrorNotice';
import { CategoryEditor } from './CategoryEditor';
import { AdminOrdersBoard, AdminPaymentsReview } from './OrderManagement';
import { ProductEditor } from './ProductEditor';
import { QrImageSettings } from './QrImageSettings';

export function AdminDashboard({ owner }: { owner: Owner }) {
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
    <div className="flex min-h-screen w-full flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-stone-200 bg-white p-5 sm:p-8 lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r">
        <header className="mb-6">
            <div>
              <Link
                to="/"
                className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-900"
              >
                Neighborhood Coffee &amp; Pasta
              </Link>
              <p className="mt-1 text-sm text-stone-600">Signed in as {owner.name}</p>
            </div>
        </header>
        <nav className="flex flex-wrap gap-2 lg:flex-col" aria-label="Admin sections">
            {(['orders', 'payments', 'products', 'categories', 'qr'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-current={section === item ? 'page' : undefined}
                className={`rounded-lg px-3 py-2 text-left text-sm font-semibold capitalize ${
                  section === item
                    ? 'bg-emerald-50 text-emerald-900'
                    : 'text-stone-600 hover:bg-stone-100'
                }`}
                onClick={() => setSection(item)}
              >
                {item === 'qr' ? 'QR payment' : item === 'payments' ? 'Payments' : item}
              </button>
            ))}
        </nav>
        <button
            type="button"
            className="mt-5 rounded-lg border border-stone-300 px-3 py-2 text-left text-sm font-semibold text-stone-700 hover:bg-stone-50 lg:mt-auto"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sign out
        </button>
      </aside>

      <main className="min-w-0 flex-1 px-5 py-8 sm:px-8">
          {!realtimeConnected && (
            <p className="mb-5 text-xs text-stone-500" role="status">
              Live updates are reconnecting; order and payment lists will continue refreshing.
            </p>
          )}
          <div className="flex flex-wrap items-end justify-between gap-5">
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
      </main>
      {editingProduct !== undefined && categories.data && (
        <ProductEditor
          key={editingProduct?.id ?? 'new'}
          product={editingProduct}
          categories={categories.data}
          onClose={() => setEditingProduct(undefined)}
        />
      )}
    </div>
  );
}
