/** Isolated production server for root/subpath, offline, and release-lifecycle tests. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
let revision = 1;
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:5182');
  if (url.pathname === '/__test/release' && request.method === 'POST') {
    revision = Number(url.searchParams.get('version'));
    response.end('ok');
    return;
  }
  const pathname = decodeURIComponent(url.pathname).replace(/^\/contour_workbench\//, '/');
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(resolve(root) + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (revision === 3 && pathname.endsWith('/icon-512.png')) throw new Error('Partial release');
    let body = await readFile(file);
    if (pathname === '/sw.js')
      body = Buffer.from(
        body.toString().replace(/const VERSION = '[^']+';/, `const VERSION = 'test-${revision}';`),
      );
    if (pathname === '/' || pathname === '/index.html')
      body = Buffer.from(
        body
          .toString()
          .replace('</head>', `<meta name="test-release" content="${revision}" /></head>`),
      );
    response.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(5182, '127.0.0.1');
