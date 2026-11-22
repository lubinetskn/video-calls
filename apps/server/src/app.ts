import Fastify from 'fastify';
import { Server } from 'socket.io';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import staticFiles from '@fastify/static';
import { z } from 'zod';

export function createApp(dbPath = process.env.DATABASE_PATH || 'data/calls.sqlite') {
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, created INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, room TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL);`);
  const app = Fastify({ logger: false, bodyLimit: 8192 });
  const io = new Server(app.server, { maxHttpBufferSize: 16384, allowRequest: (req, done) => {
    const origin = req.headers.origin;
    const allowed = process.env.PUBLIC_ORIGIN;
    done(null, !origin || (allowed ? origin === allowed : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080', 'http://127.0.0.1:8080'].includes(origin)));
  }});
  const members = new Map<string, Map<string, string>>();
  const attempts = new Map<string, { count: number; until: number }>();
  const lifetime = 24 * 60 * 60 * 1000;
  function validRoom(id: string) { return db.prepare('SELECT id FROM rooms WHERE id=? AND created>?').get(id, Date.now() - lifetime); }
  function limited(key: string, max: number, duration = 60000) {
    const now = Date.now();
    if (attempts.size > 10000) for (const [k,v] of attempts) if (v.until < now) attempts.delete(k);
    const v = attempts.get(key);
    if (!v || v.until < now) { attempts.set(key, { count: 1, until: now + duration }); return false; }
    return ++v.count > max;
  }
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.post('/api/rooms', async (req, reply) => {
    if (limited('create:' + req.ip, 20)) return reply.code(429).send({ error: 'Too many rooms. Try again in a minute.' });
    const cutoff = Date.now() - lifetime;
    db.prepare('DELETE FROM messages WHERE room IN (SELECT id FROM rooms WHERE created<=?)').run(cutoff);
    db.prepare('DELETE FROM rooms WHERE created<=?').run(cutoff);
    const id = randomBytes(18).toString('base64url');
    db.prepare('INSERT INTO rooms VALUES(?,?)').run(id, Date.now());
    return reply.code(201).send({ id });
  });
  app.get('/api/rooms/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!validRoom(id)) return reply.code(404).send({ error: 'Room not found or expired.' });
    return { id, participants: members.get(id)?.size || 0 };
  });
  app.get('/api/ice', async () => {
    const iceServers: { urls: string | string[]; username?: string; credential?: string }[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) iceServers.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
    return { iceServers };
  });
  io.on('connection', socket => {
    function leave() {
      const room = socket.data.room as string | undefined;
      if (!room) return;
      const peers = members.get(room); peers?.delete(socket.id);
      socket.to(room).emit('peer-left'); socket.leave(room);
      if (!peers?.size) members.delete(room);
      delete socket.data.room;
    }
    socket.on('join', (input, ack) => {
      if (typeof ack !== 'function') return;
      if (limited('join:' + socket.handshake.address, 60)) return ack({ error: 'Too many attempts. Try again shortly.' });
      const parsed = z.object({ room: z.string().regex(/^[\w-]{24}$/), name: z.string().trim().min(1).max(40) }).safeParse(input);
      if (!parsed.success || !validRoom(parsed.data.room)) return ack({ error: 'Room not found or expired.' });
      leave();
      const { room, name } = parsed.data;
      const peers = members.get(room) || new Map<string, string>();
      if (peers.size >= 2) return ack({ error: 'This room already has two people.' });
      const existing = [...peers.entries()].map(([id, name]) => ({ id, name }));
      peers.set(socket.id, name); members.set(room, peers); socket.data.room = room; socket.join(room);
      const messages = db.prepare('SELECT * FROM (SELECT * FROM messages WHERE room=? ORDER BY created DESC LIMIT 100) ORDER BY created ASC').all(room);
      ack({ peers: existing, messages });
      socket.to(room).emit('peer-joined', { id: socket.id, name });
    });
    socket.on('signal', input => {
      const room = socket.data.room as string | undefined;
      if (!room || !validRoom(room) || limited('signal:' + socket.id, 300)) return;
      const parsed = z.object({ target: z.string().max(100), data: z.object({ description: z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(14000) }).optional(), candidate: z.record(z.string(), z.unknown()).optional() }) }).safeParse(input);
      if (!parsed.success || !members.get(room)?.has(parsed.data.target)) return;
      io.to(parsed.data.target).emit('signal', { from: socket.id, data: parsed.data.data });
    });
    socket.on('message', (input, ack) => {
      if (typeof ack !== 'function') return;
      const room = socket.data.room as string | undefined;
      const parsed = z.string().trim().min(1).max(2000).safeParse(input);
      if (!room || !validRoom(room) || !parsed.success) return ack({ error: 'Message could not be sent.' });
      if (limited('chat:' + socket.id, 30)) return ack({ error: 'Please slow down.' });
      const message = { id: randomUUID(), name: members.get(room)!.get(socket.id)!, text: parsed.data, created: Date.now() };
      db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').run(message.id, room, message.name, message.text, message.created);
      io.to(room).emit('message', message); ack({ ok: true });
    });
    socket.on('leave', leave);
    socket.on('disconnect', leave);
  });
  const web = resolve('dist/web');
  if (existsSync(web)) {
    app.register(staticFiles, { root: web });
    app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.type('text/html').sendFile('index.html'));
  }
  app.addHook('onClose', async () => { io.disconnectSockets(); await new Promise<void>(r => io.close(() => r())); db.close(); });
  return { app, io };
}
