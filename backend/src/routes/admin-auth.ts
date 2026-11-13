import bcrypt from 'bcryptjs';
import { eq, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import {
  clearSessionCookie,
  createSessionToken,
  hashSessionToken,
  hasValidOrigin,
  readSessionCookie,
  requireOwner,
  sessionDurationMs,
  setSessionCookie,
} from '../auth.js';
import { adminSessions, users } from '../db/schema/index.js';
import { consumeLoginAttempt } from '../rate-limit.js';
import { revokeOwnerSockets } from '../realtime.js';

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

export const adminAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', async (request, reply) => {
    if (!hasValidOrigin(request)) {
      return reply.code(403).send({ error: 'Request origin is not allowed' });
    }

    const retryAfter = consumeLoginAttempt(request);
    if (retryAfter > 0) {
      reply.header('Retry-After', String(retryAfter));
      return reply.code(429).send({ error: 'Too many login attempts. Try again later.' });
    }

    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid email or password' });

    const [user] = await app.db
      .select()
      .from(users)
      .where(eq(users.email, parsed.data.email.toLowerCase()))
      .limit(1);
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + sessionDurationMs);
    await app.db.transaction(async (transaction) => {
      await transaction.delete(adminSessions).where(lte(adminSessions.expiresAt, new Date()));
      await transaction.insert(adminSessions).values({
        tokenHash: hashSessionToken(token),
        userId: user.id,
        expiresAt,
      });
    });

    setSessionCookie(reply, token, expiresAt);
    return { user: { id: user.id, name: user.name, email: user.email } };
  });

  app.post('/logout', { preHandler: requireOwner }, async (request, reply) => {
    if (!hasValidOrigin(request)) {
      return reply.code(403).send({ error: 'Request origin is not allowed' });
    }
    const token = readSessionCookie(request);
    if (token) {
      await request.server.db
        .delete(adminSessions)
        .where(eq(adminSessions.tokenHash, hashSessionToken(token)));
    }
    revokeOwnerSockets(request.owner!.id);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/me', { preHandler: requireOwner }, async (request) => ({ user: request.owner }));
};
