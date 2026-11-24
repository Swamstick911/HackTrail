import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/platform-browser',
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:47658',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/e2e-platform.mjs',
    url: 'http://127.0.0.1:47658/api/health',
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
