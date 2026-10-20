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
import { Input } from './core/input.js';
import { UI } from './ui/ui.js';
import { Game } from './game/game.js';
import { Net } from './net/net.js';
import { handleGameMessage } from './net/netgame.js';
import { setModelModules, getAvatar } from './game/models.js';
import { CLASS_IDS, CLASS_META } from './game/classMeta.js';
import { TextureFactory } from './render/textures.js';

// Optional modules (resolved at build time; missing files are simply skipped)
const optional = import.meta.glob(['./audio/audio.js', './game/enemyModels.js', './game/wizardModels.js']);

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------
const SETTINGS_KEY = 'arcane-ascent-settings';
const defaults = { master: 0.8, music: 0.55, sfx: 0.85, sensitivity: 1, fov: 80, shake: 1, quality: 'high', invertY: false, name: '', lastClass: 'pyromancer', showFps: false };
let settings = { ...defaults };
try { settings = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { /* ignore */ }
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
renderer.baseFov = settings.fov;
const input = new Input(canvas);
input.invertY = settings.invertY;
let audio = null;
const ui = new UI(document.getElementById('ui'), renderer, input, null);
ui.loading(0.05, 'Kindling the torches');

let game = null;
let net = null;
let mode = 'menu'; // 'menu' | 'select' | 'run'
let selectedClass = CLASS_IDS.includes(settings.lastClass) ? settings.lastClass : 'pyromancer';
let lobby = null; // { players: [{id,name,classId,ready,host}], api }
let menuAvatar = null;

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
  window.__game = game;
  // warm up the procedural textures used everywhere
  await frame();
  for (const s of ['dungeonWall', 'flagstone', 'wood', 'iron', 'sewerWall', 'cobble']) { game.texFactory.get(s, s === 'iron' ? 512 : 1024, 1); }
  ui.loading(0.7, 'Opening the sewers');
  await frame();
  startBackdrop();
  ui.loading(1, 'Ready');
  await frame();
  ui.hideLoading();
  const join = q.get('join');
  if (join) doJoin(join);
  else if (q.get('autostart')) { if (CLASS_IDS.includes(q.get('autostart'))) selectedClass = q.get('autostart'); startSolo(); }
  else showMenu();
  // test hook: pretend the pointer is locked so automated tests can drive input
  if (q.get('test')) { input.locked = true; Object.defineProperty(input, 'locked', { get: () => true, set: () => {} }); window.__input = input;
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

function placeMenuAvatar() {
  if (menuAvatar) { game.scene.remove(menuAvatar.root); menuAvatar.dispose?.(); menuAvatar = null; }
  if (mode !== 'select') return;
  menuAvatar = getAvatar(selectedClass, game);
  game.scene.add(menuAvatar.root);
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
    const camPos = new THREE.Vector3(ax + Math.sin(angle) * 3.4, ag + 1.6, az + Math.cos(angle) * 3.4);
    if (!b.snapped) { cam.position.copy(camPos); b.snapped = true; }
    cam.position.lerp(camPos, 1 - Math.exp(-dt * 3));
    // frame the wizard in the gap between the class grid and the detail panel
    const side = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const look = new THREE.Vector3(ax, ag + 1.05, az).addScaledVector(side, -0.12);
    cam.lookAt(look);
    menuAvatar.root.position.set(ax, ag, az);
    menuAvatar.root.rotation.y = angle + Math.sin(b.t * 0.3) * 0.25;
    menuAvatar.update(dt, { anim: Math.floor(b.t / 5) % 3 === 2 ? 'cast' : 'idle', t: b.t, speed: 0, pitch: 0, castProgress: (b.t % 5) / 5, strafe: 0 });
    const fwd = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    game.lights.request(new THREE.Vector3(ax, ag + 2.6, az).addScaledVector(fwd, 1.8).addScaledVector(side, -1.2), 0xffb070, 30, 10);
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
function readStats() { try { return JSON.parse(localStorage.getItem('arcane-ascent-stats') || '{}'); } catch { return {}; } }

function showMenu() {
  mode = 'menu';
  placeMenuAvatar();
  ui.showMenu({
    name: settings.name,
    stats: readStats(),
    onName: (n) => { settings.name = n.slice(0, 16); saveSettings(); },
    onSolo: () => { audio?.init(); showSelect(null); },
    onHost: () => { audio?.init(); doHost(); },
    onJoin: () => { audio?.init(); mode = 'join'; const api = ui.showJoin({ onJoin: (c) => doJoin(c, api), onBack: () => { joinGen++; leaveNet(); showMenu(); } }); },
    onSettings: () => {
      const q0 = settings.quality;
      ui.showSettings(settings, (s) => { settings = s; saveSettings(); applyVolumes(); if (settings.quality !== q0 && mode !== 'run') setTimeout(() => location.reload(), 150); });
    },
    onHelp: () => ui.showHelp(),
  });
}

function showSelect(lobbyInfo) {
  mode = 'select';
  placeMenuAvatar();
  const wins = readStats().wins ?? 0;
  const api = ui.showClassSelect({
    selected: selectedClass,
    lobby: lobbyInfo,
    ascension: (!lobbyInfo || lobbyInfo.isHost) ? { max: Math.min(10, wins), value: Math.min(settings.ascension ?? 0, wins), onChange: (v) => { settings.ascension = v; saveSettings(); } } : null,
    onSelect: (id) => {
      selectedClass = id;
      settings.lastClass = id;
      saveSettings();
      placeMenuAvatar();
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
  });
}

// ---------------------------------------------------------------------------
// solo
// ---------------------------------------------------------------------------
function currentAscension() { return Math.min(settings.ascension ?? 0, readStats().wins ?? 0); }

function startSolo() {
  const fixedSeed = +new URLSearchParams(location.search).get('seed'); // test hook: reproducible floors
  beginRun({ seed: fixedSeed || Math.floor(Math.random() * 1e9), localId: 'solo', isHost: true, net: null, players: [], ascension: currentAscension() });
}

function beginRun(opts) {
  mode = 'run';
  if (menuAvatar) { game.scene.remove(menuAvatar.root); menuAvatar.dispose?.(); menuAvatar = null; }
  ui.fadeOut(0.6, () => {
    game.menuMode = false;
    game.backdrop = null;
    game.paused = false;
    const a = opts.ascension ?? 0;
    game.difficulty = { enemyHp: 1 + 0.2 * a, enemyDamage: 1 + 0.15 * a, playerDamage: 1, ascension: a };
    game.startRun({ ...opts, name: settings.name || 'Wizard', classId: selectedClass, floor: opts.floor ?? (+q.get('floor') || 0) });
    if (opts.late) applyLateState(opts.late);
    if (opts.late && net && !net.isHost) net.send({ t: 'started' });
    ui.fadeIn(1.4);
    input.lock();
  });
}

ui.onReturnToMenu = () => {
  ui.closeAllModals();
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
    net.on((msg, from) => { if (mode === 'run' && game && !game.menuMode) handleGameMessage(game, msg, from); });
    net.onDisconnect = () => {
      if (net !== myNet) return;
      if (mode === 'run') ui.banner('CONNECTION LOST', 'The host has left the party', '#c04030', 6);
      setTimeout(() => { if (net !== myNet) return; leaveNet(); game.ended = true; startBackdrop(); showMenu(); }, mode === 'run' ? 4000 : 0);
    };
    net.send({ t: 'hello', name: settings.name || 'Wizard', cls: selectedClass });
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
  net.broadcast({ t: 'roster', players: lobby.players });
  refreshLobby();
}

function onLobbyMessage(msg, from) {
  if (net.isHost) {
    if (msg.t === 'hello') {
      if (lobby.players.length >= 4) { net.sendTo(from, { t: 'full' }); return; }
      const p = { id: from, name: String(msg.name ?? 'Wizard').slice(0, 16), classId: CLASS_IDS.includes(msg.cls) ? msg.cls : 'pyromancer', ready: false };
      lobby.players = lobby.players.filter((x) => x.id !== from);
      lobby.players.push(p);
      net.sendTo(from, { t: 'welcome', id: from });
      pushRoster();
      audio?.play('ui_click');
      if (mode === 'run' && game && !game.menuMode) {
        // late join: bring them into the current floor; actors follow once they report 'started'
        net.sendTo(from, { t: 'start', seed: game.seed, players: lobby.players, floor: game.floorIndex, late: lateState(), asc: game.difficulty?.ascension ?? 0 });
        game.addRemote(p);
      }
    } else if (msg.t === 'started') {
      if (mode !== 'run' || !game || game.menuMode) return;
      for (const a of game.actors.list) {
        if (a.dead) continue;
        net.sendTo(from, { t: 'spawn', id: a.id, ty: a.type, x: a.pos.x, z: a.pos.z, yaw: a.yaw, e: a.elite ? 1 : 0, hp: a.maxHp, f: a.faction === 'ally' ? 1 : 0, af: a.affix, fly: a.brain?.data?.fly ? 1 : 0 });
        if (a.boss) net.sendTo(from, { t: 'boss', id: a.id });
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
      refreshLobby();
      if (mode === 'run') {
        for (const p of msg.players) if (p.id !== net.id) game.addRemote(p);
        const ids = new Set(msg.players.map((p) => p.id));
        for (const id of [...game.remotes.keys()]) if (!ids.has(id)) game.removeRemote(id);
      }
    } else if (msg.t === 'start') {
      lobby.players = msg.players;
      beginRun({ seed: msg.seed, localId: net.id, isHost: false, net, players: msg.players, floor: msg.floor ?? 0, late: msg.late, ascension: msg.asc ?? 0 });
    } else if (msg.t === 'full') {
      alert('That party is full (4 wizards max).');
      leaveNet(); showMenu();
    }
  }
}

function hostStart() {
  const seed = Math.floor(Math.random() * 1e9);
  const me = lobby.players.find((p) => p.host);
  me.classId = selectedClass;
  const asc = currentAscension();
  net.broadcast({ t: 'start', seed, players: lobby.players, floor: +q.get('floor') || 0, asc });
  beginRun({ seed, localId: 'host', isHost: true, net, players: lobby.players, ascension: asc });
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

function leaveNet() {
  if (net) { net.close(); net = null; }
  lobby = null;
}

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
      onQuit: () => { game.ended = true; leaveNet(); startBackdrop(); showMenu(); },
    });
  } else if (locked) {
    ui.hidePause();
    game.paused = false;
  }
};
canvas.addEventListener('click', () => {
  if (mode === 'run' && game && !game.ended && !ui.modalOpen) input.lock();
});

// ---------------------------------------------------------------------------
// main loop
// ---------------------------------------------------------------------------
let last = performance.now();
const perf = { frames: 0, t: 0, warned: false, fps: 60 };
const fpsEl = document.createElement('div');
fpsEl.style.cssText = 'position:fixed;right:8px;top:4px;z-index:60;font:12px monospace;color:#9a8;pointer-events:none;text-shadow:0 1px 2px #000';
document.body.appendChild(fpsEl);
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  perf.frames++; perf.t += dt;
  if (perf.t >= 1) {
    perf.fps = perf.frames / perf.t;
    perf.frames = 0; perf.t = 0;
    fpsEl.textContent = settings.showFps ? `${Math.round(perf.fps)} fps · ${renderer.lastStats?.calls ?? 0} calls` : '';
    if (mode === 'run' && !perf.warned && perf.fps < 35 && game && game.time > 8 && settings.quality !== 'low' && !NORENDER) {
      perf.warned = true;
      ui.toast(`Running at ${Math.round(perf.fps)} fps — try a lower Graphics quality in Settings (Esc)`, '#ff9040');
    }
  }
  if (dt > 0.05) dt = 0.05;
  if (game) {
    if (game.menuMode) {
      game.time += dt;
      updateBackdrop(dt);
      game.actors.update(dt);
      game.spells.update(dt);
      const cam = renderer.camera;
      for (const f of game.built.flames) {
        const dx = f.x - cam.position.x, dz = f.z - cam.position.z;
        if (dx * dx + dz * dz < 1300) game.vfx.flame(f, dt);
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
      game.update(dt);
    }
  }
  if (!NORENDER) renderer.render(performance.now() / 1000);
  input.endFrame();
}

boot().catch((e) => {
  console.error(e);
  ui.loading(1, 'Failed to start: ' + e.message);
});

void TextureFactory;
