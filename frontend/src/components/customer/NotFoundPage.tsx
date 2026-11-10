import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-3xl font-semibold text-stone-900">Page not found</h1>
      <Link className="mt-4 inline-block text-emerald-800 underline" to="/">
        Return to menu
      </Link>
    </main>
  );
}
