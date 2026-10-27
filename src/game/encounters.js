import * as THREE from 'three';
import { ROOM, T } from '../world/levelgen.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getSharedMaterials } from '../world/materials.js';
import { SPR } from '../render/particles.js';
import { getAvatar, getEnemyModel } from './models.js';
import { rollTomes, rollRelics, RARITY } from './upgrades.js';
import { makeChest } from './interactables.js';
import { ENEMY_DEFS } from './enemyDefs.js';
import { RNG, rand } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Encounters: what makes one floor's rooms unlike the last one's.
//
//   room modifiers  some fights are Dark, under a Blood Moon, Haunted, in an
//                   Arcane Surge or a Powder Store: signposted on the door
//                   sigil, visible from the doorway, announced on entry
//   champions       a named elite with two affixes and a health bar holds some
//                   elite chambers, and guards an epic tome and a relic
//   mimics          some treasure chests bite (a subtle tell gives them away)
//   bargains        a Blood Altar (pay in blood or take a curse) and a Gambler
//   secret rooms    a cracked wall with a draught, dust and light leaking
//                   through; a spell breaks it open onto a small hoard
//
// Which rooms get what is decided by the level generator from the floor seed,
// so every peer agrees without a word. Everything that happens after load is
// host-authoritative and goes over the wire as { t: 'enc', k: ... } messages
// (net/netgame.js forwards them to onNet).
// ---------------------------------------------------------------------------

export const MODS = {
  darkness: { name: 'DARKNESS', sub: 'The torches gutter out — your light is all there is', color: '#9aa8ff', glyph: '◐', tint: [0.86, 0.9, 1.08] },
  bloodmoon: { name: 'BLOOD MOON', sub: 'Foes strike harder — and bleed more gold', color: '#ff4a3a', glyph: '◉', tint: [1.28, 0.8, 0.78] },
  haunted: { name: 'HAUNTED', sub: 'The restless dead pass through stone', color: '#8fe8ff', glyph: '☽', tint: [0.88, 1.0, 1.12] },
  surge: { name: 'ARCANE SURGE', sub: 'Wild magic — every cooldown quickens, theirs too', color: '#c890ff', glyph: '✦', tint: [1.06, 0.94, 1.16] },
  powder: { name: 'POWDER STORE', sub: 'One spark and the whole room goes up', color: '#ff9a40', glyph: '✹', tint: null },
};
const AFFIXES = ['hasted', 'vampiric', 'volatile', 'shielded', 'frenzied', 'bombardier'];
const AFFIX_NAME = { hasted: 'Hasted', vampiric: 'Vampiric', volatile: 'Volatile', shielded: 'Shielded', frenzied: 'Frenzied', bombardier: 'Bombardier' };
const TRAITS = {
  warcaller: 'Warcaller', // calls its pack at two-thirds and one-third health
  thunderous: 'Thunderous', // stamps out shockwaves you must jump
  juggernaut: 'Juggernaut', // never staggers or gives ground, and keeps coming
  venomous: 'Venomous', // leaves poison in its wake
};
const CHAMP_NAMES = {
  ratOgre: ['Gorvath the Unbroken', 'Grubmaw the Bloated', 'Old Rotfang'],
  executionerGuard: ['Maudrik the Headtaker', 'Brother Noose', 'Sever the Patient'],
  knightCaptain: ['Ser Aldric the Oathless', 'Dame Ysolde of the Ash', 'The Grey Marshal'],
  archivistLich: ['Vessiline of the Ink', 'Curator Morwen', 'The Unread'],
  default: ['Gorvath the Unbroken'],
};
const SIGILS = { altar: ['♰', '#e03a3a'], gambler: ['⚄', '#e8c050'] };
// what a wager at the gambler's table turns up (common, rare, epic, legendary)
const GAMBLE_ODDS = [40, 32, 20, 8];

// materials for the set pieces live for the whole session: they are compiled by
// the first floor's prewarm that has them in the scene, and never recompile
const CRACK_MAT = new THREE.MeshBasicMaterial({ color: 0x0a0605 });
const LEAK_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.25, 0.5) });
const BLOOD_MAT = new THREE.MeshStandardMaterial({ color: 0x4a0408, roughness: 0.12, metalness: 0.2, emissive: 0x3a0002, emissiveIntensity: 1 });
const RUNE_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.25, 0.2) });
const _v = new THREE.Vector3();
const BLOOD_MOON = new THREE.Color(1, 0.12, 0.08); // a Color: Color.lerp reads r/g/b, a Vector3 gave NaN

export class Encounters {
  constructor(game) {
    this.g = game;
    this.curse = 0;
    this.tint = [1, 1, 1];
    this.hemiK = 1;
    this.selfK = 1;
    // test hook: ?enc=mimic,champion,darkness,... forces encounters onto every eligible room
    try { const f = new URLSearchParams(location.search).get('enc'); this.forced = f ? f.split(',') : null; } catch { this.forced = null; }
  }

  // ================================================================ setup
  // After the floor is built and before the prewarm (so every set piece's
  // materials compile behind the loading veil).
  setLevel(level) {
    const g = this.g;
    this.dispose();
    // the curse outlives floors but not runs (startRun makes a fresh stats object)
    if (this._run !== g.stats) { this._run = g.stats; this.curse = 0; this._draftHint = false; }
    this.level = level;
    this.group = new THREE.Group();
    this.group.name = 'encounters';
    g.scene.add(this.group);
    this.geos = [];
    this.disposers = [];
    this.champs = [];
    this.tint = [1, 1, 1]; this.hemiK = 1; this.selfK = 1;
    this.moonBase = g.moon.color.clone();
    for (const room of level.rooms) {
      if (room.mod) this._setupMod(room);
      if (room.mimicAt) this._setupMimic(room);
      if (room.type === ROOM.ALTAR) this._setupAltar(room);
      if (room.type === ROOM.GAMBLER) this._setupGambler(room);
      if (room.secret) this._setupSecret(room);
    }
  }

  dispose() {
    if (this.group) { this.g.scene.remove(this.group); this.group = null; }
    for (const geo of this.geos ?? []) geo.dispose();
    for (const f of this.disposers ?? []) { try { f(); } catch { /* already gone */ } }
    this.geos = []; this.disposers = [];
  }

  // enemy types this floor may spawn beyond the realm's roster (for the prewarm)
  warmTypes(level) {
    const out = [];
    if (level.rooms.some((r) => r.mimicAt)) out.push('mimic');
    if (level.rooms.some((r) => r.mod === 'haunted')) out.push('specter');
    return out;
  }

  // door sigil for a destination, if the encounter changes it
  sigil(room) {
    if (room.mod) return [MODS[room.mod].glyph, MODS[room.mod].color];
    if (room.champ) return ['♛', '#ff6a40'];
    return SIGILS[room.type] ?? null;
  }

  _mesh(geo, mat, parent = this.group) {
    this.geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  }

  _roomTorches(room) {
    const x0 = room.x * T - 1, z0 = room.y * T - 1, x1 = (room.x + room.w) * T + 1, z1 = (room.y + room.h) * T + 1;
    const ins = (x, z) => x > x0 && x < x1 && z > z0 && z < z1;
    return {
      torches: this.g.lights.torches.filter((t) => ins(t.pos.x, t.pos.z)).map((t) => ({ t, i0: t.intensity, c0: t.color.clone() })),
      flames: this.g.built.flames.filter((f) => ins(f.x, f.z)).map((f) => ({ f, s0: f.size, c0: f.color })),
    };
  }

  // ================================================================ room modifiers
  _setupMod(room) {
    const st = room._mod = { ...this._roomTorches(room), level: 1, on: false };
    if (room.mod === 'bloodmoon') {
      // the torches already burn red: you can see it from the corridor
      for (const e of st.torches) e.t.color.lerp(new THREE.Color(0xff2a14), 0.8);
      for (const e of st.flames) { e.f.color = 0xff3018; if (e.f.gpu !== undefined) this.g.built.candles.sync(e.f.gpu, e.f.gk, e.f.color); }
    }
    if (room.mod === 'darkness') st.level = 0.55;
  }

  _modUpdate(room, dt, inRoom, near) {
    const g = this.g, st = room._mod, P = g.vfx.P, cam = g.renderer.camera.position;
    const active = room._locked && !room.cleared;
    const rx = () => (room.x + 0.5 + Math.random() * (room.w - 1)) * T, rz = () => (room.y + 0.5 + Math.random() * (room.h - 1)) * T;
    if (room.mod === 'darkness') {
      // guttering before the fight, black during it, relit when it's won
      const want = room.cleared ? 1 : active ? 0.025 : 0.5;
      st.level += (want - st.level) * Math.min(1, dt * (want < st.level ? 1.4 : 2.5));
      const gut = st.level < 0.9 ? 0.75 + 0.25 * Math.sin(g.time * 13 + room.id) * Math.sin(g.time * 5.3) : 1;
      for (const e of st.torches) e.t.intensity = e.i0 * st.level * gut;
      for (const e of st.flames) {
        e.f.out = st.level < 0.12; e.f.size = e.s0 * Math.max(0.35, st.level);
        if (e.f.gpu !== undefined) g.built.candles.sync(e.f.gpu, e.f.out ? 0 : e.f.gk * Math.max(0.35, st.level), e.f.color);
      }
      if (inRoom && active) {
        this._hemiWant = Math.min(this._hemiWant, 0.4);
        this._selfWant = Math.max(this._selfWant, 2.4);
      }
    } else if (room.mod === 'bloodmoon') {
      // ash and red motes sifting down; the moon over the bailey turns
      if (near && Math.random() < dt * 10) P.glow({ x: rx(), y: room.ceil > 30 ? 9 : Math.min(room.ceil, 7) - 0.3, z: rz(), vx: rand(-0.2, 0.2), vy: -0.5, vz: rand(-0.2, 0.2), r: 1.6, g: 0.18, b: 0.1, life: 6, size: 0.05, sprite: SPR.EMBER, drag: 0.3 });
      if (inRoom) this._moonWant = 1;
      if (active) for (const a of g.actors.hostiles()) if (Math.random() < dt * 3) P.glow({ x: a.pos.x + rand(-a.radius, a.radius), y: a.pos.y + a.height * rand(0.3, 1), z: a.pos.z + rand(-a.radius, a.radius), vy: rand(0.6, 1.4), r: 2.4, g: 0.1, b: 0.08, life: 0.7, size: 0.07, sprite: SPR.SPARK, drag: 0.5 });
    } else if (room.mod === 'haunted') {
      // pale wisps drift through the room and through its walls
      if (near && Math.random() < dt * (active ? 9 : 4)) {
        const x = rx(), z = rz();
        P.glow({ x, y: rand(0.3, 2.6), z, vx: rand(-0.6, 0.6), vy: rand(-0.05, 0.15), vz: rand(-0.6, 0.6), r: 0.5, g: 1.1, b: 1.5, life: rand(3, 5), size: rand(0.12, 0.3), sprite: SPR.WISP, drag: 0.1, spin: 0.4 });
      }
      if (near && Math.random() < dt * 0.06) g.audio?.play('ghost_wail', { pos: new THREE.Vector3(rx(), 2, rz()), volume: 0.3 });
    } else if (room.mod === 'surge') {
      if (near) for (let n = Math.floor(dt * (active ? 45 : 14) + Math.random()); n > 0; n--) P.glow({ x: rx(), y: rand(0.05, 0.4), z: rz(), vx: rand(-0.25, 0.25), vy: rand(0.6, 1.8), vz: rand(-0.25, 0.25), r: 1.5, g: 0.7, b: 3, r2: 0.4, g2: 0.1, b2: 1.2, life: rand(1.6, 2.8), size: rand(0.1, 0.26), sprite: Math.random() < 0.35 ? SPR.RUNE : SPR.SPARK, drag: 0.2, spin: 1 });
      if (active && Math.random() < dt * 2.5) g.vfx.decal(new THREE.Vector3(rx(), g.groundY(0, 0), rz()), 'glyph', rand(1.6, 2.6), 1.6, 0x7040ff);
      if (active && inRoom) {
        // everyone's spells come back faster while the surge lasts (re-armed, not re-added, each frame)
        const p = g.player, b = p.buffs.find((x) => x.id === 'surge');
        if (!b || b.t < 0.3) p.addBuff('surge', 1, { cdRate: 0.6 });
      }
      if (active && g.isHost) for (const a of g.actors.hostiles()) for (const k in a.cds) a.cds[k] -= dt * 0.5;
    } else if (room.mod === 'powder') {
      // fuses fizz on the kegs
      if (near) for (const b of g.level.breakables) {
        if (!b.alive || b.type !== 'keg' || Math.random() > dt * 0.6) continue;
        if (g.level.roomAt(b.x, b.z) !== room) continue;
        P.glow({ x: b.x + rand(-0.1, 0.1), y: g.groundY(b.x, b.z) + 1.1, z: b.z + rand(-0.1, 0.1), vx: rand(-1, 1), vy: rand(1, 2.5), vz: rand(-1, 1), r: 3, g: 1.6, b: 0.4, life: 0.4, size: 0.04, sprite: SPR.SPARK, gravity: 6, stretch: 0.02 });
      }
    }
    if (inRoom && MODS[room.mod].tint) {
      const k = active ? 1 : room.cleared ? 0 : 0.35;
      for (let i = 0; i < 3; i++) this._tintWant[i] += (MODS[room.mod].tint[i] - 1) * k;
    }
    void cam;
  }

  // host: haunted fights keep spitting specters out of the walls while the waves last
  _haunt(room, dt) {
    const g = this.g, A = g.director.active;
    if (!A || A.room !== room) return;
    room._hauntT = (room._hauntT ?? 1.5) - dt;
    const alive = g.actors.list.filter((a) => a.type === 'specter' && !a.dead).length;
    const max = 4 + this.level.floorIndex;
    if (room._hauntT > 0 || (room._haunted ?? 0) >= max || alive >= 3) return;
    room._hauntT = rand(5, 8);
    room._haunted = (room._haunted ?? 0) + 1;
    // out of a wall, somewhere along the room's edge, nearest a player
    const p = g.allPlayers().find((x) => x.alive && !x.dead) ?? g.player;
    const L = this.level;
    let best = null, bd = 1e9;
    for (let t = 0; t < 16; t++) {
      const side = Math.floor(Math.random() * 4);
      const u = Math.random();
      let x = room.x * T + u * room.w * T, z = room.y * T + u * room.h * T;
      if (side === 0) z = room.y * T - 0.9; else if (side === 1) z = (room.y + room.h) * T + 0.9;
      else if (side === 2) x = room.x * T - 0.9; else x = (room.x + room.w) * T + 0.9;
      if (side < 2) x = room.x * T + 1 + u * (room.w * T - 2); else z = room.y * T + 1 + u * (room.h * T - 2);
      if (L.walkable(Math.floor(x / T), Math.floor(z / T))) continue;
      const d = Math.abs(Math.hypot(p.pos.x - x, p.pos.z - z) - 8);
      if (d < bd) { bd = d; best = { x, z }; }
    }
    if (!best) return;
    const a = g.director.spawnEnemy('specter', best.x, best.z, { spawnFx: false });
    a.state = 'chase'; a.anim = 'idle';
    this._send({ k: 'wail', x: best.x, z: best.z }, true);
  }

  // all peers: a specter seeps out of the stone
  _wailFx(x, z) {
    const g = this.g, c = new THREE.Vector3(x, 1.4, z);
    g.vfx.smoke(c, { count: 6, size: 0.9, color: [0.2, 0.3, 0.36], alpha: 0.35, life: 2, speed: 0.6, rise: 0.4 });
    g.vfx.burst(c, { count: 16, speed: 1.6, life: 1.2, size: 0.18, sprite: SPR.WISP, color: [0.5, 1.1, 1.5], drag: 1, upward: 0.5 });
    g.audio?.play('ghost_wail', { pos: c, volume: 0.7 });
  }

  // ================================================================ room flow hooks
  onLock(room, locked) {
    room._locked = locked;
    if (!locked) return;
    if (room.cursed && room.type !== ROOM.BOSS) this.g.ui?.toast('The altar\'s curse stirs — an elite joins this fight', '#e03a3a');
  }

  // returns true if this room's arrival banner is an encounter's
  lockBanner(room) {
    const ui = this.g.ui;
    if (room.mimicAt) { ui?.banner('MIMIC!', 'The treasure was hungry', '#ffb030'); return true; }
    if (room.champ && room.type === ROOM.ELITE) { ui?.banner('CHAMPION\'S LAIR', 'A named champion holds this chamber', '#ff6a40'); return true; }
    if (room.mod) { const m = MODS[room.mod]; ui?.banner(m.name, m.sub, m.color); this.g.audio?.play('telegraph', { volume: 0.6 }); return true; }
    return false;
  }

  // host, as a fight begins: blood moon sentries get their edge, and the altar's curse adds an elite
  onEncounterStart(room, waves) {
    if (room.mod === 'bloodmoon') for (const id of room.sentryIds ?? []) { const a = this.g.actors.byId.get(id); if (a) a.dmg *= 1.35; }
    if (this.curse <= 0 || (room.type !== ROOM.COMBAT && room.type !== ROOM.ELITE) || !waves.length) return;
    const b = this.level.biome, t = b.elites[Math.floor(Math.random() * b.elites.length)];
    const s = ENEMY_DEFS[t]?.elite ? { type: t, elite: false, role: 'heavy' } : { type: t, elite: true, affix: AFFIXES[Math.floor(Math.random() * AFFIXES.length)], role: 'heavy' };
    // into the last wave (fights always have two or more; the first may be sentries already standing)
    waves[waves.length - 1].push(s);
    this.curse--;
    room.cursed = true;
    this._send({ k: 'cursed', r: room.id, n: this.curse }, true);
  }

  // host: the director spawned an enemy into the active fight
  onSpawned(a) {
    const room = this.g.director.active?.room;
    if (room?.mod === 'bloodmoon' && a.faction === 'enemy') a.dmg *= 1.35;
  }

  goldMult(a) {
    const room = this.g.director.active?.room ?? a.homeRoom;
    return room?.mod === 'bloodmoon' ? 2.5 : 1;
  }

  // all peers, as a room is won: extra rewards. Returns { rarity, gold, banner }
  onRoomCleared(room) {
    const g = this.g;
    if (room.mod) {
      const s = room._mod;
      if (room.mod === 'darkness' && s) { s.level = 0.05; g.audio?.play('cast_fire', { pos: new THREE.Vector3(room.cx, 2, room.cz), volume: 0.6 }); }
      g.player.buffs = g.player.buffs.filter((b) => b.id !== 'surge');
      g.player.recomputeStats();
    }
    if (room.champ && room.type === ROOM.ELITE) {
      const at = this._freeSpot(room.cx, room.cz + 2.8, room);
      this._hoard(at.x, at.z, 0);
      return { rarity: 2, gold: 2, banner: ['CHAMPION SLAIN', 'An epic tome and a relic hoard await', '#ffb060'] };
    }
    if (room.mimicAt) return { rarity: 1, gold: 1.5 };
    if (room.mod === 'darkness' || room.mod === 'haunted') return { rarity: 1, gold: 1 };
    if (room.mod === 'bloodmoon') return { rarity: 0, gold: 2 };
    return null;
  }

  _freeSpot(x, z, room) {
    const col = this.g.collision;
    for (let r = 0; r < 4; r += 0.8) for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (this.level.roomAt(px, pz) === room && !col.pushOut(px, pz, 0.9)) return { x: px, z: pz };
    }
    return { x, z };
  }

  // a relic chest that appears where a champion or mimic kept its hoard
  _hoard(x, z, rot) {
    const g = this.g;
    const chest = makeChest(g, { x, z, rot, big: true });
    g.interactables.push(chest);
    this.disposers.push(() => chest.dispose());
    const c = new THREE.Vector3(x, g.groundY(x, z) + 0.6, z);
    g.vfx.burst(c, { count: 40, speed: 4, upward: 2, life: 1.4, size: 0.1, sprite: SPR.STAR, color: [3, 2.2, 0.6], gravity: 5, drag: 0.6 });
    g.vfx.smoke(c, { count: 6, size: 0.8, color: [0.3, 0.26, 0.2], alpha: 0.4 });
    g.lights.flash(c, 0xffc060, 14, 8, 0.8);
  }

  // host: called when an actor dies
  onKilled(a) {
    const g = this.g;
    if (a.type === 'mimic' && a.homeRoom?.mimicAt) {
      this._send({ k: 'hoard', r: a.homeRoom.id }, true);
      g.spawnDrop('health', a.pos, 25 + this.level.floorIndex * 5);
    }
  }

  // ================================================================ champions
  // host: the director just spawned an elite chamber's champion
  makeChampion(a, room) {
    const rng = new RNG(this.level.seed * 31 + room.id * 7 + this.level.floorIndex);
    const names = CHAMP_NAMES[a.type] ?? CHAMP_NAMES.default;
    const name = names[rng.int(0, names.length - 1)];
    const affix = rng.pick(AFFIXES), trait = rng.pick(Object.keys(TRAITS));
    // (the Exalted pact: a second affix)
    const affix2 = this.g.difficulty?.twinAffix || (this.g.abyss ?? 0) >= 2 ? rng.pick(AFFIXES.filter((k) => k !== affix)) : null;
    a.maxHp *= 1.5; a.hp = a.maxHp;
    this._champion(a, name, affix, trait, affix2);
    this._send({ k: 'champ', id: a.id, n: name, af: affix, af2: affix2, tr: trait, hp: a.maxHp }, false);
  }

  _champion(a, name, affix, trait, affix2 = null) {
    const g = this.g;
    a.affix = affix;
    a.affix2 = affix2;
    a.champion = trait;
    // a named copy of its definition: the health bar and banner read the name from it
    a.def = { ...a.def, name, title: `${AFFIX_NAME[affix]}${affix2 ? ' · ' + AFFIX_NAME[affix2] : ''} · ${TRAITS[trait]}`, poise: trait === 'juggernaut' ? 9999 : a.def.poise };
    if (trait === 'juggernaut') a.speedMult *= 1.15;
    const k = 1.15;
    a.scale *= k; a.radius *= k; a.height *= k;
    a.model?.root.scale.setScalar(a.scale);
    a._champT = { stomp: 4, pool: 0, called: 0 };
    this.champs.push(a);
    g.ui?.bossIntro(a);
    g.audio?.play('boss_roar', { pos: a.pos, volume: 0.7 });
    g.vfx.explosion(new THREE.Vector3(a.pos.x, a.pos.y + 1, a.pos.z), 'enemyFire', 3.5, { groundY: a.pos.y });
    g.vfx.addShake(0.5);
  }

  // host: champion traits
  _champUpdate(a, dt) {
    const g = this.g, c = a._champT;
    if (a.dead || !a.alive) return;
    if (a.champion === 'warcaller') {
      const f = a.hp / a.maxHp;
      if ((c.called === 0 && f < 0.66) || (c.called === 1 && f < 0.33)) {
        c.called++;
        const b = this.level.biome;
        const pool = b.enemies.filter((t) => (ENEMY_DEFS[t]?.cost ?? 9) <= 4);
        for (let i = 0; i < 2 + this.level.floorIndex % 2; i++) {
          const ang = Math.random() * Math.PI * 2, x = a.pos.x + Math.cos(ang) * 3, z = a.pos.z + Math.sin(ang) * 3;
          if (g.collision.cellBlocked(Math.floor(x / T), Math.floor(z / T), a.pos.y)) continue;
          g.director.spawnEnemy(pool[Math.floor(Math.random() * pool.length)] ?? b.enemies[0], x, z);
        }
        this._send({ k: 'rally', id: a.id }, true);
      }
    } else if (a.champion === 'thunderous') {
      c.stomp -= dt;
      const tg = a.target?.pos;
      if (c.stomp <= 0 && a.state === 'chase' && tg && Math.hypot(tg.x - a.pos.x, tg.z - a.pos.z) < 13) {
        c.stomp = rand(5.5, 7.5);
        g.broadcastHazard({ shape: 'wave', x: a.pos.x, y: a.pos.y, z: a.pos.z, r: 1.2, speed: 9, maxR: 12, delay: 0.55, dmg: a.dmg * 0.6, el: 'enemy', kb: 7 });
        this._send({ k: 'stomp', id: a.id }, true);
      }
    } else if (a.champion === 'venomous') {
      c.pool -= dt;
      if (c.pool <= 0 && (a.moveSpeed ?? 0) > 1) {
        c.pool = 1.1;
        g.spawnPool(a.pos, 1.5, 6, 6 * g.director.dmgScale(), 'enemyGreen');
      }
    }
  }

  // ================================================================ mimics
  _setupMimic(room) {
    const g = this.g, at = room.mimicAt;
    // until someone walks in, the mimic is only a model, posed shut (the actor
    // spawns dormant in its place when a player enters, so a sleeping mimic
    // never draws fire or homing spells from the next room over)
    const m = getEnemyModel('mimic', g);
    m.disguised = true;
    m.root.position.set(at.x, g.groundY(at.x, at.z), at.z);
    this.group.add(m.root);
    m.update(0.016, { anim: 'idle', speed: 0 });
    this.disposers.push(() => m.dispose());
    room._mimic = { deco: m, actor: null, sprung: false, near: 0 };
    const it = {
      kind: 'mimic', id: 'mimic' + room.id, room, pos: new THREE.Vector3(at.x, g.groundY(at.x, at.z) + 0.6, at.z), r: 2.8, label: 'Open the Chest', usedBy: new Set(),
      update: (dt) => { it.hidden = room._mimic.sprung; },
    };
    g.interactables.push(it);
  }

  _mimicUpdate(room, dt) {
    const g = this.g, M = room._mimic, at = room.mimicAt;
    // the actor, once there is one (host spawns it; clients learn of it from the spawn message)
    if (!M.actor || M.actor.dead && !g.actors.byId.has(M.actor.id)) M.actor = g.actors.list.find((a) => a.type === 'mimic' && a.homeRoom === room) ?? null;
    const a = M.actor;
    M.deco.root.visible = !a && !M.sprung;
    if (M.deco.root.visible) {
      const cam = g.renderer.camera.position;
      if ((cam.x - at.x) ** 2 + (cam.z - at.z) ** 2 < 900) M.deco.update(dt, { anim: 'idle', speed: 0 });
    }
    if (a?.model && !a.dead) a.model.disguised = !!a.dormant;
    // its one tell besides the breathing lid: no glitter, and now and then a drop of drool
    const sleeping = (!a || a.dormant) && !M.sprung;
    if (sleeping && Math.random() < dt * 0.5) {
      const p = a?.pos ?? at;
      g.vfx.P.solid({ x: p.x + rand(-0.4, 0.4), y: g.groundY(p.x, p.z) + 0.68, z: p.z + 0.42, vy: -0.2, r: 0.35, g: 0.32, b: 0.22, a: 0.8, life: 0.7, size: 0.025, sprite: SPR.DROP, gravity: 9, stretch: 0.02 });
    }
    if (!g.isHost || M.sprung) return;
    const L = this.level;
    if (!a) {
      // spawn the sleeping actor when a player walks in (or looks in from close by)
      const near = g.allPlayers().some((p) => p.alive && !p.dead && (L.roomAt(p.pos.x, p.pos.z) === room || (Math.hypot(p.pos.x - at.x, p.pos.z - at.z) < 10 && g.collision.los(p.pos.x, p.pos.y + 1.4, p.pos.z, at.x, 1, at.z))));
      if (near && !g.director.active) {
        M.actor = g.director.spawnEnemy('mimic', at.x, at.z, { dormant: true, homeRoom: room, spawnFx: false, yaw: 0, noCredit: true });
        M.actor.model.disguised = true;
      }
      return;
    }
    if (a.dead) return;
    // it loses patience with anyone who stands over it too long
    const close = g.allPlayers().some((p) => p.alive && !p.dead && Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z) < 1.9);
    M.near = close ? M.near + dt : 0;
    if (a.dormant && M.near > 2.6) g.actors.wake(a, false);
    if (!a.dormant && !g.director.active) this._spring(room);
  }

  // host: the mimic is awake; lock the vault and fight it
  _spring(room) {
    const g = this.g, M = room._mimic, a = M.actor;
    if (M.sprung || !a) return;
    if (a.dormant) g.actors.wake(a, false);
    M.sprung = true;
    room.cleared = false;
    room.sentriesPlaced = true;
    room.plannedWaves = [[{ type: 'mimic', role: 'heavy' }]];
    room.sentryIds = [a.id];
    g.director.startEncounter(room);
    this._send({ k: 'sprung', r: room.id, id: a.id }, true);
  }

  _sprungFx(room, id) {
    const g = this.g, M = room._mimic;
    M.sprung = true;
    const a = g.actors.byId.get(id) ?? M.actor;
    const p = a?.pos ?? room.mimicAt;
    const c = new THREE.Vector3(p.x, g.groundY(p.x, p.z) + 0.8, p.z);
    g.vfx.burst(c, { count: 30, speed: 6, upward: 2.5, life: 1.2, size: 0.07, sprite: SPR.CHUNK, solid: true, color: [1.0, 0.75, 0.2], color2: [0.6, 0.4, 0.1], gravity: 14, spin: 10 });
    g.vfx.burst(c, { count: 18, speed: 5, upward: 1, life: 1, size: 0.1, sprite: SPR.CHUNK, solid: true, color: [0.34, 0.22, 0.12], gravity: 15, spin: 8 });
    g.vfx.smoke(c, { count: 5, size: 0.7, color: [0.25, 0.2, 0.16], alpha: 0.4 });
    g.lights.flash(c, 0xd6ff4a, 10, 6, 0.4);
    g.vfx.addShake(0.45);
    g.audio?.play('mimic_spring', { pos: c });
  }

  // ================================================================ bargains
  _setupAltar(room) {
    const g = this.g, at = room.setAt, gy = g.groundY(at.x, at.z);
    const m = getSharedMaterials(g.texFactory);
    const root = new THREE.Group();
    root.position.set(at.x, gy, at.z);
    this.group.add(root);
    // a low, heavy block of stained stone with a basin of blood on top and runes cut into its sides
    const base = this._mesh(new THREE.BoxGeometry(1.8, 0.25, 1.2), m.stone, root); base.position.y = 0.125;
    const body = this._mesh(new THREE.BoxGeometry(1.5, 0.75, 0.95), m.stone, root); body.position.y = 0.62;
    const top = this._mesh(new THREE.BoxGeometry(1.75, 0.14, 1.15), m.stone, root); top.position.y = 1.06;
    const basin = this._mesh(new THREE.LatheGeometry([[0.01, 0], [0.42, 0.02], [0.5, 0.12], [0.46, 0.16], [0.4, 0.06], [0.01, 0.05]].map(([r, y]) => new THREE.Vector2(r, y)), 18), m.iron, root); basin.position.y = 1.13;
    const blood = this._mesh(new THREE.CircleGeometry(0.41, 20).rotateX(-Math.PI / 2), BLOOD_MAT, root); blood.position.y = 1.26;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const horn = this._mesh(new THREE.ConeGeometry(0.07, 0.42, 6), m.bone, root);
      horn.position.set(sx * 0.78, 1.32, sz * 0.48); horn.rotation.set(sz * 0.35, 0, -sx * 0.35);
    }
    // runes cut into the front and back: each a few thin glowing strokes
    const R = new RNG(this.level.seed + room.id), strokes = [];
    for (const side of [1, -1]) for (let i = 0; i < 6; i++) {
      const cx = -0.55 + i * 0.22, cy = 0.62 + (i % 2) * 0.06;
      for (let k = 0; k < 3; k++) {
        const st = new THREE.PlaneGeometry(0.014, R.range(0.08, 0.16)).rotateZ(R.range(-0.9, 0.9)).translate(R.range(-0.035, 0.035), R.range(-0.04, 0.04), 0);
        if (side < 0) st.rotateY(Math.PI);
        strokes.push(st.translate(cx * side, cy, 0.478 * side));
      }
    }
    this._mesh(mergeGeometries(strokes), RUNE_MAT, root);
    for (const st of strokes) st.dispose();
    // candles on the corners, their flames drawn by the realm's flame emitters
    for (const [x, z] of [[0.72, 0.42], [-0.72, 0.42], [0.72, -0.42], [-0.72, -0.42]]) {
      const cd = this._mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.22, 8), m.candle, root); cd.position.set(x, 1.24, z);
      g.built.flames.push({ x: at.x + x, y: gy + 1.37, z: at.z + z, size: 0.25, kind: 'candle' });
    }
    g.lights.addTorch(new THREE.Vector3(at.x, gy + 1.9, at.z), { color: 0xff2a1a, intensity: 12, range: 8, flicker: 0.5 });
    const decal = g.vfx.decal(new THREE.Vector3(at.x, gy, at.z), 'glyph', 5, 9999, 0x7a0a08);
    this.disposers.push(() => { decal.visible = false; const e = g.vfx.active.find((x) => x.mesh === decal); if (e) e.t = e.life; });
    g.interactables.push({
      kind: 'altar', id: 'altar' + room.id, pos: new THREE.Vector3(at.x, gy + 1.2, at.z), r: 3, label: 'Kneel at the Blood Altar', usedBy: new Set(),
      update: (dt, t) => {
        // the blood stirs; runes pulse
        const k = 0.75 + Math.sin(t * 2.1) * 0.25;
        RUNE_MAT.color.setRGB(1.5 * k, 0.12 * k, 0.08 * k);
        if (Math.random() < dt * 3) g.vfx.P.glow({ x: at.x + rand(-0.3, 0.3), y: gy + 1.3, z: at.z + rand(-0.3, 0.3), vy: rand(0.2, 0.6), r: 1.6, g: 0.1, b: 0.08, life: 1.2, size: 0.05, sprite: SPR.BUBBLE });
      },
    });
  }

  _setupGambler(room) {
    const g = this.g, at = room.setAt, gy = g.groundY(at.x, at.z);
    const m = getSharedMaterials(g.texFactory);
    // a hooded figure behind the table, dice and a heap of coin in front of it
    const npc = getAvatar('warlock', g);
    npc.root.position.set(at.x, gy, at.z - 1.15);
    npc.root.rotation.y = 0;
    npc.setTint?.(0x5a3a50, 0.35);
    this.group.add(npc.root);
    this.disposers.push(() => npc.dispose?.());
    const ty = gy + 0.86; // table top (props.js table)
    for (let i = 0; i < 3; i++) { const d = this._mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), m.bone); d.position.set(at.x - 0.25 + i * 0.16, ty + 0.045, at.z + 0.25 + (i % 2) * 0.1); d.rotation.set(i, i * 0.7, 0); }
    for (let i = 0; i < 9; i++) { const c = this._mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10), m.gold); c.position.set(at.x + 0.35 + rand(-0.12, 0.12), ty + 0.01 + (i % 4) * 0.02, at.z + 0.1 + rand(-0.1, 0.1)); }
    // a candle on the table lights the gambler's face from below
    g.lights.addTorch(new THREE.Vector3(at.x + 0.4, gy + 1.3, at.z - 0.2), { color: 0xffc070, intensity: 12, range: 6, flicker: 0.4 });
    const cd = this._mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.2, 8), m.candle); cd.position.set(at.x + 0.4, ty + 0.1, at.z - 0.2);
    g.built.flames.push({ x: at.x + 0.4, y: ty + 0.22, z: at.z - 0.2, size: 0.25, kind: 'candle' });
    g.interactables.push({
      kind: 'gambler', id: 'gambler' + room.id, pos: new THREE.Vector3(at.x, gy + 1.1, at.z), r: 3.2, label: 'Wager with the Gambler', wagers: 0,
      update: (dt, t) => {
        const near = g.renderer.camera.position.distanceToSquared(npc.root.position) < 30 * 30;
        npc.root.visible = near;
        if (near) npc.update(dt, { anim: 'idle', t, speed: 0, pitch: Math.sin(t * 0.4) * 0.15 - 0.1, castProgress: 0, strafe: 0 });
      },
    });
  }

  // F on an encounter interactable (local player)
  interact(it) {
    const g = this.g, p = g.player;
    if (it.kind === 'mimic') {
      if (g.isHost) { const M = it.room._mimic; if (M.actor) this._spring(it.room); else M.wantSpring = true; }
      else g.net?.send({ t: 'enc', k: 'spring', r: it.room.id });
      return;
    }
    if (it.kind === 'altar') {
      g.audio?.play('shrine', { pos: it.pos });
      const f = this.level.floorIndex;
      const done = () => { it.usedBy.add(p.id); g.audio?.play('altar_pact', { pos: it.pos }); g.screenTint([1.5, 0.6, 0.6], 0.8); };
      g.ui?.chooseBlessing([
        { name: 'Offering of Blood', desc: 'Lose 35% of your current health. Choose an Epic tome.', icon: 'drop', apply: () => { p.payHp(p.hp * 0.35); done(); g.ui?.chooseTome(rollTomes(p, 3, 2), (x) => x && g.grantTome(x)); } },
        { name: 'Accept the Curse', desc: 'The next 2 chambers each hold an extra elite. Choose a relic now.', icon: 'skull', apply: () => {
          done();
          if (g.isHost) this._addCurse(2); else g.net?.send({ t: 'enc', k: 'curse', n: 2 });
          const r = rollRelics(p, 3); if (r.length) g.ui?.chooseRelic(r, (x) => x && g.grantRelic(x));
        } },
        { name: 'Blood Money', desc: `Lose 20% of your current health. Gain ${60 + f * 30} gold.`, icon: 'gold', apply: () => { p.payHp(p.hp * 0.2); done(); this._gold(60 + f * 30); } },
      ], null, 'The Blood Altar', 'It answers only to sacrifice');
      return;
    }
    if (it.kind === 'gambler') {
      const f = this.level.floorIndex;
      const w = it.wagers;
      const price = Math.round((35 + f * 15) * Math.pow(1.6, w));
      const pot = Math.floor(p.gold / 2);
      g.ui?.chooseBlessing([
        { name: 'Roll the Bones', desc: `Pay ${price} gold for a tome of random rarity (${GAMBLE_ODDS.map((o, i) => `${RARITY[i].name} ${o}%`).join(' · ')}).`, icon: 'bounce', apply: () => {
          if (p.gold < price) { g.audio?.play('ui_error'); g.ui?.toast('"Come back with more coin."', '#e8c050'); return; }
          p.gold -= price; it.wagers++;
          g.audio?.play('dice_roll', { pos: it.pos });
          const rar = rollOdds(GAMBLE_ODDS);
          const tome = rollTomes(p, 1, rar)[0];
          if (!tome) return;
          g.ui?.toast(`The bones fall: ${RARITY[tome.rarity].name}!`, RARITY[tome.rarity].color);
          g.ui?.chooseTome([tome], (x) => x && g.grantTome(x));
        } },
        { name: 'Double or Nothing', desc: pot >= 10 ? `Stake half your gold (${pot}). Even odds to double it.` : 'Stake half your gold. (You have too little to play.)', icon: 'gold', apply: () => {
          if (pot < 10) { g.audio?.play('ui_error'); return; }
          g.audio?.play('dice_roll', { pos: it.pos });
          if (Math.random() < 0.5) { this._gold(pot); g.ui?.toast(`Doubled! +${pot} gold`, '#ffd060'); } else { p.gold -= pot; g.ui?.toast(`Lost ${pot} gold. The gambler smiles.`, '#a08870'); }
        } },
      ], null, 'The Gambler', `"Care to tempt fate, wizard?"  You carry ${Math.floor(p.gold)} gold`);
    }
  }

  _gold(n) {
    const p = this.g.player;
    p.gold += n; this.g.stats.gold += n;
    this.g.audio?.play('pickup_gold');
    this.g.ui?.goldPulse();
  }

  _addCurse(n) {
    this.curse += n;
    this._send({ k: 'cursed', r: -1, n: this.curse }, false);
    this.g.ui?.toast(`Cursed: ${this.curse === 1 ? 'the next chamber holds' : `the next ${this.curse} chambers hold`} an extra elite`, '#e03a3a');
  }

  // ================================================================ secret rooms
  _setupSecret(room) {
    const g = this.g, s = room.secret, L = this.level, b = L.biome;
    g.collision.setDoorBlocked(s, true);
    const wallMat = g.built.group.getObjectByName('lvl_wall')?.material ?? getSharedMaterials(g.texFactory).stone;
    // the slab: a stretch of wall laid over the passage mouth, shaded like the builder's walls
    const host = L.rooms[s.host];
    const ax = -s.nz, az = s.nx; // along the wall, to the right as you face it
    const gy = L.floorAt(s.x - s.nx * 0.5, s.z - s.nz * 0.5);
    const h = s.h, w = T / 2 + 0.02, top = host.ceil > 30 ? 8 : host.ceil;
    const fx = s.x - s.nx * 0.004, fz = s.z - s.nz * 0.004;
    const damp = { sewers: [0.66, 0.8, 0.64], dungeon: [0.74, 0.72, 0.68], courtyard: [0.72, 0.8, 0.68] }[b.id];
    const shade = (y) => {
      let c = 0.42 + 0.58 * Math.min(1, y / 1.6);
      if (!b.outdoor) c *= 0.72 + 0.28 * Math.min(1, (top - y) / 1.2);
      if (!damp) return [c, c, c];
      const k = 1 - Math.min(1, Math.max(0, (y - 0.2) / 1.3));
      return [c * (1 + (damp[0] - 1) * k), c * (1 + (damp[1] - 1) * k), c * (1 + (damp[2] - 1) * k)];
    };
    const ys = [0, 0.5, 1.6]; if (!b.outdoor && h - 1.2 > 1.8) ys.push(h - 1.2); ys.push(h);
    const pos = [], nrm = [], uv = [], col = [], idx = [];
    const lat0 = (fx * ax + fz * az);
    for (const y of ys) for (const sd of [-1, 1]) {
      pos.push(fx + ax * w * sd, gy + y, fz + az * w * sd);
      nrm.push(-s.nx, 0, -s.nz);
      uv.push((lat0 + w * sd) * 0.5, (gy + y) * 0.5);
      col.push(...shade(y));
    }
    for (let r = 0; r < ys.length - 1; r++) { const a = r * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const wall = new THREE.Group();
    this.group.add(wall);
    this._mesh(geo, wallMat, wall);
    // cracks: a jagged web from a point at chest height; the widest seams glow with the brazier behind
    const R = new RNG(L.seed * 17 + room.id);
    const cracks = [], leaks = [];
    const seg = (list, a, b2, wd, off) => {
      const dx = b2[0] - a[0], dy = b2[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * wd / 2, ny = dx / l * wd / 2;
      const P = (u, v) => [fx + ax * u - s.nx * off, gy + v, fz + az * u - s.nz * off];
      list.push([P(a[0] + nx, a[1] + ny), P(a[0] - nx, a[1] - ny), P(b2[0] - nx, b2[1] - ny), P(b2[0] + nx, b2[1] + ny)]);
    };
    const c0 = [R.range(-0.25, 0.25), R.range(1.0, 1.5)];
    for (let k = 0; k < 6; k++) {
      let p = c0, ang = (k / 6) * Math.PI * 2 + R.range(-0.3, 0.3), wd = 0.07;
      const glow = k % 2 === 0;
      for (let i = 0; i < 6; i++) {
        ang += R.range(-0.6, 0.6);
        const q = [p[0] + Math.cos(ang) * R.range(0.18, 0.32), p[1] + Math.sin(ang) * R.range(0.18, 0.32)];
        if (Math.abs(q[0]) > w - 0.05 || q[1] < 0.05 || q[1] > h - 0.05) break;
        seg(cracks, p, q, wd, 0.008);
        if (glow && i < 4) seg(leaks, p, q, wd * 0.4, 0.014);
        p = q; wd *= 0.8;
      }
    }
    const quads = (list) => {
      const pp = [], ii = [];
      for (const q of list) { const o = pp.length / 3; for (const v of q) pp.push(...v); ii.push(o, o + 1, o + 2, o, o + 2, o + 3, o, o + 2, o + 1, o, o + 3, o + 2); }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
      gg.setIndex(ii);
      return gg;
    };
    this._mesh(quads(cracks), CRACK_MAT, wall);
    this._mesh(quads(leaks), LEAK_MAT, wall);
    room._secret = { wall, broken: false, c: new THREE.Vector3(s.x, gy + 1.2, s.z), crack: new THREE.Vector3(fx + ax * c0[0], gy + c0[1], fz + az * c0[0]), snd: null, hinted: false };
  }

  _secretUpdate(room, dt) {
    const g = this.g, S = room._secret;
    if (S.broken) return;
    const cam = g.renderer.camera.position;
    const d = cam.distanceTo(S.c);
    // the light through the cracks flickers with the fire behind, and eases off right at the lens
    const fl = 0.75 + 0.25 * Math.sin(g.time * 9.3) * Math.sin(g.time * 3.1 + 1);
    const k = fl * Math.min(1, Math.max(0.25, (d - 0.6) / 2.2));
    LEAK_MAT.color.setRGB(1.5 * k, 0.82 * k, 0.32 * k);
    if (d > 22) { if (S.snd) { S.snd.stop(0.8); S.snd = null; } return; }
    // a draught whistles through, dust sifts from the cracks and drifts into the room
    if (!S.snd && g.audio?.ctx) S.snd = g.audio.loop('loop_draft', { pos: S.c, volume: 0.55 });
    const s = room.secret, P = g.vfx.P;
    if (Math.random() < dt * 7) P.glow({ x: S.crack.x + rand(-0.4, 0.4), y: S.crack.y + rand(-0.6, 0.6), z: S.crack.z + rand(-0.4, 0.4), vx: -s.nx * rand(0.15, 0.4) + rand(-0.1, 0.1), vy: rand(-0.05, 0.12), vz: -s.nz * rand(0.15, 0.4) + rand(-0.1, 0.1), r: 0.9, g: 0.7, b: 0.45, life: rand(3, 5), size: rand(0.02, 0.035), sprite: SPR.GLOW, drag: 0.4 });
    if (Math.random() < dt * 1.2) P.solid({ x: S.crack.x + rand(-0.5, 0.5), y: S.crack.y + rand(0, 0.5), z: S.crack.z + rand(-0.5, 0.5), vx: -s.nx * 0.1, vy: -0.3, vz: -s.nz * 0.1, r: 0.32, g: 0.29, b: 0.25, a: 0.5, life: 1.2, size: 0.02, sprite: SPR.CHUNK, gravity: 6 });
    // the first one of a run gets spelled out; after that, players know what a draught means
    if (!S.hinted && d < 5 && !this._draftHint) { S.hinted = this._draftHint = true; g.ui?.toast('You feel a draught from the wall…', '#c8b890'); }
  }

  // any peer: did a spell just strike a secret wall?
  wallHit(p) {
    if (p.faction !== 'player' || !p.local) return;
    this.smash(p.pos, Math.max(0.3, p.radius));
  }
  smash(pos, r) {
    for (const room of this.level?.rooms ?? []) {
      const S = room._secret;
      if (!S || S.broken) continue;
      const s = room.secret;
      const dx = pos.x - s.x, dz = pos.z - s.z;
      const lat = Math.abs(dx * -s.nz + dz * s.nx), depth = dx * s.nx + dz * s.nz;
      if (lat < T / 2 + r + 0.3 && depth > -(r + 0.8) && depth < 1 && pos.y < S.c.y + s.h) this.breakWall(room, true);
    }
  }

  breakWall(room, local) {
    const g = this.g, S = room._secret, s = room.secret;
    if (!S || S.broken) return;
    S.broken = true;
    g.collision.setDoorBlocked(s, false);
    S.wall.visible = false;
    S.snd?.stop(0.4); S.snd = null;
    const host = this.level.rooms[s.host];
    if (!host.neighbors.includes(room.id)) host.neighbors.push(room.id);
    room.neighbors.push(host.id);
    const c = S.c;
    const out = new THREE.Vector3(-s.nx, 0.3, -s.nz);
    g.vfx.burst(c, { count: 30, speed: 7, dir: out, spread: 0.9, life: 1.6, size: 0.14, sprite: SPR.CHUNK, solid: true, color: [0.4, 0.37, 0.33], color2: [0.28, 0.26, 0.23], gravity: 15, spin: 9, jitter: 0.8 });
    // and the wall's own blocks tumble out into the room
    g.rubble?.burst(c.x, c.y, c.z, 12, 0.34, 0.22, 0.16, 3.5, 2.5, 0.8, -s.nx * 0.9, -s.nz * 0.9);
    g.rubble?.burst(c.x, c.y + 0.6, c.z, 10, 0.16, 0.12, 0.09, 4.5, 3, 0.9, -s.nx * 0.8, -s.nz * 0.8);
    g.vfx.smoke(c, { count: 12, size: 1.2, color: [0.3, 0.27, 0.23], alpha: 0.5, life: 2.4, spread: 1, speed: 1.2 });
    g.lights.flash(c, 0xffb060, 16, 10, 0.6);
    g.vfx.addShake(0.4);
    g.audio?.play('wall_crumble', { pos: c });
    g.ui?.banner('A SECRET!', 'Something was walled away here', '#ffcf60', 2.5);
    if (local) g.net?.broadcastOrSend({ t: 'enc', k: 'wall', r: room.id });
  }

  // ================================================================ per frame
  update(dt) {
    const g = this.g, L = this.level;
    if (!L || !g.player) return;
    const p = g.player, here = L.roomAt(p.pos.x, p.pos.z);
    this._tintWant = [1, 1, 1]; this._hemiWant = 1; this._selfWant = 1; this._moonWant = 0;
    for (const room of L.rooms) {
      if (room.mod) {
        const near = Math.hypot(p.pos.x - room.cx, p.pos.z - room.cz) < Math.max(room.w, room.h) * T * 0.5 + 16;
        this._modUpdate(room, dt, here === room, near);
        if (room.mod === 'haunted' && g.isHost) this._haunt(room, dt);
      }
      if (room._mimic) { this._mimicUpdate(room, dt); if (room._mimic.wantSpring && room._mimic.actor && g.isHost) { room._mimic.wantSpring = false; this._spring(room); } }
      if (room._secret) this._secretUpdate(room, dt);
    }
    if (g.isHost) for (const a of this.champs) this._champUpdate(a, dt);
    this.champs = this.champs.filter((a) => !a.dead);
    const k = Math.min(1, dt * 2);
    for (let i = 0; i < 3; i++) this.tint[i] += (this._tintWant[i] - this.tint[i]) * k;
    this.hemiK += (this._hemiWant - this.hemiK) * k;
    this.selfK += (this._selfWant - this.selfK) * k;
    g.selfLight.distance = 11 + (this.selfK - 1) * 5;
    if (g.biome.moon) {
      this._moonK = (this._moonK ?? 0) + (this._moonWant - (this._moonK ?? 0)) * k;
      g.moon.color.copy(this.moonBase).lerp(BLOOD_MOON, this._moonK * 0.85);
    }
  }

  // ================================================================ net
  // host -> clients, and (local) run it here too
  _send(msg, local) {
    this.g.net?.broadcast({ t: 'enc', ...msg });
    if (local) this.onNet({ t: 'enc', ...msg });
  }

  onNet(msg, from) {
    if (msg.t !== 'enc') return;
    const g = this.g, L = this.level, room = L?.rooms[msg.r];
    switch (msg.k) {
      case 'spring': if (g.isHost && room?._mimic) { if (room._mimic.actor) this._spring(room); else room._mimic.wantSpring = true; } break;
      case 'sprung': if (room?._mimic) this._sprungFx(room, msg.id); break;
      case 'hoard': if (room?.mimicAt) { const at = this._freeSpot(room.mimicAt.x, room.mimicAt.z - 2.4, room); this._hoard(at.x, at.z, 0); } break;
      case 'champ': { const a = g.actors.byId.get(msg.id); if (a && !g.isHost) { a.maxHp = msg.hp; this._champion(a, msg.n, msg.af, msg.tr, msg.af2 ?? null); } break; }
      case 'rally': { const a = g.actors.byId.get(msg.id); if (a) { g.audio?.play('boss_roar', { pos: a.pos, volume: 0.6 }); g.ui?.floatText(new THREE.Vector3(a.pos.x, a.pos.y + a.height + 0.5, a.pos.z), 'TO ME!', '#ff6a40', true); } break; }
      case 'stomp': { const a = g.actors.byId.get(msg.id); if (a) { g.vfx.ring(a.pos, 2.2, [2.6, 0.5, 0.15], 0.5, 0.15); g.audio?.play('boss_slam', { pos: a.pos, volume: 0.7 }); g.vfx.addShake(0.2); } break; }
      case 'wail': this._wailFx(msg.x, msg.z); break;
      case 'wall': if (room) this.breakWall(room, false); break;
      case 'curse': if (g.isHost) this._addCurse(msg.n ?? 2); break;
      case 'cursed': if (!g.isHost) { this.curse = msg.n; if (room) room.cursed = true; else g.ui?.toast(`Cursed: ${this.curse === 1 ? 'the next chamber holds' : `the next ${this.curse} chambers hold`} an extra elite`, '#e03a3a'); } break;
      default: break;
    }
    void from;
  }
}

function rollOdds(w) {
  let t = 0; for (const x of w) t += x;
  let r = Math.random() * t;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return 0;
}
