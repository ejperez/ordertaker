export function isPostgresError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

export function isUniqueViolation(error: unknown): boolean {
  return isPostgresError(error, '23505');
}

export function isSerializationFailure(error: unknown): boolean {
  return isPostgresError(error, '40001') || isPostgresError(error, '40P01');
}
