import { defineConfig } from 'vite';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  plugins: [precompress()],
  server: { host: true },
});
