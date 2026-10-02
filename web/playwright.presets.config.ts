import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './performance-tests',
  timeout: 15 * 60 * 1000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5181',
    viewport: { width: 1104, height: 700 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [
        '--no-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5181 --strictPort',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: !process.env.CI,
  },
});
