import { defineConfig } from 'vite';

// base './' makes the build work from any sub-path of a website
// (e.g. https://lokhunproject.com/games/arcane-ascent/).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
    target: 'es2020',
  },
  server: { host: true },
});
