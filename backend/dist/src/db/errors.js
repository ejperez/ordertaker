export function isPostgresError(error, code) {
    return (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === code);
}
export function isUniqueViolation(error) {
    return isPostgresError(error, '23505');
}
export function isSerializationFailure(error) {
    return isPostgresError(error, '40001') || isPostgresError(error, '40P01');
}
