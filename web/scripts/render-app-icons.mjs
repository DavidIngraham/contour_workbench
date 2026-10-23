/** Raster fallbacks derived from the existing mountain mark; run after changing icon.svg. */
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const directory = new URL('../public/', import.meta.url);
await mkdir(new URL('icons/', directory), { recursive: true });
const svg = await readFile(new URL('icon.svg', directory), 'utf8');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const render = async (size, maskable = false) => {
    const data = await page.evaluate(
      async ({ svg, size, maskable }) => {
        const image = new Image();
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (maskable) {
          ctx.fillStyle = '#172d27';
          ctx.fillRect(0, 0, size, size);
        }
        const margin = maskable ? size * 0.2 : 0;
        ctx.drawImage(image, margin, margin, size - 2 * margin, size - 2 * margin);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { svg, size, maskable },
    );
    return Buffer.from(data, 'base64');
  };
  for (const [filename, size, maskable] of [
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['apple-touch-icon.png', 180, false],
    ['maskable-512.png', 512, true],
  ])
    await writeFile(new URL(`icons/${filename}`, directory), await render(size, maskable));
  const images = await Promise.all([16, 32].map(size => render(size)));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((png, i) => {
    const position = 6 + 16 * i;
    header[position] = header[position + 1] = [16, 32][i];
    header.writeUInt16LE(1, position + 4);
    header.writeUInt16LE(32, position + 6);
    header.writeUInt32LE(png.length, position + 8);
    header.writeUInt32LE(offset, position + 12);
    offset += png.length;
  });
  await writeFile(new URL('favicon.ico', directory), Buffer.concat([header, ...images]));
} finally {
  await browser.close();
}
