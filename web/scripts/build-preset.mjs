import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [projectArg, bundleArg, imageArg] = process.argv.slice(2);
if (!projectArg || !bundleArg) {
  console.error(
    'Usage: node scripts/build-preset.mjs <project.contour.json> <output.cwpack> [screenshot.png]',
  );
  process.exit(2);
}
const projectPath = resolve(projectArg),
  bundlePath = resolve(bundleArg),
  project = JSON.parse(await readFile(projectPath, 'utf8'));
const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1104, height: 556 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', error => console.error('Browser error:', error.message));
  await page.goto(process.env.APP_URL || 'http://localhost:5173');
  await page.waitForFunction(() => window.contourDiagnostics?.landingOpen, null, {
    timeout: 120000,
  });
  await page.locator('#file-project').setInputFiles(projectPath);
  await page.waitForFunction(
    count =>
      window.contourDiagnostics?.features === count &&
      Number.isFinite(window.contourDiagnostics?.triangles) &&
      !window.contourDiagnostics?.busy,
    project.features.length,
    { timeout: 360000 },
  );
  const pending = page.waitForEvent('download', { timeout: 360000 });
  await page.evaluate(async () => window.contourDiagnostics.buildPreset());
  const download = await pending;
  await mkdir(dirname(bundlePath), { recursive: true });
  await download.saveAs(bundlePath);
  if (imageArg) {
    const imagePath = resolve(imageArg);
    await mkdir(dirname(imagePath), { recursive: true });
    await page.locator('#viewport').screenshot({ path: imagePath });
  }
  console.log(`Built ${bundlePath} with ${project.features.length} linked features.`);
} finally {
  await browser.close();
}
