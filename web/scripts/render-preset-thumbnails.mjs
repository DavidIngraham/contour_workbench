import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const catalogPath = resolve('public/examples/catalog.json'),
  catalog = JSON.parse(await readFile(catalogPath, 'utf8')),
  baseUrl = process.env.APP_URL || 'http://localhost:5173';
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
  const page = await browser.newPage({ viewport: { width: 1104, height: 700 } });
  for (const preset of catalog.models) {
    await page.goto(`${baseUrl}/?preset=${encodeURIComponent(preset.id)}`);
    await page.waitForFunction(
      () =>
        Boolean(window.contourDiagnostics?.triangles) &&
        !window.contourDiagnostics?.busy &&
        window.contourDiagnostics?.thumbnail,
      null,
      { timeout: 120000 },
    );
    const dataUrl = await page.evaluate(() => window.contourDiagnostics.thumbnail()),
      comma = dataUrl.indexOf(',');
    if (comma < 0) throw new Error(`${preset.name} returned an invalid thumbnail.`);
    await writeFile(
      resolve('public', preset.image),
      Buffer.from(dataUrl.slice(comma + 1), 'base64'),
    );
    console.log(`Rendered ${preset.name} with the shared project thumbnail camera.`);
  }
} finally {
  await browser.close();
}
