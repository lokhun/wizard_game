import { iconSVG } from './icons.js';
import { SETS, setCounts, relicColor } from '../game/relicDefs.js';

// ---------------------------------------------------------------------------
// Relic UI: the HUD shelf (small icons, set pips, live proc state), the list
// shown while Tab is held and on the pause screen, and the choice cards.
// Like the rest of the HUD, DOM is rebuilt only when its key changes and
// per-frame writes are skipped when a value is unchanged.
// ---------------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setText = (el, v) => { if (el._t !== v) { el._t = v; el.textContent = v; } };

// set chips: which sets you hold and how far along they are
function setChips(relics) {
  const n = setCounts(relics);
  return Object.keys(n).sort((a, b) => n[b] - n[a]).map((k) => {
    const S = SETS[k], c = n[k];
    return `<span class="rset${c >= 2 ? ' on' : ''}${c >= 3 ? ' full' : ''}" style="--sc:${S.color}">${esc(S.name)} ${'●'.repeat(Math.min(3, c))}${'○'.repeat(Math.max(0, 3 - c))}</span>`;
  }).join('');
}

export function updateRelicShelf(ui, game) {
  const p = game.player, h = ui.h;
  if (!h) return;
  if (!h.relics || !h.relics.isConnected) {
    h.relics = document.createElement('div');
    h.relics.className = 'relic-shelf';
    h.relicTab = document.createElement('div');
    h.relicTab.className = 'relic-tab panel hidden';
    // above the health bar and buffs, clear of the toasts on the right
    (ui.hudEl.querySelector('.hp-wrap') ?? ui.hudEl).prepend(h.relics);
    ui.hudEl.appendChild(h.relicTab);
    h.relics._key = h.relicTab._key = null;
  }
  const key = p.relics.length; // relics are only ever added (a new run rebuilds the HUD)
  if (h.relics._key !== key) {
    h.relics._key = key;
    h.relics.innerHTML = p.relics.length ? `<div class="rsets">${setChips(p.relics)}</div><div class="ricons">${p.relics.map((r) => {
      const c = relicColor(r.def);
      return `<div class="ri${r.def.cursed ? ' cursed' : ''}" data-id="${r.def.id}" style="--rc:${c}">${iconSVG(r.def.icon, c, 22, { glow: false })}<i class="rk"></i><b class="rn"></b></div>`;
    }).join('')}</div>` : '';
    h.relics._items = [...h.relics.querySelectorAll('.ri')].map((el) => ({ el, id: el.dataset.id, k: el.querySelector('.rk'), n: el.querySelector('.rn') }));
  }
  // live state: cooldown sweep, a badge (stacks, counts) and a lit frame
  for (const it of h.relics._items) {
    const m = game.relics?.meter(it.id);
    if (!m) continue;
    const pv = `${Math.round((m.k ?? 0) * 100)}%`;
    if (it.k._p !== pv) { it.k._p = pv; it.k.style.setProperty('--p', pv); }
    setText(it.n, m.n ?? '');
    if (it.on !== !!m.on) { it.on = !!m.on; it.el.classList.toggle('lit', it.on); }
  }
  // Tab (the big map) also lays out every relic with what it does
  const tab = ui.input.is('map') && p.relics.length > 0;
  if (h.relicTab._shown !== tab) { h.relicTab._shown = tab; h.relicTab.classList.toggle('hidden', !tab); }
  if (tab && h.relicTab._key !== key) { h.relicTab._key = key; h.relicTab.innerHTML = relicListHTML(p, true); }
}

// every relic with its description, and the set bonuses (Tab and pause)
export function relicListHTML(p, compact = false) {
  if (!p.relics.length) return '';
  const n = setCounts(p.relics);
  const sets = Object.keys(n).map((k) => {
    const S = SETS[k], c = n[k];
    return `<div class="rsetrow" style="--sc:${S.color}"><b>${esc(S.name)} ${c}/3</b><span class="${c >= 2 ? 'on' : ''}">(2) ${esc(S.b2)}</span><span class="${c >= 3 ? 'on' : ''}">(3) ${esc(S.b3)}</span></div>`;
  }).join('');
  const rows = p.relics.map((r) => {
    const c = relicColor(r.def);
    return `<div class="rrow${r.def.cursed ? ' cursed' : ''}" style="--rc:${c}">${iconSVG(r.def.icon, c, compact ? 20 : 22, { glow: false })}<div><b>${esc(r.def.name)}</b>${r.def.cursed ? '<em>Cursed</em>' : ''}${r.def.set ? `<i>${esc(SETS[r.def.set].name)}</i>` : ''}<span>${esc(r.def.desc)}</span></div></div>`;
  }).join('');
  const setsHTML = sets ? `<div class="subtitle" style="margin:${compact ? '0 0 4px' : '10px 0 4px'}">Sets</div>${sets}` : '';
  const relicsHTML = `<div class="subtitle" style="margin:${compact && sets ? '10px' : '0'} 0 6px">Relics</div><div class="rlist">${rows}</div>`;
  // Tab: sets first (what the build adds up to), then the relics, in a tighter type
  return compact ? `<div class="compact">${setsHTML}${relicsHTML}</div>` : relicsHTML + setsHTML;
}

// a relic offered in a choice (treasure, elite lectern, shrine)
export function relicCard(r, i, owned) {
  const d = r.def, c = relicColor(d), S = SETS[d.set];
  const have = S ? setCounts(owned)[d.set] ?? 0 : 0;
  return `<div class="tome card relic r-relic${d.cursed ? ' cursed' : ''}" data-i="${i}" style="--rc:${c}">
    <div class="rar" style="color:${c}">${d.cursed ? 'Cursed Relic' : 'Relic'}</div>
    ${S ? `<div class="augtag" style="color:${S.color};border-color:${S.color}88">${esc(S.name)} set · ${Math.min(3, have + 1)}/3</div>` : ''}
    <div class="ticon">${iconSVG(d.icon, c, 54)}</div>
    <div class="tname">${esc(d.name)}</div>
    <div class="tdesc">${esc(d.desc)}</div>
    ${S && (have === 1 || have === 2) ? `<div class="tdesc rset-next" style="color:${S.color}">Wakes (${have + 1}): ${esc(have === 2 ? S.b3 : S.b2)}</div>` : ''}
    <div class="tkey">[${i + 1}]</div>
  </div>`;
}
