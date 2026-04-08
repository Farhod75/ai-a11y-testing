import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
export default defineConfig({
  testDir: './playwright-tests',
  outputDir: './reports/playwright-results',
  fullyParallel: false,
  retries: 1,
  reporter: [
    ['html', { outputFolder: './reports/html-report' }],
    ['json', { outputFile: './reports/results.json' }],
    ['list'],
  ],
  use: {
    headless: true,
    screenshot: 'on',
    baseURL: process.env.BASE_URL || 'https://dequeuniversity.com/demo/mars',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});