import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@shared': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/shared') } },
  test: {
    include: process.env['AGENTDOCK_INTEGRATION']
      ? ['tests/integration/**/*.test.ts']
      : ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: process.env['AGENTDOCK_INTEGRATION'] ? 60000 : 5000,
    fileParallelism: false
  }
});
