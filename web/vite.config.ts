import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served under /trapline/ behind nginx (and by the Fastify server itself).
export default defineConfig({
  base: '/trapline/',
  plugins: [react()],
  server: {
    port: 5173,
    // Allow importing ../shared/types.ts from outside the web/ root.
    fs: { allow: ['..'] },
    proxy: {
      '/trapline/api': {
        target: `http://127.0.0.1:${process.env.TRAPLINE_PORT ?? 8731}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
