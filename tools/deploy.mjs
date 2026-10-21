// Build Arcane Ascent and deploy it to https://play.lokhunproject.fun.
// Usage: node tools/deploy.mjs
// Installs dist/ into /opt/wizard (static Caddy on loopback :3003), then points the rift
// Caddy's play.lokhunproject.fun block at it, rolling back if Caddy rejects the config.
// The RIFT game container keeps running on :3000; /opt/wizard/Caddyfile.before-wizard
// holds the front Caddyfile as it was before the first wizard deploy.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = `${root}test-output/deploy`;
const options = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
  '-o', 'UserKnownHostsFile=C:/Users/lokhu/.ssh/known_hosts', '-i', 'C:/Users/lokhu/.ssh/rift_digitalocean'];
const host = 'root@157.230.224.36';

function run(executable, args, { input, cwd } = {}) {
  const r = spawnSync(executable, args, { input, cwd, encoding: 'utf8' });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0) throw Error(r.stderr || `${executable} failed`);
}

run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: root });

// Layout inside: compose.yaml, Caddyfile, site/ (the contents of dist/).
rmSync(work, { recursive: true, force: true });
mkdirSync(`${work}/stage`, { recursive: true });
cpSync(`${root}dist`, `${work}/stage/site`, { recursive: true });
cpSync(`${root}deploy/compose.yaml`, `${work}/stage/compose.yaml`);
cpSync(`${root}deploy/Caddyfile`, `${work}/stage/Caddyfile`);
// Relative paths: GNU tar (Git Bash) reads "C:..." as a remote host.
run('tar', ['-czf', 'wizard-deploy.tar.gz', '-C', 'stage', '.'], { cwd: work });

run('ssh', [...options, host, 'mkdir -p /opt/wizard']);
run('scp', [...options, `${work}/wizard-deploy.tar.gz`, `${host}:/opt/wizard/wizard-deploy.tar.gz`], { cwd: work });
run('ssh', [...options, host, 'sh', '-s'], { input: `set -eu
cd /opt/wizard
rm -rf next && mkdir next
tar -xzf wizard-deploy.tar.gz -C next
# Archives built on Windows carry 666/777 modes.
find next -type d -exec chmod 755 {} +
find next -type f -exec chmod 644 {} +
test -f next/site/index.html
docker run --rm -v /opt/wizard/next/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
rm -rf site.old
if [ -d site ]; then mv site site.old; fi
mv next/site site
cp next/compose.yaml next/Caddyfile .
rm -rf next
# Recreate: the container's bind mounts still point at the replaced files.
docker compose up -d --force-recreate --remove-orphans
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:3003/healthz > /dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:3003/healthz
curl -fsS http://127.0.0.1:3003/ | grep -q '<title>Arcane Ascent</title>'
# Point the play site (the {$DOMAIN} block, the only one on :3000) at the wizard game.
[ -f /opt/wizard/Caddyfile.before-wizard ] || cp -p /opt/rift/deploy/Caddyfile /opt/wizard/Caddyfile.before-wizard
cp -p /opt/rift/deploy/Caddyfile /opt/wizard/Caddyfile.previous
sed -i 's#reverse_proxy 127.0.0.1:3000$#reverse_proxy 127.0.0.1:3003#' /opt/rift/deploy/Caddyfile
grep -q 'reverse_proxy 127.0.0.1:3003' /opt/rift/deploy/Caddyfile
# Copy the current host file: a single-file bind can retain an older inode after game updates.
docker cp /opt/rift/deploy/Caddyfile rift-caddy-1:/tmp/wizard-Caddyfile
if ! docker exec rift-caddy-1 caddy validate --config /tmp/wizard-Caddyfile --adapter caddyfile; then
  cat /opt/wizard/Caddyfile.previous > /opt/rift/deploy/Caddyfile
  exit 1
fi
if ! docker exec rift-caddy-1 caddy reload --config /tmp/wizard-Caddyfile --adapter caddyfile; then
  cat /opt/wizard/Caddyfile.previous > /opt/rift/deploy/Caddyfile
  docker cp /opt/wizard/Caddyfile.previous rift-caddy-1:/tmp/wizard-Caddyfile
  docker exec rift-caddy-1 caddy reload --config /tmp/wizard-Caddyfile --adapter caddyfile
  exit 1
fi
curl -fsS https://play.lokhunproject.fun/healthz
curl -fsS https://play.lokhunproject.fun/ | grep -q '<title>Arcane Ascent</title>'
docker compose ps
` });
console.log('deployed https://play.lokhunproject.fun');
