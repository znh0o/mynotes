import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 60000,
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173/mynotes/', channel: process.env.CI ? undefined : 'msedge', viewport: { width: 1440, height: 1080 }, acceptDownloads: true, trace: 'retain-on-failure' },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173/mynotes/', reuseExistingServer: !process.env.CI },
});
