import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const shared = resolve(root, 'src/shared');

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        // the PTY worker is a second entry: it is loaded by file name at runtime
        input: { index: resolve(root, 'src/main/index.ts'), 'pty-worker': resolve(root, 'src/main/pty/pty-worker.ts') },
        external: ['node-pty', 'better-sqlite3']
      }
    }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    // sandboxed preload must be CommonJS
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    resolve: { alias: { '@shared': shared, '@': resolve(root, 'src/renderer') } },
    plugins: [react(), tailwindcss()]
  }
});
