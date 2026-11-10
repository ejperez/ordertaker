import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { apiRequest, jsonBody } from '../../api';
import type { OrderMessage as OrderMessageType } from '../../types';
import { ErrorNotice } from './ErrorNotice';

export function OrderMessages({
  side,
  orderId,
  trackingToken,
}: {
  side: 'owner' | 'customer';
  orderId?: string;
  trackingToken?: string;
}) {
  const queryClient = useQueryClient();
  const [messageText, setMessageText] = useState('');
  const identifier = side === 'owner' ? (orderId ?? '') : (trackingToken ?? '');
  const messagesPath =
    side === 'owner'
      ? `/admin/orders/${encodeURIComponent(identifier)}/messages`
      : `/orders/track/${encodeURIComponent(identifier)}/messages`;
  const queryKey =
    side === 'owner'
      ? (['order-messages', 'owner', identifier] as const)
      : (['order-messages', 'customer', identifier] as const);
  const messages = useQuery({
    queryKey,
    queryFn: () => apiRequest<OrderMessageType[]>(messagesPath),
    enabled: Boolean(identifier),
    refetchInterval: 30_000,
  });
  const send = useMutation({
    mutationFn: () =>
      apiRequest<OrderMessageType>(messagesPath, {
        method: 'POST',
        body: jsonBody({ message: messageText }),
      }),
    onSuccess: async () => {
      setMessageText('');
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send.mutate();
  }

  return (
    <section className="mt-8 border-t border-stone-200 pt-6">
      <h2 className="text-lg font-semibold text-stone-900">Order messages</h2>
      <div
        className="mt-3 max-h-72 space-y-3 overflow-y-auto rounded-xl bg-stone-50 p-4"
        aria-live="polite"
      >
        {messages.isPending ? (
          <p className="text-sm text-stone-500">Loading messages…</p>
        ) : messages.data?.length ? (
          messages.data.map((entry) => (
            <article
              key={entry.id}
              className={`max-w-[90%] rounded-lg p-3 text-sm ${
                (side === 'owner' && entry.senderType === 'OWNER') ||
                (side === 'customer' && entry.senderType === 'CUSTOMER')
                  ? 'ml-auto bg-emerald-100 text-emerald-950'
                  : 'bg-white text-stone-800'
              }`}
            >
              <p className="font-semibold">{entry.senderName}</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{entry.message}</p>
              <time className="mt-2 block text-xs text-stone-500">
                {new Date(entry.createdAt).toLocaleString()}
              </time>
            </article>
          ))
        ) : (
          <p className="text-sm text-stone-500">No messages yet.</p>
        )}
      </div>
      <ErrorNotice error={messages.error ?? send.error} />
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <label className="sr-only" htmlFor={`message-${side}-${identifier}`}>
          Write a message
        </label>
        <input
          id={`message-${side}-${identifier}`}
          className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2.5 text-sm"
          value={messageText}
          maxLength={2000}
          required
          placeholder="Write a message…"
          onChange={(event) => setMessageText(event.target.value)}
        />
        <button
          className="rounded-lg bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={send.isPending || !messageText.trim()}
        >
          {send.isPending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
