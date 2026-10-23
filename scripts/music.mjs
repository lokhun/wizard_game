// Music checks.
//   node scripts/music.mjs            melodies: each bar's downbeat note is a tone of that bar's chord
//   PORT=5190 node scripts/music.mjs --render [sec]
//                                     renders every theme offline (tools/music.html) and prints levels,
//                                     at intensity 0 and, for bosses, 2
import { THEMES, chordOf, melDeg } from '../src/audio/themes.js';

const SC = { aeolian: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], locrian: [0, 1, 3, 5, 6, 8, 10] };
const deg = (sc, d) => { const n = sc.length, o = Math.floor(d / n); return sc[d - o * n] + 12 * o; };
let bad = 0;
for (const [name, th] of Object.entries(THEMES)) {
  const spec = th.spec;
  for (const [sk, sec] of Object.entries(spec.sec)) {
    sec.prog.forEach((cv, b) => {
      if (typeof cv !== 'number') return;
      const [r, t, f] = chordOf(spec, cv), q = ((t - r) % 12 + 12) % 12, fi = ((f - r) % 12 + 12) % 12;
      if (fi !== 7) { bad++; console.log(`${name} ${sk} bar ${b}: degree ${cv} is a ${q === 4 ? 'augmented' : 'diminished'} triad`); }
    });
    for (const P of sec.parts) {
      if (!P.m) continue;
      for (const lines of [P.l, ...(P.alts ?? [])]) {
        for (let b = 0; b < sec.bars; b++) {
          const line = lines[b % lines.length], c = line[0];
          if (c === '.' || c === '-') continue;
          const pc = ((deg(SC[spec.scale], melDeg(c)) % 12) + 12) % 12;
          const ch = chordOf(spec, sec.prog[b % sec.prog.length]).map((x) => ((x % 12) + 12) % 12);
          if (!ch.includes(pc)) { bad++; console.log(`${name} ${sk} bar ${b} (${P.m}): '${c}' not in chord`); }
        }
      }
    }
  }
}
console.log(`${Object.keys(THEMES).length} themes, ${bad} downbeats off the chord`);

if (process.argv.includes('--render')) {
  const sec = +(process.argv[process.argv.indexOf('--render') + 1] || 30) || 30;
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await page.goto(`http://localhost:${process.env.PORT ?? 5190}/tools/music.html`, { timeout: 120000 });
  await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  const names = await page.evaluate(() => window.__names);
  for (const n of names) {
    for (const k of n.startsWith('boss') ? [0, 2] : [0]) {
      const r = await page.evaluate(([n, s, k]) => window.__render(n, s, k), [n, sec, k]);
      console.log(`${(n + (k ? ' @' + k : '')).padEnd(26)} rms ${r.rms.padStart(6)}  peak ${r.peak.padStart(6)}  quiet10 ${r.quiet10.padStart(6)}  loud90 ${r.loud90.padStart(6)}`);
    }
  }
  console.log('errors:', errs.length, errs.slice(0, 8).join(' | '));
  await browser.close();
}
