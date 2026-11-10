import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { apiRequest, jsonBody } from '../../api';
import type { PaymentStatus } from '../../types';
import { imageData } from '../../utils';
import { ErrorNotice } from './ErrorNotice';

export function PaymentResubmission({ token, instructions }: { token: string; instructions: string }) {
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
