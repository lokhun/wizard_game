import * as THREE from 'three';
import { iconSVG, classEmblem } from './icons.js';
import { ITEMS } from '../game/items.js';
import { CLASS_LIST, SLOTS } from '../game/classes.js';
import { CLASS_META, ELEMENT_COLORS } from '../game/classMeta.js';
import { RARITY, statChanges } from '../game/upgrades.js';
import { ROOM, T, K_WATER } from '../world/levelgen.js';
import { BIOMES } from '../world/biomes.js';
import { fightsHere } from '../game/director.js';
import { updateRelicShelf, relicListHTML, relicCard } from './relicUI.js';
import { KEYS as BINDS, REBINDABLE, keyOf, keyLabel, applyBindings } from '../core/input.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
// a teammate's health: green, amber when hurt, orange when low - never an enemy's red
const allyHpColor = (f) => (f > 0.5 ? '#4ade80' : f > 0.25 ? '#f5c542' : '#ff9a3c');
// what a merchant's ware changes on you, from -> to (a tome: your stats without and with it)
function shopDiff(it, player) {
  let rows = it.preview?.(player) ?? [];
  if (it.tome && player.computeStats) rows = statChanges(player.computeStats(), player.computeStats([it.tome]), player);
  if (!rows.length) return '';
  return `<div class="sdiff">${rows.slice(0, 4).map(([k, a, b]) => `<div><span class="k">${esc(k)}</span><span class="a">${esc(a)}</span><span class="arr">→</span><span class="b">${esc(b)}</span></div>`).join('')}</div>`;
}
// the key shown on a spell slot follows the player's bindings
const capAffix = (k) => (k ? k[0].toUpperCase() + k.slice(1) + ' ' : '');
const slotKey = (s) => (s === 'primary' ? 'LMB' : s === 'secondary' ? 'RMB' : keyOf(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------------
// DOM UI + a 2D canvas overlay for damage numbers and health bars.
// ---------------------------------------------------------------------------
// cached DOM writes: skip when the value hasn't changed
// replay a one-shot CSS flash without a forced layout (the old remove / read offsetWidth / add): switch
// between `cls` and its twin `cls2`, which run the same keyframes under another name (styles.css)
function replay(el, cls) { const a = el.classList.contains(cls); el.classList.toggle(cls, !a); el.classList.toggle(cls + '2', a); }
function setText(el, v) { if (el && el._t !== v) { el._t = v; el.textContent = v; } }
function setStyle(el, k, v) { if (!el) return; const c = (el._s ??= {}); if (c[k] !== v) { c[k] = v; el.style[k] = v; } }

export class UI {
  constructor(root, renderer, input, audio) {
    this.root = root;
    this.renderer = renderer;
    this.input = input;
    this.audio = audio;
    this.modalStack = [];
    this.numbers = [];
    this.floats = [];
    this.banners = [];
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'fx2d';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this._resize();
    window.addEventListener('resize', () => this._resize());
    root.innerHTML = `
      <div id="hud" class="hidden"></div>
      <div id="screens"></div>
      <div id="modals"></div>
      <div class="fade" id="fade"></div>`;
    this.hudEl = root.querySelector('#hud');
    this.screens = root.querySelector('#screens');
    this.modals = root.querySelector('#modals');
    this.fadeEl = root.querySelector('#fade');
    this.dmgDirs = [];
    this._dmgPool = [];
    // hover / click sounds on any button
    root.addEventListener('mouseover', (e) => { if (e.target.closest?.('.btn, .card, .tome, .shop-item')) this.audio?.play('ui_hover', { volume: 0.25 }); });
    root.addEventListener('click', (e) => { if (e.target.closest?.('.btn, .card')) this.audio?.play('ui_click', { volume: 0.4 }); });
  }

  get modalOpen() { return this.modalStack.length > 0; }

  // The first measureText / fillText in a new font (weight and size) loads
  // and resolves the face and starts its glyph cache: 5-12 ms each, and
  // damage numbers come in ~30 sizes, so a run's first big hits stuttered as
  // each new size appeared. Every font the overlay draws with, once, at boot.
  async warmFonts() {
    try { await Promise.all(['600', '700'].map((w) => document.fonts.load(`${w} 16px Cinzel`))); } catch { /* fallback faces then */ }
    const g = document.createElement('canvas').getContext('2d');
    const fonts = ['600 11px Cinzel, serif', '600 12px Cinzel, serif', '18px serif', '22px serif'];
    for (let s = 13; s <= 32; s++) fonts.push(`600 ${s}px Cinzel, serif`, `700 ${s}px Cinzel, serif`);
    for (const f of fonts) {
      g.font = f;
      g.measureText('0123456789');
      g.lineWidth = 3;
      g.strokeText('0123456789!', 0, 40);
      g.fillText('0123456789!', 0, 40);
    }
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ======================================================================
  // loading / menus
  // ======================================================================
  loading(pct, text) {
    let el = document.getElementById('loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'loading';
      el.className = 'loading';
      el.innerHTML = `<div class="title logo">Arcane Ascent</div><div class="lbar"><i></i></div><div class="ltxt"></div>`;
      this.root.appendChild(el);
    }
    el.querySelector('.lbar i').style.width = `${Math.round(pct * 100)}%`;
    el.querySelector('.ltxt').textContent = text ?? '';
  }
  hideLoading() {
    const el = document.getElementById('loading');
    if (!el) return;
    el.id = ''; // a loading() during the fade starts a fresh veil instead of reviving this one
    el.style.opacity = 0;
    setTimeout(() => el.remove(), 900);
  }

  clearScreens() { this.screens.innerHTML = ''; }

  showMenu({ onSolo, onHost, onJoin, onSettings, onHelp, name, onName, stats, onDaily, onCodex, riteLine }) {
    this.clearScreens();
    this.hudEl.classList.add('hidden');
    const s = stats ?? {};
    const el = document.createElement('div');
    el.className = 'screen vignette-bg';
    el.id = 'menu';
    el.innerHTML = `
      <div class="menu-col">
        <h1 class="title logo">Arcane Ascent</h1>
        <div class="tagline">From the drowned sewers to the hollow throne</div>
        <div class="name-row"><label>WIZARD NAME</label><input class="field interactive" id="nameIn" maxlength="16" value="${esc(name)}"/></div>
        <button class="btn primary" id="bSolo">Begin the Ascent</button>
        <button class="btn" id="bHost">Host Co-op Party</button>
        <button class="btn" id="bJoin">Join a Party</button>
        ${onDaily ? `<button class="btn rite" id="bDaily">Daily Rite<span class="rs2">${esc(riteLine ?? '')}</span></button>` : ''}
        <div class="menu-row">${onCodex ? '<button class="btn" id="bCodex">Codex</button>' : ''}<button class="btn" id="bHelp">How to Play</button><button class="btn" id="bSettings">Settings</button></div>
        ${matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches ? '<div class="stats-line" style="color:#ff9040">Arcane Ascent needs a keyboard and mouse — play on a computer for the full experience.</div>' : ''}
        <div class="stats-line">${s.runs ? `Runs ${s.runs} · Victories ${s.wins ?? 0} · Deepest realm ${s.bestFloor ?? 1} · Foes slain ${(s.kills ?? 0).toLocaleString('en-US')}${s.feats !== undefined ? ` · Feats ${s.feats}` : ''}` : 'The Hollow King awaits atop the Ashen Keep.'}</div>
      </div>
      <div class="credit">Co-op for up to 4 wizards · 13 classes · 5 realms</div>`;
    this.screens.appendChild(el);
    el.querySelector('#nameIn').addEventListener('input', (e) => onName(e.target.value));
    el.querySelector('#bSolo').onclick = onSolo;
    el.querySelector('#bHost').onclick = onHost;
    el.querySelector('#bJoin').onclick = onJoin;
    el.querySelector('#bSettings').onclick = onSettings;
    el.querySelector('#bHelp').onclick = onHelp;
    if (onDaily) el.querySelector('#bDaily').onclick = onDaily;
    if (onCodex) el.querySelector('#bCodex').onclick = onCodex;
  }

  showJoin({ onJoin, onBack, status }) {
    this.clearScreens();
    const el = document.createElement('div');
    el.className = 'screen vignette-bg';
    el.id = 'lobby';
    el.innerHTML = `
      <div class="panel lobby-box">
        <div class="title" style="font-size:30px;text-align:center">Join a Party</div>
        <div class="subtitle" style="text-align:center">Enter the code your host shared</div>
        <input class="field interactive" id="codeIn" maxlength="6" placeholder="CODE" style="text-align:center;font-size:34px;letter-spacing:0.4em;text-transform:uppercase"/>
        <div class="status" id="jStatus">${esc(status ?? '')}</div>
        <div style="display:flex;gap:12px;justify-content:center">
          <button class="btn" id="bBack">Back</button>
          <button class="btn primary" id="bGo">Join</button>
        </div>
      </div>`;
    this.screens.appendChild(el);
    const inp = el.querySelector('#codeIn');
    inp.focus();
    const go = () => onJoin(inp.value.trim().toUpperCase());
    el.querySelector('#bGo').onclick = go;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); e.stopPropagation(); });
    el.querySelector('#bBack').onclick = onBack;
    return { setStatus: (t) => { el.querySelector('#jStatus').textContent = t; } };
  }

  // class select also doubles as the co-op lobby
  showClassSelect({ selected, onSelect, onConfirm, onBack, lobby, ascension, pacts }) {
    this.clearScreens();
    const el = document.createElement('div');
    el.className = 'screen';
    el.id = 'classSelect';
    el.style.background = 'linear-gradient(90deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0) 65%, rgba(0,0,0,0.5) 100%)';
    el.innerHTML = `
      <div class="left">
        <div><div class="title" style="font-size:34px">Choose Your Wizard</div><div class="subtitle">${lobby ? 'Party lobby' : 'Solo ascent'}</div></div>
        <div class="grid">${CLASS_LIST.map((c) => `
          <div class="card" data-id="${c.id}">
            ${classEmblem(c.id, hex(c.color), 52)}
            <div class="cname" style="color:${hex(c.color2 ?? c.color)}">${c.name}</div>
            <div class="crole">${c.role}</div>
            <div class="taken"></div>
          </div>`).join('')}
        </div>
        <div id="lobbyBox" class="${lobby ? '' : 'hidden'} panel" style="padding:12px 16px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="subtitle">Party code</div>
            <button class="btn small" id="bCopy">Copy invite link</button>
          </div>
          <div class="title" id="lobbyCode" style="font-size:34px;letter-spacing:0.3em;color:var(--gold)"></div>
          <div id="lobbyPlayers" style="display:flex;flex-direction:column;gap:4px;margin-top:6px"></div>
          <div id="lobbySworn" class="hidden" style="color:#ff9a70;font-size:13px;margin-top:6px;font-family:var(--serif)"></div>
          <div id="lobbyStatus" style="color:var(--text-dim);font-size:13px;margin-top:6px"></div>
        </div>
        ${ascension && ascension.max > 0 ? `<div class="panel" style="padding:10px 16px;display:flex;align-items:center;gap:12px">
          <div class="subtitle" style="flex:1">Ascension <span style="color:var(--text-dim);letter-spacing:0;text-transform:none;font-size:12px">— enemies +20% health, +15% damage per level</span></div>
          <button class="btn small" id="ascDown">−</button><span id="ascVal" style="font-family:var(--serif);font-size:22px;color:var(--gold);min-width:24px;text-align:center">${ascension.value}</span><button class="btn small" id="ascUp">+</button>
        </div>` : ''}
        ${pacts ? '<div id="csPacts"></div>' : ''}
        <div class="cs-buttons">
          <button class="btn" id="bBack">Back</button>
          <button class="btn primary" id="bGo">${lobby ? (lobby.isHost ? 'Begin Ascent' : 'Ready') : 'Begin Ascent'}</button>
        </div>
      </div>
      <div class="detail panel" id="detail"></div>`;
    this.screens.appendChild(el);
    const detail = el.querySelector('#detail');
    const render = (id) => {
      const c = CLASS_LIST.find((x) => x.id === id);
      el.querySelectorAll('.card').forEach((cd) => cd.classList.toggle('selected', cd.dataset.id === id));
      detail.innerHTML = `
        <h2 style="color:${hex(c.color2 ?? c.color)};text-shadow:0 0 22px ${hex(c.color)}">${c.name}</h2>
        <div class="ctitle">${c.title} · ${c.role} · <span class="diff">${'◆'.repeat(c.difficulty)}${'◇'.repeat(3 - c.difficulty)}</span></div>
        <div class="blurb">${c.blurb}</div>
        <div class="passive-box"><b>${c.passive.name}</b> — ${c.passive.desc}</div>
        <div class="ability-list">${SLOTS.map((s) => {
          const sp = c.spells[s];
          return `<div class="ability-row"><div class="key">${slotKey(s)}</div><div class="ic">${iconSVG(sp.icon, hex(c.color), 28)}</div><div class="txt"><b>${sp.name}</b>${sp.cd ? ` <span style="display:inline;color:var(--text-dim);font-size:12px">${sp.cd}s</span>` : ''}<span>${sp.desc}</span></div></div>`;
        }).join('')}</div>
        <div style="margin-top:10px;color:var(--text-dim);font-size:13px">Health ${c.hp} · Speed ${Math.round(c.speed * 100)}%</div>`;
    };
    // pacts: html for the chosen wizard, re-bound whenever it changes
    let cur = selected;
    const renderPacts = () => { const box = pacts && el.querySelector('#csPacts'); if (box) { box.innerHTML = pacts.html(cur); pacts.bind?.(box, cur, renderPacts); } };
    el.querySelectorAll('.card').forEach((cd) => {
      cd.onclick = () => { cur = cd.dataset.id; onSelect(cur); render(cur); renderPacts(); };
    });
    render(selected);
    renderPacts();
    el.querySelector('#bGo').onclick = () => onConfirm();
    if (ascension && ascension.max > 0) {
      const setA = (v) => { ascension.value = Math.max(0, Math.min(ascension.max, v)); el.querySelector('#ascVal').textContent = ascension.value; ascension.onChange?.(ascension.value); };
      el.querySelector('#ascDown').onclick = () => setA(ascension.value - 1);
      el.querySelector('#ascUp').onclick = () => setA(ascension.value + 1);
    }
    el.querySelector('#bBack').onclick = onBack;
    const api = {
      setLobby: ({ code, players, status, isHost, canStart, link, sworn }) => {
        el.querySelector('#lobbyCode').textContent = code ?? '';
        const sw = el.querySelector('#lobbySworn');
        sw.textContent = sworn ? `${isHost ? 'You have sworn the party to' : 'The host has sworn the party to'}: ${sworn}` : '';
        sw.classList.toggle('hidden', !sworn);
        el.querySelector('#lobbyStatus').textContent = status ?? '';
        el.querySelector('#lobbyPlayers').innerHTML = (players ?? []).map((p) => `
          <div style="display:flex;align-items:center;gap:10px">${classEmblem(p.classId, hex(CLASS_META[p.classId].color), 26)}
          <span style="font-family:var(--serif);flex:1">${esc(p.name)}${p.host ? ' <span style="color:var(--gold);font-size:11px">HOST</span>' : ''}</span>
          <span style="color:${p.ready ? '#80d080' : 'var(--text-dim)'};font-size:12px;font-family:var(--serif)">${p.ready || p.host ? 'READY' : 'CHOOSING'}</span></div>`).join('');
        const taken = new Map((players ?? []).map((p) => [p.classId, p.name]));
        el.querySelectorAll('.card').forEach((cd) => { cd.querySelector('.taken').textContent = taken.has(cd.dataset.id) ? '●' : ''; });
        const go = el.querySelector('#bGo');
        if (isHost) { go.disabled = !canStart; go.textContent = 'Begin Ascent'; }
        el.querySelector('#bCopy').onclick = () => {
          navigator.clipboard?.writeText(link ?? code).then(() => this.toast('Invite link copied'));
        };
      },
      setReadyLabel: (t) => { el.querySelector('#bGo').textContent = t; },
    };
    return api;
  }

  showHelp(onBack) {
    const m = this._modal(`
      <div class="panel help-box">
        <div class="title" style="font-size:30px;text-align:center">How to Play</div>
        <p>Fight your way up from the <b>Drowned Sewers</b>, through the <b>Oubliette</b>, the moonlit <b>Bailey</b> and the <b>Hall of Whispers</b>, to the <b>Hollow Throne</b>. Each realm ends with a boss. Death is permanent, but every run grows you stronger with Arcane Tomes.</p>
        <div class="cols">
          <div><span class="k">${esc(['forward', 'left', 'back', 'right'].map(keyOf).join(''))}</span> move</div><div><span class="k">Mouse</span> aim</div>
          <div><span class="k">Left click</span> primary spell (hold)</div><div><span class="k">Right click</span> secondary spell</div>
          <div><span class="k">${esc(keyOf('ability1'))} / ${esc(keyOf('ability2'))}</span> abilities</div><div><span class="k">${esc(keyOf('ultimate'))}</span> ultimate (charges as you deal damage)</div>
          <div><span class="k">${esc(keyOf('dash'))}</span> dash (brief invulnerability)</div><div><span class="k">${esc(keyOf('jump'))}</span> jump — leap over shockwaves</div>
          <div><span class="k">${esc(keyOf('interact'))}</span> interact / revive allies</div><div><span class="k">${esc(BINDS.map.map(keyLabel).join(' / '))}</span> map</div>
          <div><span class="k">Esc</span> pause & settings</div><div><span class="k">${esc(keyOf('ping'))}</span> ping a foe, item or spot</div>
          <div><span class="k">${esc(keyOf('item'))}</span> use your item</div><div></div>
        </div>
        <p><b style="color:var(--bronze-hi)">Skill pays:</b> dash through a blow at the last moment for a <i>perfect dodge</i> (+25% damage for a few seconds); jump during a dash (or just after) for a <i>dash-jump</i>, a long bound that keeps half its speed; aim for the head (the front of a beast; the crosshair turns gold over one) and a direct hit strikes a <i>weak point</i> for +35%, marked in gold; stagger or kill a foe as it winds up and you <i>interrupt</i> the blow (+5% ultimate). Enemy shots only bend toward you early in their flight: a late sidestep always beats them. The run summary scores your mastery against your best. <i>Items</i> (a fire flask, a frost phial, a rallying bell...) drop from elites and bosses, wait in chests and sit on the merchant's table: you carry one at a time, so spend it. A boss that lands a leap, ends a whirl or a charge is <i>EXPOSED</i> for a moment (+30% damage): dodge the blow, then punish it. When you fall, <i>What hit you</i> shows the blows that did it.</p>
        <p><b style="color:var(--bronze-hi)">For a harder fight:</b> <i>Nightmare</i> (on the wizard select) makes foes smarter and relentless and gives every boss a new move; chambers cleared without a scratch earn Dread Marks (+5% damage each). <i>Boss Rush</i> pits you against the five bosses back to back. After your first victory, <i>Pacts</i> raise the heat for finer rewards, and the Hollow King's fall opens the endless <i>Abyss</i>.</p>
        <p><b style="color:var(--bronze-hi)">Elemental reactions:</b> combine schools for bonus effects — <i>Melt</i> (fire on frozen), <i>Shatter</i> (shards, earth or blades on frozen), <i>Overload</i> (lightning on burning), <i>Electrocute</i> (lightning on wet foes in water), <i>Combust</i> (fire on poison), <i>Purge</i> (holy on hexed) and more. In co-op, set up reactions for each other!</p>
        <p><b style="color:var(--bronze-hi)">Co-op:</b> one wizard hosts and shares the party code. Fallen wizards can be revived by holding <b>${esc(keyOf('interact'))}</b> beside them. Wizards who bleed out return when the chamber is cleared. Each player picks their own rewards — no loot stealing.</p>
        <div style="text-align:center"><button class="btn" id="bClose">Close</button></div>
      </div>`);
    m.querySelector('#bClose').onclick = () => { this._closeModal(m); onBack?.(); };
  }

  showSettings(settings, onChange, onBack) {
    const m = this._modal(`
      <div class="panel settings-box">
        <div class="title" style="font-size:28px">Settings</div>
        <div class="row">Master volume <input type="range" min="0" max="1" step="0.05" id="sMaster" value="${settings.master}"></div>
        <div class="row">Music <input type="range" min="0" max="1" step="0.05" id="sMusic" value="${settings.music}"></div>
        <div class="row">Effects <input type="range" min="0" max="1" step="0.05" id="sSfx" value="${settings.sfx}"></div>
        <div class="row">Mouse sensitivity <input type="range" min="0.2" max="3" step="0.05" id="sSens" value="${settings.sensitivity}"></div>
        <div class="row">Field of view <input type="range" min="65" max="105" step="1" id="sFov" value="${settings.fov}"></div>
        <div class="row">Screen shake <input type="range" min="0" max="1.5" step="0.05" id="sShake" value="${settings.shake}"></div>
        <div class="row">HUD scale <input type="range" min="0.75" max="1.3" step="0.05" id="sHud" value="${settings.hudScale ?? 1}"></div>
        <div class="row">Reduce flashing <input type="checkbox" id="sCalm" ${settings.calm ? 'checked' : ''}></div>
        <div class="row">High-contrast danger zones <input type="checkbox" id="sTele" ${settings.contrastTele ? 'checked' : ''}></div>
        <div class="row">Graphics quality <select id="sQual"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra (AO)</option></select></div>
        <div class="row">Invert mouse Y <input type="checkbox" id="sInv" ${settings.invertY ? 'checked' : ''}></div>
        <div class="row">Dynamic resolution <input type="checkbox" id="sDyn" ${settings.dynamicRes !== false ? 'checked' : ''}></div>
        <div class="row">Show FPS <input type="checkbox" id="sFps" ${settings.showFps ? 'checked' : ''}></div>
        <div style="color:var(--text-dim);font-size:12px">Quality changes apply on the next page load.</div>
        <div style="display:flex;gap:10px;justify-content:center"><button class="btn" id="bKeys">Controls</button><button class="btn" id="bClose">Done</button></div>
      </div>`);
    m.querySelector('#sQual').value = settings.quality;
    // each slider shows its value beside it (a player tuning FOV or sensitivity wants the number)
    const FMT = { sMaster: 'pct', sMusic: 'pct', sSfx: 'pct', sShake: 'pct', sHud: 'pct', sSens: 'x', sFov: 'deg' };
    for (const [id, f] of Object.entries(FMT)) {
      const inp = m.querySelector('#' + id), out = document.createElement('output');
      const show = () => { const v = +inp.value; out.textContent = f === 'pct' ? `${Math.round(v * 100)}%` : f === 'deg' ? `${v}°` : `${v.toFixed(2)}×`; };
      inp.after(out); show(); inp.addEventListener('input', show);
    }
    const bind = (id, key, num = true) => m.querySelector(id).addEventListener('input', (e) => { settings[key] = e.target.type === 'checkbox' ? e.target.checked : num ? +e.target.value : e.target.value; onChange(settings); });
    bind('#sMaster', 'master'); bind('#sMusic', 'music'); bind('#sSfx', 'sfx'); bind('#sSens', 'sensitivity'); bind('#sFov', 'fov'); bind('#sShake', 'shake'); bind('#sCalm', 'calm'); bind('#sHud', 'hudScale');
    bind('#sQual', 'quality', false); bind('#sInv', 'invertY', false); bind('#sTele', 'contrastTele', false); bind('#sFps', 'showFps', false); bind('#sDyn', 'dynamicRes', false);
    m.querySelector('#sQual').addEventListener('change', (e) => { settings.quality = e.target.value; onChange(settings); });
    m.querySelector('#bClose').onclick = () => { this._closeModal(m); onBack?.(); };
    m.querySelector('#bKeys').onclick = () => { this._closeModal(m); this.showControls(settings, onChange, () => this.showSettings(settings, onChange, onBack)); };
  }

  // Rebind the keys: click an action, press a key (or a mouse's middle or side
  // button). A key another action held goes to that action's old key instead.
  showControls(settings, onChange, onBack) {
    const m = this._modal(`
      <div class="panel settings-box keys-box">
        <div class="title" style="font-size:28px">Controls</div>
        <div class="keys-grid"></div>
        <div style="color:var(--text-dim);font-size:12px">Click an action, then press its new key. Esc cancels. Spells stay on the mouse buttons.</div>
        <div style="display:flex;gap:10px;justify-content:center"><button class="btn" id="kReset">Reset to defaults</button><button class="btn" id="kDone">Done</button></div>
      </div>`);
    const grid = m.querySelector('.keys-grid');
    let capture = null;
    const render = () => {
      grid.innerHTML = REBINDABLE.map(([a, name]) => `<div class="row">${esc(name)}<button class="btn small kb${capture === a ? ' cap' : ''}" data-a="${a}">${capture === a ? 'Press a key…' : esc(keyOf(a))}</button></div>`).join('');
      grid.querySelectorAll('button[data-a]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); capture = b.dataset.a; render(); }; });
    };
    const commit = (code) => {
      const a = capture; capture = null;
      if (code && code !== 'Escape') {
        const over = { ...(settings.keys ?? {}) };
        const old = BINDS[a][0];
        const other = REBINDABLE.map(([x]) => x).find((x) => x !== a && BINDS[x][0] === code);
        if (other) over[other] = old; // swap
        over[a] = code;
        settings.keys = over;
        applyBindings(over);
        this.refreshKeyLabels();
        onChange(settings);
      }
      render();
    };
    const onKey = (e) => { if (!capture) return; e.preventDefault(); e.stopImmediatePropagation(); commit(e.code); };
    const onMouse = (e) => { if (!capture || !(e.button === 1 || e.button > 2)) return; e.preventDefault(); e.stopImmediatePropagation(); commit('Mouse' + e.button); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    const close = () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('mousedown', onMouse, true); this._closeModal(m); onBack?.(); };
    m.querySelector('#kDone').onclick = close;
    m.querySelector('#kReset').onclick = () => { capture = null; settings.keys = {}; applyBindings({}); this.refreshKeyLabels(); onChange(settings); render(); };
    render();
    return m;
  }
  refreshKeyLabels() {
    for (const el of document.querySelectorAll('.slot[data-slot] .key')) el.textContent = slotKey(el.parentElement.dataset.slot);
  }

  // ======================================================================
  // HUD
  // ======================================================================
  onRunStart(game) {
    this.closeAllModals();
    this.clearScreens();
    this.game = game;
    const p = game.player;
    const c = p.cls;
    const col = hex(p.meta.color);
    this.hudEl.classList.remove('hidden');
    this.hudEl.innerHTML = `
      <div class="crosshair"><div class="ring"></div></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="damage-dir"></div>
      <div class="floor-info"><div class="fname"></div><div class="fsub"></div><div class="objective"></div></div>
      <canvas class="minimap"></canvas><div class="mm-frame"><i class="pip"></i></div>
      <div class="boss-bar hidden"><div class="bname"></div><div class="btitle"></div><div class="bframe"><i class="cap l"></i><div class="bar"><div class="lag"></div><div class="fill"></div><div class="sheen"></div><div class="phase-marks"></div></div><i class="cap r"></i></div></div>
      <div class="wave-ind"></div>
      <div class="team"></div>
      <div class="hp-wrap" style="--pc:${col}">
        <div class="buffs"></div>
        <div class="pframe">
          <div class="medal">${classEmblem(p.classId, col, 40)}</div>
          <div class="pmain">
            <div class="hp-name"><span>${esc(p.name)}</span><span class="cls">${p.meta.name}</span></div>
            <div class="bar" id="hpBar"><div class="lag"></div><div class="fill"></div><div class="shield"></div><div class="ticks"></div><div class="txt"></div></div>
            <div class="pfoot"><div class="dash-pips"></div><div class="resource"></div></div>
          </div>
        </div>
      </div>
      <div class="abilities" style="--pc:${col}"><div class="slot itemslot empty" data-slot="item"><div class="iic"></div><div class="key">${slotKey('item')}</div></div>${SLOTS.map((s) => `
        <div class="slot ${s === 'ultimate' ? 'ult' : ''}" data-slot="${s}">
          ${s === 'ultimate' ? '<div class="ult-fill"></div>' : ''}
          ${iconSVG(c.spells[s].icon, col, s === 'ultimate' ? 42 : 34)}
          <div class="cd"></div><div class="cdtxt"></div><div class="key">${slotKey(s)}</div><div class="charges"></div>
        </div>`).join('')}
      </div>
      <div class="gold-box"><span class="dread hidden" title="Dread Marks: +5% damage each, earned by flawless chambers">${iconSVG('skull', '#ff5a4a', 20)}<span id="dreadTxt">0</span></span><span class="coin">${iconSVG('gold', '#f0c050', 24)}<span id="goldTxt">0</span></span></div>
      <div class="prompt"></div>
      <div class="toasts"></div>
      <div class="banner"><div class="b1"></div><div class="line"></div><div class="b2"></div></div>
      <div class="click-hint hidden">CLICK TO CONTINUE</div>`;
    const q = (s) => this.hudEl.querySelector(s);
    this.h = {
      hpWrap: q('.hp-wrap'), itemSlot: q('.itemslot'), itemIcon: q('.itemslot .iic'), hp: q('#hpBar .fill'), hpLag: q('#hpBar .lag'), hpShield: q('#hpBar .shield'), hpTxt: q('#hpBar .txt'),
      dash: q('.dash-pips'), res: q('.resource'), buffs: q('.buffs'),
      slots: Object.fromEntries(SLOTS.map((s) => [s, q(`.slot[data-slot="${s}"]`)])),
      gold: q('#goldTxt'), goldBox: q('.gold-box'), dread: q('#dreadTxt'), dreadBox: q('.gold-box .dread'), prompt: q('.prompt'), toasts: q('.toasts'), banner: q('.banner'),
      hit: q('.hitmarker'), team: q('.team'), boss: q('.boss-bar'), bossFill: q('.boss-bar .fill'), bossLag: q('.boss-bar .lag'),
      bossName: q('.boss-bar .bname'), bossTitle: q('.boss-bar .btitle'), minimap: q('.minimap'), fname: q('.fname'), fsub: q('.fsub'),
      obj: q('.objective'), wave: q('.wave-ind'), dmgDir: q('.damage-dir'), clickHint: q('.click-hint'),
    };
    this.mm = this.h.minimap.getContext('2d');
    this.h.minimap.width = 400; this.h.minimap.height = 400;
    this._lastHp = p.hp;
  }

  onFloor(game, biome, index) {
    if (!this.h) return;
    const ab = game.abyss ?? 0;
    this.h.fname.textContent = ab ? `${biome.name} · Abyss ${ab}` : biome.name;
    const nm = !!game.difficulty?.nightmare;
    this.h.fsub.textContent = nm ? `${game.difficulty.damnation ? 'Damnation' : 'Nightmare'} · Realm ${index + 1} of ${BIOMES.length}` : `Realm ${index + 1} of ${BIOMES.length} · ${biome.subtitle}`;
    this.h.fsub.style.color = nm ? '#ff8070' : '';
    if (ab) this.banner(`ABYSS ${ab} · ${biome.name}`, 'The realms remade in darkness — deadlier than before', '#ff5878', 5);
    else if (nm) this.banner(biome.name, `${biome.subtitle} · ${game.difficulty.damnation ? 'damnation' : 'a nightmare'}`, game.difficulty.damnation ? '#ff3a60' : '#ff7060', 4);
    else this.banner(biome.name, biome.subtitle, '#e2c48a', 4);
    this.h.boss.classList.add('hidden');
    this.bossActor = null;
    this._mmCache = null;
    this._mmCenter = null;
  }

  update(dt, game) {
    if (!this.h || !game.player) return;
    const p = game.player;
    const h = this.h;
    // health (DOM writes only when a value changes: the HUD updates every frame)
    const hpPct = Math.max(0, p.hp / p.maxHp) * 100;
    setStyle(h.hp, 'width', hpPct.toFixed(1) + '%');
    setStyle(h.hpLag, 'width', hpPct.toFixed(1) + '%');
    setStyle(h.hpShield, 'width', Math.min(100, (p.shield / p.maxHp) * 100).toFixed(1) + '%');
    const low = hpPct < 30 && !p.dead;
    if (this._low !== low) { this._low = low; h.hpWrap.classList.toggle('low', low); }
    setText(h.hpTxt, p.downed ? `DOWNED ${Math.ceil(p.downT)}s` : p.dead ? 'SLAIN' : `${Math.ceil(p.hp)} / ${p.maxHp}${p.shield > 0 ? ` (+${Math.ceil(p.shield)})` : ''}`);
    // dash
    const pips = p.stats.dashCharges;
    if (h.dash.children.length !== pips) h.dash.innerHTML = '<i></i>'.repeat(pips);
    if (this._dashOn !== p.dashCharges + pips * 10) {
      this._dashOn = p.dashCharges + pips * 10;
      [...h.dash.children].forEach((el, i) => el.classList.toggle('on', i < p.dashCharges));
    }
    // class resource
    let res = '';
    if (p.classId === 'spellblade') res = `EDGE ${'◆'.repeat(p.edge)}${'◇'.repeat(5 - p.edge)}`;
    else if (p.classId === 'stormcaller') res = p.staticReady ? 'STATIC CHARGED ⚡' : '';
    else if (p.classId === 'bloodmage' && p.hp / p.maxHp < 0.4) res = 'FRENZY';
    setText(h.res, res);
    // buffs
    const bk = p.buffs.map((b) => b.id + Math.ceil(b.t)).join() + (p.hasteT > 0 ? 'h' + Math.ceil(p.hasteT) : '');
    if (bk !== this._buffKey) {
      this._buffKey = bk;
      const col = hex(p.meta.color);
      h.buffs.innerHTML = p.buffs.map((b) => `<div class="buff">${iconSVG(b.icon ?? (b.id === 'stoneskin' ? 'stoneskin' : b.id === 'bloodpact' ? 'pact' : b.id === 'timestop' ? 'hourglass' : 'power'), col, 20)}<span class="t">${b.label ?? Math.ceil(b.t)}</span></div>`).join('')
        + (p.hasteT > 0 ? `<div class="buff">${iconSVG('speed', '#40e0c8', 20)}<span class="t">${Math.ceil(p.hasteT)}</span></div>` : '');
    }
    // ability slots (child elements looked up once)
    for (const s of SLOTS) {
      const el = h.slots[s];
      const q = (el._q ??= { cd: el.querySelector('.cd'), cdtxt: el.querySelector('.cdtxt'), charges: el.querySelector('.charges'), ult: el.querySelector('.ult-fill') });
      const sp = p.cls.spells[s];
      let pctCd = 0, txt = '';
      if (s === 'ultimate') {
        setStyle(q.ult, 'height', `${Math.floor(p.ult)}%`);
        if (el._ready !== (p.ult >= 100)) { el._ready = p.ult >= 100; el.classList.toggle('ready-ult', el._ready); }
        txt = p.ult >= 100 ? '' : `${Math.floor(p.ult)}%`;
        setStyle(q.cdtxt, 'fontSize', '13px');
      } else if (s !== 'primary') {
        const maxCh = sp.charges ?? 1;
        if (p.chargesLeft[s] <= 0) {
          const full = p._cdOf(s) || 1;
          pctCd = (p.cds[s] / full) * 100;
          txt = p.cds[s] > 0 ? (p.cds[s] < 1 ? p.cds[s].toFixed(1) : Math.ceil(p.cds[s])) : '';
        }
        if (q.charges) setText(q.charges, maxCh > 1 ? String(p.chargesLeft[s]) : '');
      }
      // a spell coming off cooldown flashes its slot once
      const cooling = pctCd > 0;
      if (el._cooling && !cooling) replay(el, 'ready');
      el._cooling = cooling;
      const pv = pctCd.toFixed(1) + '%';
      if (q.cd && q.cd._p !== pv) { q.cd._p = pv; q.cd.style.setProperty('--p', pv); }
      setText(q.cdtxt, String(txt));
    }
    // the item slot: redrawn only when the item changes
    if (this._itemKey !== p.item) {
      const was = this._itemKey;
      this._itemKey = p.item;
      const d = p.item ? ITEMS[p.item] : null;
      h.itemIcon.innerHTML = d ? iconSVG(d.icon, d.color, 30) : '';
      h.itemSlot.classList.toggle('empty', !d);
      h.itemSlot.style.setProperty('--ic', d?.color ?? '#5a4426');
      h.itemSlot.title = d ? `${d.name}: ${d.desc}` : 'No item';
      if (d && was !== undefined) replay(h.itemSlot, 'ready');
    }
    // gold
    setText(h.gold, String(Math.floor(p.gold)));
    if (p.dread !== this._dread) { this._dread = p.dread; h.dreadBox.classList.toggle('hidden', !p.dread); setText(h.dread, String(p.dread)); }
    // team
    const team = [...game.remotes.values()];
    const tk = team.map((r) => `${r.id}${Math.ceil(r.hp)}${r.downed}${r.dead}${r.maxHp}`).join();
    if (tk !== this._teamKey) {
      this._teamKey = tk;
      h.team.innerHTML = team.map((r) => `
        <div class="tm ${r.downed || r.dead ? 'down' : ''}" style="--pc:${hex(r.meta.color)}"><div class="row"><span class="tmedal">${classEmblem(r.classId, hex(r.meta.color), 18)}</span><span class="tname">${esc(r.name)}</span><span class="thp">${r.dead ? 'SLAIN' : r.downed ? 'DOWN' : Math.ceil(r.hp)}</span></div>
        <div class="bar small ally"><div class="fill" style="width:${Math.max(0, r.hp / r.maxHp) * 100}%;--hpc:${r.downed || r.dead ? '#8a8a8a' : allyHpColor(r.hp / r.maxHp)}"></div></div></div>`).join('');
    }
    // boss
    if (this.bossActor) {
      const a = this.bossActor;
      const f = Math.max(0, a.hp / a.maxHp) * 100;
      h.bossFill.style.width = f + '%';
      h.bossLag.style.width = f + '%';
      const ex = game.time < a.exposedUntil;
      if (this._bossEx !== ex) { this._bossEx = ex; h.boss.classList.toggle('exposed', ex); }
      if (a.dead) { setTimeout(() => h.boss.classList.add('hidden'), 1500); this.bossActor = null; }
    }
    // objective
    const room = game.level.roomAt(p.pos.x, p.pos.z);
    let obj = '';
    const fightRoom = game.director.active?.room ?? room;
    const foes = game.actors.list.reduce((n, a) => n + (fightsHere(a, fightRoom) ? 1 : 0), 0);
    const locked = game.director.active || (room && !room.cleared && foes > 0);
    const tr = fightRoom?.type === ROOM.TRIAL && fightRoom.trialWon === null && fightRoom.trialEnd ? Math.max(0, Math.ceil(fightRoom.trialEnd - game.time)) : null;
    if (locked && tr !== null) obj = `Trial — ${tr}s left · ${foes} foe${foes === 1 ? '' : 's'} remain`;
    else if (locked) obj = game.actors.list.some((a) => a.boss && !a.dead) ? 'Defeat the guardian' : `Survive the ambush — ${foes} foe${foes === 1 ? '' : 's'} remain`;
    else if (room?.type === ROOM.BOSS && room.cleared) obj = game.interactables.some((i) => i.kind === 'abyssPortal') ? 'Claim your victory, or descend into the Abyss' : 'Step through the portal to ascend';
    else obj = 'Find the way to the guardian\'s lair';
    if (obj !== this._obj) { this._obj = obj; h.obj.textContent = obj; }
    // banners/toasts timers
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) h.banner.classList.remove('show'); }
    // hitmarker fade
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) h.hit.style.opacity = 0; }
    // damage direction indicators (styles written only when they change)
    for (let i = this.dmgDirs.length - 1; i >= 0; i--) {
      const d = this.dmgDirs[i];
      d.t -= dt;
      if (d.t <= 0) { d.el.style.display = 'none'; this._dmgPool.push(d.el); this.dmgDirs.splice(i, 1); continue; }
      const rel = Math.atan2(d.x - p.pos.x, d.z - p.pos.z) - (p.yaw + Math.PI);
      setStyle(d.el, 'transform', `rotate(${(-rel).toFixed(2)}rad)`);
      setStyle(d.el, 'opacity', Math.min(1, d.t * 1.6).toFixed(2));
    }
    updateRelicShelf(this, game);
    // pointer lock hint
    h.clickHint.classList.toggle('hidden', this.input.locked || this.modalOpen || game.ended || !!this.pauseEl);
    this._minimap(game);
    this._draw2d(dt, game);
  }

  // ---------------------------------------------------------------- minimap
  _minimap(game) {
    const big = this.input.is('map');
    const cvs = this.h.minimap;
    cvs.classList.toggle('big', big);
    this._mmT = (this._mmT ?? 0) + 1;
    if (!big && this._mmT % 3 !== 1) return; // (every third frame, starting with the first)
    const g = this.mm;
    const L = game.level;
    const p = game.player;
    const W = cvs.width, H = cvs.height;
    g.clearRect(0, 0, W, H);
    if (this._mmCenterL !== L) { this._mmCenterL = L; this._mmCenter = this._levelCenter(L); }
    // the big map fits the rooms' extent (with a margin), not the whole level grid
    const scale = big ? Math.min(W / (this._mmCenter.w + 8), H / (this._mmCenter.h + 8)) : 3.2;
    const cx = big ? this._mmCenter : p.pos;
    g.save();
    g.translate(W / 2, H / 2);
    if (!big) g.rotate(p.yaw);
    g.translate(-cx.x * scale, -cx.z * scale);
    // rooms and corridors only change when a room is discovered or a fight
    // starts/ends: drawn once into an offscreen layer, blitted every frame
    const layer = this._mmLayer(game, L);
    g.drawImage(layer.c, 0, 0, layer.c.width * scale / layer.s, layer.c.height * scale / layer.s);
    for (const r of L.rooms) {
      if (!layer.known.has(r.id)) continue;
      const icon = r.type === ROOM.BOSS ? '☠' : r.type === ROOM.SHOP ? '⚖' : r.type === ROOM.SHRINE ? '✚' : r.type === ROOM.TREASURE ? '♦' : r.type === ROOM.ELITE ? '★' : r.type === ROOM.TRIAL ? '⧗' : r.type === ROOM.ALTAR ? '♰' : r.type === ROOM.GAMBLER ? '⚄' : r.type === ROOM.SECRET ? '♦' : '';
      if (!icon) continue;
      g.save();
      g.translate((r.x + r.w / 2) * T * scale, (r.y + r.h / 2) * T * scale);
      if (!big) g.rotate(-p.yaw);
      this._blitText(g, this._textBitmap(icon, `${big ? 22 : 18}px serif`, r.type === ROOM.BOSS ? '#ff6050' : '#f0d090', { lw: 0 }), 0, 0);
      g.restore();
    }
    // enemies in current encounter
    g.fillStyle = '#ff4030';
    for (const a of game.actors.list) {
      if (a.dead || a.faction !== 'enemy') continue;
      const rm = L.roomAt(a.pos.x, a.pos.z);
      if (!rm || !rm.visited) continue;
      if (a.def.hoarder) { g.fillStyle = '#ffd040'; g.beginPath(); g.arc(a.pos.x * scale, a.pos.z * scale, 4.5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#ff4030'; continue; }
      g.beginPath(); g.arc(a.pos.x * scale, a.pos.z * scale, a.boss ? 6 : 2.5, 0, Math.PI * 2); g.fill();
    }
    // players
    const drawP = (pl, color) => {
      g.save();
      g.translate(pl.pos.x * scale, pl.pos.z * scale);
      g.rotate(-pl.yaw);
      g.fillStyle = color;
      g.beginPath(); g.moveTo(0, -8); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath(); g.fill();
      g.restore();
    };
    for (const r of game.remotes.values()) drawP(r, hex(r.meta.color));
    drawP(p, '#fff4d8');
    g.restore();
  }
  _mmLayer(game, L) {
    const active = game.director.active?.room?.id ?? -1;
    let key = active + ':';
    for (const r of L.rooms) if (r.visited) key += r.id + ',';
    const c0 = this._mmL;
    if (c0 && c0.L === L && c0.key === key) return c0;
    const S = 3.2; // px per metre in the layer
    const c = c0?.L === L ? c0.c : document.createElement('canvas');
    c.width = Math.ceil(L.W * T * S); c.height = Math.ceil(L.H * T * S);
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const known = new Set();
    for (const r of L.rooms) if (r.visited) { known.add(r.id); for (const n of r.neighbors) known.add(n); }
    g.fillStyle = 'rgba(150,130,100,0.35)';
    for (const co of L.corridors) {
      if (!(L.rooms[co.a].visited || L.rooms[co.b].visited)) continue;
      for (const i of co.cells) { const x = i % L.W, y = Math.floor(i / L.W); g.fillRect(x * T * S, y * T * S, T * S + 0.5, T * S + 0.5); }
    }
    for (const r of L.rooms) {
      if (!known.has(r.id)) continue;
      const x = r.x * T * S, y = r.y * T * S, w = r.w * T * S, hh = r.h * T * S;
      g.fillStyle = r.visited ? (active === r.id ? 'rgba(160,40,30,0.55)' : 'rgba(120,100,75,0.45)') : 'rgba(60,50,40,0.3)';
      g.fillRect(x, y, w, hh);
      // a visited room's ground as it lies: raised floor lighter, pits darker, water blue-grey, vents marked
      if (r.visited) {
        for (let cy = r.y; cy < r.y + r.h; cy++) for (let cx = r.x; cx < r.x + r.w; cx++) {
          const i = L.idx(cx, cy);
          if (L.roomId[i] !== r.id) continue;
          const hgt = L.hgt[i];
          if (L.kind[i] === K_WATER) g.fillStyle = 'rgba(70,110,130,0.45)';
          else if (L.cells[i] !== 1) g.fillStyle = 'rgba(20,16,12,0.55)';
          else if (hgt > 0.3) g.fillStyle = `rgba(235,215,170,${Math.min(0.32, 0.16 * hgt)})`;
          else if (hgt < -0.3) g.fillStyle = `rgba(0,0,0,${Math.min(0.4, -0.2 * hgt)})`;
          else continue;
          g.fillRect(cx * T * S, cy * T * S, T * S + 0.5, T * S + 0.5);
        }
        g.fillStyle = 'rgba(255,120,40,0.75)';
        for (const v of r.vents ?? []) { g.beginPath(); g.arc(v.x * S, v.z * S, 2.2, 0, Math.PI * 2); g.fill(); }
      }
      g.strokeStyle = r.visited ? 'rgba(226,196,138,0.8)' : 'rgba(226,196,138,0.3)';
      g.lineWidth = 1.5;
      g.strokeRect(x, y, w, hh);
    }
    this._mmL = { L, key, c, s: S, known };
    return this._mmL;
  }
  _levelCenter(L) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const r of L.rooms) { minX = Math.min(minX, r.x * T); maxX = Math.max(maxX, (r.x + r.w) * T); minZ = Math.min(minZ, r.y * T); maxZ = Math.max(maxZ, (r.y + r.h) * T); }
    return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, h: maxZ - minZ };
  }

  // ---------------------------------------------------------------- 2D overlay
  // an arrow on the screen's edge toward a teammate out of view; a downed one pulses red
  _edgeMark(g, r) {
    const cam = this.renderer.camera;
    const v = (this._ev ??= new THREE.Vector3()).set(r.pos.x, r.pos.y + 1.2, r.pos.z).applyMatrix4(cam.matrixWorldInverse);
    let dx = v.x, dy = -v.y;
    if (Math.abs(dx) + Math.abs(dy) < 1e-3) dy = 1; // right behind: point down
    const ang = Math.atan2(dy, dx), c = Math.cos(ang), sn = Math.sin(ang);
    // (the bottom edge keeps clear of the spell bar and the health plate)
    const W = innerWidth, H = innerHeight, mx = W / 2 - 46, my = sn > 0 ? H / 2 - 140 : H / 2 - 50;
    const t = Math.min(mx / Math.max(1e-3, Math.abs(c)), my / Math.max(1e-3, Math.abs(sn)));
    const x = W / 2 + c * t, y = H / 2 + sn * t;
    const down = r.downed, col = down ? '#ff5050' : hex(r.meta.color2 ?? r.meta.color);
    g.globalAlpha = down ? 0.8 + 0.2 * Math.sin(performance.now() / 120) : 0.85;
    g.save(); g.translate(x, y); g.rotate(ang); if (down) g.scale(1.35, 1.35);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.moveTo(16, 0); g.lineTo(-8, -11); g.lineTo(-3, 0); g.lineTo(-8, 11); g.closePath(); g.fill();
    g.fillStyle = col; g.beginPath(); g.moveTo(13, 0); g.lineTo(-6, -8); g.lineTo(-2, 0); g.lineTo(-6, 8); g.closePath(); g.fill();
    g.restore();
    this._blitText(g, this._textBitmap(down ? r.name + ' — DOWNED' : r.name, '600 12px Cinzel, serif', col, { stroke: 'rgba(0,0,0,0.75)', lw: 3 }), x - c * 34, y - sn * 22);
    g.globalAlpha = 1;
  }
  _project(pos) {
    const v = (this._pv ??= new THREE.Vector3()).set(pos.x, pos.y, pos.z).project(this.renderer.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, z: v.z };
  }

  // Text drawn into a small canvas once (font, outline and glow included) and
  // blitted with drawImage after that. Per-frame fillText/strokeText with an
  // animated font size (and shadowBlur glows) cost ~2 ms a frame in a fight.
  _textBitmap(text, font, fill, { stroke = 'rgba(0,0,0,0.85)', lw = 3, glow = 0 } = {}) {
    const key = text + '|' + font + '|' + fill + '|' + lw + '|' + glow;
    const cache = (this._tb ??= new Map());
    let b = cache.get(key);
    if (b) return b;
    // packed into shared atlas pages (shelf packing): creating a canvas per
    // text cost several ms each on some machines
    const pad = Math.ceil(lw + glow + 2);
    const A = (this._atlas ??= { pages: [], x: 0, y: 0, row: 0 });
    let page = A.pages[A.pages.length - 1];
    if (!page) page = this._atlasPage();
    page.g.font = font;
    const w = Math.ceil(page.g.measureText(text).width) + pad * 2;
    const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
    const h = Math.ceil(px * 1.3) + pad * 2;
    const P = 1024;
    if (A.x + w > P) { A.x = 0; A.y += A.row + 1; A.row = 0; }
    if (A.y + h > P) {
      // page full: start another; past a few pages, start over (rare: the
      // cache only holds distinct texts, digits and short labels)
      if (A.pages.length >= 4) { A.pages.length = 0; cache.clear(); }
      page = this._atlasPage();
      A.x = 0; A.y = 0; A.row = 0;
      page.g.font = font;
    }
    const g = page.g, x0 = A.x, y0 = A.y;
    g.save();
    g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (lw) { g.lineWidth = lw; g.strokeStyle = stroke; g.lineJoin = 'round'; g.strokeText(text, x0 + w / 2, y0 + h / 2); }
    if (glow) { g.shadowColor = fill; g.shadowBlur = glow; }
    g.fillStyle = fill;
    g.fillText(text, x0 + w / 2, y0 + h / 2);
    g.restore();
    A.x += w + 1; A.row = Math.max(A.row, h);
    b = { c: page.c, sx: x0, sy: y0, w, h, pad };
    cache.set(key, b);
    return b;
  }
  _atlasPage() {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const page = { c, g: c.getContext('2d') };
    this._atlas.pages.push(page);
    return page;
  }
  // Damage numbers change on every merged hit, so they're composed from cached
  // per-digit bitmaps (ten per style) instead of a fresh bitmap per value.
  _blitNumber(g, text, font, fill, x, y, scale = 1) {
    const bs = this._numBits ??= [];
    let adv = 0;
    for (let i = 0; i < text.length; i++) { const b = this._textBitmap(text[i], font, fill); bs[i] = b; adv += b.w - b.pad * 2; }
    let cx = x - (adv * scale) / 2;
    for (let i = 0; i < text.length; i++) {
      const b = bs[i], a = (b.w - b.pad * 2) * scale;
      this._blitText(g, b, cx + a / 2, y, scale);
      cx += a;
    }
  }
  // blit a cached text bitmap centred at x, with its baseline-ish at y
  _blitText(g, b, x, y, scale = 1) {
    const w = b.w * scale, h = b.h * scale;
    g.drawImage(b.c, b.sx, b.sy, b.w, b.h, x - w / 2, y - h * 0.62, w, h);
  }

  _draw2d(dt, game) {
    const g = this.ctx;
    // nothing drawn last frame and nothing to draw now: leave the canvas alone
    const busy = this.numbers.length || this.floats.length || game.remotes.size || game.pings?.length || game.actors.list.length;
    if (!busy && !this._2dDirty) return;
    this._2dDirty = !!busy;
    g.clearRect(0, 0, innerWidth, innerHeight);
    const cam = this.renderer.camera;
    // enemy health bars (only damaged or elite/boss nearby)
    for (const a of game.actors.list) {
      if (a.dead || a.boss) continue;
      if (a.hp >= a.maxHp && !a.elite && a.faction === 'enemy') continue;
      const d = a.pos.distanceTo(cam.position);
      if (d > 30) continue;
      // no health bars through walls (line of sight re-checked a few times a second)
      if (!(a._losT > game.time)) { a._losT = game.time + 0.2 + Math.random() * 0.1; a._los = game.collision.los(cam.position.x, cam.position.y, cam.position.z, a.pos.x, a.pos.y + a.height * 0.8, a.pos.z); }
      if (!a._los) continue;
      const s = this._project({ x: a.pos.x, y: a.pos.y + a.height + 0.35, z: a.pos.z });
      if (!s) continue;
      // keep labels off the minimap corner
      if (s.x > innerWidth - 250 && s.y < 250) continue;
      const w = a.elite ? 70 : 46, hgt = a.elite ? 6 : 4;
      const alpha = Math.min(1, (30 - d) / 8);
      g.globalAlpha = alpha;
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(s.x - w / 2 - 1, s.y - 1, w + 2, hgt + 2);
      g.fillStyle = a.faction === 'ally' ? '#50d060' : a.elite ? '#ff9020' : '#c82020';
      g.fillRect(s.x - w / 2, s.y, w * Math.max(0, a.hp / a.maxHp), hgt);
      if (a.shieldHp > 0) { g.fillStyle = '#ffe080'; g.fillRect(s.x - w / 2, s.y - 3, w * Math.min(1, a.shieldHp / a.maxHp), 2); }
      if (a.elite) {
        // (built once per affix set, not every frame; a champion's name comes after spawn)
        if (a._lblFor !== a.def || a._lblA !== a.affix || a._lblB !== a.affix2) { a._lblFor = a.def; a._lblA = a.affix; a._lblB = a.affix2; a._lbl = capAffix(a.affix) + capAffix(a.affix2) + a.def.name; }
        const b = this._textBitmap(a._lbl, '600 11px Cinzel, serif', '#ffb050', { lw: 0 });
        const lw = b.w / 2 + 2;
        this._blitText(g, b, Math.max(lw, Math.min(innerWidth - lw, s.x)), s.y - 9);
      }
      // status pips
      let px = s.x - w / 2;
      for (const [k, col] of [[1, '#ff7a30'], [2, '#7fd8ff'], [4, '#c8f4ff'], [8, '#9fb4ff'], [16, '#9adf3a'], [32, '#c050ff'], [64, '#ff3048'], [128, '#40e0c8'], [4096, '#ffc040']]) {
        if (a.mask & k) { g.fillStyle = col; g.fillRect(px, s.y + hgt + 2, 6, 3); px += 8; }
      }
      g.globalAlpha = 1;
    }
    // teammate name tags (and, for one out of view, a marker at the screen edge pointing to them)
    for (const r of game.remotes.values()) {
      const s = this._project({ x: r.pos.x, y: r.pos.y + 2.25, z: r.pos.z });
      if (!s || s.x < 0 || s.y < 0 || s.x > innerWidth || s.y > innerHeight) { if (!r.dead) this._edgeMark(g, r); continue; }
      this._blitText(g, this._textBitmap(r.name + (r.downed ? ' — DOWNED' : ''), '600 13px Cinzel, serif', r.downed ? '#ff5050' : hex(r.meta.color2 ?? r.meta.color), { stroke: 'rgba(0,0,0,0.7)', lw: 3 }), s.x, s.y - 4);
      // a teammate's bar: wide, outlined and in ally colours (never an enemy's red)
      const f = Math.max(0, Math.min(1, r.hp / r.maxHp)), bw = 64, bh = 7, bx = s.x - bw / 2, by = s.y + 5;
      g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
      g.strokeStyle = 'rgba(235,245,235,0.8)'; g.lineWidth = 1; g.strokeRect(bx - 1.5, by - 1.5, bw + 3, bh + 3);
      g.fillStyle = r.downed || r.dead ? '#8a8a8a' : allyHpColor(f); g.fillRect(bx, by, bw * f, bh);
      if (r.downed) {
        g.strokeStyle = '#ffd860'; g.lineWidth = 3;
        g.beginPath(); g.arc(s.x, s.y + 26, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (r.reviveProgress ?? 0)); g.stroke();
      }
    }
    // damage numbers
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += dt;
      n.pos.y += dt * (n.crit ? 1.4 : 1.0);
      const s = this._project(n.pos);
      if (n.t > n.life || !s) { if (n.t > n.life) this.numbers.splice(i, 1); continue; }
      const k = n.t / n.life;
      const pop = n.t < 0.12 ? 1 + (1 - n.t / 0.12) * (n.crit ? 0.9 : 0.4) : 1;
      g.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      // bigger hits read bigger; the size is rounded so a merged number only
      // re-renders its bitmap when it visibly grows, and the pop is a scale
      const size = Math.round(n.dot ? 13 : (n.crit ? 22 : 15) + Math.min(10, Math.log2(1 + n.amount / 12) * 2.5));
      this._blitNumber(g, n.text, `${n.crit ? 700 : 600} ${size}px Cinzel, serif`, n.color, s.x + n.ox, s.y, pop);
      g.globalAlpha = 1;
    }
    // floating texts (reactions etc.)
    // call-outs (BLOCKED, SHATTER, INTERRUPT...): oldest first, each keeps its place and a newer one
    // that would cover it steps up just clear of it, so a pile of them stays readable; none is
    // drawn off the top of the screen (the rects are reused: no garbage)
    const FR = (this._floatRects ??= new Float32Array(4 * 24));
    let nr = 0, keep = 0;
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i];
      f.t += dt;
      f.pos.y += dt * 0.8;
      if (f.t > 1.4) continue;
      this.floats[keep++] = f;
      const s = this._project(f.pos);
      if (!s) continue;
      const b = this._textBitmap(f.text, `700 ${f.big ? 22 : 15}px Cinzel, serif`, f.color, { stroke: 'rgba(0,0,0,0.9)', lw: 4, glow: 12 });
      const hw = b.w * 0.36, hh = b.h * 0.3; // (the lettering, not the glow around it)
      let y = Math.max(s.y, hh + 34);
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (let j = 0; j < nr; j++) {
          const o = j * 4;
          if (s.x + hw < FR[o] || s.x - hw > FR[o + 2] || y + hh < FR[o + 1] || y - hh > FR[o + 3]) continue;
          y = FR[o + 1] - hh - 2; moved = true;
        }
        if (!moved) break;
      }
      if (nr < 24) { const o = nr * 4; FR[o] = s.x - hw; FR[o + 1] = y - hh; FR[o + 2] = s.x + hw; FR[o + 3] = y + hh; nr++; }
      g.globalAlpha = f.t > 1 ? 1 - (f.t - 1) / 0.4 : 1;
      const pop = f.t < 0.15 ? 1 + (1 - f.t / 0.15) * 0.8 : 1;
      this._blitText(g, b, s.x, y, pop);
      g.globalAlpha = 1;
    }
    this.floats.length = keep;
    // pings: a foe ping rides above its foe, a thing ping names the thing; off screen
    // (or behind you) a ping clings to the screen's edge, pointing the way
    for (const pg of game.pings ?? []) {
      const age = game.time - pg.born;
      const fade = Math.min(1, (pg.life - age) / 0.8);
      let s = this._project(pg.pos);
      let edge = false;
      if (!s || s.x < 30 || s.x > innerWidth - 30 || s.y < 30 || s.y > innerHeight - 30) {
        // direction in view space, pushed to the border
        const v = (this._pe ??= new THREE.Vector3()).copy(pg.pos).applyMatrix4(this.renderer.camera.matrixWorldInverse);
        let dx = v.x, dy = -v.y;
        if (v.z > 0) { dx = -dx; dy = -dy; } // behind: mirror
        const k = Math.min((innerWidth / 2 - 34) / Math.max(1e-3, Math.abs(dx)), (innerHeight / 2 - 34) / Math.max(1e-3, Math.abs(dy)));
        s = { x: innerWidth / 2 + dx * k, y: innerHeight / 2 + dy * k };
        edge = true;
      }
      const foe = pg.kind === 'foe', item = pg.kind === 'item';
      const pulse = 1 + 0.25 * Math.max(0, 1 - age * 2.5); // a pop when it lands
      g.globalAlpha = Math.max(0, fade);
      g.lineWidth = 2.5;
      g.strokeStyle = pg.color;
      g.fillStyle = foe ? 'rgba(200,40,30,0.35)' : 'rgba(0,0,0,0.25)';
      g.beginPath();
      const r = 11 * pulse;
      if (foe) { g.moveTo(s.x - r, s.y - r * 0.9); g.lineTo(s.x + r, s.y - r * 0.9); g.lineTo(s.x, s.y + r * 0.7); g.closePath(); } // a chevron over the foe
      else if (item) g.arc(s.x, s.y, r * 0.85, 0, Math.PI * 2);
      else { g.moveTo(s.x, s.y - r * 1.3); g.lineTo(s.x + r * 0.8, s.y); g.lineTo(s.x, s.y + r * 1.3); g.lineTo(s.x - r * 0.8, s.y); g.closePath(); }
      g.fill(); g.stroke();
      const dist = Math.round(pg.pos.distanceTo(cam.position));
      const label = (pg.label ? pg.label : pg.name) + (edge || dist > 6 ? ` · ${dist}m` : '');
      this._blitText(g, this._textBitmap(label, '600 12px Cinzel, serif', foe ? '#ff7a60' : pg.color, { lw: 3 }), s.x, s.y - 24);
      if (pg.label) this._blitText(g, this._textBitmap(pg.name, '11px Cinzel, serif', pg.color, { lw: 3 }), s.x, s.y + 24);
      g.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- feedback API
  // Hits on the same target within a short window merge into one rising number
  // (damage over time accumulates for a second), so a fight isn't a cloud of 3s and 7s.
  damageNumber(pos, amount, el, crit, dot, key) {
    if (key != null) {
      for (const n of this.numbers) {
        if (n.key !== key || n.dot !== !!dot || n.t > (dot ? 1.0 : 0.3)) continue;
        n.amount += amount;
        n.text = String(Math.round(n.amount));
        if (crit && !n.crit) { n.crit = true; n.color = '#ffd040'; n.life = 1.0; }
        n.pos.copy(pos);
        if (!dot) n.t = Math.min(n.t, 0.05);
        return;
      }
    }
    if (this.numbers.length > 60) this.numbers.shift();
    const col = crit ? '#ffd040' : dot ? 'rgba(220,210,190,0.75)' : hex(ELEMENT_COLORS[el] ?? 0xffffff);
    const cam = this.renderer.camera.position;
    const seen = !this.game?.collision || this.game.collision.los(cam.x, cam.y, cam.z, pos.x, pos.y, pos.z);
    if (!seen) return;
    this.numbers.push({ pos: pos.clone(), amount, key, text: String(Math.round(amount)), color: col, crit, dot: !!dot, t: 0, life: dot ? 1.3 : crit ? 1.0 : 0.8, ox: (Math.random() - 0.5) * 30 });
  }
  floatText(pos, text, color = '#fff', big = false) { this.floats.push({ pos: pos.clone(), text, color, big, t: 0 }); }
  hitmarker(crit, kill, weak = false) {
    if (!this.h) return;
    const el = this.h.hit;
    el.classList.toggle('crit', crit);
    el.classList.toggle('kill', kill);
    el.classList.toggle('weak', weak && !kill);
    el.style.opacity = 1;
    el.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${kill ? 1.4 : crit ? 1.2 : 1})`;
    this.hitT = kill ? 0.25 : 0.12;
  }
  healFlash(n) {
    if (this.game) this.game.healPulse = Math.min(1, (this.game.healPulse ?? 0) + n / 40);
  }
  // One marker per direction: a hit within ~25° of a live marker renews it,
  // and the elements are pooled (eight at most). A crowd used to stack a new
  // blurred ring per hit, each restyled every frame.
  damageDirection(from, p = this.game?.player) {
    if (!from || !this.h || !p) return;
    const ang = Math.atan2(from.x - p.pos.x, from.z - p.pos.z);
    for (const d of this.dmgDirs) {
      const da = Math.atan2(d.x - p.pos.x, d.z - p.pos.z) - ang;
      if (Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) < 0.45) { d.x = from.x; d.z = from.z; d.t = 1; return; }
    }
    let d = this.dmgDirs.length >= 8 ? this.dmgDirs.shift() : null;
    if (!d) {
      const el = this._dmgPool.pop() ?? document.createElement('i');
      if (el.parentNode !== this.h.dmgDir) this.h.dmgDir.appendChild(el);
      el.style.display = '';
      d = { el, x: 0, z: 0, t: 1 };
    }
    d.x = from.x; d.z = from.z; d.t = 1;
    this.dmgDirs.push(d);
  }
  slotDenied(slot) {
    const el = this.h?.slots[slot];
    if (!el) return;
    replay(el, 'denied');
  }
  goldPulse() {
    const el = this.h?.goldBox;
    if (!el) return;
    // (a coin a pickup, up to eight a drop: one pulse in flight at a time is all the eye can see)
    const now = performance.now();
    if (now - (this._goldPulseT ?? 0) < 120) return;
    this._goldPulseT = now;
    replay(el, 'pulse');
  }
  prompt(text, progress) {
    if (!this.h) return;
    const key = text + (progress !== undefined ? Math.round(progress * 30) : '');
    if (key === this._promptKey) return;
    this._promptKey = key;
    this.h.prompt.innerHTML = text ? `${esc(text)}${progress !== undefined ? `<div class="progress"><i style="width:${Math.min(100, progress * 100)}%"></i></div>` : ''}` : '';
  }
  // the blows that just put you down (tracker.recap), under the banner for a few seconds
  recap(rows) {
    if (!this.h || !rows?.length) return;
    let el = this._recapEl;
    if (!el) { el = this._recapEl = document.createElement('div'); el.className = 'recap'; this.h.banner.parentElement.appendChild(el); }
    el.innerHTML = `<div class="rh">What hit you</div>` + rows.map((h) => `<div class="rr"><span>${esc(h.name)}${h.move ? ` <em>· ${esc(h.move)}</em>` : ''}${h.n > 1 ? ` ×${h.n}` : ''}</span><b>${Math.round(h.dmg)}</b></div>`).join('');
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(this._recapT);
    this._recapT = setTimeout(() => el.classList.remove('show'), 7000);
  }

  banner(a, b = '', color = '#e2c48a', dur = 3) {
    if (!this.h) return;
    const el = this.h.banner;
    el.querySelector('.b1').textContent = a;
    el.querySelector('.b2').textContent = b;
    el.style.color = color;
    // mid-fight it must not hide the foes: smaller, see-through, gone sooner
    // (a foe within 25 m or a boss up: works on every peer, the director's state lives on the host)
    const g = this.game, pp = g?.player?.pos;
    const bossUp = !!this.bossActor && !this.bossActor.dead;
    const fight = !!pp && (bossUp || g.actors.hostiles().some((x) => (x.pos.x - pp.x) ** 2 + (x.pos.z - pp.z) ** 2 < 625));
    el.classList.toggle('combat', fight);
    el.classList.toggle('edge', fight && !bossUp); // (up in the free strip at the top, where the boss bar would be)
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.bannerT = fight ? Math.min(dur, 2.2) : dur;
  }
  // the crosshair over a weak point (Game._aimOnWeak): gold, the ring drawn in
  aimWeak(on) {
    const h = this.h;
    if (!h || on === h.aimWeak) return;
    h.aimWeak = on;
    (h.xhair ??= this.hudEl.querySelector('.crosshair'))?.classList.toggle('weak', on); // (on this run's HUD)
  }
  // a kill streak's call, just under the crosshair: pops in and fades on its own (one reused element)
  streak(text, sub, color) {
    if (!this.h) return;
    let el = this._streakEl;
    if (!el) { el = this._streakEl = document.createElement('div'); el.className = 'streak'; el.innerHTML = '<div class="s1"></div><div class="s2"></div>'; this.h.banner.parentElement.appendChild(el); }
    el.querySelector('.s1').textContent = text;
    el.querySelector('.s2').textContent = sub;
    el.style.color = color;
    replay(el, 'show');
  }
  toast(text, color) {
    const host = this.h?.toasts;
    if (!host) { console.log(text); return; }
    const el = document.createElement('div');
    el.className = 'toast';
    if (color) el.style.borderColor = color;
    el.innerHTML = color ? `<span style="color:${color}">${esc(text)}</span>` : esc(text);
    host.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity 0.5s'; el.style.opacity = 0; setTimeout(() => el.remove(), 500); }, 3500);
    while (host.children.length > 5) host.firstChild.remove();
  }
  wave(n, of) {
    if (!this.h) return;
    this.h.wave.textContent = `WAVE ${n} / ${of}`;
    clearTimeout(this._waveTO);
    this._waveTO = setTimeout(() => { if (this.h) this.h.wave.textContent = ''; }, 3000);
  }
  bossIntro(a) {
    if (!this.h) return;
    this.bossActor = a;
    const h = this.h;
    h.boss.classList.remove('hidden');
    h.bossName.textContent = a.def.name;
    h.bossTitle.textContent = a.def.title ?? '';
    const marks = h.boss.querySelector('.phase-marks');
    marks.innerHTML = [0.33, 0.66].map((f) => `<i style="left:${f * 100}%"></i>`).join('');
    this.banner(a.def.name, a.def.title ?? '', '#ff7050', 4);
  }

  // ---------------------------------------------------------------- modals
  _modal(html) {
    // a banner fading behind a modal reads as overlapping text
    if (this.h?.banner) { this.h.banner.classList.remove('show'); this.bannerT = 0; }
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = html;
    this.modals.appendChild(m);
    this.modalStack.push(m);
    this.input.unlock();
    return m;
  }
  _closeModal(m, relock = true) {
    m.remove();
    this.modalStack = this.modalStack.filter((x) => x !== m);
    if (!relock) return;
    // A pick often opens the next screen straight away (the gambler's roll ->
    // its tome): relocking here and unlocking there in the same click raced in
    // the browser, and the last relock could be refused, leaving the cursor
    // loose. Relock a beat later, once no screen is open (still inside the
    // click's user activation).
    const want = () => !this.modalOpen && this.game && !this.game.ended && !this.pauseEl;
    setTimeout(() => { if (want()) this.input.lock(want); }, 0);
  }

  _choiceModal(title, sub, items, render, onPick, allowSkip = true, reroll = null) {
    const m = this._modal(`
      <h2>${title}</h2><div class="msub">${sub}</div>
      <div class="choices">${items.map((it, i) => render(it, i)).join('')}</div>
      <div style="display:flex;gap:14px;margin-top:26px">
      ${reroll ? `<button class="btn small" id="bReroll">Reroll (${reroll.left})</button>` : ''}
      ${allowSkip ? '<button class="btn small" id="bSkip">Skip</button>' : ''}</div>`);
    const rr = m.querySelector('#bReroll');
    if (rr) rr.onclick = () => { this._closeModal(m, false); this.audio?.play('tome_open'); reroll.fn(); };
    m.querySelectorAll('[data-i]').forEach((el) => {
      el.onclick = () => { this._closeModal(m); onPick(items[+el.dataset.i]); };
    });
    const skip = m.querySelector('#bSkip');
    if (skip) skip.onclick = () => { this._closeModal(m); onPick(null); };
    const keyH = (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= items.length && m.isConnected) { this._closeModal(m); onPick(items[n - 1]); window.removeEventListener('keydown', keyH); }
      if (!m.isConnected) window.removeEventListener('keydown', keyH);
    };
    window.addEventListener('keydown', keyH);
    return m;
  }

  chooseTome(choices, cb, reroll, opts = {}) {
    const col = this.game ? hex(this.game.player.meta.color) : '#fff';
    this._choiceModal(opts.title ?? 'Arcane Tomes', opts.sub ?? 'Choose one tome to bind to your soul', choices, (c, i) => {
      const r = RARITY[c.rarity];
      // spell augments: tagged with the spell they change, in the class colour
      const ac = c.def.aug ? hex(CLASS_META[c.def.cls]?.color ?? 0xffffff) : null;
      return `<div class="tome card r-${r.id}${ac ? ' augment' : ''}" data-i="${i}" style="--rc:${ac ?? r.color}${ac ? `;--ac:${ac};--ac-dim:${ac}99;--ac-glow:${ac}26` : ''}">
        <div class="rar" style="color:${r.color}">${c.from !== undefined ? `${RARITY[c.from].name} → ` : ''}${r.name}</div>
        ${ac ? `<div class="augtag">Augment · ${esc(c.def.spellName)}</div>` : ''}
        <div class="ticon">${iconSVG(c.def.icon, ac ?? (c.def.el ? hex(ELEMENT_COLORS[c.def.el] ?? 0xffffff) : r.color === '#c8c0b0' ? col : r.color), 54)}</div>
        <div class="tname">${c.def.name}</div>
        <div class="tdesc">${c.def.desc(c.mult)}</div>${c.dr && c.dr < 0.999 ? `<div class="tdesc" style="opacity:0.6;font-size:0.85em">Already held: ${Math.round(c.dr * 100)}% strength</div>` : ''}
        <div class="tkey">[${i + 1}]</div>
      </div>`;
    }, cb, true, reroll);
  }
  chooseRelic(relics, cb) {
    const owned = this.game?.player?.relics ?? [];
    this._choiceModal('Relics', 'Ancient power — claim one', relics, (r, i) => relicCard(r, i, owned), cb);
  }
  chooseBlessing(list, cb, title = 'The Shrine Answers', sub = 'Accept one blessing') {
    this._choiceModal(title, sub, list, (b, i) => `
      <div class="tome card" data-i="${i}" style="--rc:#ffe080">
        <div class="rar" style="color:#ffe080">Blessing</div>
        <div class="ticon">${iconSVG(b.icon, '#ffe080', 54)}</div>
        <div class="tname">${b.name}</div>
        <div class="tdesc">${b.desc}</div>
        <div class="tkey">[${i + 1}]</div>
      </div>`, (b) => { if (b) { b.apply(); cb?.(b); } });
  }
  openShop(items, player, buy) {
    const render = () => items.map((it, i) => {
      const r = it.rarity !== undefined ? RARITY[it.rarity] : null;
      if (it.available && !it.available(player)) return '';
      const c = r ? r.color : it.relic ? it.color ?? '#ffb030' : '#e8d8b0';
      return `<div class="shop-item ${it.sold ? 'sold' : ''} ${player.gold < it.price ? 'cant' : ''}" data-i="${i}" style="--rc:${c}">
        <div class="sicon">${iconSVG(it.icon, c, 34)}</div>
        <div class="sbody"><div class="sname" style="color:${r || it.relic ? c : '#f0e2c4'}">${it.name}</div><div class="sdesc">${it.desc}</div>${it.sold ? '' : shopDiff(it, player)}<div class="price">${it.sold ? 'SOLD' : `${iconSVG('gold', '#f0c050', 14)} ${it.price}`}</div></div>
      </div>`;
    }).join('');
    const m = this._modal(`
      <h2>The Wandering Merchant</h2><div class="msub">"Coin for power, wizard. A fair trade." · You have <span id="shopGold" style="color:var(--gold)">${Math.floor(player.gold)}</span> gold</div>
      <div class="msub" style="font-size:12px;opacity:0.8">Each purchase raises the price of the rest by a quarter: choose.</div>
      <div class="shop-grid">${render()}</div>
      <button class="btn small" id="bLeave" style="margin-top:26px">Leave</button>`);
    const bind = () => {
      m.querySelectorAll('.shop-item').forEach((el) => {
        el.onclick = () => {
          if (buy(items[+el.dataset.i])) {
            if (!m.isConnected) return; // (a refine closes the shop for its own choice)
            m.querySelector('.shop-grid').innerHTML = render();
            m.querySelector('#shopGold').textContent = Math.floor(player.gold);
            bind();
          }
        };
      });
    };
    bind();
    m.querySelector('#bLeave').onclick = () => this._closeModal(m);
  }

  showPause({ onResume, onSettings, onQuit, coop, code }) {
    if (this.pauseEl) return;
    const p = this.game?.player;
    let build = '';
    if (p) {
      const counts = new Map();
      for (const u of p.upgrades) { const k = u.def.id; const e = counts.get(k) ?? { def: u.def, n: 0, best: 0 }; e.n++; e.best = Math.max(e.best, u.rarity); counts.set(k, e); }
      const tomes = [...counts.values()].map((e) => `<span title="${esc(e.def.desc(1))}" style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;color:${RARITY[e.best].color}">${iconSVG(e.def.icon, RARITY[e.best].color, 18, { glow: false })}${esc(e.def.name)}${e.n > 1 ? ' ×' + e.n : ''}</span>`).join('');
      const relics = relicListHTML(p);
      const st = p.stats;
      build = `<div class="panel" style="padding:12px 16px;max-width:620px;font-size:14px;text-align:left;margin-bottom:6px">
        <div class="subtitle" style="margin-bottom:6px">Your build</div>
        <div>${tomes || '<span style="color:var(--text-dim)">No tomes bound yet.</span>'}</div>
        ${relics ? `<div class="relic-pause">${relics}</div>` : ''}
        <div style="margin-top:8px;color:var(--text-dim);font-size:13px">Damage ×${st.dmgMult.toFixed(2)} · Crit ${Math.round(st.critChance * 100)}% (×${st.critMult.toFixed(2)}) · Cooldowns −${Math.round(st.cdr * 100)}% · Armor ${Math.round(st.armor * 100)}% · Speed ${st.moveSpeed.toFixed(1)}</div>
      </div>`;
    }
    const m = this._modal(`
      <div class="panel pause-box">
        <div class="title" style="font-size:34px">Paused</div>
        ${build}
        ${coop ? `<div class="subtitle">The world does not wait in co-op${code ? ` · Code ${code}` : ''}</div>` : ''}
        <button class="btn primary" id="bRes">Resume</button>
        <button class="btn" id="bHelp">How to Play</button>
        <button class="btn" id="bSet">Settings</button>
        <button class="btn" id="bQuit">Abandon Run</button>
      </div>`);
    this.pauseEl = m;
    m.querySelector('#bRes').onclick = () => { this.hidePause(); onResume(); };
    m.querySelector('#bSet').onclick = () => onSettings();
    m.querySelector('#bHelp').onclick = () => this.showHelp();
    m.querySelector('#bQuit').onclick = () => { this.hidePause(); onQuit(); };
  }
  hidePause() {
    if (!this.pauseEl) return;
    const m = this.pauseEl;
    this.pauseEl = null;
    this._closeModal(m);
  }

  closeAllModals() {
    for (const m of this.modalStack) m.remove();
    this.modalStack = [];
    this.pauseEl = null;
  }

  endScreen(won, game) {
    this.closeAllModals();
    const s = game.stats;
    const p = game.player;
    const mins = Math.floor(s.time / 60), secs = Math.floor(s.time % 60);
    const m = this._modal(`
      <div class="panel end-box">
        ${classEmblem(p.classId, hex(p.meta.color), 72)}
        <div class="big" style="color:${won ? '#ffd060' : '#c02020'};text-shadow:0 0 30px ${won ? '#ff9a20' : '#ff0000'}">${won ? 'Victory' : 'Defeat'}</div>
        ${won ? '<div style="color:var(--gold);font-family:var(--serif);letter-spacing:0.1em">A new Ascension level is unlocked</div>' : ''}
        <div class="subtitle">${won ? 'The Hollow King has fallen. The Ashen Keep is free.' : `Fell in ${game.biome.name}`}</div>
        <table>
          <tr><td>Wizard</td><td>${esc(p.name)} the ${p.meta.name}</td></tr>
          ${game.difficulty?.ascension ? `<tr><td>Ascension</td><td>${game.difficulty.ascension}</td></tr>` : ''}
          <tr><td>Realm reached</td><td>${game.floorIndex + 1} / ${BIOMES.length}</td></tr>
          <tr><td>Time</td><td>${mins}m ${secs}s</td></tr>
          <tr><td>Foes slain (party)</td><td>${s.kills}</td></tr>
          <tr><td>Damage dealt</td><td>${Math.round(p.damageDealt)}</td></tr>
          <tr><td>Tomes bound</td><td>${p.upgrades.length}</td></tr>
          <tr><td>Relics</td><td>${p.relics.map((r) => r.def.name).join(', ') || '—'}</td></tr>
        </table>
        <button class="btn primary" id="bMenu">Return to Menu</button>
      </div>`);
    m.querySelector('#bMenu').onclick = () => { this._closeModal(m, false); this.onReturnToMenu?.(); };
  }

  fadeOut(t, cb) {
    this.fadeEl.style.transition = `opacity ${t}s`;
    this.fadeEl.style.opacity = 1;
    setTimeout(cb, t * 1000 + 50);
  }
  fadeIn(t) {
    this.fadeEl.style.transition = `opacity ${t}s`;
    this.fadeEl.style.opacity = 0;
  }

  letterbox(on) {
    if (!this._lb) {
      this._lb = document.createElement('div');
      this._lb.innerHTML = '<i style="position:fixed;left:0;right:0;top:0;height:0;background:#000;transition:height 0.5s;z-index:15"></i><i style="position:fixed;left:0;right:0;bottom:0;height:0;background:#000;transition:height 0.5s;z-index:15"></i>';
      document.body.appendChild(this._lb);
    }
    for (const b of this._lb.children) b.style.height = on ? '11vh' : '0';
    this.hudEl.style.transition = 'opacity 0.4s';
    this.hudEl.style.opacity = on ? 0.15 : 1;
  }

  hideHud() { this.hudEl.classList.add('hidden'); this.h = null; this.game = null; this.ctx.clearRect(0, 0, innerWidth, innerHeight); }
}
