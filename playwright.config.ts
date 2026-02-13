import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.BASE_URL || 'https://sourcelibrary.org',
    navigationTimeout: 20_000,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
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
