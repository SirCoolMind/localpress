import { defineConfig } from '@playwright/test';
import { mainServer } from './helpers.js';

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 5 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  globalSetup: './global-setup.js',
  use: {
    baseURL: mainServer.url,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: mainServer.command,
    url: `${mainServer.url}api/ping`,
    env: mainServer.env,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
