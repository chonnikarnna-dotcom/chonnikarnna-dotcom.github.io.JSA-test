import { defineConfig } from '@playwright/test';

/**
 * E2E tests run against a running stack (API + frontend) seeded with demo users:
 *   backend: npm run db:reset && npm run db:seed   (SEED_DEMO_USERS default on in development)
 *   E2E_BASE_URL defaults to the Vite dev server.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    locale: 'en-GB',
    timezoneId: 'Asia/Bangkok',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
});
