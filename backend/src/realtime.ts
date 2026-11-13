import { createHash } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { and, eq, gt } from 'drizzle-orm';
import { env } from './config/env.js';
import { hashSessionToken, sessionCookieName } from './auth.js';
import type { AppDatabase } from './db.js';
import { adminSessions, orders } from './db/schema/index.js';

const ownerRoom = 'owners';
let realtimeServer: Server | null = null;

function hashTrackingToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  const cookie = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) || null : null;
}

export function attachRealtimeServer(server: HttpServer, db: AppDatabase): Server {
  const io = new Server(server, {
    path: '/api/admin/socket.io',
    cors: { origin: env.FRONTEND_ORIGIN, credentials: true },
    maxHttpBufferSize: 64 * 1024,
  });
  realtimeServer = io;

  io.use(async (socket, next) => {
    try {
      if (socket.handshake.headers.origin !== env.FRONTEND_ORIGIN) {
        next(new Error('Origin is not allowed'));
        return;
      }

      const requestedRole = socket.handshake.auth?.role;
      const ownerToken = readCookie(socket.handshake.headers.cookie, sessionCookieName);
      if (requestedRole === 'owner' && ownerToken) {
        const session = await db.query.adminSessions.findFirst({
          where: and(
            eq(adminSessions.tokenHash, hashSessionToken(ownerToken)),
            gt(adminSessions.expiresAt, new Date()),
          ),
          columns: { expiresAt: true },
          with: { user: { columns: { id: true, name: true } } },
        });
        if (!session) {
          next(new Error('Authentication required'));
          return;
        }
        socket.data.role = 'owner';
        socket.data.owner = session.user;
        socket.data.sessionExpiresAt = session.expiresAt.getTime();
        next();
        return;
      }

      if (requestedRole !== 'customer') {
        next(new Error('Authentication required'));
        return;
      }

      const token = socket.handshake.auth?.trackingToken;
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        next(new Error('Authentication required'));
        return;
      }

      const order = await db.query.orders.findFirst({
        where: eq(orders.trackingTokenHash, hashTrackingToken(token)),
        columns: { id: true },
      });
      if (!order) {
        next(new Error('Authentication required'));
        return;
      }
      socket.data.role = 'customer';
      socket.data.orderId = order.id;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error('Socket authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.data.role === 'owner') {
      void socket.join(ownerRoom);
      if (typeof socket.data.owner?.id === 'string') {
        void socket.join(ownerIdentityRoom(socket.data.owner.id));
      }
      if (typeof socket.data.sessionExpiresAt === 'number') {
        const expiryTimer = setTimeout(
          () => socket.disconnect(true),
          Math.max(0, socket.data.sessionExpiresAt - Date.now()),
        );
        expiryTimer.unref();
        socket.on('disconnect', () => clearTimeout(expiryTimer));
      }
      return;
    }
    if (socket.data.role === 'customer' && typeof socket.data.orderId === 'string') {
      void socket.join(orderRoom(socket.data.orderId));
    }
  });

  return io;
}

export function revokeOwnerSockets(ownerId: string): void {
  realtimeServer?.in(ownerIdentityRoom(ownerId)).disconnectSockets(true);
}

export function closeRealtimeServer(): Promise<void> {
  if (!realtimeServer) return Promise.resolve();
  const io = realtimeServer;
  realtimeServer = null;
  return new Promise((resolve) => io.close(() => resolve()));
}

function orderRoom(orderId: string): string {
  return `order:${orderId}`;
}

function ownerIdentityRoom(ownerId: string): string {
  return `owner:${ownerId}`;
}

export function publishOrderCreated(orderId: string, orderNumber: string): void {
  realtimeServer?.to(ownerRoom).emit('order:created', { orderId, orderNumber });
}

export function publishOrderUpdated(
  orderId: string,
  event: 'order:updated' | 'payment:updated',
  payload: Record<string, unknown>,
): void {
  realtimeServer?.to(ownerRoom).emit(event, { orderId, ...payload });
  realtimeServer?.to(orderRoom(orderId)).emit(event, { orderId, ...payload });
}

export function publishNewMessage(
  orderId: string,
  message: {
    id: string;
    senderType: 'CUSTOMER' | 'OWNER';
    senderName: string;
    message: string;
    createdAt: Date;
  },
): void {
  const payload = { orderId, message };
  realtimeServer?.to(ownerRoom).emit('message:new', payload);
  realtimeServer?.to(orderRoom(orderId)).emit('message:new', payload);
}
