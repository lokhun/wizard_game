import { iconSVG, classEmblem } from '../ui/icons.js';
import { CLASS_META, CLASS_IDS } from '../game/classMeta.js';
import { ENEMY_DEFS, BOSS_DEFS } from '../game/enemyDefs.js';
import { BIOMES } from '../world/biomes.js';
import { loadProfile, saveProfile, storageOk } from './profile.js';
import { FEATS, FEAT_GROUPS, bestiaryTypes } from './feats.js';
import { PACTS, PACT_BY_ID, NIGHTMARE, BOSS_RUSH, MAX_HEAT, heatOf, cleanPacts, dailyRite, utcDay, pactOpen, nextUnlock, heatBoons } from './pacts.js';
import { fmtTime, fmtNum } from './summary.js';

// ---------------------------------------------------------------------------
// Menu screens of the meta layer: the Codex (feats, wizards, bestiary,
// records), the pact board and the daily rite card. All are modals over the
// menu backdrop; Escape backs out of each.
// ---------------------------------------------------------------------------

const hex = (n) => '#' + (n ?? 0xffffff).toString(16).padStart(6, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROMAN = ['I', 'II', 'III'];

// a modal that closes on Escape (and runs `keys` for everything else)
function keyed(ui, m, onClose, keys) {
  const close = () => { window.removeEventListener('keydown', onKey); if (m.isConnected) ui._closeModal(m, false); onClose?.(); };
  const onKey = (e) => {
    if (!m.isConnected) { window.removeEventListener('keydown', onKey); return; }
    if (ui.modalStack[ui.modalStack.length - 1] !== m) return; // a modal on top of us has the keys
    if (e.code === 'Escape') { e.preventDefault(); close(); } else keys?.(e);
  };
  window.addEventListener('keydown', onKey);
  return close;
}

// ================================================================== codex
export function showCodex(ui, { tab = 0, onClose } = {}) {
  const p = loadProfile();
  const earned = FEATS.filter((f) => p.feats[f.id]).length;
  const tabs = ['Feats', 'Wizards', 'Bestiary', 'Records'];
  const m = ui._modal(`
    <div class="cx panel">
      <div class="cx-head"><div class="title">The Codex</div><div class="meta">${earned} / ${FEATS.length} feats · ${p.runs} runs · ${p.wins} victories</div></div>
      <div class="cx-tabs">${tabs.map((t, i) => `<div class="cx-tab" data-t="${i}">${t}<span class="k">${i + 1}</span></div>`).join('')}</div>
      <div class="cx-body"></div>
      <div class="cx-foot"><div class="hint">${storageOk ? 'Your codex is kept in this browser.' : 'Browser storage is unavailable: progress this session will not be kept.'} · 1–4 or ←/→ to turn the page · Esc to close</div><button class="btn small" id="cxClose">Close</button></div>
    </div>`);
  const body = m.querySelector('.cx-body');
  const pages = [featsPage, wizardsPage, bestiaryPage, recordsPage];
  let cur = tab;
  const show = (i) => {
    cur = (i + tabs.length) % tabs.length;
    m.querySelectorAll('.cx-tab').forEach((t) => t.classList.toggle('on', +t.dataset.t === cur));
    body.innerHTML = pages[cur](p);
    body.scrollTop = 0;
  };
  m.querySelectorAll('.cx-tab').forEach((t) => { t.onclick = () => { show(+t.dataset.t); ui.audio?.play('ui_click', { volume: 0.4 }); }; });
  const close = keyed(ui, m, onClose, (e) => {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= tabs.length) show(n - 1);
    else if (e.code === 'ArrowRight') show(cur + 1);
    else if (e.code === 'ArrowLeft') show(cur - 1);
  });
  m.querySelector('#cxClose').onclick = close;
  show(tab);
  return m;
}

function featsPage(p) {
  return FEAT_GROUPS.map((g, gi) => `<div class="cx-grp">${g}</div><div class="cx-feats">${FEATS.filter((f) => f.group === gi).map((f) => {
    const got = p.feats[f.id];
    const pr = !got && f.progress ? f.progress(p) : null;
    return `<div class="cx-feat${got ? ' got' : ''}"><div class="ic">${iconSVG(f.icon, got ? '#f0c050' : '#5a5048', 26, { glow: !!got })}</div><div style="min-width:0;flex:1">
      <div class="n">${esc(f.name)}</div><div class="d">${esc(f.desc)}</div>
      ${got ? `<div class="w">Earned ${new Date(got).toLocaleDateString()}</div>` : pr ? `<div class="cx-bar" title="${pr[0]} / ${pr[1]}"><i style="width:${Math.round((pr[0] / pr[1]) * 100)}%"></i></div><div class="w">${fmtNum(pr[0])} / ${fmtNum(pr[1])}</div>` : ''}
    </div></div>`;
  }).join('')}</div>`).join('');
}

function wizardsPage(p) {
  const rows = CLASS_IDS.map((id) => {
    const c = p.classes[id], m = CLASS_META[id];
    const has = c && c.runs > 0;
    const d = (v, f = (x) => x) => (v ? f(v) : '—');
    return `<tr class="${c?.wins ? 'won' : ''}"><td><span class="cn">${classEmblem(id, hex(m.color), 28)}${m.name}</span></td>
      <td class="${has ? '' : 'dim'}">${has ? c.runs : '—'}</td><td class="${c?.wins ? '' : 'dim'}">${d(c?.wins)}${c?.nightmare ? ` <span class="nmw" title="Nightmare victories">· ${c.nightmare} ${iconSVG('skull', '#ff6050', 12, { glow: false })}</span>` : ''}</td>
      <td class="${has ? '' : 'dim'}">${has ? `${c.bestFloor} / ${BIOMES.length}` : '—'}</td><td class="${c?.fastest ? '' : 'dim'}">${d(c?.fastest, fmtTime)}</td>
      <td class="${c?.bestHeat >= 0 && c?.wins ? 'hot' : 'dim'}">${c?.wins && c.bestHeat >= 0 ? c.bestHeat : '—'}</td><td class="${c?.bestAbyss ? 'hot' : 'dim'}">${d(c?.bestAbyss)}</td><td class="${has ? '' : 'dim'}">${has ? fmtNum(c.kills) : '—'}</td></tr>`;
  }).join('');
  return `<table class="cx-table"><tr><th>Wizard</th><th>Runs</th><th>Victories</th><th>Best realm</th><th>Fastest victory</th><th>Highest heat cleared</th><th>Deepest Abyss</th><th>Foes slain</th></tr>${rows}</table>`;
}

function bestiaryPage(p) {
  const nem = (t) => (p.killedBy[t] ? `<span class="nem">ended ${p.killedBy[t]} run${p.killedBy[t] > 1 ? 's' : ''}</span>` : '');
  const beast = (t, d, n, boss) => `<div class="cx-beast${n ? '' : ' unk'}${boss ? ' boss' : ''}"><div style="min-width:0"><div class="n">${n || p.killedBy[t] ? esc(d.name) : 'Unknown foe'}</div>${nem(t)}</div><div class="c">${n ? fmtNum(n) : '—'}</div></div>`;
  const bosses = BIOMES.map((b) => beast(b.boss, BOSS_DEFS[b.boss], p.bosses[b.boss] ?? 0, true)).join('');
  // grouped by the realm a foe first appears in, then the rest
  const seen = new Set();
  let html = `<div class="cx-grp">Realm lords · defeated</div><div class="cx-beasts">${bosses}</div>`;
  for (const b of BIOMES) {
    const ts = [...new Set([...b.enemies, ...(b.elites ?? [])])].filter((t) => ENEMY_DEFS[t] && !seen.has(t));
    ts.forEach((t) => seen.add(t));
    if (ts.length) html += `<div class="cx-grp">${esc(b.name)} · slain by you</div><div class="cx-beasts">${ts.map((t) => beast(t, ENEMY_DEFS[t], p.bestiary[t] ?? 0)).join('')}</div>`;
  }
  const rest = bestiaryTypes().filter((t) => !seen.has(t));
  if (rest.length) html += `<div class="cx-grp">Spawn and stragglers</div><div class="cx-beasts">${rest.map((t) => beast(t, ENEMY_DEFS[t], p.bestiary[t] ?? 0)).join('')}</div>`;
  return html;
}

function recordsPage(p) {
  const t = (label, v, sub = '') => `<div class="rs-tile"><div class="tl">${label}</div><div class="tv" style="font-size:24px">${v}</div><div class="ts">${sub || '&nbsp;'}</div></div>`;
  const nemesis = Object.entries(p.killedBy).sort((a, b) => b[1] - a[1])[0];
  const d = p.daily;
  return `<div class="cx-grp">Lifetime</div><div class="cx-recs">
    ${t('Runs', fmtNum(p.runs), `${fmtNum(p.wins)} victories · ${fmtNum(p.deaths)} deaths`)}
    ${t('Deepest realm', p.bestFloor ? `${p.bestFloor} / ${BIOMES.length}` : '—', p.bestFloor ? esc(BIOMES[p.bestFloor - 1].name) : '')}
    ${t('Foes slain', fmtNum(p.kills))}
    ${t('Damage dealt', fmtNum(p.damage))}
    ${t('Time in the keep', fmtTime(p.time))}
    ${t('Tomes bound', fmtNum(p.tomes))}
    ${t('Chambers cleared', fmtNum(p.rooms), `${fmtNum(p.flawless)} untouched`)}
    ${t('Gold gathered', fmtNum(p.gold))}
  </div><div class="cx-grp">Best of all runs</div><div class="cx-recs">
    ${t('Biggest hit', p.records.biggestHit ? fmtNum(p.records.biggestHit) : '—')}
    ${t('Most damage in a run', p.records.mostDamage ? fmtNum(p.records.mostDamage) : '—')}
    ${t('Most foes in a run', p.records.mostKills ? fmtNum(p.records.mostKills) : '—')}
    ${t('Fastest victory', p.records.fastestWin ? fmtTime(p.records.fastestWin) : '—')}
    ${t('Highest heat cleared', p.records.highestHeat >= 0 ? p.records.highestHeat : '—')}
    ${t('Fastest Boss Rush', p.records.rushBest ? fmtTime(p.records.rushBest) : '—')}
    ${t('Nightmare victories', p.records.nightmareWins ? fmtNum(p.records.nightmareWins) : '—')}
    ${t('Deepest Abyss', p.records.deepestAbyss ? `depth ${p.records.deepestAbyss}` : '—')}
    ${t('Co-op victories', fmtNum(p.coopWins))}
    ${t('Nemesis', nemesis ? esc((ENEMY_DEFS[nemesis[0]] ?? BOSS_DEFS[nemesis[0]])?.name ?? nemesis[0]) : '—', nemesis ? `ended ${nemesis[1]} run${nemesis[1] > 1 ? 's' : ''}` : '')}
    ${t('Daily Rite streak', d.streak ? `${d.streak} day${d.streak > 1 ? 's' : ''}` : '—', `best ${d.bestStreak} · ${d.runs} rites`)}
  </div>`;
}

// ================================================================== pacts
export function pactsUnlocked(p = loadProfile()) { return p.wins > 0; }

// the strip on the class-select screen: the pacts (after the first win) and
// the Nightmare toggle (open from the start, for those who came for a fight)
export function nightmareOn(p = loadProfile()) { return !!cleanPacts(p.pacts).nightmare; }
export function toggleNightmare() {
  const p = loadProfile(), sel = cleanPacts(p.pacts);
  if (sel.nightmare) delete sel.nightmare; else sel.nightmare = 1;
  p.pacts = sel; saveProfile();
  return !!sel.nightmare;
}
export function rushOn(p = loadProfile()) { return !!cleanPacts(p.pacts).rush; }
export function toggleRush() {
  const p = loadProfile(), sel = cleanPacts(p.pacts);
  if (sel.rush) delete sel.rush; else sel.rush = 1;
  p.pacts = sel; saveProfile();
  return !!sel.rush;
}
export function pactStrip(classId) {
  const p = loadProfile();
  const nm = nightmareOn(p), nmWins = p.classes[classId]?.nightmare ?? 0, ru = rushOn(p);
  const rush = `<button class="btn small cs-nm${ru ? ' on rush' : ''}" id="bRush" title="${esc(BOSS_RUSH.desc())}${p.records.rushBest ? ` Best: ${fmtTime(p.records.rushBest)}` : ''}">${iconSVG('boss', ru ? '#ffb050' : '#9a8f7c', 16, { glow: ru })}Boss Rush</button>`;
  const night = `<button class="btn small cs-nm${nm ? ' on' : ''}" id="bNight" title="${esc(NIGHTMARE.desc())}">${iconSVG('skull', nm ? '#ff5050' : '#9a8f7c', 16, { glow: nm })}Nightmare${nmWins ? ` <span class="w">${nmWins}✦</span>` : ''}</button>`;
  if (!pactsUnlocked(p)) return `<div class="panel cs-pacts${nm ? ' nm' : ''}">${iconSVG(nm ? 'skull' : 'pact', nm ? '#ff5050' : '#806050', 26, { glow: nm })}<div class="lab"><div class="subtitle">${nm ? 'Nightmare · heat 10' : 'Pacts of Ascension'}</div><div class="s2">${nm ? 'Smarter, relentless foes · flawless chambers earn Dread Marks' : 'Pacts unlock with your first victory. Seasoned? Try Nightmare.'}</div></div><div class="cs-btns">${night}${rush}</div></div>`;
  const sel = cleanPacts(p.pacts), h = heatOf(sel);
  const best = p.classes[classId]?.wins ? p.classes[classId].bestHeat : -1;
  const names = Object.keys(sel).filter((id) => id !== 'nightmare' && id !== 'rush').map((id) => PACT_BY_ID[id].name).join(' · ');
  return `<div class="panel cs-pacts${nm ? ' nm' : ''}">${iconSVG('flame', h ? '#ff8a40' : '#806050', 26, { glow: !!h })}<div class="hv">${h}</div><div class="lab"><div class="subtitle">${nm ? 'Pacts · heat' : 'Pacts of Ascension · heat'}</div><div class="s2">${names ? esc(names) : 'No pacts sworn.'}${best >= 0 ? ` · best cleared with this wizard: ${best}` : ''}</div></div><div class="cs-btns">${night}${rush}<button class="btn small" id="bPacts">Pacts</button></div></div>`;
}

export function showPactBoard(ui, { classId, onClose } = {}) {
  const p = loadProfile();
  const sel = cleanPacts(p.pacts);
  const best = p.classes[classId]?.wins ? p.classes[classId].bestHeat : -1;
  const m = ui._modal(`
    <div class="pb panel">
      <div class="pb-head"><div><div class="title" style="font-size:30px">Pacts of Ascension</div><div class="subtitle">Swear pacts to raise the heat${best >= 0 ? ` · best cleared as ${CLASS_META[classId].name}: ${best}` : ''}</div></div>
      <div class="pb-heat"><small>HEAT</small>${iconSVG('flame', '#ff8a40', 34)}<span id="pbHeat">0</span><small style="margin-left:6px">/ ${MAX_HEAT}</small></div></div>
      <div class="pb-grid"></div>
      <div class="pb-boons" id="pbBoons"></div>
      <div class="pb-foot"><div class="hint">Click a pact to raise its rank, right-click to lower it. Heat is recorded per wizard when you win; clearing more heat opens deeper pacts.</div><button class="btn small" id="pbClear">Clear all</button><button class="btn small primary" id="pbDone">Done</button></div>
    </div>`);
  const grid = m.querySelector('.pb-grid');
  const cleared = p.records.highestHeat; // (any wizard)
  for (const id of Object.keys(sel)) if (!pactOpen(PACT_BY_ID[id], cleared)) delete sel[id];
  const render = () => {
    grid.innerHTML = PACTS.map((pc) => {
      if (!pactOpen(pc, cleared)) return `<div class="pb-card locked"><div class="t">${iconSVG(pc.icon, '#4a4038', 20, { glow: false })}${esc(pc.name)}</div><div class="d">Win with ${pc.unlock} heat to break this seal.</div><div class="r"><span class="h">+${pc.heat} heat${pc.max > 1 ? ' each' : ''}</span></div></div>`;
      const r = sel[pc.id] ?? 0;
      return `<div class="pb-card${r ? ' on' : ''}" data-id="${pc.id}"><div class="t">${iconSVG(pc.icon, r ? '#ffb070' : '#9a8f7c', 20, { glow: !!r })}${esc(pc.name)}${pc.max > 1 && r ? ` ${ROMAN[r - 1]}` : ''}</div>
        <div class="d">${esc(pc.desc(Math.max(1, r)))}</div>
        <div class="r">${Array.from({ length: pc.max }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('')}<span class="h">+${pc.heat} heat${pc.max > 1 ? ' each' : ''}</span></div></div>`;
    }).join('');
    const h = heatOf(sel), b = heatBoons(h), nu = nextUnlock(cleared);
    m.querySelector('#pbHeat').textContent = h;
    m.querySelector('#pbBoons').innerHTML = (sel.nightmare ? `${iconSVG('skull', '#ff5050', 16, { glow: false })}<b style="color:#ff7060">Nightmare +10</b> · ` : '') + (h ? `${iconSVG('flame', '#ff8a40', 16, { glow: false })}<b>Heat ${h} rewards:</b> finer tomes ${Math.round((b.luck - 1) * 100)}% likelier · ${Math.round((b.gold - 1) * 100)}% more gold` : 'Swear pacts to raise the heat: the hotter the run, the finer its tomes and the richer its gold.')
      + (Number.isFinite(nu) ? ` <span class="nu">· next seal breaks at heat ${nu}${cleared >= 0 ? ` (best cleared: ${cleared})` : ''}</span>` : '');
    grid.querySelectorAll('.pb-card:not(.locked)').forEach((el) => {
      const pc = PACT_BY_ID[el.dataset.id];
      const set = (r) => { if (r > 0) sel[pc.id] = r; else delete sel[pc.id]; ui.audio?.play(r ? 'ui_click' : 'ui_hover', { volume: 0.5 }); render(); };
      el.onclick = () => set(((sel[pc.id] ?? 0) + 1) % (pc.max + 1));
      el.oncontextmenu = (e) => { e.preventDefault(); set(Math.max(0, (sel[pc.id] ?? 0) - 1)); };
    });
  };
  render();
  const done = () => { p.pacts = cleanPacts(sel); saveProfile(); };
  const close = keyed(ui, m, () => { done(); onClose?.(heatOf(sel)); }, (e) => { if (e.code === 'Enter') close(); });
  m.querySelector('#pbDone').onclick = close;
  m.querySelector('#pbClear').onclick = () => { for (const k of Object.keys(sel)) if (k !== 'nightmare' && k !== 'rush') delete sel[k]; render(); }; // (Nightmare and Boss Rush have their own toggles)
  return m;
}

// ================================================================== daily rite
export function riteLine() {
  const r = dailyRite(), p = loadProfile();
  const done = p.daily.best?.date === r.key;
  return `${CLASS_META[r.classId].name} · heat ${r.heat}${p.daily.streak && (p.daily.last === r.key || p.daily.last === prevKey()) ? ` · streak ${p.daily.streak}` : ''}${done ? ' · done' : ''}`;
}
const prevKey = () => utcDay(new Date(Date.now() - 864e5));

export function showDailyRite(ui, { onBegin, onClose } = {}) {
  const r = dailyRite(), p = loadProfile();
  const m0 = CLASS_META[r.classId];
  const best = p.daily.best?.date === r.key ? p.daily.best : null;
  const alive = p.daily.last === r.key || p.daily.last === prevKey();
  const m = ui._modal(`
    <div class="dr panel">
      <div class="date">DAILY RITE · ${r.key}</div>
      <div class="title" style="font-size:30px">The Rite of the Day</div>
      <div style="color:var(--text-dim);font-size:15px">One realm-path, one wizard and one set of pacts for every wizard alive today. Finish it to keep your streak.</div>
      <div class="cls">${classEmblem(r.classId, hex(m0.color), 64)}<div style="text-align:left"><div class="nm" style="color:${hex(m0.color2 ?? m0.color)}">${m0.name}</div><div class="subtitle" style="letter-spacing:0.2em">${esc(m0.title)}</div></div></div>
      <div class="pacts">${Object.entries(r.pacts).map(([id, rank]) => `<div>${iconSVG(PACT_BY_ID[id].icon, '#ffb070', 20, { glow: false })}<b>${esc(PACT_BY_ID[id].name)}</b><span style="color:var(--text-dim)">${esc(PACT_BY_ID[id].desc(rank))}</span></div>`).join('')}</div>
      <div class="stats"><div><b style="color:#ffb070">${r.heat}</b>heat</div><div><b>${best ? (best.won ? 'Victory' : `Realm ${best.floor}`) : '—'}</b>best today${best?.won ? ` · ${fmtTime(best.time)}` : ''}</div><div><b>${alive ? p.daily.streak : 0}</b>day streak</div><div><b>${p.daily.bestStreak}</b>best streak</div></div>
      <div class="btns"><button class="btn" id="drBack">Back</button><button class="btn primary" id="drGo">Begin the Rite</button></div>
    </div>`);
  const close = keyed(ui, m, onClose, (e) => { if (e.code === 'Enter') go(); });
  const go = () => { if (m.isConnected) ui._closeModal(m, false); onBegin?.(r); }; // the key listener drops itself on the next key
  m.querySelector('#drBack').onclick = close;
  m.querySelector('#drGo').onclick = go;
  return m;
}
