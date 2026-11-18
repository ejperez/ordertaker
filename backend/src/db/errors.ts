function hasMySqlErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function hasMySqlErrno(error: unknown, errno: number): boolean {
  return typeof error === 'object' && error !== null && 'errno' in error && error.errno === errno;
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    hasMySqlErrorCode(error, 'ER_DUP_ENTRY') ||
    hasMySqlErrorCode(error, '1062') ||
    hasMySqlErrno(error, 1062)
  );
}

export function isSerializationFailure(error: unknown): boolean {
  return (
    hasMySqlErrorCode(error, 'ER_LOCK_DEADLOCK') ||
    hasMySqlErrorCode(error, 'ER_LOCK_WAIT_TIMEOUT') ||
    hasMySqlErrorCode(error, '1213') ||
    hasMySqlErrorCode(error, '1205') ||
    hasMySqlErrorCode(error, '40001') ||
    hasMySqlErrno(error, 1213) ||
    hasMySqlErrno(error, 1205)
  );
}
