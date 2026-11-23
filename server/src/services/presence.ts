import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { config } from '../config.js';
import { parseCookies, resolveSession, sessionEvents } from '../auth/sessions.js';
import { getDb } from '../db/index.js';

/**
 * Authenticated real-time presence (§34). Identity always comes from the server-side session
 * found via the HttpOnly cookie in the handshake; client-supplied ids are ignored.
 */
interface Conn {
  socketId: string;
  userId: number;
  sessionId: number;
  email: string;
  connectedAt: string;
  lastHeartbeat: number;
  userAgent: string;
  ip: string;
}

const STALE_MS = 90_000;
let io: Server | null = null;
const conns = new Map<string, Conn>();

export function presenceSnapshot() {
  const list = [...conns.values()];
  const users = new Map<number, { userId: number; email: string; sockets: number; sessions: Set<number>; since: string; lastHeartbeat: number }>();
  for (const c of list) {
    const u = users.get(c.userId) ?? { userId: c.userId, email: c.email, sockets: 0, sessions: new Set<number>(), since: c.connectedAt, lastHeartbeat: 0 };
    u.sockets++;
    u.sessions.add(c.sessionId);
    if (c.connectedAt < u.since) u.since = c.connectedAt;
    u.lastHeartbeat = Math.max(u.lastHeartbeat, c.lastHeartbeat);
    users.set(c.userId, u);
  }
  const activeSessions = (getDb().prepare("SELECT COUNT(*) c FROM user_sessions WHERE revoked_at IS NULL AND expires_at > ?").get(new Date().toISOString()) as any).c;
  return {
    socketConnections: list.length,
    uniqueOnlineUsers: users.size,
    connectedSessions: new Set(list.map((c) => c.sessionId)).size,
    activeAuthenticatedSessions: activeSessions,
    users: [...users.values()].map((u) => ({ ...u, sessions: [...u.sessions], lastHeartbeat: new Date(u.lastHeartbeat).toISOString() })),
    connections: list.map((c) => ({ ...c, lastHeartbeat: new Date(c.lastHeartbeat).toISOString() })),
  };
}

function broadcastToAdmins() {
  io?.to('super_admins').emit('presence:update', presenceSnapshot());
}

function disconnectSessions(sessionIds: number[], reason: string) {
  if (!io) return;
  for (const c of [...conns.values()]) {
    if (!sessionIds.includes(c.sessionId)) continue;
    const s = io.sockets.sockets.get(c.socketId);
    s?.emit('session:revoked', { reason });
    s?.disconnect(true);
    conns.delete(c.socketId);
  }
  broadcastToAdmins();
}

export function attachPresence(server: HttpServer) {
  io = new Server(server, { path: '/socket.io', serveClient: false, cors: { origin: false } });
  sessionEvents.onRevoke = (ids, reason) => disconnectSessions(ids, reason);

  io.use((socket, next) => {
    const token = parseCookies(socket.handshake.headers.cookie)[config.sessionCookie];
    const r = resolveSession(token);
    if (!r) return next(new Error('unauthorized'));
    (socket.data as any).userId = r.user.id;
    (socket.data as any).sessionId = r.session.id;
    (socket.data as any).role = r.user.role;
    (socket.data as any).token = token;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const d = socket.data as any;
    const user = getDb().prepare('SELECT email FROM users WHERE id = ?').get(d.userId) as any;
    conns.set(socket.id, {
      socketId: socket.id,
      userId: d.userId,
      sessionId: d.sessionId,
      email: user?.email ?? '',
      connectedAt: new Date().toISOString(),
      lastHeartbeat: Date.now(),
      userAgent: String(socket.handshake.headers['user-agent'] || '').slice(0, 200),
      ip: String(socket.handshake.address || ''),
    });
    if (d.role === 'super_admin') socket.join('super_admins');
    broadcastToAdmins();

    // re-validate the session on every event (revocation / disablement / expiry)
    const stillValid = () => {
      const r = resolveSession(d.token);
      if (!r || r.session.id !== d.sessionId) {
        socket.emit('session:revoked', { reason: 'session_invalid' });
        socket.disconnect(true);
        return null;
      }
      return r;
    };

    socket.on('heartbeat', () => {
      if (!stillValid()) return;
      const c = conns.get(socket.id);
      if (c) c.lastHeartbeat = Date.now();
    });
    socket.on('presence:get', (ack?: (x: unknown) => void) => {
      const r = stillValid();
      if (!r || r.user.role !== 'super_admin') return ack?.({ error: 'forbidden' });
      ack?.(presenceSnapshot());
    });
    socket.on('disconnect', () => {
      conns.delete(socket.id);
      broadcastToAdmins();
    });
  });

  // sweep stale connections and sessions that became invalid
  const timer = setInterval(() => {
    let changed = false;
    for (const c of [...conns.values()]) {
      const s = io!.sockets.sockets.get(c.socketId);
      const stale = Date.now() - c.lastHeartbeat > STALE_MS;
      const sess = getDb()
        .prepare('SELECT s.revoked_at, s.expires_at, u.status FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.id = ?')
        .get(c.sessionId) as any;
      const invalid = !sess || sess.revoked_at || new Date(sess.expires_at).getTime() <= Date.now() || sess.status !== 'enabled';
      if (stale || invalid || !s) {
        if (invalid) s?.emit('session:revoked', { reason: 'session_invalid' });
        s?.disconnect(true);
        conns.delete(c.socketId);
        changed = true;
      }
    }
    if (changed) broadcastToAdmins();
  }, 30_000);
  timer.unref();
  return io;
}

export function closePresence() {
  io?.close();
  io = null;
  conns.clear();
}
