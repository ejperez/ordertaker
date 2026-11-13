import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiRequest, jsonBody } from '../../api';
import { imageData } from '../../utils';
import { ErrorNotice } from '../shared/ErrorNotice';

export function QrImageSettings() {
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
          src={image.data.imagePath}
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
