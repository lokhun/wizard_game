// CPU (and optionally allocation) profile of a test script, via the Chrome DevTools Protocol.
// Usage: PORT=5194 node scripts/profile.mjs "<query>" <script.js> [waitMs] [--alloc] [--startup]
// Prints the script's result, then the top functions by self time (and by
// sampled allocation with --alloc). --startup profiles the page load instead.
// A script that calls console.profile()/console.profileEnd() is profiled over
// just that window (scripts/stress.js does, around its timed runs).
import { chromium } from 'playwright-core';
import fs from 'fs';
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [query = '', scriptFile, wait = '3000'] = args.filter((a) => !a.startsWith('--'));
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
let consoleProfile = null;
cdp.on('Profiler.consoleProfileFinished', (e) => { consoleProfile = e.profile; });
const url = (process.env.URL ?? 'http://localhost:' + (process.env.PORT ?? 5180) + '/') + query;
if (flags.has('--startup')) await cdp.send('Profiler.start');
await page.goto(url, { timeout: 300000 });
await page.waitForTimeout(+wait);
// profile the script, not the rest of the load
if (!flags.has('--startup')) await page.waitForFunction(() => window.__game?.player && !window.__game.loadingFloor, null, { timeout: 600000, polling: 500 });
if (!flags.has('--startup')) await cdp.send('Profiler.start');
// allocations are sampled from a '[stress] measuring' console marker if the script prints one
let allocProfile = null;
const startAlloc = async () => { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096 }); };
if (flags.has('--alloc')) {
  let marked = false;
  page.on('console', async (m) => {
    const t = m.text();
    if (t === '[stress] measuring') { marked = true; await cdp.send('HeapProfiler.stopSampling').catch(() => {}); await startAlloc(); }
    if (t === '[stress] done' && marked) allocProfile = (await cdp.send('HeapProfiler.stopSampling')).profile;
  });
  await startAlloc();
}
if (scriptFile) {
  const res = await page.evaluate(fs.readFileSync(scriptFile, 'utf8'));
  if (res !== undefined) console.log('[script]', JSON.stringify(res).slice(0, 4000));
}
let { profile } = await cdp.send('Profiler.stop');
if (consoleProfile) profile = consoleProfile;
const short = (u) => (u || '').replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '');
const self = new Map();
const dt = profile.timeDeltas, byId = new Map(profile.nodes.map((n) => [n.id, n]));
let total = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const cf = n.callFrame;
  const key = `${cf.functionName || '(anon)'} ${short(cf.url)}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
  total += dt[i] ?? 0;
}
console.log(`\nCPU self time (total ${(total / 1000).toFixed(0)} ms)`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, +(process.env.TOP ?? 45))) console.log((v / 1000).toFixed(1).padStart(9), 'ms', (100 * v / total).toFixed(1).padStart(5) + '%', k);
// CALLERS=fnA,fnB: where those functions' time comes from (stack paths, 4 frames up)
if (process.env.CALLERS) {
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const nm = (n) => `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`;
  for (const want of process.env.CALLERS.split(',')) {
    const paths = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      let id = profile.samples[i], hit = null;
      for (let k = id; k !== undefined; k = parent.get(k)) if (byId.get(k).callFrame.functionName === want) { hit = k; break; }
      if (hit === null) continue;
      // skip recursion (updateMatrixWorld calls itself down the tree)
      while (parent.has(hit) && byId.get(parent.get(hit)).callFrame.functionName === want) hit = parent.get(hit);
      const path = [];
      for (let k = parent.get(hit), d = 0; k !== undefined && d < 4; k = parent.get(k), d++) path.push(nm(byId.get(k)));
      const key = path.join(' < ');
      paths.set(key, (paths.get(key) ?? 0) + (dt[i] ?? 0));
    }
    console.log(`\n${want} (inclusive) by caller:`);
    for (const [k, v] of [...paths].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log((v / 1000).toFixed(1).padStart(9), 'ms', k);
  }
}
if (flags.has('--alloc')) {
  const hp = allocProfile ?? (await cdp.send('HeapProfiler.stopSampling')).profile;
  const acc = new Map();
  let all = 0;
  const walk = (n) => {
    const cf = n.callFrame;
    const key = `${cf.functionName || '(anon)'} ${short(cf.url)}:${cf.lineNumber + 1}`;
    acc.set(key, (acc.get(key) ?? 0) + n.selfSize); all += n.selfSize;
    for (const c of n.children) walk(c);
  };
  walk(hp.head);
  console.log(`\nSampled allocations (total ${(all / 1048576).toFixed(1)} MB)`);
  for (const [k, v] of [...acc].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log((v / 1024).toFixed(0).padStart(9), 'KB', k);
}
await browser.close();
