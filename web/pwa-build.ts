/** Emit a deterministic worker from final build files, including lazy workers and WASM. */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import type { Plugin } from 'vite';

export function pwaBuild(): Plugin {
  let output: string;
  return {
    name: 'contour-offline-shell',
    apply: 'build',
    configResolved(config) {
      output = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const template = await readFile(
        new URL('./scripts/service-worker.mjs', import.meta.url),
        'utf8',
      );
      const files: string[] = [];
      const visit = async (directory: string) => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name);
          if (entry.isDirectory()) await visit(path);
          else {
            const name = relative(output, path).replaceAll('\\', '/');
            if (
              /^(assets\/|icons\/|examples\/images\/)/.test(name) ||
              [
                'index.html',
                'icon.svg',
                'favicon.ico',
                'app.webmanifest',
                'examples/catalog.json',
              ].includes(name)
            )
              files.push(name);
          }
        }
      };
      await visit(output);
      files.sort();
      const hash = createHash('sha256').update(template);
      for (const file of files) hash.update(file).update(await readFile(resolve(output, file)));
      const source = template
        .replace('__VERSION__', hash.digest('hex').slice(0, 20))
        .replace("['__FILES__']", JSON.stringify(files));
      await writeFile(resolve(output, 'sw.js'), source);
    },
  };
}
