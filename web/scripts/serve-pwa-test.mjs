/** Isolated production server for root/subpath, offline, and release-lifecycle tests. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
let revision = 1;
let requireActivation = false;
let releaseWorker;
let workerGate;
const requests = new Map();
const hash = body => createHash('sha256').update(body).digest('hex');
const htmlForRelease = body =>
  Buffer.from(
    body
      .toString()
      .replace(
        /name="workbench-release" content="[^"]+"/,
        `name="workbench-release" content="test-${revision}"`,
      )
      .replace('</head>', `<meta name="test-release" content="${revision}" /></head>`),
  );
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
    releaseWorker?.();
    workerGate = url.searchParams.has('holdWorker')
      ? new Promise(resolve => {
          releaseWorker = resolve;
        })
      : undefined;
    revision = Number(url.searchParams.get('version'));
    requireActivation = url.searchParams.has('requireActivation');
    response.end('ok');
    return;
  }
  if (url.pathname === '/__test/resume-worker' && request.method === 'POST') {
    releaseWorker?.();
    workerGate = undefined;
    response.end('ok');
    return;
  }
  if (url.pathname === '/__test/requests') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(Object.fromEntries(requests)));
    return;
  }
  const pathname = decodeURIComponent(url.pathname).replace(/^\/contour_workbench\//, '/');
  if (pathname === '/sw.js') await workerGate;
  requests.set(pathname, (requests.get(pathname) || 0) + 1);
  if (/^\/assets\/release-\d+\.js$/.test(pathname)) {
    if (pathname !== `/assets/release-${revision}.js`) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'text/javascript');
    response.end(`export const release = ${revision};`);
    return;
  }
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(resolve(root) + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (revision === 3 && pathname.endsWith('/icon-512.png')) throw new Error('Partial release');
    let body = await readFile(file);
    if (pathname === '/sw.js') {
      const source = body.toString();
      const files = JSON.parse(source.match(/const FILES = (\[.*?\]);/)[1]);
      for (const file of files)
        if (file.url === 'index.html')
          file.revision = hash(htmlForRelease(await readFile(resolve(root, 'index.html'))));
        else if (revision === 3 && file.url.endsWith('icon-512.png'))
          file.revision = 'f'.repeat(64);
      files.push({
        url: `assets/release-${revision}.js`,
        revision: hash(`export const release = ${revision};`),
      });
      body = Buffer.from(
        source
          .replace(/const VERSION = '[^']+';/, `const VERSION = 'test-${revision}';`)
          .replace(
            /const COMPATIBILITY = '[^']+';/,
            `const COMPATIBILITY = '${revision === 6 ? 2 : 1}';`,
          )
          .replace(/const FILES = \[.*?\];/, `const FILES = ${JSON.stringify(files)};`),
      );
      if (requireActivation)
        body = Buffer.from(
          body
            .toString()
            .replace(
              'await activateCompatibleRelease();',
              '/* Test: leave the completed worker waiting until the page requests activation. */',
            ),
        );
    }
    if (pathname === '/' || pathname === '/index.html')
      body = revision === 5 ? Buffer.from('<h1>Stale CDN response</h1>') : htmlForRelease(body);
    response.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(5182, '127.0.0.1');
