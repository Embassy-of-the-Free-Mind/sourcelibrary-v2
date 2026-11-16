import { defineConfig } from '@playwright/test';

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    // Use Vercel direct URL by default to avoid Cloudflare bot protection in CI.
    // Override with BASE_URL=https://sourcelibrary.org for local testing.
    baseURL: process.env.BASE_URL,
    navigationTimeout: 20_000,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    extraHTTPHeaders: {
      // Identifies the suite in logs only: this value is public, so no rule may trust it.
      'X-E2E-Test': 'sourcelibrary',
      // The edge pass (v2#8603): a Cloudflare skip rule, first in the custom ruleset, matches this secret
      // (GitHub Actions secret E2E_EDGE_TOKEN) so bot protection does not challenge the suite from Azure runners.
      ...(process.env.E2E_EDGE_TOKEN ? { 'X-E2E-Edge-Token': process.env.E2E_EDGE_TOKEN } : {}),
    },
  },

  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['list']]
    : [['list']],

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
