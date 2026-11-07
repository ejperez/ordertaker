import type { FastifyRequest } from 'fastify';

const windowMs = 15 * 60 * 1000;
const maxAttempts = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();
const orderWindowMs = 10 * 60 * 1000;
const maxOrderAttempts = 10;
const orderAttempts = new Map<string, { count: number; resetAt: number }>();

function consumeAttempt(
  request: FastifyRequest,
  store: Map<string, { count: number; resetAt: number }>,
  limit: number,
  durationMs: number,
): number {
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
      if (value.resetAt <= now) store.delete(ip);
    }
  }

  return entry.count > limit ? Math.ceil((entry.resetAt - now) / 1000) : 0;
}

export function consumeLoginAttempt(request: FastifyRequest): number {
  return consumeAttempt(request, attempts, maxAttempts, windowMs);
}

export function consumeOrderAttempt(request: FastifyRequest): number {
  return consumeAttempt(request, orderAttempts, maxOrderAttempts, orderWindowMs);
}
