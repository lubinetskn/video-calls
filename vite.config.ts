import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: 'apps/web', plugins: [react()], server: { port: 3000, proxy: { '/api': 'http://127.0.0.1:8080', '/socket.io': { target: 'http://127.0.0.1:8080', ws: true } } }, build: { outDir: '../../dist/web', emptyOutDir: true } });
