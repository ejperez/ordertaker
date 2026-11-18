import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { adminSessions, users } from './db/schema/auth.js';
import { env } from './config/env.js';
export const sessionCookieName = 'ordertaker_admin';
export const sessionDurationMs = 12 * 60 * 60 * 1000;
export function readSessionCookie(request) {
    const cookie = request.headers.cookie
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${sessionCookieName}=`));
    return cookie ? cookie.slice(sessionCookieName.length + 1) || null : null;
}
export function hashSessionToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
export function setSessionCookie(reply, token, expiresAt) {
    const cookieParts = [
        `${sessionCookieName}=${token}`,
        'Path=/api/admin',
        'HttpOnly',
        'SameSite=Lax',
        `Expires=${expiresAt.toUTCString()}`,
    ];
    if (process.env.NODE_ENV === 'production')
        cookieParts.push('Secure');
    reply.header('Set-Cookie', cookieParts.join('; '));
}
export function clearSessionCookie(reply) {
    const cookieParts = [
        `${sessionCookieName}=`,
        'Path=/api/admin',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=0',
    ];
    if (process.env.NODE_ENV === 'production')
        cookieParts.push('Secure');
    reply.header('Set-Cookie', cookieParts.join('; '));
}
export function hasValidOrigin(request) {
    return request.headers.origin === env.FRONTEND_ORIGIN;
}
export async function requireOwner(request, reply) {
    const token = readSessionCookie(request);
    if (!token) {
        await reply.code(401).send({ error: 'Authentication required' });
        return;
    }
    const [owner] = await request.server.db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(adminSessions)
        .innerJoin(users, eq(adminSessions.userId, users.id))
        .where(and(eq(adminSessions.tokenHash, hashSessionToken(token)), gt(adminSessions.expiresAt, new Date())))
        .limit(1);
    if (!owner) {
        clearSessionCookie(reply);
        await reply.code(401).send({ error: 'Authentication required' });
        return;
    }
    request.owner = owner;
}
export function createSessionToken() {
    return randomBytes(32).toString('base64url');
}
