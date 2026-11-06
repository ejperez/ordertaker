import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { apiRequest, apiUrl, jsonBody } from './api';

type Owner = { id: string; name: string; email: string };
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

function ErrorNotice({ error }: { error: unknown }) {
  if (!(error instanceof Error)) return null;
  return (
    <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      {error.message}
    </p>
  );
}

function HomePage() {
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiRequest<Category[]>('/categories'),
  });
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => apiRequest<Product[]>('/products'),
  });
  const [categoryFilter, setCategoryFilter] = useState('all');
  const visibleProducts =
    products.data?.filter(
      (product) => categoryFilter === 'all' || product.categoryId === categoryFilter,
    ) ?? [];

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-10 sm:px-8">
      <header className="flex items-center justify-between border-b border-stone-200 pb-6">
        <Link to="/" className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-900">
          Neighborhood Coffee &amp; Pasta
        </Link>
        <Link to="/admin" className="text-sm font-semibold text-stone-600 hover:text-emerald-900">
          Owner sign in
        </Link>
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
        {products.isPending ? (
          <p className="py-12 text-stone-600">Loading the menu…</p>
        ) : visibleProducts.length ? (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visibleProducts.map((product) => (
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
                    <p className="mt-2 text-sm leading-6 text-stone-600">{product.description}</p>
                  )}
                </div>
              </article>
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
  const [section, setSection] = useState<'products' | 'categories'>('products');
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
      <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8">
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

        <div className="mt-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-800">
              Store management
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-stone-900">Your menu</h1>
          </div>
          {section === 'products' ? (
            <button
              className="rounded-lg bg-emerald-900 px-4 py-2.5 font-semibold text-white"
              onClick={() => setEditingProduct(null)}
              disabled={!categories.data?.length}
            >
              Add product
            </button>
          ) : (
            <button
              className="rounded-lg bg-emerald-900 px-4 py-2.5 font-semibold text-white"
              onClick={() => setEditingCategory(null)}
            >
              Add category
            </button>
          )}
        </div>

        <nav className="mt-7 flex gap-2 border-b border-stone-200" aria-label="Admin sections">
          {(['products', 'categories'] as const).map((item) => (
            <button
              key={item}
              className={`border-b-2 px-4 py-3 text-sm font-semibold capitalize ${
                section === item
                  ? 'border-emerald-900 text-emerald-900'
                  : 'border-transparent text-stone-500'
              }`}
              onClick={() => setSection(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="mt-5">
          <ErrorNotice error={logout.error ?? categories.error} />
          {section === 'products' ? (
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
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/admin/*" element={<AdminPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
