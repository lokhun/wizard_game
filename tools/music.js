// Music box: play any theme (realm explore / combat, boss, menu, stingers) and
// set its intensity. window.__render(state, sec, intensity) renders a theme
// offline and returns its level, for scripts/music.mjs.
import { GameAudio } from '../src/audio/audio.js';
import { THEMES } from '../src/audio/themes.js';

const audio = new GameAudio();
const names = [...Object.keys(THEMES), 'victory', 'defeat', 'explore', 'combat', 'boss'];
const groups = [['Menu', (n) => n === 'menu'], ['Realms — exploring', (n) => n.startsWith('explore:')], ['Realms — fighting', (n) => n.startsWith('combat:')],
  ['Bosses', (n) => n.startsWith('boss:')], ['Stingers and the old shared pieces', (n) => !n.includes(':') && n !== 'menu']];
const list = document.getElementById('list'), ctl = document.getElementById('ctl');
const btns = new Map();
let cur = null;
for (const [title, test] of groups) {
  const h = document.createElement('div'); h.className = 'grp'; h.textContent = title; list.appendChild(h);
  for (const n of names.filter(test)) {
    const b = document.createElement('button'); b.textContent = n.replace(/^(explore|combat|boss):/, ''); btns.set(n, b);
    b.onclick = () => { audio.init(); audio.setVolumes({ music: 0.8 }); cur = cur === n ? null : n; audio.setMusic(cur); for (const [k, x] of btns) x.classList.toggle('on', k === cur); };
    list.appendChild(b);
  }
}
for (const k of [0, 1, 2]) {
  const b = document.createElement('button'); b.textContent = 'intensity ' + k;
  b.onclick = () => audio.setMusicIntensity(k);
  ctl.appendChild(b);
}

// offline: the theme's first `sec` seconds; RMS and peak in dBFS of the music bus
window.__render = async (state, sec = 30, intensity = 0) => {
  const rate = 22050, off = new OfflineAudioContext(2, Math.ceil(rate * sec), rate);
  const a = new GameAudio();
  a.init({ context: off, manualPump: true, raw: true });
  a.setVolumes({ master: 1, music: 1 });
  a._musicIntensity = intensity;
  a.setMusic(state);
  a._music.tick(sec);
  const buf = await off.startRendering();
  const L = buf.getChannelData(0), Rr = buf.getChannelData(1);
  let ss = 0, pk = 0, n = 0;
  const win = Math.floor(rate * 0.4), wins = [];
  let ws = 0;
  for (let i = Math.floor(rate * 2); i < L.length; i++) { const v = (L[i] + Rr[i]) * 0.5; ss += v * v; n++; ws += v * v; pk = Math.max(pk, Math.abs(L[i]), Math.abs(Rr[i])); if (n % win === 0) { wins.push(Math.sqrt(ws / win)); ws = 0; } }
  const db = (x) => (20 * Math.log10(Math.max(1e-9, x))).toFixed(1);
  wins.sort((x, y) => x - y);
  return { state, rms: db(Math.sqrt(ss / n)), peak: db(pk), quiet10: db(wins[Math.floor(wins.length * 0.1)] ?? 0), loud90: db(wins[Math.floor(wins.length * 0.9)] ?? 0) };
};
window.__names = names;
window.__ready = true;
