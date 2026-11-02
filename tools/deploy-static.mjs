// Deploy a static browser game (a folder with an index.html, no build) to
// https://play.lokhunproject.fun/<slug>/, next to Arcane Ascent on the same server.
// Usage: node tools/deploy-static.mjs <slug> <folder>
//   e.g. node tools/deploy-static.mjs ashen-arena "../arena_duels"
// The folder is copied as it is (less .git, .claude and node_modules), with .br and .gz copies
// beside every file they shrink, into /opt/wizard/play/<slug>; the version it replaces is kept
// in /opt/wizard/static.old/<slug>. Served once tools/deploy.mjs has set up the play/ layout. Add the
// game to the home page (deploy/home/index.html) for players to find it.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants as Z } from 'node:zlib';

const [slug, src] = process.argv.slice(2);
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug ?? '') || !src) throw Error('usage: node tools/deploy-static.mjs <slug> <folder>');
if (['arcane-ascent', '_site', 'assets'].includes(slug)) throw Error(`${slug} is taken`);
const from = resolve(src);
if (!existsSync(join(from, 'index.html'))) throw Error(`no index.html in ${from}`);

const root = fileURLToPath(new URL('..', import.meta.url));
const work = `${root}test-output/deploy-${slug}`;
const options = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
  '-o', 'UserKnownHostsFile=C:/Users/lokhu/.ssh/known_hosts', '-i', 'C:/Users/lokhu/.ssh/rift_digitalocean'];
const host = 'root@157.230.224.36';

function run(executable, args, { input, cwd } = {}) {
  const r = spawnSync(executable, args, { input, cwd, encoding: 'utf8' });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0) throw Error(r.stderr || `${executable} failed`);
}

rmSync(work, { recursive: true, force: true });
mkdirSync(`${work}/stage`, { recursive: true });
const SKIP = new Set(['.git', '.claude', 'node_modules', '.DS_Store', 'Thumbs.db', 'desktop.ini']);
cpSync(from, `${work}/stage/${slug}`, { recursive: true, filter: (p) => !SKIP.has(p.split(/[\\/]/).pop()) });

// Precompressed copies for Caddy's file_server (precompressed br gzip), kept only where they
// save at least a tenth: text, and mocap clips, which shrink about 6x; not embedded textures.
const EXT = /\.(js|mjs|css|html|svg|json|txt|xml|wasm|fbx|glb|gltf|obj|bin)$/i;
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
let raw = 0, sent = 0;
for (const file of walk(`${work}/stage/${slug}`)) {
  const buf = readFileSync(file);
  raw += buf.length;
  if (!EXT.test(file) || buf.length < 1024) { sent += buf.length; continue; }
  const quality = buf.length > (1 << 20) ? 9 : 11;
  const b = brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: quality, [Z.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  if (b.length > buf.length * 0.9) { sent += buf.length; continue; }
  writeFileSync(file + '.br', b);
  writeFileSync(file + '.gz', gzipSync(buf, { level: 9 }));
  sent += b.length;
}
console.log(`${slug}: ${(raw / 1048576).toFixed(1)} MB, ${(sent / 1048576).toFixed(1)} MB to download with brotli`);
// Relative paths: GNU tar (Git Bash) reads "C:..." as a remote host.
run('tar', ['-czf', `${slug}.tar.gz`, '-C', 'stage', slug], { cwd: work });

run('scp', [...options, `${slug}.tar.gz`, `${host}:/opt/wizard/${slug}.tar.gz`], { cwd: work });
run('ssh', [...options, host, 'sh', '-s'], { input: `set -eu
cd /opt/wizard
mkdir -p play && chmod 755 play
rm -rf next-${slug} && mkdir next-${slug}
tar -xzf ${slug}.tar.gz -C next-${slug}
rm ${slug}.tar.gz
# Archives built on Windows carry 666/777 modes.
find next-${slug} -type d -exec chmod 755 {} +
find next-${slug} -type f -exec chmod 644 {} +
test -f next-${slug}/${slug}/index.html
mkdir -p static.old
rm -rf static.old/${slug}
if [ -d play/${slug} ]; then mv play/${slug} static.old/${slug}; fi
mv next-${slug}/${slug} play/${slug}
rm -rf next-${slug}
# (before the first tools/deploy.mjs with the play/ layout, the site doesn't serve play/ yet)
if curl -fsS http://127.0.0.1:3003/ | grep -q '<title>Lokhun Project Games</title>'; then
  curl -fsS -o /dev/null http://127.0.0.1:3003/${slug}/
  curl -fsS -o /dev/null https://play.lokhunproject.fun/${slug}/
else
  echo "installed in /opt/wizard/play/${slug}; it goes live with the next tools/deploy.mjs"
fi
` });
console.log(`deployed https://play.lokhunproject.fun/${slug}/`);
