import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel-decorative/400.css';
import '@fontsource/cinzel-decorative/700.css';
import '@fontsource/im-fell-english/400.css';
import '@fontsource/im-fell-english/400-italic.css';
import './ui/styles.css';
import * as THREE from 'three';
import { Renderer } from './render/renderer.js';
import { Input, applyBindings, KEYS } from './core/input.js';
import { UI } from './ui/ui.js';
import { Chat } from './ui/chat.js';
import { BUILD, newerBuild } from './core/version.js';
import { Game } from './game/game.js';
import { Net } from './net/net.js';
import { handleGameMessage } from './net/netgame.js';
import { setModelModules, getAvatar } from './game/models.js';
import { CLASS_IDS, CLASS_META } from './game/classMeta.js';
import { sigilTexture } from './game/models/wizard/sigil.js';
import { TextureFactory, surfaceBakes } from './render/textures.js';
import { warmBakes } from './render/bake.js';
import { installShaderFixes } from './render/shaderFixes.js';
import { attachMeta, loadProfile, resetProfile, difficultyFor, cleanPacts, heatOf, PACT_BY_ID, pactLabel, pactsUnlocked, toggleNightmare, toggleRush, pactStrip, showPactBoard, showCodex, showDailyRite, riteLine, demoSummary, FEATS } from './meta/index.js';

// Optional modules (resolved at build time; missing files are simply skipped)
const optional = import.meta.glob(['./audio/audio.js', './game/enemyModels.js', './game/wizardModels.js']);

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------
const SETTINGS_KEY = 'arcane-ascent-settings';
const defaults = { master: 0.8, music: 0.55, sfx: 0.85, sensitivity: 1, fov: 80, shake: 1, quality: 'high', invertY: false, name: '', lastClass: 'pyromancer', showFps: false, dynamicRes: true, calm: false, keys: {}, contrastTele: false, hudScale: 1 };
let settings = { ...defaults };
let saved = null;
try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); settings = { ...defaults, ...(saved ?? {}) }; } catch { /* ignore */ }
// First visit: start at a quality the GPU can carry. Integrated / mobile GPUs
// begin on Medium, software renderers on Low; dynamic resolution handles the rest.
// stored settings are taken on trust nowhere: a value of the wrong kind falls back to its default and the sliders'
// values to their range (a stray fov of -5 had the world through a 5-degree slit)
for (const k of Object.keys(defaults)) {
  const d = defaults[k], v = settings[k];
  if (typeof v !== typeof d || (typeof d === 'number' && !Number.isFinite(v)) || (k === 'keys' && (!v || Array.isArray(v)))) settings[k] = d;
}
for (const [k, lo, hi] of [['master', 0, 1], ['music', 0, 1], ['sfx', 0, 1], ['sensitivity', 0.2, 3], ['fov', 65, 105], ['shake', 0, 1.5], ['hudScale', 0.75, 1.3]]) settings[k] = Math.min(hi, Math.max(lo, settings[k]));
settings.name = settings.name.slice(0, 16);
if (!['low', 'medium', 'high', 'ultra'].includes(settings.quality)) delete saved?.quality;
if (!saved?.quality) settings.quality = guessQuality();
function guessQuality() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'low';
    if (/intel|uhd|iris|mali|adreno|powervr|videocore/i.test(name) && !/arc/i.test(name)) return 'medium';
    return 'high';
  } catch { return 'high'; }
}
applyBindings(settings.keys); // (rebound keys, see Controls in the settings)
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };
if (!settings.name) settings.name = ['Morvain', 'Elsabeth', 'Corvin', 'Ysolde', 'Thadric', 'Isolde', 'Varian', 'Maelis', 'Orin', 'Seraphine'][Math.floor(Math.random() * 10)];
const q = new URLSearchParams(location.search);
const NORENDER = !!q.get('norender'); // headless logic tests
if (q.get('quality')) settings.quality = q.get('quality');

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new Renderer(canvas, settings.quality);
installShaderFixes(renderer.renderer.getContext());
renderer.baseFov = settings.fov;
renderer.noRender = NORENDER;
const input = new Input(canvas);
input.invertY = settings.invertY;
let audio = null;
const ui = new UI(document.getElementById('ui'), renderer, input, null);
ui.loading(0.05, 'Kindling the torches');
const chat = new Chat(document.getElementById('ui'), input);

let game = null;
let net = null;
let mode = 'menu'; // 'menu' | 'select' | 'run'
let selectedClass = CLASS_IDS.includes(settings.lastClass) ? settings.lastClass : 'pyromancer';
let lobby = null; // { players: [{id,name,classId,ready,host}], api }
let menuAvatar = null;
let dailyRun = null; // the daily rite being played (its wizard is borrowed, not saved as yours)

async function boot() {
  const load = async (k) => (optional[k] ? optional[k]().catch((e) => { console.warn('optional module failed', k, e); return null; }) : null);
  ui.loading(0.15, 'Summoning the denizens');
  const [audioMod, enemyMod, wizardMod] = await Promise.all([load('./audio/audio.js'), load('./game/enemyModels.js'), load('./game/wizardModels.js')]);
  setModelModules({ enemy: enemyMod, wizard: wizardMod });
  if (audioMod?.GameAudio) {
    audio = new audioMod.GameAudio();
    ui.audio = audio;
    applyVolumes();
  }
  ui.loading(0.35, 'Carving the stone');
  game = new Game({ renderer, input, audio, ui, settings });
  game.contrastTele = !!settings.contrastTele;
  window.__game = game;
  // run tracking, feats and the run summary (src/meta)
  attachMeta(game, ui, {
    // a co-op run's end keeps the party together: back to its lobby, not the menu
    onMenu: () => (net ? returnToParty() : ui.onReturnToMenu()),
    menuLabel: () => (net ? 'Back to the Party' : null),
    canAgain: () => !net,
    onAgain: () => { ui.closeAllModals(); if (dailyRun) startDaily(dailyRun); else startSolo(); },
  });
  // compile the procedural-texture bake shaders the menu needs in parallel
  // before the first bake: one at a time they blocked for ~15 s on Windows
  // (see render/bake.js). Creature skins only matter once a run starts.
  await warmBakes(renderer.renderer, [...surfaceBakes(), ...(wizardMod?.wizardBakes?.() ?? [])]);
  // warm up the procedural textures used everywhere
  await frame();
  for (const s of ['dungeonWall', 'flagstone', 'wood', 'iron', 'sewerWall', 'cobble']) { game.texFactory.get(s, s === 'iron' ? 512 : 1024, 1, 'floor'); } // (floor-scoped: a later realm frees what it doesn't use)
  ui.loading(0.7, 'Opening the sewers');
  await frame();
  startBackdrop();
  await renderer.postReady; // (bloom and grade programs, compiled in parallel since the renderer was made)
  ui.warmFonts(); // (while the menu is up)
  ui.loading(1, 'Ready');
  await frame();
  ui.hideLoading();
  warmBakes(renderer.renderer, enemyMod?.creatureBakes?.() ?? [], { lanes: 2 }); // in the background, gently
  const join = q.get('join');
  if (join) doJoin(join);
  else if (q.get('autostart')) { if (CLASS_IDS.includes(q.get('autostart'))) selectedClass = q.get('autostart'); startSolo(); }
  else showMenu();
  if (q.get('screen')) testScreen(q.get('screen'));
  if (q.get('test')) window.__screen = (which, arg) => { ui.closeAllModals(); if (which === 'menu') showMenu(); else testScreen(which, arg); };
  // test hook: pretend the pointer is locked so automated tests can drive input
  if (q.get('test')) { input.locked = true; Object.defineProperty(input, 'locked', { get: () => true, set: () => {} }); window.__input = input; window.__THREE = THREE; import('./game/upgrades.js').then((m) => { window.__upgrades = m; }); // test scripts need math classes and tome rolls (dev and production builds alike)
    // advance the simulation without rendering (fast, deterministic tests)
    window.__sim = (sec, step = 1 / 30, each) => { for (let t = 0; t < sec; t += step) { each?.(t); game.update(step); input.endFrame(); } };
  }
  requestAnimationFrame(loop);
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

function applyVolumes() {
  audio?.setVolumes({ master: settings.master, sfx: settings.sfx, music: settings.music, ambience: settings.music * 0.9 + 0.1 });
  input.invertY = settings.invertY;
  renderer.baseFov = settings.fov;
  renderer.setCalm(settings.calm);
  if (game) game.contrastTele = !!settings.contrastTele;
  document.documentElement.style.setProperty('--hud-scale', String(settings.hudScale ?? 1));
  ui?.layoutBar?.();
}

// first user gesture starts audio
window.addEventListener('pointerdown', () => { audio?.init(); }, { once: false });
window.addEventListener('keydown', () => { audio?.init(); });

// ---------------------------------------------------------------------------
// menu backdrop: a slowly drifting camera through a torch-lit level
// ---------------------------------------------------------------------------
function startBackdrop(floor) {
  // the menu shows off the most atmospheric realms: the moonlit bailey, the keep halls, the throne
  const f = floor ?? [2, 3, 4][Math.floor(Math.random() * 3)];
  game.menuMode = true;
  game.startRun({ seed: Math.floor(Math.random() * 1e9), localId: 'menu', name: 'menu', classId: selectedClass, isHost: true, net: null, floor: f });
  game.menuMode = true;
  game.ui?.hideHud();
  audio?.setMusic('menu');
  const fights = game.level.rooms.filter((r) => r.type === 'combat' || r.type === 'elite');
  const room = fights.sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? game.level.rooms[Math.min(1, game.level.rooms.length - 1)];
  // showcase spot: the start room (small and uncluttered), camera on a clear side
  const sr = game.level.startRoom;
  const free = (x, z) => !game.collision.cellBlocked(Math.floor(x / 2), Math.floor(z / 2), 0.5) && !game.collision.pushOut(x, z, 0.6);
  let show = { x: sr.cx, z: sr.cz, dir: 0 };
  outer: for (const [ox, oz] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [2, 2], [-2, -2]]) {
    for (const dir of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const x = sr.cx + ox, z = sr.cz + oz;
      if (free(x, z) && free(x + Math.sin(dir) * 3.6, z + Math.cos(dir) * 3.6) && free(x + Math.sin(dir) * 1.8, z + Math.cos(dir) * 1.8)) { show = { x, z, dir }; break outer; }
    }
  }
  game.backdrop = { room, t: Math.random() * 100, show };
  placeMenuAvatar();
}

// The class-select wizard is built and its shaders compiled on the driver's
// threads before it is shown. Building it on the click linked a dozen programs
// synchronously (~350 ms each on ANGLE/D3D11): a 2 s freeze on entering the
// screen and on every pick, since disposing the last wizard released programs
// the next one needed again. Now the wizard on show stays until its successor
// is ready (keeping the shared programs alive), and the menu builds the last
// played class's wizard while it idles.
let avatarGen = 0, nextAvatar = null; // { classId, av, ready }
function prepareAvatar(classId) {
  if (nextAvatar?.classId === classId) return nextAvatar;
  nextAvatar?.av.dispose?.();
  const av = getAvatar(classId, game);
  nextAvatar = { classId, av, ready: renderer.compileObject(av.root, game.scene) };
  return nextAvatar;
}
function dropMenuAvatar() {
  if (menuAvatar) { game.scene.remove(menuAvatar.root); menuAvatar.dispose?.(); menuAvatar = null; }
}
function placeMenuAvatar() {
  const gen = ++avatarGen;
  if (mode !== 'select') { dropMenuAvatar(); return; }
  if (menuAvatar?.classId === selectedClass) return;
  const next = prepareAvatar(selectedClass);
  next.ready.then(() => {
    if (gen !== avatarGen || mode !== 'select' || nextAvatar !== next) return; // a later pick won
    nextAvatar = null;
    const pick = !!menuAvatar;
    dropMenuAvatar();
    menuAvatar = next.av;
    menuAvatar.classId = next.classId;
    game.scene.add(menuAvatar.root);
    if (pick && game.backdrop) game.backdrop.flourish = 0; // the pick's flourish, on the new wizard
  });
}

function updateBackdrop(dt) {
  const b = game.backdrop;
  if (!b) return;
  b.t += dt;
  const cam = renderer.camera;
  const r = b.room;
  const gy = game.groundY(r.cx, r.cz);
  if (mode === 'select' && menuAvatar) {
    // showcase the chosen wizard
    const ax = b.show.x, az = b.show.z;
    const ag = game.groundY(ax, az);
    const angle = b.show.dir + Math.sin(b.t * 0.15) * 0.18;
    // a touch low and close: the wizard reads larger and more heroic
    const camPos = new THREE.Vector3(ax + Math.sin(angle) * 3.0, ag + 1.35, az + Math.cos(angle) * 3.0);
    if (!b.snapped) { cam.position.copy(camPos); b.snapped = true; }
    cam.position.lerp(camPos, 1 - Math.exp(-dt * 3));
    // frame the wizard in the gap between the class grid and the detail panel
    const side = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const look = new THREE.Vector3(ax, ag + 1.1, az).addScaledVector(side, -0.12);
    cam.lookAt(look);
    menuAvatar.root.position.set(ax, ag, az);
    menuAvatar.root.rotation.y = angle + Math.sin(b.t * 0.3) * 0.25;
    const fwd = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const cc = CLASS_META[selectedClass].color;
    // picking a class: the wizard casts, its rune circle flaring at its feet
    let anim = Math.floor(b.t / 5) % 3 === 2 ? 'cast' : 'idle', castP = (b.t % 5) / 5;
    if (b.flourish !== undefined) {
      const f0 = b.flourish;
      b.flourish += dt;
      anim = 'cast'; castP = Math.min(1, b.flourish / 1.1);
      if (f0 < 0.38 && b.flourish >= 0.38) {
        const at = new THREE.Vector3(ax, ag, az);
        game.vfx.groundSigil(at, sigilTexture(selectedClass), cc, 1.6, 1.6);
        const c = new THREE.Color(cc);
        game.vfx.burst(at.clone().add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(fwd, 0.5), { count: 28, speed: 3.5, upward: 0.6, life: 0.9, size: 0.06, sprite: 0, color: [c.r * 3, c.g * 3, c.b * 3] });
        game.vfx.flash(at.clone().add(new THREE.Vector3(0, 1.4, 0)).addScaledVector(fwd, 0.8), cc, 26, 8, 0.5);
        const el = CLASS_META[selectedClass].element ?? 'arcane';
        audio?.play(`cast_${el === 'necrotic' ? 'shadow' : el}_big`, { volume: 0.5 });
      }
      if (b.flourish > 1.5) b.flourish = undefined;
    }
    menuAvatar.update(dt, { anim, t: b.t, speed: 0, pitch: 0, castProgress: castP, strafe: 0 });
    game.lights.request(new THREE.Vector3(ax, ag + 2.2, az).addScaledVector(fwd, 2.0).addScaledVector(side, -0.9), 0xffb070, 42, 10);
    game.lights.request(new THREE.Vector3(ax, ag + 1.0, az).addScaledVector(fwd, 1.6).addScaledVector(side, 1.4), 0xc0b0ff, 8, 6);
    game.lights.request(new THREE.Vector3(ax, ag + 1.8, az).addScaledVector(fwd, -1.4).addScaledVector(side, 1.0), CLASS_META[selectedClass].color, 24, 6);
    if (Math.random() < dt * 20) {
      const c = new THREE.Color(CLASS_META[selectedClass].color);
      game.vfx.P.glow({ x: ax + (Math.random() - 0.5) * 3, y: ag + Math.random() * 0.3, z: az + (Math.random() - 0.5) * 3, vy: 0.4 + Math.random() * 0.6, r: c.r * 3, g: c.g * 3, b: c.b * 3, life: 2.5, size: 0.04, sprite: 0 });
    }
  } else {
    const a = b.t * 0.05;
    const rad = Math.min(r.w, r.h) * 0.6;
    cam.position.set(r.cx + Math.cos(a) * rad, gy + 2.2 + Math.sin(b.t * 0.2) * 0.3, r.cz + Math.sin(a) * rad);
    cam.lookAt(r.cx - Math.cos(a) * rad * 0.5, gy + 2, r.cz - Math.sin(a) * rad * 0.5);
  }
  cam.fov = 70;
  cam.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// screens
// ---------------------------------------------------------------------------
function menuStats() { const p = loadProfile(); return { runs: p.runs, wins: p.wins, bestFloor: p.bestFloor, kills: p.kills, feats: `${FEATS.filter((f) => p.feats[f.id]).length}/${FEATS.length}` /* (only feats that still exist) */ }; }

function showMenu() {
  // a new version came out during the run: back at the menu is the moment to load it
  if (pendingBuild && !net) { reloadForUpdate(); return; }
  mode = 'menu';
  placeMenuAvatar();
  // the wizard the class select opens on, built while the menu idles
  setTimeout(() => { if (mode === 'menu') (window.requestIdleCallback ?? setTimeout)(() => { if (mode === 'menu') prepareAvatar(selectedClass); }, { timeout: 2000 }); }, 2500);
  ui.showMenu({
    name: settings.name,
    stats: menuStats(),
    riteLine: riteLine(),
    onDaily: () => { audio?.init(); showDailyRite(ui, { onBegin: (r) => startDaily(r) }); },
    onCodex: () => { audio?.init(); showCodex(ui); },
    onName: (n) => { settings.name = n.slice(0, 16); saveSettings(); },
    onSolo: () => { audio?.init(); showSelect(null); },
    onHost: () => { audio?.init(); doHost(); },
    onJoin: () => { audio?.init(); mode = 'join'; const api = ui.showJoin({ onJoin: (c) => doJoin(c, api), onBack: () => { joinGen++; leaveNet(); showMenu(); } }); },
    onSettings: () => {
      // a new quality takes a reload: once, on Done (it reloaded 150 ms after any change, so the panel shut
      // under you mid-adjustment, and stepping through the list with the arrow keys reloaded every step)
      const q0 = settings.quality;
      ui.showSettings(settings, (s) => { settings = s; saveSettings(); applyVolumes(); },
        () => { if (settings.quality !== q0 && mode !== 'run') location.reload(); });
    },
    onHelp: () => ui.showHelp(),
  });
}

function showSelect(lobbyInfo) {
  mode = 'select';
  placeMenuAvatar();
  const api = ui.showClassSelect({
    selected: selectedClass,
    lobby: lobbyInfo,
    // the host swears the pacts for the whole party
    pacts: (!lobbyInfo || lobbyInfo.isHost) ? { html: (id) => pactStrip(id), bind: (box, id, rerender) => {
      // (a host's change goes straight to the party, so everyone sees what they are in for)
      const changed = () => { rerender(); if (lobbyInfo?.isHost) pushRoster(); };
      const b = box.querySelector('#bPacts'); if (b) b.onclick = () => showPactBoard(ui, { classId: id, onClose: changed });
      const n = box.querySelector('#bNight'); if (n) n.onclick = () => { ui.audio?.play(toggleNightmare() ? 'boss_roar' : 'ui_click', { volume: 0.5 }); changed(); };
      const r = box.querySelector('#bRush'); if (r) r.onclick = () => { ui.audio?.play(toggleRush() ? 'victory_sting' : 'ui_click', { volume: 0.5 }); changed(); };
    } } : null,
    onSelect: (id) => {
      selectedClass = id;
      settings.lastClass = id;
      saveSettings();
      placeMenuAvatar();
      if (game.backdrop) game.backdrop.flourish = 0; // the chosen wizard shows off a cast
      audio?.play('ui_click');
      if (net) {
        if (net.isHost) { const me = lobby.players.find((p) => p.host); me.classId = id; pushRoster(); }
        else net.send({ t: 'cls', cls: id });
      }
    },
    onConfirm: () => {
      if (!net) startSolo();
      else if (net.isHost) hostStart();
      else { net.send({ t: 'ready', r: 1 }); api.setReadyLabel('Waiting for host…'); }
    },
    onBack: () => { leaveNet(); showMenu(); },
  });
  if (lobby) lobby.api = api;
  refreshLobby();
}

// what the host has sworn the party to, in a line for the lobby: "Nightmare · heat 14 · Iron Hides II, Wrath"
function swornLine(pk) {
  pk = cleanPacts(pk);
  const h = heatOf(pk);
  if (!h && !pk.rush) return '';
  const names = Object.keys(pk).filter((id) => id !== 'nightmare' && id !== 'rush').map((id) => pactLabel(id, pk[id]));
  return [pk.rush ? 'Boss Rush' : '', pk.nightmare ? pactLabel('nightmare', pk.nightmare) : '', h ? `heat ${h}` : '', names.join(', ')].filter(Boolean).join(' · ');
}
function refreshLobby() {
  if (!lobby?.api || !net) return;
  const link = `${location.origin}${location.pathname}?join=${net.code}`;
  lobby.api.setLobby({
    code: net.code,
    players: lobby.players,
    isHost: net.isHost,
    canStart: net.isHost,
    link,
    status: net.isHost ? (lobby.players.length < 2 ? 'Share the code — friends join from the main menu or via the invite link.' : `${lobby.players.length} wizards in the party`) : 'Waiting for the host to begin…',
    sworn: swornLine(net.isHost ? currentPacts() : lobby.hostPacts),
  });
}

// ---------------------------------------------------------------------------
// solo
// ---------------------------------------------------------------------------
// (Nightmare is open from the first run; the pacts after the first victory)
function currentPacts() {
  const sel = cleanPacts(loadProfile().pacts);
  // (test hook: &pacts=hides:3,blades:3 swears those pacts for the run)
  if (q.get('test') && q.get('pacts')) Object.assign(sel, cleanPacts(Object.fromEntries(q.get('pacts').split(',').map((x) => x.split(':')).map(([k, v]) => [k, +(v ?? 1)]))));
  if (q.get('test') && (q.has('nightmare') || q.has('damnation') || q.has('rush'))) return { ...sel, ...(q.has('damnation') ? { nightmare: 2 } : q.has('nightmare') ? { nightmare: 1 } : {}), ...(q.has('rush') ? { rush: 1 } : {}) }; // test hooks
  if (pactsUnlocked()) return sel;
  const open = {}; // (Nightmare and Boss Rush are open from the first run)
  if (sel.nightmare) open.nightmare = sel.nightmare;
  if (sel.rush) open.rush = 1;
  return open;
}

function startSolo() {
  dailyRun = null;
  const fixedSeed = +new URLSearchParams(location.search).get('seed'); // test hook: reproducible floors
  beginRun({ seed: fixedSeed || Math.floor(Math.random() * 1e9), localId: 'solo', isHost: true, net: null, players: [], pacts: currentPacts() });
}

// the daily rite: today's seed, wizard and pacts, the same for everyone
function startDaily(r) {
  if (net) return;
  dailyRun = r;
  selectedClass = r.classId;
  beginRun({ seed: r.seed, localId: 'solo', isHost: true, net: null, players: [], pacts: r.pacts, daily: r.key, floor: 0 });
}

function beginRun(opts) {
  mode = 'run';
  ui.closeAllModals(); // (a party member still reading the last run's summary)
  avatarGen++;
  dropMenuAvatar();
  nextAvatar?.av.dispose?.(); nextAvatar = null;
  ui.fadeOut(0.6, () => {
    game.menuMode = false;
    game.backdrop = null;
    game.paused = false;
    game.difficulty = difficultyFor(opts.pacts, { daily: opts.daily ?? null });
    // the Abyss opens past the Hollow King once you have won a run (the host's profile decides for a party)
    game.abyssUnlocked = (!net || net.isHost) && (pactsUnlocked() || q.has('abyss'));
    game.startRun({ ...opts, name: settings.name || 'Wizard', classId: selectedClass, floor: opts.floor ?? (+q.get('floor') || 0), abyss: opts.abyss ?? (+q.get('abyss') || 0) });
    if (opts.late) applyLateState(opts.late);
    if (opts.late && net && !net.isHost) net.send({ t: 'started' });
    ui.fadeIn(1.4);
    input.lock();
  });
}

// After a co-op run ends, the party stays connected and goes back to its lobby
// (the class select), where the host can start the next run.
function returnToParty() {
  if (!net) { ui.onReturnToMenu(); return; }
  ui.closeAllModals();
  game.ended = true;
  startBackdrop();
  if (lobby) for (const p of lobby.players) if (!p.host) p.ready = false;
  showSelect({ isHost: net.isHost, code: net.code });
  if (net.isHost) pushRoster();
  else net.send({ t: 'ready', r: 0 });
}

ui.onReturnToMenu = () => {
  ui.closeAllModals();
  if (dailyRun) { dailyRun = null; selectedClass = CLASS_IDS.includes(settings.lastClass) ? settings.lastClass : 'pyromancer'; }
  leaveNet();
  game.ended = true;
  startBackdrop();
  showMenu();
};

// ---------------------------------------------------------------------------
// co-op
// ---------------------------------------------------------------------------
async function doHost() {
  net = new Net();
  window.__net = net;
  try {
    ui.toast?.('Opening a portal…');
    const code = await net.host();
    lobby = { players: [{ id: 'host', name: settings.name || 'Host', classId: selectedClass, host: true, ready: true }] };
    net.on(onLobbyMessage);
    net.on(onChatMessage);
    chat.setActive(true);
    net.on((msg, from) => { if (mode === 'run' && game && !game.menuMode) handleGameMessage(game, msg, from); });
    net.onPeerLeft = (pid) => {
      lobby.players = lobby.players.filter((p) => p.id !== pid);
      pushRoster();
      if (mode === 'run') game.removeRemote(pid);
    };
    showSelect({ isHost: true, code });
  } catch (e) {
    console.error(e);
    net = null;
    alert('Could not open a co-op session: ' + (e.message ?? e.type ?? e) + '\nYou can still play solo.');
    showMenu();
  }
}

let joinGen = 0;
async function doJoin(code, api) {
  if (!code || code.length < 4) { api?.setStatus('Enter a valid party code.'); return; }
  leaveNet();
  const gen = ++joinGen;
  net = new Net();
  const myNet = net;
  window.__net = net;
  api?.setStatus?.('Connecting…');
  if (!api) { mode = 'join'; ui.showJoin({ onJoin: (c) => doJoin(c), onBack: () => { joinGen++; leaveNet(); showMenu(); }, status: 'Connecting to ' + code + '…' }); }
  try {
    await myNet.join(code);
    if (gen !== joinGen || net !== myNet) { myNet.close(); return; }
    lobby = { players: [] };
    net.on(onLobbyMessage);
    net.on(onChatMessage);
    chat.setActive(true);
    net.on((msg, from) => { if (mode === 'run' && game && !game.menuMode) handleGameMessage(game, msg, from); });
    net.onDisconnect = () => {
      if (net !== myNet) return;
      if (mode === 'run') ui.banner('CONNECTION LOST', 'The host has left the party', '#c04030', 6);
      setTimeout(() => { if (net !== myNet) return; leaveNet(); game.ended = true; startBackdrop(); showMenu(); }, mode === 'run' ? 4000 : 0);
    };
    net.send({ t: 'hello', name: settings.name || 'Wizard', cls: selectedClass, v: BUILD });
    showSelect({ isHost: false, code: net.code });
  } catch (e) {
    console.warn(e);
    if (gen !== joinGen) return;
    const msg = e.message ?? String(e);
    net = null;
    if (mode !== 'menu' && mode !== 'join') return;
    const a2 = ui.showJoin({ onJoin: (c) => doJoin(c, a2), onBack: () => { joinGen++; leaveNet(); showMenu(); }, status: msg });
  }
}

function pushRoster() {
  if (!net?.isHost) return;
  net.broadcast({ t: 'roster', players: lobby.players, pk: currentPacts() });
  refreshLobby();
}

function onLobbyMessage(msg, from) {
  if (net.isHost) {
    if (msg.t === 'hello') {
      // different builds don't agree on messages: everyone plays the same version
      if (BUILD !== 'dev' && msg.v !== 'dev' && msg.v !== BUILD) { net.sendTo(from, { t: 'version', v: BUILD }); return; }
      if (lobby.players.length >= 4) { net.sendTo(from, { t: 'full' }); return; }
      const p = { id: from, name: String(msg.name ?? 'Wizard').slice(0, 16), classId: CLASS_IDS.includes(msg.cls) ? msg.cls : 'pyromancer', ready: false };
      lobby.players = lobby.players.filter((x) => x.id !== from);
      lobby.players.push(p);
      net.sendTo(from, { t: 'welcome', id: from });
      pushRoster();
      audio?.play('ui_click');
      if (mode === 'run' && game && !game.menuMode && !game.ended) {
        // late join: bring them into the current floor; actors follow once they report 'started'
        net.sendTo(from, { t: 'start', seed: game.seed, players: lobby.players, floor: game.floorIndex, ab: game.abyss ?? 0, late: lateState(), pk: game.difficulty?.pacts ?? {} });
        game.addRemote(p);
      }
    } else if (msg.t === 'started') {
      if (mode !== 'run' || !game || game.menuMode) return;
      for (const a of game.actors.list) {
        if (a.dead) continue;
        net.sendTo(from, { t: 'spawn', id: a.id, ty: a.type, x: a.pos.x, z: a.pos.z, yaw: a.yaw, e: a.elite ? 1 : 0, hp: a.maxHp, f: a.faction === 'ally' ? 1 : 0, af: a.affix, af2: a.affix2, fly: a.brain?.data?.fly ? 1 : 0 });
        if (a.boss) net.sendTo(from, { t: 'boss', id: a.id, late: 1 }); // (mid-fight: no entrance for them)
      }
      const act = game.director.active;
      if (act) net.sendTo(from, { t: 'tp', x: act.room.cx, z: act.room.cz });
    } else if (msg.t === 'cls') {
      const p = lobby.players.find((x) => x.id === from);
      if (p && CLASS_IDS.includes(msg.cls)) { p.classId = msg.cls; pushRoster(); }
    } else if (msg.t === 'ready') {
      const p = lobby.players.find((x) => x.id === from);
      if (p) { p.ready = !!msg.r; pushRoster(); }
    }
  } else {
    if (msg.t === 'roster') {
      lobby.players = msg.players;
      lobby.hostPacts = cleanPacts(msg.pk);
      refreshLobby();
      if (mode === 'run') {
        for (const p of msg.players) if (p.id !== net.id) game.addRemote(p);
        const ids = new Set(msg.players.map((p) => p.id));
        for (const id of [...game.remotes.keys()]) if (!ids.has(id)) game.removeRemote(id);
      }
    } else if (msg.t === 'start') {
      lobby.players = msg.players;
      beginRun({ seed: msg.seed, localId: net.id, isHost: false, net, players: msg.players, floor: msg.floor ?? 0, abyss: +msg.ab || 0, late: msg.late, pacts: msg.pk });
    } else if (msg.t === 'full') {
      alert('That party is full (4 wizards max).');
      leaveNet(); showMenu();
    } else if (msg.t === 'version') {
      leaveNet();
      newerBuild().then((v) => {
        if (v) { alert('A new version of the game is out. Updating now - then join the party again.'); reloadForUpdate(); }
        else { alert('The host is playing an older version of the game. Ask them to reload the page, then join again.'); showMenu(); }
      });
    }
  }
}

function hostStart() {
  const seed = Math.floor(Math.random() * 1e9);
  const me = lobby.players.find((p) => p.host);
  me.classId = selectedClass;
  const pk = currentPacts();
  net.broadcast({ t: 'start', seed, players: lobby.players, floor: +q.get('floor') || 0, pk });
  beginRun({ seed, localId: 'host', isHost: true, net, players: lobby.players, pacts: pk });
}

function lateState() {
  return { cleared: game.level.rooms.filter((r) => r.cleared).map((r) => r.id), visited: game.level.rooms.filter((r) => r.visited).map((r) => r.id), active: game.director.active?.room.id ?? -1, broken: game.level.breakables.filter((b) => !b.alive).map((b) => b.i) };
}
function applyLateState(s) {
  for (const id of s.cleared ?? []) game.level.rooms[id].cleared = true;
  for (const id of s.visited ?? []) game.level.rooms[id].visited = true;
  if (s.active >= 0) game.setRoomLocked(s.active, true);
  for (const i of s.broken ?? []) game.breakProp(i, false);
}

// a closing tab says goodbye: its party sees it go at once, not when WebRTC notices (if ever)
addEventListener('pagehide', (e) => { if (!e.persisted) net?.close(); });

function leaveNet() {
  if (net) { net.close(); net = null; }
  lobby = null;
  chat.setActive(false);
}

// ---------------------------------------------------------------------------
// updates: an open game moves onto a new deploy (core/version.js) - at once
// when sitting in the menu, otherwise when the player is next back there
// (never mid-run, never out of a party lobby)
// ---------------------------------------------------------------------------
let pendingBuild = null, updateNoted = false;
function reloadForUpdate() {
  ui.loading(1, 'Updating to the new version…');
  location.reload();
}
async function checkForUpdate() {
  const v = await newerBuild();
  if (!v) return;
  pendingBuild = v;
  if (mode === 'menu' && !net && !ui.modalOpen) { reloadForUpdate(); return; }
  if (!updateNoted) { updateNoted = true; ui.toast('A new version of the game is out: it loads when you return to the menu.', '#8fd0ff'); }
}
setInterval(checkForUpdate, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });

// ---------------------------------------------------------------------------
// party chat (ui/chat.js): Enter to talk, in the lobby and during runs
// ---------------------------------------------------------------------------
const classColor = (id) => (CLASS_META[id] ? '#' + CLASS_META[id].color.toString(16).padStart(6, '0') : undefined);
chat.onSend = (text) => {
  if (!net) return;
  const msg = { t: 'chat', n: settings.name || 'Wizard', x: text, c: selectedClass };
  // a client's line goes through the host, who passes it on to everyone else
  if (net.isHost) net.broadcast(msg); else net.send({ ...msg, relay: 1 });
  chat.add(msg.n, text, { mine: true, from: 'me', color: classColor(selectedClass) });
};
function onChatMessage(msg, from) {
  if (msg.t === 'chat') chat.add(msg.n, msg.x, { from, color: classColor(msg.c) });
}
window.addEventListener('keydown', (e) => {
  if ((e.key !== 'Enter' && e.code !== 'NumpadEnter') || e.repeat || !chat.active || chat.open) return;
  if (e.target?.closest?.('input, textarea') || ui.modalOpen || ui.pauseEl) return;
  if (mode !== 'run' && mode !== 'select') return;
  e.preventDefault();
  chat.show();
});

// ---------------------------------------------------------------------------
// pause handling
// ---------------------------------------------------------------------------
input.onLockChange = (locked) => {
  if (mode !== 'run' || !game || game.ended) return;
  if (!locked && !ui.modalOpen) {
    if (game.isSolo) game.paused = true;
    ui.showPause({
      coop: !game.isSolo,
      code: net?.code,
      onResume: () => { game.paused = false; input.lock(); },
      onSettings: () => ui.showSettings(settings, (s) => { settings = s; saveSettings(); applyVolumes(); }),
      onQuit: () => { game.events.emit('abandon'); game.ended = true; dailyRun = null; leaveNet(); startBackdrop(); showMenu(); },
    });
  } else if (locked) {
    ui.hidePause();
    game.paused = false;
  }
};
// P (pause's other key; Escape is the browser's own: it releases the mouse) lets the mouse go too, which pauses
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.code === 'Escape' || !KEYS.pause.includes(e.code) || e.target?.closest?.('input, textarea, [contenteditable]')) return;
  if (mode === 'run' && game && !game.ended && input.locked) input.unlock();
});
// any click during a run takes the mouse back when nothing is asking for it
// (not just one on the bare canvas: the HUD covers much of it)
window.addEventListener('mousedown', () => {
  if (mode === 'run' && game && !game.ended && !ui.modalOpen && !ui.pauseEl && !input.locked) input.lock();
});

// ---------------------------------------------------------------------------
// main loop
// ---------------------------------------------------------------------------
let last = performance.now();
const perf = { frames: 0, t: 0, warned: false, fps: 60 };
const fpsEl = document.createElement('div');
fpsEl.style.cssText = 'position:fixed;right:8px;top:4px;z-index:60;font:12px monospace;color:#9a8;pointer-events:none;text-shadow:0 1px 2px #000';
document.body.appendChild(fpsEl);
// Dynamic resolution: steps the render scale down while the frame rate stays
// low and creeps back up after a long stretch at full speed. A level that just
// failed is not retried for a while, so it never oscillates.
// Each step down is judged two seconds later: when the frame rate didn't
// rise, the frame is bound by the CPU (a crowded fight), fewer pixels only
// blur the view (and every step reallocates the render targets), so the step
// is undone and the scale left alone for half a minute.
const dyn = { low: 0, high: 0, holdUntil: 0, failedAt: 1.1, judge: null, cpuUntil: 0 };
function adaptResolution(fps) {
  if (settings.dynamicRes === false) renderer.setResScale(1);
  if (settings.dynamicRes === false || NORENDER || mode !== 'run' || !game || game.paused) { dyn.low = dyn.high = 0; dyn.judge = null; return; }
  const now = performance.now() / 1000, k = renderer.resScale;
  if (fps < 48) { dyn.low++; dyn.high = 0; } else if (fps >= 57) { dyn.high++; dyn.low = 0; } else { dyn.low = dyn.high = 0; }
  if (dyn.judge && now >= dyn.judge.at) {
    if (fps < dyn.judge.fps * 1.06) { renderer.setResScale(dyn.judge.k); dyn.failedAt = 1.1; dyn.cpuUntil = now + 30; dyn.low = 0; }
    dyn.judge = null;
    return;
  }
  if (dyn.judge) return;
  if (dyn.low >= 2 && k > 0.5 && now > dyn.cpuUntil) {
    dyn.failedAt = k; dyn.holdUntil = now + 25;
    dyn.judge = { k, fps, at: now + 1.9 };
    renderer.setResScale(k - 0.1);
    dyn.low = 0;
  } else if (dyn.high >= 8 && k < 1) {
    const next = Math.min(1, k + 0.1);
    if (next < dyn.failedAt - 0.01 || now > dyn.holdUntil) renderer.setResScale(next);
    dyn.high = 0;
  }
}

let veil = false;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  perf.frames++; perf.t += dt;
  if (perf.t >= 1) {
    perf.fps = perf.frames / perf.t;
    perf.frames = 0; perf.t = 0;
    fpsEl.textContent = settings.showFps ? `${Math.round(perf.fps)} fps · ${renderer.lastStats?.calls ?? 0} calls${renderer.resScale < 1 ? ` · ${Math.round(renderer.resScale * 100)}% res` : ''}` : '';
    adaptResolution(perf.fps);
    if (mode === 'run' && !perf.warned && perf.fps < 35 && (renderer.resScale <= 0.55 || performance.now() / 1000 < dyn.cpuUntil) && game && game.time > 8 && settings.quality !== 'low' && !NORENDER) {
      perf.warned = true;
      ui.toast(`Running at ${Math.round(perf.fps)} fps — try a lower Graphics quality in Settings (Esc)`, '#ff9040');
    }
  }
  if (dt > 0.05) dt = 0.05;
  // a floor's shaders are still compiling: hold everything behind the veil
  // (rendering now would compile them synchronously, which is the freeze).
  // The menu stays up over its backdrop, which appears once it is ready.
  if (game?.loadingFloor) {
    if (!veil && !game.menuMode) { veil = true; ui.loading(0.85, 'Preparing the realm…'); }
    input.endFrame();
    return;
  }
  if (veil) { veil = false; ui.hideLoading(); }
  if (game) {
    if (game.menuMode) {
      game.time += dt;
      updateBackdrop(dt);
      game.actors.update(dt);
      game.spells.update(dt);
      const cam = renderer.camera;
      for (const f of game.built.flames) {
        const dx = f.x - cam.position.x, dz = f.z - cam.position.z;
        if (dx * dx + dz * dz < 1300 && f.gpu === undefined) game.vfx.flame(f, dt); // (candles burn on the GPU)
      }
      game.selfLight.intensity = 0;
      game.lights.update(dt, game.time, cam.position);
      game.built.update(dt, game.time);
      game.vfx.update(dt, game.time);
      game.particles.update(game.time);
      if (game.viewmodel) game.viewmodel.root.visible = false;
      audio?.setListener(cam.position, new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion));
    } else {
      if (game.viewmodel) game.viewmodel.root.visible = true;
      // tests set __freeze to hold the world still between __sim steps (filmstrips)
      if (!window.__freeze) game.update(dt);
    }
  }
  if (!NORENDER) { game?.built?.cull?.(renderer.camera.position); renderer.render(performance.now() / 1000); }
  input.endFrame();
}

boot().catch((e) => {
  console.error(e);
  ui.loading(1, 'Failed to start: ' + e.message);
});

void TextureFactory;

// test hooks: ?screen=summary&demo=win|loss|coop, codex(&tab=0-3), pacts, daily, select; &profile=demo seeds a lived-in profile
function testScreen(which, arg) {
  if (q.get('profile') === 'demo' && !demoProfile.done) { demoProfile.done = true; demoProfile(); showMenu(); }
  if (which === 'summary') demoSummary(ui, arg ?? q.get('demo') ?? 'win');
  else if (which === 'codex') showCodex(ui, { tab: arg ?? (+q.get('tab') || 0) });
  else if (which === 'pacts') showPactBoard(ui, { classId: selectedClass });
  else if (which === 'daily') showDailyRite(ui, { onBegin: (r) => startDaily(r) });
  else if (which === 'select') showSelect(null);
}
function demoProfile() {
  const ids = CLASS_IDS;
  const classes = Object.fromEntries(ids.slice(0, 9).map((id, i) => [id, { runs: 3 + i, wins: i % 3 === 0 ? 1 + (i % 2) : 0, bestFloor: 1 + (i % 5), fastest: i % 3 === 0 ? 1900 + i * 61 : 0, bestHeat: i % 3 === 0 ? i : -1, kills: 300 + i * 97, bestAbyss: i === 0 ? 2 : 0 }]));
  const feats = Object.fromEntries(FEATS.filter((f, i) => i % 3 !== 2).map((f, i) => [f.id, Date.now() - i * 864e5]));
  resetProfile({ v: 1, runs: 47, wins: 6, deaths: 41, coopWins: 2, kills: 6420, damage: 2310400, time: 61230, gold: 18400, tomes: 412, rooms: 302, flawless: 41, bestFloor: 5,
    records: { biggestHit: 4312, mostDamage: 188200, mostKills: 402, fastestWin: 1904, highestHeat: 9, deepestAbyss: 2 }, classes, feats,
    bestiary: { rat: 1200, slime: 430, slimeling: 610, ghoul: 220, bilespitter: 140, ratShaman: 61, ratOgre: 14, skeleton: 380, skeletonArcher: 210, wraith: 120, jailer: 64, executionerGuard: 6, fallenKnight: 140, hound: 260, gargoyle: 88 },
    bosses: { motherOfFilth: 12, executioner: 9, stoneWyvern: 7, courtArchmage: 6 }, killedBy: { gargoyle: 6, executionerGuard: 3, executioner: 4, skeletonArcher: 2 },
    pacts: { hides: 2, wrath: 1, fate: 1 }, daily: { last: new Date(Date.now() - 864e5).toISOString().slice(0, 10), streak: 4, bestStreak: 6, runs: 11, best: null } });
}
