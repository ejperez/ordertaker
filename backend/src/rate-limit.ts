import type { FastifyRequest } from 'fastify';

const windowMs = 15 * 60 * 1000;
const maxAttempts = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

export function consumeLoginAttempt(request: FastifyRequest): number {
  const now = Date.now();
  const key = request.ip;
  let entry = attempts.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    attempts.set(key, entry);
  }
  entry.count += 1;

  if (attempts.size > 1000) {
    for (const [ip, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(ip);
    }
  }

  return entry.count > maxAttempts ? Math.ceil((entry.resetAt - now) / 1000) : 0;
}
