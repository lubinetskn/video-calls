import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
const once = (socket: Socket, event: string): Promise<any[]> => new Promise(resolve => socket.once(event, (...args: any[]) => resolve(args)));
import { createApp } from './app.js';

test('rooms enforce capacity, scoped signaling, chat and cleanup', async () => {
  const { app } = createApp(':memory:');
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const clients: Socket[] = [];
  async function client() { const s = io(url, { transports: ['websocket'], reconnection: false }); clients.push(s); await once(s, 'connect'); return s; }
  const join = (s: Socket, room: string, name: string): Promise<any> => s.timeout(2000).emitWithAck('join', { room, name });
  try {
    const room = (await app.inject({ method: 'POST', url: '/api/rooms' })).json().id;
    assert.equal(room.length, 24);
    assert.equal((await app.inject('/api/rooms/not-real')).statusCode, 404);
    const a = await client(), b = await client(), c = await client();
    assert.match((await join(c, 'not-real', 'C')).error, /not found/);
    assert.deepEqual((await join(a, room, 'Alice')).peers, []);
    assert.equal((await join(b, room, 'Bob')).peers[0].name, 'Alice');
    assert.match((await join(c, room, 'C')).error, /two people/);
    const received = once(b, 'message');
    assert.equal((await a.timeout(2000).emitWithAck('message', 'Hello')).ok, true);
    assert.equal((await received)[0].text, 'Hello');
    assert.ok((await c.timeout(2000).emitWithAck('message', 'unauthorised')).error);
    const signal = once(b, 'signal');
    a.emit('signal', { target: b.id, data: { description: { type: 'offer', sdp: 'test' } } });
    assert.equal((await signal)[0].from, a.id);
    const left = once(b, 'peer-left'); a.disconnect(); await left;
    const rejoin = await join(c, room, 'Carol');
    assert.equal(rejoin.messages[0].text, 'Hello');
    assert.equal(rejoin.peers.length, 1);
    assert.equal((await app.inject(`/api/rooms/${room}`)).json().participants, 2);
  } finally { clients.forEach(c => c.disconnect()); await app.close(); }
});

test('room creation is rate limited', async () => {
  const { app } = createApp(':memory:');
  try {
    for (let i = 0; i < 20; i++) assert.equal((await app.inject({ method:'POST', url:'/api/rooms' })).statusCode, 201);
    assert.equal((await app.inject({ method:'POST', url:'/api/rooms' })).statusCode, 429);
  } finally { await app.close(); }
});
