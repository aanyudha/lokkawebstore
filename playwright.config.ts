import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  // One disposable database backs the whole suite (workers: 1 keeps the shared
  // demo catalog, fixed local ports and relative stock assertions deterministic).
  globalSetup: './tests/browser/global-setup.ts',
  globalTeardown: './tests/browser/global-teardown.ts',
  workers: 1,
  timeout: 60000,
  use: {
    channel: process.platform === 'win32' ? 'chrome' : 'chromium',
    headless: true,
  },
  outputDir: 'test-results',
});
