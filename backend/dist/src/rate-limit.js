const windowMs = 15 * 60 * 1000;
const maxAttempts = 5;
const attempts = new Map();
const orderWindowMs = 10 * 60 * 1000;
const maxOrderAttempts = 10;
const orderAttempts = new Map();
const messageWindowMs = 10 * 60 * 1000;
const maxMessageAttempts = 30;
const messageAttempts = new Map();
function consumeAttempt(request, store, limit, durationMs) {
    const now = Date.now();
    const key = request.ip;
    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + durationMs };
        store.set(key, entry);
    }
    entry.count += 1;
    if (store.size > 1000) {
        for (const [ip, value] of store) {
            if (value.resetAt <= now)
                store.delete(ip);
        }
    }
    return entry.count > limit ? Math.ceil((entry.resetAt - now) / 1000) : 0;
}
export function consumeLoginAttempt(request) {
    return consumeAttempt(request, attempts, maxAttempts, windowMs);
}
export function consumeOrderAttempt(request) {
    return consumeAttempt(request, orderAttempts, maxOrderAttempts, orderWindowMs);
}
export function consumeMessageAttempt(request) {
    return consumeAttempt(request, messageAttempts, maxMessageAttempts, messageWindowMs);
}
