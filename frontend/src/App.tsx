import { useQuery } from '@tanstack/react-query';
import { Link, Route, Routes } from 'react-router-dom';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

function HomePage() {
  const health = useQuery({
    queryKey: ['api-health'],
    queryFn: async () => {
      const response = await fetch(`${apiUrl}/api/health`);
      if (!response.ok) {
        throw new Error(`API responded with ${response.status}`);
      }
      return (await response.json()) as { status: string };
    },
    retry: 1,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-emerald-800">
        Neighborhood Coffee &amp; Pasta
      </p>
      <h1 className="max-w-2xl text-4xl font-semibold leading-tight text-stone-900 sm:text-6xl">
        Good food, close to home.
      </h1>
      <p className="mt-5 max-w-xl text-lg leading-8 text-stone-600">
        Your local ordering experience is getting ready. The project foundation is up and running.
      </p>
      <div
        className="mt-10 flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm"
        role="status"
        aria-live="polite"
      >
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            health.isSuccess ? 'bg-emerald-500' : health.isError ? 'bg-red-500' : 'bg-amber-400'
          }`}
        />
        <span className="font-medium text-stone-800">
          {health.isPending && 'Checking backend connection…'}
          {health.isSuccess && `Backend connected (${health.data.status})`}
          {health.isError && 'Could not reach the backend. Start the API and try again.'}
        </span>
      </div>
    </main>
  );
}

function NotFoundPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-3xl font-semibold text-stone-900">Page not found</h1>
      <Link className="mt-4 inline-block text-emerald-800 underline" to="/">
        Return home
      </Link>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
