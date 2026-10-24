import { defineConfig } from 'vite';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { brotliCompressSync, gzipSync, constants as Z } from 'node:zlib';

// Writes .br and .gz next to every compressible file in dist/, so the web
// server can send them as-is (Apache rules in public/.htaccess, nginx
// gzip_static/brotli_static) instead of compressing on every request or not
// at all. Roughly a 3-4x smaller download for players.
function precompress() {
  const EXT = /\.(js|css|html|svg|json|txt|xml|wasm)$/;
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  return {
    name: 'precompress',
    apply: 'build',
    closeBundle() {
      let raw = 0, br = 0;
      for (const file of walk('dist')) {
        if (!EXT.test(file)) continue;
        const buf = readFileSync(file);
        if (buf.length < 1024) continue;
        const b = brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_SIZE_HINT]: buf.length } });
        writeFileSync(file + '.br', b);
        writeFileSync(file + '.gz', gzipSync(buf, { level: 9 }));
        raw += buf.length; br += b.length;
      }
      console.log(`precompress: ${(raw / 1024).toFixed(0)} KB -> ${(br / 1024).toFixed(0)} KB brotli`);
    },
  };
}

// Every build gets an id, baked into the game (__BUILD__) and written beside it
// as version.json: an open game checks that file and moves players onto a new
// deploy (src/core/version.js). The dev server's id is 'dev' (no checks).
let commit = 'nogit';
try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ }
const BUILD_ID = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${commit}`;
function versionFile() {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ v: BUILD_ID }) }); },
  };
}

// base './' makes the build work from any sub-path of a website
// (e.g. https://lokhunproject.com/games/arcane-ascent/).
export default defineConfig(({ command }) => ({
  base: './',
  define: { __BUILD__: JSON.stringify(command === 'build' ? BUILD_ID : 'dev') },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
    target: 'es2020',
  },
  plugins: [precompress(), versionFile()],
  server: { host: true },
}));
