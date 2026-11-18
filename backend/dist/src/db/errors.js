function hasMySqlErrorCode(error, code) {
    return (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === code);
}
function hasMySqlErrno(error, errno) {
    return typeof error === 'object' && error !== null && 'errno' in error && error.errno === errno;
}
export function isUniqueViolation(error) {
    return (hasMySqlErrorCode(error, 'ER_DUP_ENTRY') ||
        hasMySqlErrorCode(error, '1062') ||
        hasMySqlErrno(error, 1062));
}
export function isSerializationFailure(error) {
    return (hasMySqlErrorCode(error, 'ER_LOCK_DEADLOCK') ||
        hasMySqlErrorCode(error, 'ER_LOCK_WAIT_TIMEOUT') ||
        hasMySqlErrorCode(error, '1213') ||
        hasMySqlErrorCode(error, '1205') ||
        hasMySqlErrorCode(error, '40001') ||
        hasMySqlErrno(error, 1213) ||
        hasMySqlErrno(error, 1205));
}
