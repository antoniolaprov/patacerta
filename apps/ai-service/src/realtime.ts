import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { isStaff, verifyToken } from './auth.js';
import { config } from './config.js';

export const REALTIME_CHANNEL = 'patacerta:realtime';

export interface RealtimeEvent {
  rooms: string[];
  event: string;
  payload: unknown;
}

/**
 * WebSocket gateway. The API publishes events on Redis; this service fans them
 * out to the right sockets: `user:<id>` for a tutor, `staff` for the clinic panel.
 * The Redis adapter lets several instances of this service run side by side.
 */
export function startRealtime(http: HttpServer) {
  const io = new Server(http, {
    cors: { origin: config.CORS_ORIGINS.split(',') },
  });
  const pub = new Redis(config.REDIS_URL);
  const sub = pub.duplicate();
  io.adapter(createAdapter(pub, sub));

  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth?.token as string | undefined);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    if (isStaff(user)) socket.join('staff');
  });

  const events = pub.duplicate();
  events.subscribe(REALTIME_CHANNEL);
  events.on('message', (_channel, raw) => {
    try {
      const { rooms, event, payload } = JSON.parse(raw) as RealtimeEvent;
      io.to(rooms).emit(event, payload);
    } catch (err) {
      console.error('[realtime] evento inválido', err);
    }
  });

  const emit = (e: RealtimeEvent) => io.to(e.rooms).emit(e.event, e.payload);
  return { io, emit };
}
