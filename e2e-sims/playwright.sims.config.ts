/**
 * Playwright config for simulated-user scenarios (e2e-sims/).
 *
 * Separate from playwright.config.ts on purpose: that one runs ./e2e nightly
 * against production, read-only. These sims sign in invented users and WRITE
 * (chat, notes, reports), so they only ever run against a local server or a
 * host named in SIMS_ALLOW_HOST (see study-rooms/target.ts). No CI workflow
 * runs them.
 *
 *   BASE_URL=http://localhost:3000 SIMS_AUTH_SECRET=... npm run test:sims
 */
import { defineConfig } from '@playwright/test';
import { assertSafeTarget } from './study-rooms/target';

// Validate early when a target is given; `--list` works without one.
if (process.env.BASE_URL) assertSafeTarget(process.env.BASE_URL);

export default defineConfig({
  testDir: './study-rooms',
  outputDir: '../test-results/sims',
  fullyParallel: false,
  // Several browser contexts per test already; one test at a time keeps the
  // shared rooms predictable.
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: { 'X-E2E-Test': 'sourcelibrary-sims' },
  },
  projects: [
    {
      name: 'chromium-fake-media',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
});
