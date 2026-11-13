import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Set VITE_BASE_PATH=/app/ to serve the SPA from a sub-path behind a proxy.
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false
      },
      '/uploads': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false
      },
      '/health': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
