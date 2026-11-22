import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createApp } from './app.js';
if (existsSync('.env')) loadEnvFile('.env');
const { app } = createApp();
await app.listen({ port: Number(process.env.PORT || 8080), host: process.env.HOST || '127.0.0.1' });
console.log(`Video Calls listening on ${app.server.address() && JSON.stringify(app.server.address())}`);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, async () => { await app.close(); process.exit(0); });
