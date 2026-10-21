import * as THREE from 'three';
import { iconSVG, classEmblem } from './icons.js';
import { CLASS_LIST, SLOTS } from '../game/classes.js';
import { CLASS_META, ELEMENT_COLORS } from '../game/classMeta.js';
import { RARITY } from '../game/upgrades.js';
import { ROOM, T } from '../world/levelgen.js';
import { BIOMES } from '../world/biomes.js';
import { fightsHere } from '../game/director.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const KEYS = { primary: 'LMB', secondary: 'RMB', ability1: 'Q', ability2: 'E', ultimate: 'R' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------------
// DOM UI + a 2D canvas overlay for damage numbers and health bars.
// ---------------------------------------------------------------------------
// cached DOM writes: skip when the value hasn't changed
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
    // hover / click sounds on any button
    root.addEventListener('mouseover', (e) => { if (e.target.closest?.('.btn, .card, .tome, .shop-item')) this.audio?.play('ui_hover', { volume: 0.25 }); });
    root.addEventListener('click', (e) => { if (e.target.closest?.('.btn, .card')) this.audio?.play('ui_click', { volume: 0.4 }); });
  }

  get modalOpen() { return this.modalStack.length > 0; }

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
          return `<div class="ability-row"><div class="key">${KEYS[s]}</div><div class="ic">${iconSVG(sp.icon, hex(c.color), 28)}</div><div class="txt"><b>${sp.name}</b>${sp.cd ? ` <span style="display:inline;color:var(--text-dim);font-size:12px">${sp.cd}s</span>` : ''}<span>${sp.desc}</span></div></div>`;
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
      setLobby: ({ code, players, status, isHost, canStart, link }) => {
        el.querySelector('#lobbyCode').textContent = code ?? '';
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
          <div><span class="k">WASD</span> move</div><div><span class="k">Mouse</span> aim</div>
          <div><span class="k">Left click</span> primary spell (hold)</div><div><span class="k">Right click</span> secondary spell</div>
          <div><span class="k">Q / E</span> abilities</div><div><span class="k">R</span> ultimate (charges as you deal damage)</div>
          <div><span class="k">Shift</span> dash (brief invulnerability)</div><div><span class="k">Space</span> jump — leap over shockwaves</div>
          <div><span class="k">F</span> interact / revive allies</div><div><span class="k">Tab / M</span> map</div>
          <div><span class="k">Esc</span> pause & settings</div><div><span class="k">G</span> ping location</div>
        </div>
        <p><b style="color:var(--bronze-hi)">Elemental reactions:</b> combine schools for bonus effects — <i>Melt</i> (fire on frozen), <i>Shatter</i> (shards, earth or blades on frozen), <i>Overload</i> (lightning on burning), <i>Electrocute</i> (lightning on wet foes in water), <i>Combust</i> (fire on poison), <i>Purge</i> (holy on hexed) and more. In co-op, set up reactions for each other!</p>
        <p><b style="color:var(--bronze-hi)">Co-op:</b> one wizard hosts and shares the party code. Fallen wizards can be revived by holding <b>F</b> beside them. Wizards who bleed out return when the chamber is cleared. Each player picks their own rewards — no loot stealing.</p>
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
        <div class="row">Reduce flashing <input type="checkbox" id="sCalm" ${settings.calm ? 'checked' : ''}></div>
        <div class="row">Graphics quality <select id="sQual"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra (AO)</option></select></div>
        <div class="row">Invert mouse Y <input type="checkbox" id="sInv" ${settings.invertY ? 'checked' : ''}></div>
        <div class="row">Dynamic resolution <input type="checkbox" id="sDyn" ${settings.dynamicRes !== false ? 'checked' : ''}></div>
        <div class="row">Show FPS <input type="checkbox" id="sFps" ${settings.showFps ? 'checked' : ''}></div>
        <div style="color:var(--text-dim);font-size:12px">Quality changes apply on the next page load.</div>
        <button class="btn" id="bClose">Done</button>
      </div>`);
    m.querySelector('#sQual').value = settings.quality;
    const bind = (id, key, num = true) => m.querySelector(id).addEventListener('input', (e) => { settings[key] = e.target.type === 'checkbox' ? e.target.checked : num ? +e.target.value : e.target.value; onChange(settings); });
    bind('#sMaster', 'master'); bind('#sMusic', 'music'); bind('#sSfx', 'sfx'); bind('#sSens', 'sensitivity'); bind('#sFov', 'fov'); bind('#sShake', 'shake'); bind('#sCalm', 'calm');
    bind('#sQual', 'quality', false); bind('#sInv', 'invertY', false); bind('#sFps', 'showFps', false); bind('#sDyn', 'dynamicRes', false);
    m.querySelector('#sQual').addEventListener('change', (e) => { settings.quality = e.target.value; onChange(settings); });
    m.querySelector('#bClose').onclick = () => { this._closeModal(m); onBack?.(); };
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
      <canvas class="minimap"></canvas>
      <div class="boss-bar hidden"><div class="bname"></div><div class="btitle"></div><div class="bar"><div class="lag"></div><div class="fill"></div><div class="phase-marks"></div></div></div>
      <div class="wave-ind"></div>
      <div class="team"></div>
      <div class="hp-wrap">
        <div class="buffs"></div>
        <div class="hp-name"><span>${esc(p.name)}</span><span class="cls">${p.meta.name}</span></div>
        <div class="bar" id="hpBar"><div class="lag"></div><div class="fill"></div><div class="shield"></div><div class="txt"></div></div>
        <div class="dash-pips"></div>
        <div class="resource"></div>
      </div>
      <div class="abilities">${SLOTS.map((s) => `
        <div class="slot ${s === 'ultimate' ? 'ult' : ''}" data-slot="${s}">
          ${s === 'ultimate' ? '<div class="ult-fill"></div>' : ''}
          ${iconSVG(c.spells[s].icon, col, s === 'ultimate' ? 42 : 34)}
          <div class="cd"></div><div class="cdtxt"></div><div class="key">${KEYS[s]}</div><div class="charges"></div>
        </div>`).join('')}
      </div>
      <div class="gold-box">${iconSVG('gold', '#f0c050', 26)}<span id="goldTxt">0</span></div>
      <div class="prompt"></div>
      <div class="toasts"></div>
      <div class="banner"><div class="b1"></div><div class="line"></div><div class="b2"></div></div>
      <div class="click-hint hidden">CLICK TO CONTINUE</div>`;
    const q = (s) => this.hudEl.querySelector(s);
    this.h = {
      hp: q('#hpBar .fill'), hpLag: q('#hpBar .lag'), hpShield: q('#hpBar .shield'), hpTxt: q('#hpBar .txt'),
      dash: q('.dash-pips'), res: q('.resource'), buffs: q('.buffs'),
      slots: Object.fromEntries(SLOTS.map((s) => [s, q(`.slot[data-slot="${s}"]`)])),
      gold: q('#goldTxt'), goldBox: q('.gold-box'), prompt: q('.prompt'), toasts: q('.toasts'), banner: q('.banner'),
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
    this.h.fname.textContent = biome.name;
    this.h.fsub.textContent = `Realm ${index + 1} of ${BIOMES.length} · ${biome.subtitle}`;
    this.banner(biome.name, biome.subtitle, '#e2c48a', 4);
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
      h.buffs.innerHTML = p.buffs.map((b) => `<div class="buff">${iconSVG(b.id === 'stoneskin' ? 'stoneskin' : b.id === 'bloodpact' ? 'pact' : b.id === 'timestop' ? 'hourglass' : 'power', col, 20)}<span class="t">${Math.ceil(b.t)}</span></div>`).join('')
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
      const pv = pctCd.toFixed(1) + '%';
      if (q.cd && q.cd._p !== pv) { q.cd._p = pv; q.cd.style.setProperty('--p', pv); }
      setText(q.cdtxt, String(txt));
    }
    // gold
    setText(h.gold, String(Math.floor(p.gold)));
    // team
    const team = [...game.remotes.values()];
    const tk = team.map((r) => `${r.id}${Math.ceil(r.hp)}${r.downed}${r.dead}${r.maxHp}`).join();
    if (tk !== this._teamKey) {
      this._teamKey = tk;
      h.team.innerHTML = team.map((r) => `
        <div class="tm ${r.downed || r.dead ? 'down' : ''}"><div class="row">${classEmblem(r.classId, hex(r.meta.color), 22)}<span style="flex:1">${esc(r.name)}</span><span>${r.dead ? 'SLAIN' : r.downed ? 'DOWN' : Math.ceil(r.hp)}</span></div>
        <div class="bar small"><div class="fill" style="width:${Math.max(0, r.hp / r.maxHp) * 100}%"></div></div></div>`).join('');
    }
    // boss
    if (this.bossActor) {
      const a = this.bossActor;
      const f = Math.max(0, a.hp / a.maxHp) * 100;
      h.bossFill.style.width = f + '%';
      h.bossLag.style.width = f + '%';
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
    else if (room?.type === ROOM.BOSS && room.cleared) obj = 'Step through the portal to ascend';
    else obj = 'Find the way to the guardian\'s lair';
    if (obj !== this._obj) { this._obj = obj; h.obj.textContent = obj; }
    // banners/toasts timers
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) h.banner.classList.remove('show'); }
    // hitmarker fade
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) h.hit.style.opacity = 0; }
    // damage direction indicators
    for (let i = this.dmgDirs.length - 1; i >= 0; i--) {
      const d = this.dmgDirs[i];
      d.t -= dt;
      const ang = Math.atan2(d.x - p.pos.x, d.z - p.pos.z);
      const rel = ang - (p.yaw + Math.PI);
      d.el.style.transform = `rotate(${-rel}rad)`;
      d.el.style.opacity = Math.max(0, d.t);
      if (d.t <= 0) { d.el.remove(); this.dmgDirs.splice(i, 1); }
    }
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
    if (!big && this._mmT % 3) return;
    const g = this.mm;
    const L = game.level;
    const p = game.player;
    const W = cvs.width, H = cvs.height;
    g.clearRect(0, 0, W, H);
    const scale = big ? Math.min(W / (L.W * T) * 1.9, H / (L.H * T) * 1.9) : 3.2;
    if (this._mmCenterL !== L) { this._mmCenterL = L; this._mmCenter = this._levelCenter(L); }
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
      const icon = r.type === ROOM.BOSS ? '☠' : r.type === ROOM.SHOP ? '⚖' : r.type === ROOM.SHRINE ? '✚' : r.type === ROOM.TREASURE ? '♦' : r.type === ROOM.ELITE ? '★' : r.type === ROOM.TRIAL ? '⧗' : '';
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
    return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  }

  // ---------------------------------------------------------------- 2D overlay
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
        const label = (a.affix ? a.affix[0].toUpperCase() + a.affix.slice(1) + ' ' : '') + a.def.name;
        const b = this._textBitmap(label, '600 11px Cinzel, serif', '#ffb050', { lw: 0 });
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
    // teammate name tags
    for (const r of game.remotes.values()) {
      const s = this._project({ x: r.pos.x, y: r.pos.y + 2.25, z: r.pos.z });
      if (!s) continue;
      this._blitText(g, this._textBitmap(r.name + (r.downed ? ' — DOWNED' : ''), '600 13px Cinzel, serif', r.downed ? '#ff5050' : hex(r.meta.color2 ?? r.meta.color), { stroke: 'rgba(0,0,0,0.7)', lw: 3 }), s.x, s.y - 4);
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(s.x - 24, s.y + 5, 48, 4);
      g.fillStyle = '#d03030'; g.fillRect(s.x - 24, s.y + 5, 48 * Math.max(0, r.hp / r.maxHp), 4);
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
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      f.pos.y += dt * 0.8;
      const s = this._project(f.pos);
      if (f.t > 1.4) { this.floats.splice(i, 1); continue; }
      if (!s) continue;
      g.globalAlpha = f.t > 1 ? 1 - (f.t - 1) / 0.4 : 1;
      const pop = f.t < 0.15 ? 1 + (1 - f.t / 0.15) * 0.8 : 1;
      this._blitText(g, this._textBitmap(f.text, `700 ${f.big ? 22 : 15}px Cinzel, serif`, f.color, { stroke: 'rgba(0,0,0,0.9)', lw: 4, glow: 12 }), s.x, s.y, pop);
      g.globalAlpha = 1;
    }
    // pings
    for (const pg of game.pings ?? []) {
      const s = this._project(pg.pos);
      if (!s) continue;
      g.strokeStyle = pg.color; g.lineWidth = 2;
      g.beginPath(); g.moveTo(s.x, s.y - 14); g.lineTo(s.x + 9, s.y); g.lineTo(s.x, s.y + 14); g.lineTo(s.x - 9, s.y); g.closePath(); g.stroke();
      g.font = '600 12px Cinzel, serif'; g.fillStyle = pg.color; g.textAlign = 'center';
      g.fillText(`${pg.name} · ${Math.round(pg.pos.distanceTo(cam.position))}m`, s.x, s.y - 20);
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
  hitmarker(crit, kill) {
    if (!this.h) return;
    const el = this.h.hit;
    el.classList.toggle('crit', crit);
    el.classList.toggle('kill', kill);
    el.style.opacity = 1;
    el.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${kill ? 1.4 : crit ? 1.2 : 1})`;
    this.hitT = kill ? 0.25 : 0.12;
  }
  healFlash(n) {
    if (this.game) this.game.healPulse = Math.min(1, (this.game.healPulse ?? 0) + n / 40);
  }
  damageDirection(from, p) {
    if (!from || !this.h) return;
    const el = document.createElement('i');
    this.h.dmgDir.appendChild(el);
    this.dmgDirs.push({ el, x: from.x, z: from.z, t: 1 });
  }
  slotDenied(slot) {
    const el = this.h?.slots[slot];
    if (!el) return;
    el.classList.remove('denied');
    void el.offsetWidth;
    el.classList.add('denied');
  }
  goldPulse() {
    const el = this.h?.goldBox;
    if (!el) return;
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  }
  prompt(text, progress) {
    if (!this.h) return;
    const key = text + (progress !== undefined ? Math.round(progress * 30) : '');
    if (key === this._promptKey) return;
    this._promptKey = key;
    this.h.prompt.innerHTML = text ? `${esc(text)}${progress !== undefined ? `<div class="progress"><i style="width:${Math.min(100, progress * 100)}%"></i></div>` : ''}` : '';
  }
  banner(a, b = '', color = '#e2c48a', dur = 3) {
    if (!this.h) return;
    const el = this.h.banner;
    el.querySelector('.b1').textContent = a;
    el.querySelector('.b2').textContent = b;
    el.style.color = color;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.bannerT = dur;
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
    if (relock && !this.modalOpen && this.game && !this.game.ended && !this.pauseEl) this.input.lock();
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

  chooseTome(choices, cb, reroll) {
    const col = this.game ? hex(this.game.player.meta.color) : '#fff';
    this._choiceModal('Arcane Tomes', 'Choose one tome to bind to your soul', choices, (c, i) => {
      const r = RARITY[c.rarity];
      // spell augments: tagged with the spell they change, in the class colour
      const ac = c.def.aug ? hex(CLASS_META[c.def.cls]?.color ?? 0xffffff) : null;
      return `<div class="tome card${ac ? ' augment' : ''}" data-i="${i}" style="--rc:${r.color}${ac ? `;--ac:${ac};--ac-dim:${ac}99;--ac-glow:${ac}26` : ''}">
        <div class="rar" style="color:${r.color}">${r.name}</div>
        ${ac ? `<div class="augtag">Augment · ${esc(c.def.spellName)}</div>` : ''}
        <div class="ticon" style="box-shadow:0 0 30px ${ac ?? r.color}55">${iconSVG(c.def.icon, ac ?? (c.def.el ? hex(ELEMENT_COLORS[c.def.el] ?? 0xffffff) : r.color === '#c8c0b0' ? col : r.color), 54)}</div>
        <div class="tname">${c.def.name}</div>
        <div class="tdesc">${c.def.desc(c.mult)}</div>
        <div class="tkey">[${i + 1}]</div>
      </div>`;
    }, cb, true, reroll);
  }
  chooseRelic(relics, cb) {
    this._choiceModal('Relics', 'A cursed treasure — claim one', relics, (r, i) => `
      <div class="tome card" data-i="${i}" style="--rc:#ffb030">
        <div class="rar" style="color:#ffb030">Relic</div>
        <div class="ticon">${iconSVG(r.def.icon, '#ffb030', 54)}</div>
        <div class="tname">${r.def.name}</div>
        <div class="tdesc">${r.def.desc}</div>
        <div class="tkey">[${i + 1}]</div>
      </div>`, cb);
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
      return `<div class="shop-item ${it.sold ? 'sold' : ''} ${player.gold < it.price ? 'cant' : ''}" data-i="${i}">
        <div>${iconSVG(it.icon, r ? r.color : it.relic ? '#ffb030' : '#e8d8b0', 40)}</div>
        <div><div class="sname" style="color:${r ? r.color : it.relic ? '#ffb030' : 'var(--text)'}">${it.name}</div><div class="sdesc">${it.desc}</div><div class="price">${it.sold ? 'SOLD' : it.price + ' gold'}</div></div>
      </div>`;
    }).join('');
    const m = this._modal(`
      <h2>The Wandering Merchant</h2><div class="msub">"Coin for power, wizard. A fair trade." · You have <span id="shopGold" style="color:var(--gold)">${Math.floor(player.gold)}</span> gold</div>
      <div class="shop-grid">${render()}</div>
      <button class="btn small" id="bLeave" style="margin-top:26px">Leave</button>`);
    const bind = () => {
      m.querySelectorAll('.shop-item').forEach((el) => {
        el.onclick = () => {
          if (buy(items[+el.dataset.i])) {
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
      const relics = p.relics.map((r) => `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;color:#ffb030">${iconSVG(r.def.icon, '#ffb030', 18, { glow: false })}${esc(r.def.name)}</span>`).join('');
      const st = p.stats;
      build = `<div class="panel" style="padding:12px 16px;max-width:620px;font-size:14px;text-align:left;margin-bottom:6px">
        <div class="subtitle" style="margin-bottom:6px">Your build</div>
        <div>${tomes || '<span style="color:var(--text-dim)">No tomes bound yet.</span>'}</div>
        ${relics ? `<div style="margin-top:6px">${relics}</div>` : ''}
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
