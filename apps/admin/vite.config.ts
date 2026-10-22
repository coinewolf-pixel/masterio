import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Общий пакет берётся из исходников (ESM), а не из собранного CommonJS — так Vite видит изменения сразу.
const shared = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@masterio/shared': shared } },
  server: { port: 5173, strictPort: true },
  build: { sourcemap: true, target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { environment: 'jsdom', include: ['test/**/*.test.{ts,tsx}'] },
});
