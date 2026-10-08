import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
