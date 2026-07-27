import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // src/tests/qa-automation.spec.ts is a Playwright spec (pre-existing, separate test
    // runner) — only collect our own Vitest unit tests, not Playwright's.
    include: ['server/**/*.test.ts', 'src/**/*.test.ts']
  }
});
