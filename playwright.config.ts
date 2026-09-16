import { defineConfig, devices } from '@playwright/test';

/**
 * The Playwright suite in src/tests/ was written months ago but had no config and no script,
 * so it had never actually run. It is an INTEGRATION suite, not a hermetic one: it signs in
 * with real school credentials (QA_SCHOOL_EMAIL / QA_SCHOOL_PASSWORD) and expects a seeded
 * school to exist. That is why it is kept out of the default CI run and pointed at whatever
 * environment PLAYWRIGHT_BASE_URL names.
 *
 * Local run:  npm run dev  (in one terminal)
 *             npm run test:e2e
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './src/tests',
  testMatch: '**/*.spec.ts',

  // These specs write real records (they onboard a student), so running files in parallel
  // against one shared environment would have them competing over the same school data.
  fullyParallel: false,
  workers: 1,

  // A flaky pass is worse than a fail here — it hides exactly the pipeline defects this
  // suite exists to catch. No automatic retries.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
