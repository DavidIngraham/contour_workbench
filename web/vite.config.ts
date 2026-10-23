import { defineConfig } from 'vite';
import { pwaBuild } from './pwa-build';
export default defineConfig({
  base: './',
  plugins: [pwaBuild()],
  optimizeDeps: { include: ['fflate', 'manifold-3d', 'fast-xml-parser', 'geotiff'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
