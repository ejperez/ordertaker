import { useMutation } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, jsonBody } from '../../api';
import type { Owner } from '../../types';
import { ErrorNotice } from '../shared/ErrorNotice';

export function AdminLogin({ onLogin }: { onLogin: (owner: Owner) => void }) {
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

  function submit(event: SubmitEvent<HTMLFormElement>) {
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
