// Dev server for automated tests: file changes are picked up on the next page
// load, but open pages are never hot-reloaded mid-test.
import { defineConfig } from 'vite';
export default defineConfig({
  root: new URL('..', import.meta.url).pathname,
  server: { port: 5190, hmr: false },
});
