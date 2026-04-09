import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@eggbomb/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['all'],
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      '/stats': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
