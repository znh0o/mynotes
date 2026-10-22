import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4173/mynotes/', channel: process.env.CI ? undefined : 'msedge', viewport: { width: 1440, height: 1080 }, acceptDownloads: true, trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173/mynotes/', reuseExistingServer: !process.env.CI },
});
