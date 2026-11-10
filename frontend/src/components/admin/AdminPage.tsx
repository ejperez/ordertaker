import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../api';
import type { Owner } from '../../types';
import { AdminDashboard } from './AdminDashboard';
import { AdminLogin } from './AdminLogin';

export function AdminPage() {
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
