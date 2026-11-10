import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest, apiUrl, jsonBody } from '../../api';
import type { Category, Product } from '../../types';
import { imageData } from '../../utils';
import { ErrorNotice } from '../shared/ErrorNotice';

export function ProductEditor({
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
