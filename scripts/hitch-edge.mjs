// Frame-time and shader-compile tracer on the real GPU (Windows: Edge over ANGLE/D3D11).
//   node scripts/hitch-edge.mjs "<url>" [scripts/hitch-tour.js] [--profile-dir=DIR] [--json=out.json] [--headful]
// e.g. node scripts/hitch-edge.mjs "http://localhost:4173/?test=1&autostart=stormcaller&floor=1&seed=4242" scripts/hitch-tour.js
// A fresh launch() has a cold GPU shader cache (a first-time player); --profile-dir reuses
// a browser profile, so the second run against it is a returning player.
// Every rAF gap is recorded with the scenario tag the page script sets (window.__tag), the
// GL time spent in it (program links, texture and buffer uploads), and each program link
// with its main-thread blocking time and a JS stack. Prints per-tag frame stats and every
// program linked after the page reached gameplay. Env EDGE overrides the browser path.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import readline from 'node:readline';

const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const [url, scriptFile] = args.filter((a) => !a.startsWith('--'));
const EDGE = process.env.EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const launchOpts = {
  executablePath: EDGE,
  headless: !args.includes('--headful'),
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
};

const init = () => {
  // the scenario tag, and when it last changed
  let tag = 'boot', tagT = 0;
  Object.defineProperty(window, '__tag', { get: () => tag, set: (v) => { tag = v; tagT = performance.now(); } });
  const acc = { link: 0, linkN: 0, tex: 0, texN: 0, buf: 0 };
  window.__frames = [];
  let last = 0, lastTag = 'boot';
  // a frame belongs to the scenario that held the larger part of it (the tour's timers only
  // get to change the tag after a long frame, but work it starts itself follows the change)
  const f = (t) => {
    const ft = tag !== lastTag && tagT - last < t - tagT ? tag : lastTag;
    if (last) window.__frames.push({ t: last, dt: t - last, tag: ft, link: acc.link, linkN: acc.linkN, tex: acc.tex, texN: acc.texN, buf: acc.buf });
    acc.link = acc.linkN = acc.tex = acc.texN = acc.buf = 0;
    last = t; lastTag = tag;
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
  window.__links = [];
  const P = WebGL2RenderingContext.prototype;
  const rec = new WeakMap();
  const link = P.linkProgram;
  P.linkProgram = function (p) {
    Error.stackTraceLimit = 60;
    const st = (new Error().stack || '').split('\n').slice(2, 60).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\/(assets\/)?/, '').replace(/\)$/, '')).join(' < ');
    const r = { t: performance.now(), tag: window.__tag, block: 0, stack: st };
    rec.set(p, r); window.__links.push(r);
    Object.defineProperty(r, 'gl', { value: p }); // (not serialised: named from three's program list at the end)
    const so = window.__shadowObj; // set by a tour while three draws shadow maps
    if (so) { const m = Array.isArray(so.material) ? so.material[0] : so.material; r.shadowOf = `${so.type} ${so.name || so.parent?.name || ''} ${m?.type}${m?.name ? ':' + m.name : ''} alphaTest=${m?.alphaTest} map=${!!m?.map} side=${m?.side}`; }
    return link.call(this, p);
  };
  // the first query of a program waits for its compile: that wait is the freeze
  for (const name of ['getProgramParameter', 'getUniformLocation', 'getActiveUniform', 'getAttribLocation', 'getActiveAttrib', 'getProgramInfoLog']) {
    const fn = P[name];
    P[name] = function (p, ...a) {
      const r = rec.get(p);
      if (!r) return fn.call(this, p, ...a);
      const t0 = performance.now();
      const out = fn.call(this, p, ...a);
      const d = performance.now() - t0;
      r.block += d; acc.link += d;
      // the call that waited is the program's first use (often frames after its link)
      if (d > 1) { r.wait = (r.wait ?? 0) + d; if (!r.useTag) { r.useTag = window.__tag; r.useCall = name; r.useStack = (new Error().stack || '').split('\n').slice(2, 14).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\/(assets\/)?/, '').replace(/\)$/, '')).join(' < '); } if (!r.counted) { r.counted = true; acc.linkN++; } }
      return out;
    };
  }
  const timed = (name, key) => {
    const fn = P[name];
    P[name] = function (...a) { const t0 = performance.now(); const out = fn.apply(this, a); acc[key] += performance.now() - t0; if (key === 'tex') acc.texN++; return out; };
  };
  for (const n of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'texStorage2D', 'generateMipmap']) timed(n, 'tex');
  for (const n of ['bufferData', 'bufferSubData']) timed(n, 'buf');
};

const pct = (v, q) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
export function summarize(frames, links) {
  const tags = {};
  for (const f of frames) (tags[f.tag] ??= []).push(f);
  const rows = {};
  for (const [k, fs] of Object.entries(tags)) {
    const dt = fs.map((f) => f.dt);
    const ls = links.filter((l) => l.tag === k), us = links.filter((l) => l.useTag === k);
    rows[k] = { n: fs.length, med: +pct(dt, 0.5).toFixed(1), p99: +pct(dt, 0.99).toFixed(1), max: Math.round(Math.max(...dt)), over50: dt.filter((d) => d > 50).length, links: ls.length, waitMs: Math.round(us.reduce((s, l) => s + l.wait, 0)), tex: Math.round(fs.reduce((s, f) => s + f.tex, 0)), buf: Math.round(fs.reduce((s, f) => s + f.buf, 0)) };
  }
  return rows;
}

// long trace events off the page's main thread (ANGLE in the GPU process), with the
// scenario tag of the frame they fell in. Streams the file: traces get big.
async function gpuEvents(file, tmark, frames) {
  const threads = new Map(), open = new Map(), out = [];
  let mark = null;
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  for await (let line of rl) {
    line = line.trim();
    if (!line.startsWith('{"')) continue;
    if (line.endsWith(',')) line = line.slice(0, -1);
    let e; try { e = JSON.parse(line); } catch { try { e = JSON.parse(line.slice(0, line.lastIndexOf('}]') + 1)); } catch { continue; } } // the last event closes the array
    if (e.ph === 'M' && e.name === 'thread_name') { threads.set(e.pid + ':' + e.tid, e.args.name); continue; }
    if (e.name === '__hitchMark') mark = e.ts;
    const k = e.pid + ':' + e.tid;
    if (e.ph === 'B') (open.get(k) ?? open.set(k, []).get(k)).push(e);
    else if (e.ph === 'E') { const b = open.get(k)?.pop(); if (b) out.push({ ...b, dur: e.ts - b.ts }); } else if (e.ph === 'X') out.push(e);
  }
  const off = mark ? mark / 1000 - tmark : 0;
  const tagAt = (t) => { let lo = 0, hi = frames.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].t <= t) lo = mid; else hi = mid - 1; } return frames[lo]?.tag; };
  const min = +(opt('trace-min') ?? 30) * 1000;
  const agg = {};
  for (const e of out) {
    if (!(e.dur >= min)) continue;
    const th = threads.get(e.pid + ':' + e.tid) ?? e.tid;
    // a compile's HLSL tells whose shader it is: Skia (the page's 2D/DOM raster) or the game's WebGL
    const src = e.args?.source;
    const who = !src ? '' : /_sk_|sk_RTAdjust/.test(src) ? ' skia' : /_projectionMatrix|_modelViewMatrix|_tDiffuse|_uv/.test(src) ? ' webgl' : ' other';
    const key = `${e.name}${who} [${th}]`;
    (agg[key] ??= []).push(`${tagAt(e.ts / 1000 - off)}:${Math.round(e.dur / 1000)}`);
  }
  for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].length - a[1].length)) console.log(`gpu ${k} x${v.length}: ${v.slice(0, 60).join(' ')}`);
}

// the functions that ran between two page timestamps (ms), by self and inclusive time
let _pi = null;
function cpuIn(p, mark, t0, t1, n = 6) {
  if (!_pi || _pi.p !== p) {
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const ts = []; let t = p.startTime;
    for (let i = 0; i < p.samples.length; i++) { t += p.timeDeltas[i] ?? 0; ts.push(t); }
    const mi = p.samples.findIndex((id) => byId.get(id).callFrame.functionName === '__hitchMarker');
    const off = mi >= 0 ? ts[mi] / 1000 - mark : 0;
    _pi = { p, byId, parent, ts, off };
  }
  const { byId, parent, ts, off } = _pi;
  const name = (n) => `${n.callFrame.functionName || '(anon)'}${n.callFrame.url ? ':' + (n.callFrame.lineNumber + 1) : ''}`;
  const self = new Map(), incl = new Map();
  let total = 0;
  for (let i = 0; i < ts.length; i++) {
    const tm = ts[i] / 1000 - off;
    if (tm < t0 || tm > t1) continue;
    const dt = (ts[i + 1] ?? ts[i]) / 1000 - ts[i] / 1000;
    total += dt;
    let id = p.samples[i];
    const k = name(byId.get(id));
    self.set(k, (self.get(k) ?? 0) + dt);
    const seen = new Set();
    for (; id != null; id = parent.get(id)) { const kk = name(byId.get(id)); if (!seen.has(kk)) { seen.add(kk); incl.set(kk, (incl.get(kk) ?? 0) + dt); } }
  }
  const top = (m, n) => [...m].filter(([k]) => !/^\((root|program)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ');
  return `sampled ${Math.round(total)} ms | self: ${top(self, n)} | incl: ${top(incl, n + 4)}`;
}

// --analyze=run.json --trace=trace.json: the trace report again for a saved run
if (opt('analyze')) { const d = JSON.parse(fs.readFileSync(opt('analyze'), 'utf8')); await gpuEvents(opt('trace'), d.tmark, d.frames); } else if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const pdir = opt('profile-dir');
  const browser = pdir ? null : await chromium.launch(launchOpts);
  const ctx = pdir ? await chromium.launchPersistentContext(pdir, { ...launchOpts, viewport: { width: 1600, height: 900 } }) : await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(init);
  // --cpu: a sampling CPU profile of the whole run, cut up per long frame below
  let cdp = null;
  if (args.includes('--cpu')) {
    cdp = await ctx.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  // --trace: GPU-process trace events (ANGLE's shader compiles run there, out of the page's sight)
  const trace = browser ? opt('trace') : null; // (tracing needs a launched browser, not a reused profile)
  if (opt('trace') && !browser) console.warn('--trace is ignored with --profile-dir');
  if (trace) await browser.startTracing(page, { path: trace, categories: [...(args.includes('--trace-gpu') ? ['gpu'] : []), ...(opt('trace-cats')?.split(',') ?? []), 'gpu.angle', 'blink.user_timing'] });
  await page.goto(url, { timeout: 120000 });
  const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e.UNMASKED_RENDERER_WEBGL); });
  let res = null;
  if (scriptFile) res = await page.evaluate(fs.readFileSync(scriptFile, 'utf8'));
  else await page.waitForTimeout(+(opt('wait') ?? 15000));
  // a named busy loop at a known performance.now() lines the profile's clock up with the page's
  const mark = cdp ? await page.evaluate(() => { const t0 = performance.now(); (function __hitchMarker() { while (performance.now() - t0 < 30); })(); return t0; }) : 0;
  const tmark = trace ? await page.evaluate(() => { const t = performance.now(); performance.mark('__hitchMark'); return t; }) : 0;
  const { frames, links } = await page.evaluate(() => {
    const progs = window.__game?.renderer?.renderer?.info?.programs ?? [];
    for (const l of window.__links) { const pr = progs.find((x) => x.program === l.gl); if (pr) l.name = pr.name + ' ' + String(pr.cacheKey); }
    return { frames: window.__frames, links: window.__links };
  });
  if (trace) await browser.stopTracing();
  const prof = cdp ? (await cdp.send('Profiler.stop')).profile : null;
  await (browser ?? ctx).close();
  const rows = summarize(frames, links);
  const play = frames.filter((f) => !['boot', 'menu', 'veil', 'begin', 'portal'].includes(f.tag)).map((f) => f.dt);
  const all = { gpu, errors: errors.slice(0, 5), result: res, overall: { frames: play.length, p99: +pct(play, 0.99).toFixed(1), max: Math.round(Math.max(...play)), over50: play.filter((d) => d > 50).length } };
  console.log(JSON.stringify(all));
  console.log('tag'.padEnd(18), 'frames   med   p99   max  >50ms  links waitMs  texMs bufMs');
  for (const [k, r] of Object.entries(rows)) console.log(k.padEnd(18), String(r.n).padStart(6), String(r.med).padStart(5), String(r.p99).padStart(5), String(r.max).padStart(5), String(r.over50).padStart(6), String(r.links).padStart(6), String(r.waitMs).padStart(6), String(r.tex).padStart(6), String(r.buf).padStart(5));
  const SKIP = /WebGL|Program|renderObject|renderScene|renderBufferDirect|setProgram|getProgram|projectObject|traverse|prepareMaterial|compile|onBuild|fetchAttributeLocations|getUniforms|^\S+\.js:\d+:\d+$/;
  // programs linked, or first used (and waited on), outside the loading phases
  const quiet = ['boot', 'menu', 'veil', 'begin', 'portal'];
  for (const l of links.filter((x) => !quiet.includes(x.tag) || (x.wait > 5 && !quiet.includes(x.useTag)))) console.log(`  link ${String(Math.round(l.wait ?? 0)).padStart(4)} ms [${l.tag}${l.useTag && l.useTag !== l.tag ? ' → used ' + l.useTag : ''}] ${(l.name ?? '(released)').slice(0, 200)}${l.useStack && l.useTag !== l.tag ? ' {first use: ' + l.useCall + ' < ' + l.useStack.split(' < ').filter((s) => !SKIP.test(s)).slice(0, 5).join(' < ') + '}' : ''}${l.shadowOf ? ' [shadow of ' + l.shadowOf + ']' : ''} | ${l.stack.split(' < ').filter((s) => !SKIP.test(s)).slice(0, 6).join(' < ')}`);
  if (prof) {
    // --cpu-tags=regex: where the main thread's time went over each matching phase
    if (opt('cpu-tags')) {
      const re = new RegExp(opt('cpu-tags'));
      for (const t of [...new Set(frames.map((f) => f.tag))].filter((t) => re.test(t))) {
        const fs = frames.filter((f) => f.tag === t);
        console.log(`phase [${t}] ${fs.length} frames, ${Math.round(fs.at(-1).t + fs.at(-1).dt - fs[0].t)} ms  ${cpuIn(prof, mark, fs[0].t, fs.at(-1).t + fs.at(-1).dt, 25)}`);
      }
    }
    const long = frames.filter((f) => f.dt > +(opt('cpu-min') ?? 50) && !['boot'].includes(f.tag));
    for (const f of long) console.log(`frame ${Math.round(f.dt)} ms [${f.tag}] @${Math.round(f.t)}  ${cpuIn(prof, mark, f.t, f.t + f.dt)}`);
  }
  if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify({ ...all, rows, frames, links, tmark }));
  if (trace) await gpuEvents(trace, tmark, frames);
}
