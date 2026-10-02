import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  optimizeDeps: { include: ['fflate', 'manifold-3d', 'fast-xml-parser', 'geotiff'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
