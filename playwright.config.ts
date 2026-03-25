import { defineConfig } from '@playwright/test';

export default defineConfig({
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
    baseURL: process.env.BASE_URL || 'https://sourcelibrary-v2.vercel.app',
    navigationTimeout: 20_000,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    extraHTTPHeaders: {
      // Identify as our E2E suite so we can whitelist in WAF if needed
      'X-E2E-Test': 'sourcelibrary',
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
