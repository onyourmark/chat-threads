import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Most tests are pure logic and run in Node. The suites that need a DOM
    // opt into jsdom with a per-file `@vitest-environment` comment.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
