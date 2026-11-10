export function ErrorNotice({ error }: { error: unknown }) {
  if (!(error instanceof Error)) return null;
  return (
    <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      {error.message}
    </p>
  );
}
