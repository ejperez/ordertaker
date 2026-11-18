import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { adminSessions } from './db/schema/auth.js';
import { env } from './config/env.js';

export const sessionCookieName = 'ordertaker_admin';
export const sessionDurationMs = 12 * 60 * 60 * 1000;

declare module 'fastify' {
  interface FastifyRequest {
    owner: { id: string; name: string; email: string } | null;
  }
}

export function readSessionCookie(request: FastifyRequest): string | null {
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));

  return cookie ? cookie.slice(sessionCookieName.length + 1) || null : null;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  const cookieParts = [
    `${sessionCookieName}=${token}`,
    'Path=/api/admin',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (process.env.NODE_ENV === 'production') cookieParts.push('Secure');
  reply.header('Set-Cookie', cookieParts.join('; '));
}

export function clearSessionCookie(reply: FastifyReply): void {
  const cookieParts = [
    `${sessionCookieName}=`,
    'Path=/api/admin',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (process.env.NODE_ENV === 'production') cookieParts.push('Secure');
  reply.header('Set-Cookie', cookieParts.join('; '));
}

export function hasValidOrigin(request: FastifyRequest): boolean {
  return request.headers.origin === env.FRONTEND_ORIGIN;
}

export async function requireOwner(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = readSessionCookie(request);
  if (!token) {
    await reply.code(401).send({ error: 'Authentication required' });
    return;
  }

  const session = await request.server.db.query.adminSessions.findFirst({
    where: and(
      eq(adminSessions.tokenHash, hashSessionToken(token)),
      gt(adminSessions.expiresAt, new Date()),
    ),
    with: { user: { columns: { id: true, name: true, email: true } } },
  });
  if (!session) {
    clearSessionCookie(reply);
    await reply.code(401).send({ error: 'Authentication required' });
    return;
  }

  request.owner = session.user;
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}
