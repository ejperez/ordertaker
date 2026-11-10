import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest, jsonBody } from '../../api';
import type { Category } from '../../types';
import { ErrorNotice } from '../shared/ErrorNotice';

export function CategoryEditor({ category, onClose }: { category: Category | null; onClose: () => void }) {
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
