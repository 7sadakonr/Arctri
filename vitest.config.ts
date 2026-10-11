import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@shared': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/shared') } },
  test: {
    include: process.env['ARCTRI_INTEGRATION']
      ? ['tests/integration/**/*.test.ts']
      : ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: process.env['ARCTRI_INTEGRATION'] ? 60000 : 5000,
    // Integration tests drive real ConPTY sessions; on a shared CI runner one of them can miss an exit now and then
    retry: process.env['ARCTRI_INTEGRATION'] && process.env['CI'] ? 2 : 0,
    fileParallelism: false
  }
});
