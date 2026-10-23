import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './pwa-tests',
  outputDir: './test-results/pwa',
  timeout: 90000,
  workers: 1,
  use: {
    launchOptions: {
      args: [
        '--no-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    },
  },
  projects: [
    { name: 'root', use: { baseURL: 'http://127.0.0.1:5182/' } },
    { name: 'pages-subpath', use: { baseURL: 'http://127.0.0.1:5182/contour_workbench/' } },
  ],
  webServer: {
    command: 'node scripts/serve-pwa-test.mjs',
    url: 'http://127.0.0.1:5182/',
    reuseExistingServer: false,
  },
});
