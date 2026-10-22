import { iconSVG, classEmblem } from '../ui/icons.js';
import { CLASS_META } from '../game/classMeta.js';
import { RARITY, TOMES, RELICS } from '../game/upgrades.js';
import { BIOMES } from '../world/biomes.js';
import { FEAT_BY_ID } from './feats.js';
import { PACT_BY_ID } from './pacts.js';

// ---------------------------------------------------------------------------
// The run summary: the screen players screenshot. Built once when the run ends
// (the fight is over, so DOM work and a short count-up animation are fine).
// Co-op runs get a column per wizard; teammates' columns fill in as their
// summaries arrive over the network.
// ---------------------------------------------------------------------------

const hex = (n) => '#' + (n ?? 0xffffff).toString(16).padStart(6, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
export const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
export const fmtNum = (n) => Math.round(n).toLocaleString('en-US');
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

// each realm's colours: [accent, deep]
export const REALM_COL = { sewers: ['#8fd0a0', '#112a1c'], dungeon: ['#e8a066', '#2e180a'], courtyard: ['#a8c2ff', '#121c3c'], keep: ['#c9a2ff', '#21133a'], throne: ['#d896ff', '#2a1036'] };
const DAWN = ['#ffd36a', '#33230a'];
const TOME_BY_ID = Object.fromEntries(TOMES.map((t) => [t.id, t]));
const RELIC_BY_ID = Object.fromEntries(RELICS.map((r) => [r.id, r]));
const ROOM_GLYPH = { combat: ['blades', '#d8c8a8', 'Ambush'], elite: ['elite', '#ff9040', 'Elite chamber'], trial: ['hourglass', '#ffcf60', 'Trial'], boss: ['boss', '#ff5040', 'Boss'] };

// tome and relic icons for a build; small = co-op columns
export function buildIcons(S, size = 22) {
  const out = [];
  for (const [id, rar, n] of S.tomes ?? []) {
    const d = TOME_BY_ID[id];
    if (!d) continue;
    const r = RARITY[rar] ?? RARITY[0];
    const col = d.aug ? hex(CLASS_META[d.cls]?.color) : r.color;
    out.push(`<div class="rs-tome${d.aug ? ' aug' : ''}" style="--rc:${col};animation-delay:${out.length * 0.03}s" title="${esc(d.name)} · ${r.name}${d.aug ? ' augment' : ''}${n > 1 ? ' ×' + n : ''}">${iconSVG(d.icon, col, size, { glow: false })}${n > 1 ? `<b>${n}</b>` : ''}</div>`);
  }
  for (const id of S.relics ?? []) {
    const d = RELIC_BY_ID[id];
    if (!d) continue;
    out.push(`<div class="rs-tome relic" style="--rc:#ffb030;animation-delay:${out.length * 0.03}s" title="Relic · ${esc(d.name)}">${iconSVG(d.icon, '#ffb030', size, { glow: false })}</div>`);
  }
  return out.length ? out.join('') : '<div class="rs-empty">No tomes were bound.</div>';
}

function chronicle(S) {
  const rooms = S.rooms ?? [];
  if (!rooms.length) return '<div class="rs-empty">No chamber was fought.</div>';
  const maxDmg = Math.max(1, ...rooms.map((r) => r[3]));
  const floors = new Map();
  for (const r of rooms) { if (!floors.has(r[0])) floors.set(r[0], []); floors.get(r[0]).push(r); }
  let html = '', k = 0;
  for (const [f, list] of floors) {
    const b = BIOMES[f];
    const fc = (REALM_COL[b?.id] ?? DAWN)[0];
    const tt = list.reduce((s, r) => s + r[2], 0), dd = list.reduce((s, r) => s + r[3], 0);
    html += `<div class="rs-floor" style="--fc:${fc};animation-delay:${0.25 + k++ * 0.08}s"><div class="fl"><b>${ROMAN[f] ?? f + 1} · ${esc((b?.name ?? '').replace(/^The /, ''))}</b><span>${fmtTime(tt)} · ${fmtNum(dd)} taken</span></div>`;
    for (const [, type, t, dmg, flags, kills] of list) {
      const [ic, col, label] = ROOM_GLYPH[type] ?? ROOM_GLYPH.combat;
      const done = flags & 1, fell = !done;
      const tip = `${label}${type === 'trial' ? (flags & 2 ? ' (won)' : ' (lost)') : ''} · ${fmtTime(t)} · ${fmtNum(dmg)} damage taken · ${kills ?? 0} slain${fell ? (S.won ? '' : ' · fell here') : ''}`;
      html += `<div class="rs-chip ${type === 'boss' ? 'boss' : ''} ${done && dmg === 0 ? 'flawless' : ''} ${fell && !S.won ? 'fell' : ''}" title="${esc(tip)}">${iconSVG(fell && !S.won ? 'skull' : ic, fell && !S.won ? '#e05050' : col, 16, { glow: false })}<span>${fmtTime(t)}</span>${dmg > 0 ? `<i style="width:${Math.max(6, (dmg / maxDmg) * 100)}%"></i>` : ''}</div>`;
    }
    html += '</div>';
  }
  return html + '<div class="rs-legend"><span><i></i>damage taken</span><span><b style="color:var(--gold)">✦</b> untouched</span></div>';
}

function featList(ids, inline = false) {
  const fs = (ids ?? []).map((id) => FEAT_BY_ID[id]).filter(Boolean);
  if (!fs.length) return '';
  inline ||= fs.length > 4; // a first run earns a pile of them: chips, not rows
  return `<div class="rs-sec"><h3>Feats earned · ${fs.length}</h3><div class="rs-feats${inline ? ' inline' : ''}">${fs.map((f, i) => `<div class="rs-feat" title="${esc(f.desc)}" style="animation-delay:${0.6 + i * 0.08}s">${iconSVG(f.icon, '#f0c050', 24)}<div><div class="n">${esc(f.name)}</div><div class="d">${esc(f.desc)}</div></div></div>`).join('')}</div></div>`;
}

const tile = (label, value, fmt, sub, rec, i) => `<div class="rs-tile${rec ? ' rec' : ''}" style="animation-delay:${0.1 + i * 0.06}s"><div class="tl">${label}</div><div class="tv" data-to="${value}" data-fmt="${fmt}">${fmt === 'time' ? '0:00' : '0'}</div><div class="ts">${sub || '&nbsp;'}</div>${rec ? '<div class="ribbon">★ NEW RECORD</div>' : ''}</div>`;

// one wizard's column (co-op)
function partyCol(S, me, best) {
  const c = CLASS_META[S.classId] ?? CLASS_META.pyromancer;
  const col = hex(c.color);
  const row = (k, label, v, txt) => `<tr><td>${label}</td><td class="${best[k] === v && v > 0 ? 'top' : ''}">${txt}</td></tr>`;
  return `<div class="rs-pc${me ? ' me' : ''}" style="--pc:${col}">
    <div class="ph">${classEmblem(S.classId, col, 38)}<div style="min-width:0"><div class="pn">${esc(S.name)}</div><div class="pcl">${c.name}${me ? ' · you' : ''}</div></div></div>
    <table>${row('kills', 'Foes slain', S.kills, fmtNum(S.kills))}${row('damage', 'Damage dealt', S.damage, fmtNum(S.damage))}${row('biggest', 'Biggest hit', S.biggest, fmtNum(S.biggest))}${row('reactions', 'Reactions', S.reactions, fmtNum(S.reactions))}
    <tr><td>Taken · downed</td><td>${fmtNum(S.taken)} · ${S.downs}×</td></tr></table>
    <div class="rs-build">${buildIcons(S, 18)}</div>
    ${S.killer ? `<div class="kb">Felled by ${esc(S.killer)}</div>` : ''}
    ${S.feats?.length ? `<div class="rs-feats inline">${S.feats.map((id) => FEAT_BY_ID[id]).filter(Boolean).map((f) => `<div class="rs-feat" title="${esc(f.desc)}">${iconSVG(f.icon, '#f0c050', 18)}<div class="n">${esc(f.name)}</div></div>`).join('')}</div>` : ''}
  </div>`;
}

// Show the summary. S: this machine's summary (tracker.summary()), with S.records.
// party: [{ id, name, classId }] of the teammates, remotes: Map(pid -> summary)
export function showSummary(ui, S, { party = [], remotes = new Map(), onMenu, onAgain } = {}) {
  ui.closeAllModals();
  const won = S.won;
  const b = BIOMES[Math.min(S.floor, BIOMES.length - 1)];
  const [acc, deep] = won ? DAWN : (REALM_COL[b?.id] ?? DAWN);
  const meta = CLASS_META[S.classId] ?? CLASS_META.pyromancer;
  const rec = S.records ?? {};
  const coop = party.length > 0;
  const pacts = Object.entries(S.pacts ?? {}).map(([id, r]) => PACT_BY_ID[id] ? PACT_BY_ID[id].name + (PACT_BY_ID[id].max > 1 ? ' ' + ROMAN[r - 1] : '') : null).filter(Boolean);
  const sub = S.fell
    ? `The Hollow King fell, but ${S.killer ? `<em>${esc(S.killer)}</em>` : 'the dark'} claimed you at depth ${S.abyss} of the Abyss.`
    : S.abyss ? `The Hollow King has fallen ${S.abyss + 1} times. You return from depth ${S.abyss} of the Abyss.`
    : won
    ? 'The Hollow King has fallen. Dawn returns to the Ashen Keep.'
    : `${S.killer ? `Slain by <em>${esc(S.killer)}</em>` : 'Fallen'} in ${esc(b?.name ?? 'the dark')}${S.rooms?.at(-1)?.[1] === 'boss' && !(S.rooms.at(-1)[4] & 1) ? ', before its lord' : ''}.`;
  const tiles = [
    tile('Time', S.time, 'time', won && !S.abyss ? 'to the throne' : 'survived', rec.fastest, 0),
    tile('Realm', S.floor + 1, 'realm', esc((b?.name ?? '').replace(/^The /, '')), rec.floor, 1),
    tile('Foes slain', S.kills, 'num', coop ? `party ${fmtNum(S.partyKills)}` : `${fmtNum(S.reactions)} reactions`, rec.kills, 2),
    tile('Damage dealt', S.damage, 'num', `${fmtNum(S.damage / Math.max(1, S.time))} per second`, rec.damage, 3),
    tile('Biggest hit', S.biggest, 'num', S.biggestOn ? 'on ' + esc(S.biggestOn) : '&nbsp;', rec.biggest, 4),
    tile('Damage taken', S.taken, 'num', S.downs ? `downed ${S.downs}×` : 'never downed', false, 5),
  ].join('');
  const left = coop ? '' : `<div class="rs-sec"><h3>The build</h3><div class="rs-build">${buildIcons(S, 22)}</div></div>${featList(S.feats)}`;
  const m = ui._modal(`
    <div class="rs panel" style="--acc:${acc};--deep:${deep}">
      <div class="rs-head">
        <div class="rs-emb">${classEmblem(S.classId, won ? '#ffd36a' : hex(meta.color), 92)}</div>
        <div class="rs-titles">
          <div class="rs-kicker"><span>Run summary</span><b>${esc(S.name)} the ${meta.name}</b>${coop ? `<span>Party of ${party.length + 1}</span>` : ''}</div>
          <div class="rs-big ${won ? 'won' : 'lost'}">${won ? 'Victory' : 'Fallen'}</div>
          <div class="rs-sub">${sub}</div>
        </div>
        <div class="rs-realms">
          <div class="rs-pips">${BIOMES.map((x, i) => `<i class="${i <= S.floor ? 'on' : ''} ${i === S.floor && !won ? 'last' : ''}"></i>`).join('')}</div>
          <div class="rl">Realm ${S.floor + 1} of ${BIOMES.length}</div>
          <div class="rs-badges">
            ${S.heat ? `<span class="rs-badge heat" title="${esc(pacts.join(' · '))}">${iconSVG('flame', '#ff8a40', 13, { glow: false })}Heat ${S.heat}${rec.heat ? ' · best' : ''}</span>` : ''}
            ${S.nightmare ? `<span class="rs-badge nm" title="Dread Marks earned: ${S.dread ?? 0}">${iconSVG('skull', '#ff6050', 13, { glow: false })}Nightmare${S.dread ? ` · ${S.dread} dread` : ''}</span>` : ''}
            ${S.abyss ? `<span class="rs-badge abyss">${iconSVG('tentacle', '#c080ff', 13, { glow: false })}Abyss ${S.abyss}${rec.abyss ? ' · best' : ''}</span>` : ''}
            ${S.daily ? `<span class="rs-badge daily">${iconSVG('sun', '#f0c050', 13, { glow: false })}Daily Rite ${esc(S.daily)}${rec.daily ? ' · best' : ''}</span>` : ''}
            ${S.practice ? '<span class="rs-badge practice">Practice · not recorded</span>' : ''}
          </div>
        </div>
      </div>
      <div class="rs-main">
      <div class="rs-tiles">${tiles}</div>
      ${coop ? `<div class="rs-sec"><h3>The party</h3><div class="rs-party" id="rsParty"></div></div>` : ''}
      <div class="rs-body"${coop ? ' style="grid-template-columns:minmax(0,1fr)"' : ''}>
        ${left ? `<div>${left}</div>` : ''}
        <div class="rs-sec"><h3>Chronicle${coop ? ' · your fights' : ''}</h3><div class="rs-chron${coop ? ' two' : ''}">${chronicle(S)}</div></div>
      </div>
      </div>
      <div class="rs-foot">
        <button class="btn primary" id="rsMenu">Return to Menu <span class="hint">ENTER</span></button>
        ${onAgain ? `<button class="btn" id="rsAgain">${S.daily ? 'Retry the Rite' : 'Ascend Again'} <span class="hint">R</span></button>` : ''}
      </div>
    </div>`);
  m.classList.add('rs-modal');
  ui.hudEl?.classList.add('hidden'); // a clean frame for the screenshot (the next run's HUD build shows it again)
  // ---- co-op columns: ours now, teammates' as their summaries land
  const renderParty = () => {
    const el = m.querySelector('#rsParty');
    if (!el) return;
    const all = [S, ...party.map((p) => remotes.get(p.id) ?? { pending: true, ...p })];
    const best = {};
    for (const k of ['kills', 'damage', 'biggest', 'reactions']) best[k] = Math.max(0, ...all.filter((x) => !x.pending).map((x) => x[k] ?? 0));
    el.style.gridTemplateColumns = `repeat(${all.length}, minmax(0, 1fr))`;
    el.innerHTML = all.map((x, i) => x.pending
      ? `<div class="rs-pc" style="--pc:${hex(CLASS_META[x.classId]?.color)}"><div class="ph">${classEmblem(x.classId, hex(CLASS_META[x.classId]?.color), 38)}<div><div class="pn">${esc(x.name)}</div><div class="pcl">${CLASS_META[x.classId]?.name ?? ''}</div></div></div><div class="rs-wait">Awaiting their tale…</div></div>`
      : partyCol(x, i === 0, best)).join('');
  };
  renderParty();
  // ---- count-ups, then the record flourishes
  const nums = [...m.querySelectorAll('.tv[data-to]')];
  const t0 = performance.now();
  const fmt = (v, f) => (f === 'time' ? fmtTime(v) : f === 'realm' ? `${Math.round(v)}<span style="font-size:0.55em;color:var(--text-dim)"> / ${BIOMES.length}</span>` : fmtNum(v));
  const step = (now) => {
    if (!m.isConnected) return;
    let running = false;
    nums.forEach((el, i) => {
      const u = Math.min(1, Math.max(0, (now - t0 - 250 - i * 110) / 1300));
      const e = 1 - Math.pow(1 - u, 3);
      el.innerHTML = fmt(+el.dataset.to * e, el.dataset.fmt);
      if (u < 1) running = true;
      else if (!el._done) {
        el._done = true;
        const t = el.closest('.rs-tile');
        if (t.classList.contains('rec')) { t.classList.add('lit'); ui.audio?.play('tome_pick', { volume: 0.5 }); }
      }
    });
    if (running) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  ui.audio?.play(won ? 'victory_sting' : 'ui_click', { volume: won ? 0.4 : 0.3 });
  // ---- buttons and keys
  const close = (fn) => { window.removeEventListener('keydown', onKey); ui._closeModal(m, false); fn?.(); };
  const armed = performance.now() + 1500; // a key still held from the fight (R is the ultimate) mustn't skip the screen
  const onKey = (e) => {
    if (!m.isConnected) { window.removeEventListener('keydown', onKey); return; }
    if (performance.now() < armed) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') close(onMenu);
    else if (e.code === 'KeyR' && onAgain) close(onAgain);
  };
  window.addEventListener('keydown', onKey);
  m.querySelector('#rsMenu').onclick = () => close(onMenu);
  m.querySelector('#rsAgain')?.addEventListener('click', () => close(onAgain));
  return { el: m, addRemote: renderParty };
}

// ---------------------------------------------------------------- feat toasts
// One element, created on first use and restyled per feat: earning a feat costs
// a single DOM write mid-fight, and a burst of feats queues up.
export function featToaster(ui) {
  let el = null;
  const queue = [];
  let busy = false;
  const next = () => {
    const f = queue.shift();
    if (!f) { busy = false; return; }
    busy = true;
    if (!el) { el = document.createElement('div'); el.className = 'feat-toast'; ui.root.appendChild(el); }
    el.innerHTML = `<div class="fi">${iconSVG(f.icon, '#f0c050', 32)}</div><div><div class="fk">Feat earned</div><div class="fn">${esc(f.name)}</div><div class="fd">${esc(f.desc)}</div></div>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    ui.audio?.play('tome_pick', { volume: 0.6 });
    setTimeout(next, 4300);
  };
  const add = (f) => { queue.push(f); if (!busy) next(); };
  add.clear = () => { queue.length = 0; el?.classList.remove('show'); }; // the summary lists the rest
  return add;
}
