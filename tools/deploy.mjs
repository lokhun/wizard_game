// Build Arcane Ascent and deploy it to https://play.lokhunproject.fun.
// Usage: node tools/deploy.mjs
// Installs dist/ into /opt/wizard (static Caddy on loopback :3003; the coturn co-op relay on
// UDP 40050; co-op matchmaking and relay logins on loopback :3004), then points the rift Caddy's
// play.lokhunproject.fun block at it, rolling back if Caddy rejects the config.
// The relay's secret is generated on the server on the first deploy (/opt/wizard/turn.secret)
// and only ever written there: not in git, not in the site, not on this machine.
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
cpSync(`${root}deploy/turnserver.conf`, `${work}/stage/turnserver.conf.in`);
mkdirSync(`${work}/stage/signal`);
for (const f of ['package.json', 'package-lock.json', 'server.mjs']) cpSync(`${root}deploy/signal/${f}`, `${work}/stage/signal/${f}`);
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
# the matchmaking service's dependencies, exactly as locked, no install scripts
docker run --rm -v /opt/wizard/next/signal:/app -w /app node:24-alpine npm ci --omit=dev --ignore-scripts --no-audit --no-fund
chmod -R a+rX next/signal
docker run --rm -v /opt/wizard/next/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
rm -rf site.old
if [ -d site ]; then mv site site.old; fi
mv next/site site
cp next/compose.yaml next/Caddyfile next/turnserver.conf.in .
rm -rf signal.old turn-credentials.mjs
if [ -d signal ]; then mv signal signal.old; fi
mv next/signal signal
rm -rf next
# The relay's shared secret: made once, here, readable only by the login service (uid 1000).
if [ ! -s turn.secret ]; then (umask 077; od -An -tx1 -N32 /dev/urandom | tr -dc 0-9a-f > turn.secret); fi
[ "$(wc -c < turn.secret)" -ge 64 ]
chown 1000:1000 turn.secret && chmod 400 turn.secret
# coturn's config with the secret in place, readable only by coturn (nobody)
mkdir -p turn && chmod 755 turn
(umask 077; sed "s/__TURN_SECRET__/$(cat turn.secret)/" turnserver.conf.in > turn/turnserver.conf)
! grep -q __TURN_SECRET__ turn/turnserver.conf
chown 65534:65534 turn/turnserver.conf && chmod 400 turn/turnserver.conf
# Recreate: the container's bind mounts still point at the replaced files.
docker compose up -d --force-recreate --remove-orphans
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:3003/healthz > /dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:3003/healthz
curl -fsS http://127.0.0.1:3003/ | grep -q '<title>Arcane Ascent</title>'
# the co-op relay answers on its UDP port
for attempt in 1 2 3 4 5; do
  if ss -ulnH 'sport = :40050' | grep -q 40050; then break; fi
  sleep 1
done
ss -ulnH 'sport = :40050' | grep -q 40050
# and the matchmaking service answers
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:3004/healthz > /dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:3004/net-config | grep -q '"credential"'
curl -fsS http://127.0.0.1:3004/peerjs/arcane/peerjs/id > /dev/null
# Point the play site (the {$DOMAIN} block, the only one on :3000) at the wizard game.
[ -f /opt/wizard/Caddyfile.before-wizard ] || cp /opt/rift/deploy/Caddyfile /opt/wizard/Caddyfile.before-wizard
cp /opt/rift/deploy/Caddyfile /opt/wizard/Caddyfile.previous
chmod 644 /opt/wizard/Caddyfile.before-wizard /opt/wizard/Caddyfile.previous
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
curl -fsS https://play.lokhunproject.fun/net-config | grep -q '"credential"'
docker compose ps
` });
console.log('deployed https://play.lokhunproject.fun');
