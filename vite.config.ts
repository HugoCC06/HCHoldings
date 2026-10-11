import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the whole app (code, styles, fonts) into ONE self-contained HTML file
// that opens straight from disk in Chrome or from GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  server: { port: 5173, host: '127.0.0.1', open: '/app.html' },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5000,
    rollupOptions: { input: 'app.html' },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
