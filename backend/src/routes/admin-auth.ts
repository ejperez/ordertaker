import bcrypt from 'bcryptjs';
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
import { prisma } from '../db.js';
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

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + sessionDurationMs);
    await prisma.$transaction([
      prisma.adminSession.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
      prisma.adminSession.create({
        data: { tokenHash: hashSessionToken(token), userId: user.id, expiresAt },
      }),
    ]);

    setSessionCookie(reply, token, expiresAt);
    return { user: { id: user.id, name: user.name, email: user.email } };
  });

  app.post('/logout', { preHandler: requireOwner }, async (request, reply) => {
    if (!hasValidOrigin(request)) {
      return reply.code(403).send({ error: 'Request origin is not allowed' });
    }
    const token = readSessionCookie(request);
    if (token)
      await prisma.adminSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    revokeOwnerSockets(request.owner!.id);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/me', { preHandler: requireOwner }, async (request) => ({ user: request.owner }));
};
