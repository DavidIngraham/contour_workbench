import { defineConfig } from 'vite';
export default defineConfig({base: './', optimizeDeps: {include: ['fflate', 'manifold-3d']}, worker: {format: 'es'}, build: {target: 'es2022'}});
