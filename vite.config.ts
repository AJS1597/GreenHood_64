import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the built game can be served from any static path.
  base: './',
  server: {
    host: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
