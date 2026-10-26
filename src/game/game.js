import * as THREE from 'three';
import { TextureFactory } from '../render/textures.js';
import { LightPool } from '../render/lights.js';
import { Particles, SPR } from '../render/particles.js';
import { VFX, fxOf } from '../render/vfx.js';
import { ContactShadows } from '../render/contact.js';
import { Storm } from '../render/storm.js';
import { Debris } from '../render/debris.js';
import { Hangers } from '../world/hangers.js';
import { Flotsam } from '../world/flotsam.js';
import { waterRipple } from '../world/materials.js';
import { generateLevel, ROOM, T, K_ALT, K_WATER, WATER_Y } from '../world/levelgen.js';
import { keyOf } from '../core/input.js';
import { PACTS, PACT_BY_ID, difficultyFor, abyssLaws, lawAt } from '../meta/pacts.js';
import { buildLevel } from '../world/builder.js';
import { Collision } from '../world/collision.js';
import { BIOMES } from '../world/biomes.js';
import { themeFor } from '../audio/themes.js';
import { SpellRuntime, soundEl, isWeak } from './spells.js';
import { ActorManager, typeIndex, hasAffix } from './actors.js';
import { Director } from './director.js';
import { Encounters } from './encounters.js';
import { LocalPlayer } from './player.js';
import { RemotePlayer } from './remote.js';
import { resolveHit, ST, REACTIONS } from '../game/combat.js';
import { getViewModel, preloadEnemies, getEnemyModel, getAvatar, setEnemyRim } from './models.js';
import { Critters } from '../world/critters.js';
import { rollTomes, rollRelics, RARITY, TOMES } from './upgrades.js';
import { ITEMS, randomItem, itemK } from './items.js';
import { RelicRuntime } from './relics.js';
import { relicColor, relicDesc } from './relicDefs.js';
import { makeChest, makePedestal, makePortal } from './interactables.js';
import { warmEruptionMeshes } from './caster.js';
import { CLASS_META } from './classMeta.js';
import { sigilTexture } from './models/wizard/sigil.js';
import { ENEMY_DEFS, BOSS_DEFS } from './enemyDefs.js';
import { GATE_LOOK } from './gates.js';
import { SCRIPTS as BOSS_SCRIPTS } from './bosses.js';
import { rand } from '../core/rng.js';
import { clamp } from '../core/math.js';
import { Emitter } from '../meta/emitter.js';

const WADE_C = [0.16, 0.22, 0.22]; // ripple rings on channel water
const _splashV = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Game: owns the world for one run and wires every system together.
// ---------------------------------------------------------------------------

const _v = new THREE.Vector3();
const _aim = new THREE.Vector3(); // (the crosshair probe's hit point)

// what a ping names when it lands on a thing
const PING_NAMES = { pedestal: (it) => (it.relic ? 'Relic' : 'Tome'), chest: 'Chest', mimic: 'Chest', shop: 'Merchant', shrine: 'Shrine', altar: 'Blood Altar', gambler: 'Gambler', portal: 'Portal', victoryPortal: 'Victory', abyssPortal: 'The Abyss' };
// the Abyss's depths: violet, drowned teal, crimson, ashen gold (then round again)
const ABYSS_TINT = [
  { fog: 0x2a1040, gain: [1.0, 0.85, 1.15], sat: 1.0, rim: 0xa070ff },
  { fog: 0x0a3030, gain: [0.8, 1.06, 1.05], sat: 0.95, rim: 0x40e0c0 },
  { fog: 0x3a0808, gain: [1.15, 0.8, 0.8], sat: 0.9, rim: 0xff4040 },
  { fog: 0x2a2618, gain: [1.08, 1.0, 0.74], sat: 0.8, rim: 0xffe0a0 },
];
for (const t of ABYSS_TINT) { const c = new THREE.Color(t.rim); t.rc = [c.r, c.g, c.b]; }
const PLACE_MUSIC = { shop: 'shop', gambler: 'shop', shrine: 'shrine', altar: 'shrine', treasure: 'vault', secret: 'vault' };
const STREAKS = [
  { n: 3, name: 'TRIPLE KILL', gold: 4, ult: 3, color: '#e8d080' },
  { n: 5, name: 'CARNAGE', gold: 8, ult: 5, color: '#ffb040' },
  { n: 8, name: 'MASSACRE', gold: 14, ult: 8, color: '#ff6a30' },
  { n: 12, name: 'ANNIHILATION', gold: 22, ult: 12, color: '#ff3048' },
];
const _nmFog = new THREE.Color(0x2a0606);
const DREAD_MAX = 12;
const _gp = new THREE.Vector3(), _gq = new THREE.Vector3();
// what flies off a struck foe, by what it is made of (its hit sound says): see hitActor
const MAT_HIT = {
  enemy_hit_armor: { count: 5, speed: 7, spread: 0.8, life: 0.3, size: 0.045, sprite: SPR.SPARK, gravity: 9, drag: 3, stretch: 0.03, color: [3.2, 2.4, 1.3], color2: [1.2, 0.4, 0.1], dir: null },
  enemy_hit_bone: { count: 4, speed: 4, spread: 0.9, life: 0.6, size: 0.06, sprite: SPR.CHUNK, gravity: 14, drag: 1, solid: true, spin: 6, color: [0.75, 0.72, 0.62], color2: [0.55, 0.5, 0.42], dir: null },
  slime_squish: { count: 5, speed: 3.5, spread: 0.9, life: 0.6, size: 0.08, sprite: SPR.DROP, gravity: 12, drag: 1, solid: true, stretch: 0.02, color: [0.3, 0.55, 0.1], color2: [0.15, 0.3, 0.05], dir: null },
  enemy_hit: { count: 4, speed: 3.5, spread: 0.7, life: 0.55, size: 0.06, sprite: SPR.DROP, gravity: 14, drag: 1, solid: true, stretch: 0.03, color: [0.32, 0.02, 0.03], color2: [0.18, 0, 0.01], dir: null },
};
MAT_HIT.paper = { count: 4, speed: 3, spread: 1, life: 0.9, size: 0.07, sprite: SPR.FEATHER, gravity: 3, drag: 2, solid: true, spin: 5, color: [0.62, 0.55, 0.4], color2: [0.45, 0.38, 0.26], dir: null };
MAT_HIT.ember = { count: 5, speed: 5, spread: 0.9, life: 0.5, size: 0.04, sprite: SPR.EMBER, gravity: -1, drag: 2, color: [3, 1.2, 0.3], color2: [0.8, 0.15, 0], dir: null };
// (by type, where the hit sound doesn't say: spirits shed nothing, a book its pages, an imp embers)
const MAT_OF = { wraith: null, specter: null, spiritWolf: null, slimeling: 'slime_squish', motherOfFilth: 'slime_squish', skeletonMinion: 'enemy_hit_bone', archivistLich: 'enemy_hit_bone', grimoire: 'paper', imp: 'ember', mimic: 'paper' };
const _mdir = new THREE.Vector3();
export class Game {
  constructor({ renderer, input, audio, ui, settings }) {
    this.renderer = renderer;
    this.scene = renderer.scene;
    this.input = input;
    this.audio = audio;
    this.ui = ui;
    this.settings = settings;
    this.texFactory = new TextureFactory(renderer.renderer);
    const q = settings.quality ?? 'high';
    this.lights = new LightPool(this.scene, q === 'low' ? { torchCount: 5, fxCount: 4 } : q === 'medium' ? { torchCount: 7, fxCount: 5 } : q === 'high' ? { torchCount: 9, fxCount: 6 } : { torchCount: 12, fxCount: 8 });
    this.lights.settings = settings; // "Reduce flashing" softens flashes
    this.particles = new Particles(this.scene);
    this.vfx = new VFX(this.scene, renderer.camera, this.particles, this.lights);
    this.vfx.floorAt = (x, z) => this.groundY(x, z);
    this.vfx.waterY = WATER_Y; // (danger zones over water lie on its surface)
    this.contact = new ContactShadows(this.scene);
    this.spells = new SpellRuntime(this);
    this.actors = new ActorManager(this);
    this.director = new Director(this);
    this.encounters = new Encounters(this);
    this.relics = new RelicRuntime(this);
    this.time = 0;
    this.storm = null;
    this._hzBusy = false; // (inside the hazard loop: see cancelHazardsFrom)
    this.debris = null; // (wreckage of smashed barrels and crates: render/debris.js)
    this.rubble = null; // (and the same in stone: a broken wall's blocks)
    this.hangers = null; // (the Oubliette's swinging cages and chains: world/hangers.js)
    this.flotsam = null; // (wood riding the Sewers' channels: world/flotsam.js)
    this._courtK = 0; // (the Hollow Throne's dead court fading out while a fight is on: 0..1)
    this._gpD = new Float32Array(8); this._gpA = new Array(8).fill(null); // (_grassPush's nearest foes)
    this._bolt = { a: new THREE.Vector3(), b: new THREE.Vector3(), o: { jag: 7, width: 0.55, life: 0.22, branches: 3, seg: 3.5, color: [2.2, 2.5, 3.4] } };
    this.remotes = new Map();
    this.hazards = [];
    this.pools = [];
    this.drops = [];
    this.interactables = [];
    this.net = null;
    this.isHost = true;
    this.paused = false;
    this.tint = { rgb: [1, 1, 1], t: 0 };
    this.stats = { kills: 0, damage: 0, time: 0, gold: 0 };
    this.dropId = 1;
    this.hemi = new THREE.HemisphereLight(0x303040, 0x080606, 1);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x9fb4ff, 0);
    this.moon.position.set(30, 60, -80);
    this.moon.shadow.mapSize.set(2048, 2048);
    const sc = this.moon.shadow.camera;
    sc.left = -36; sc.right = 36; sc.top = 36; sc.bottom = -36; sc.near = 1; sc.far = 220;
    this.moon.shadow.bias = -0.0008;
    this.moon.shadow.normalBias = 0.04;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);
    // the wizard's own glow so you can see in the dark
    this.selfLight = new THREE.PointLight(0xffffff, 0, 11, 1.6);
    this.scene.add(this.selfLight);
    // view-model scene lighting
    this.viewHemi = new THREE.HemisphereLight(0x606880, 0x202020, 1.2);
    renderer.viewScene.add(this.viewHemi);
    this.viewLights = [new THREE.PointLight(0xffa050, 0, 6, 1.5), new THREE.PointLight(0xffa050, 0, 6, 1.5)];
    for (const l of this.viewLights) renderer.viewScene.add(l);
    this.difficulty = { enemyHp: 1, enemyDamage: 1, playerDamage: 1 };
    this.hitSoundT = 0;
    // what happened, for whoever listens (run tracking, feats, the run summary: src/meta)
    this.events = new Emitter();
    this._aimT = 0; // (the crosshair's weak-point probe: next run)
    this._learned = null; this._dashN = 0; // (once-ever tips: learn())
    this.events.on('dashJump', () => this.learn('dashjump'));
    this.events.on('perfectDodge', () => { if (this.isHost) this._bossDodge(); else this.net?.send?.({ t: 'pdodge' }); });
    // (Nightmare) a chamber you leave untouched earns a Dread Mark: watch what the local player takes per fight
    this.events.on('roomLock', (room, on) => { if (on) { this._fightRoom = room; this._fightHurt = 0; } });
    this.events.on('hurt', (dmg) => { if (this._fightRoom) this._fightHurt += dmg; });
  }

  // Nightmare rewards skill: each flawless chamber grants a Dread Mark (+5% damage,
  // up to 12), a flawless boss two. Judged per wizard, on each wizard's own machine.
  _dreadCheck(room) {
    if (this._fightRoom !== room) return;
    this._fightRoom = null;
    const p = this.player;
    if (!this.difficulty.nightmare || this._fightHurt > 0 || p.dead || p.downed || this.menuMode) return;
    if (p.dread >= DREAD_MAX) { this.ui?.toast('Flawless · your Dread Marks are full', '#ff8070'); return; }
    p.dread = Math.min(DREAD_MAX, p.dread + (room.type === ROOM.BOSS ? 2 : 1));
    p.recomputeStats();
    this.ui?.toast(`Flawless · Dread Mark ${p.dread} — +${p.dread * 5}% damage`, '#ff7060');
    this.audio?.play('victory_sting', { volume: 0.35 });
    this.events.emit('dread', p.dread);
  }

  // ======================================================================
  // run setup
  // ======================================================================
  startRun({ seed, localId, name, classId, isHost, net, players = [], floor = 0, abyss = 0 }) {
    this.player?.endChannel();
    this.abyss = abyss; // the Abyss: how many times the party has descended past the Hollow King
    if (abyss) this.difficulty = abyssLaws(this.difficulty, abyss);
    this.cinematic = null;
    this.ui?.letterbox?.(false);
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this._partyGen = (this._partyGen ?? 0) + 1;
    this.stats = { kills: 0, damage: 0, time: 0, gold: 0 };
    this.tint = { rgb: [1, 1, 1], t: 0 };
    this.transitioning = false;
    this._wipeT = 0;
    this.pings = [];
    this.seed = seed;
    this.isHost = isHost;
    this.net = net;
    this.isSolo = !net || players.length <= 1;
    this.player = new LocalPlayer(this, { id: localId, name, classId });
    this.player.selfRevives = this.difficulty?.selfRevive ?? 1; // (Damnation: no second wind)
    this.ended = false;
    for (const p of players) if (p.id !== localId) this.addRemote(p);
    this._setViewModel(classId);
    this.ui?.onRunStart(this);
    this.events.emit('runStart');
    this.relics.onRunStart();
    this.loadFloor(floor);
  }

  _setViewModel(classId) {
    if (this.viewmodel) { this.renderer.viewScene.remove(this.viewmodel.root); this.viewmodel.dispose?.(); }
    this.viewmodel = getViewModel(classId, this);
    this.renderer.viewScene.add(this.viewmodel.root);
    this.selfLight.color.set(0xffe2c4).lerp(new THREE.Color(CLASS_META[classId].color), 0.3);
  }

  addRemote(p) {
    if (this.remotes.has(p.id) || p.id === this.player?.id) return;
    const r = new RemotePlayer(this, p);
    if (this.level) {
      const s = this.level.spawn;
      r.pos.set(s.x, 0, s.z);
      r.net.x = s.x; r.net.z = s.z;
    }
    this.remotes.set(p.id, r);
    this._partyGen = (this._partyGen ?? 0) + 1;
    if (this.isHost) this.director?.rescaleBosses();
    this.isSolo = false;
    this.relics?.onPeerJoin();
    this.ui?.toast(`${p.name} joined as ${CLASS_META[p.classId].name}`);
  }
  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.dispose();
    this.remotes.delete(id);
    this._partyGen = (this._partyGen ?? 0) + 1;
    if (this.isHost) this.director?.rescaleBosses();
    this.ui?.toast(`${r.name} left the party`);
  }

  // (one shared array, rebuilt only when the party changes: it is asked for
  // several times per enemy per frame. Read it, never change it.)
  allPlayers() {
    if (this._apFor !== this.player || this._apN !== this.remotes.size || this._apGen !== this._partyGen) {
      const out = (this._ap = this.player ? [this.player] : []);
      for (const r of this.remotes.values()) out.push(r);
      this._apFor = this.player; this._apN = this.remotes.size; this._apGen = this._partyGen;
    }
    return this._ap;
  }
  playerById(id) { return id === this.player?.id ? this.player : this.remotes.get(id); }

  loadFloor(index) {
    this.player?.endChannel();
    // tear down
    if (this.built) { this.scene.remove(this.built.group); this.built.dispose(); }
    if (this.storm) { this.storm.dispose(); this.storm = null; }
    for (const i of this.interactables) i.dispose?.();
    this.interactables = [];
    this.spells.clear();
    this.relics?.onFloor();
    this.actors.clear();
    for (const d of this.drops) this.scene.remove(d.mesh);
    this.drops = [];
    for (const h of this.hazards) h.wall?.end();
    this.hazards = [];
    this.pools = [];

    this.floorIndex = index;
    // (each descent into the Abyss lays the realms out anew)
    const level = generateLevel(this.seed + (this.abyss ?? 0) * 7919, index, this.encounters.forced, { omens: this.menuMode ? 0 : this.difficulty?.omens ?? 0 });
    this.level = level;
    this.biome = level.biome;
    this.collision = new Collision(level);
    this.built = buildLevel(level, this.texFactory, this.lights, { quality: this.settings?.quality });
    this.texFactory.endFloor(); // the last realm's own wall and floor textures
    this.critters?.dispose();
    this.critters = this.settings?.quality === 'low' ? null : new Critters(this.scene, level);
    this.hangers?.dispose();
    this.hangers = level.biome.id === 'dungeon' ? new Hangers(this.scene, level, this.built.mats, { quality: this.settings?.quality }) : null;
    this.built.wisps?.setEye(this.renderer.camera.position);
    this.built.court?.setEye(this.renderer.camera.position);
    this._courtK = 0;
    this.flotsam?.dispose();
    this.flotsam = level.biome.id === 'sewers' ? new Flotsam(this.scene, level, this.built.mats, { quality: this.settings?.quality }) : null;
    // the hanging lanterns burn and light the middle of their rooms
    for (const l of this.hangers?.lanterns ?? []) {
      this.lights.addTorch(new THREE.Vector3(l.x, l.y + 0.1, l.z), { color: level.biome.torchColor, intensity: 26, range: 15 });
      this.built.flames.push({ x: l.x, y: l.y, z: l.z, size: 0.42, kind: 'fire', color: level.biome.torchColor });
    }
    this.debris?.dispose(); this.rubble?.dispose();
    this.debris = new Debris(this.scene, this.built.mats.wood, this.collision);
    this.rubble = new Debris(this.scene, this.built.mats.stone, this.collision);
    this.scene.add(this.built.group);
    this.built.onDoorSlam = (d) => {
      const door = d.door;
      const bx = door.x - door.nx * 2, bz = door.z - door.ny * 2;
      const across = { x: door.ny, z: door.nx };
      for (let i = 0; i < 10; i++) {
        const o = (Math.random() - 0.5) * door.width;
        this.vfx.smoke(new THREE.Vector3(bx + across.x * o, this.groundY(bx, bz) + 0.2, bz + across.z * o), { count: 1, size: 0.7, color: [0.28, 0.24, 0.2], alpha: 0.45, life: 1.8, speed: 1.5, rise: 0.4 });
      }
      this.vfx.burst(new THREE.Vector3(bx, this.groundY(bx, bz) + 0.1, bz), { count: 12, speed: 3, life: 0.5, size: 0.05, sprite: SPR.SPARK, gravity: 8, upward: 0.8, color: [2.5, 1.6, 0.6], jitter: door.width * 0.4 });
      const near = Math.hypot(this.player.pos.x - bx, this.player.pos.z - bz);
      if (near < 25) this.vfx.addShake(0.25 * (1 - near / 25));
    };
    this.actors.setLevel(level, this.collision);
    this.director.setLevel(level);
    const b0 = level.biome;
    // the menu backdrop has no enemies: a run's own floor builds them
    if (!this.menuMode) preloadEnemies([...new Set([...b0.enemies, ...this.director.invaders(level), ...b0.elites, b0.boss, 'skeleton', 'hound', 'slime', 'slimeling', ...this.encounters.warmTypes(level)].map((t) => ENEMY_DEFS[t]?.model ?? BOSS_DEFS[t]?.model ?? t))], this);
    // atmosphere
    const b = this.biome;
    // Nightmare wears its own colours: a blood-dark fog, a dimmer sky, a grade
    // pulled toward red and a heavier vignette, in every realm
    const nm = !!this.difficulty.nightmare && !this.menuMode;
    this.audio?.setDread?.(nm);
    const fogCol = nm ? new THREE.Color(b.fog.color).lerp(_nmFog, 0.45) : new THREE.Color(b.fog.color);
    // each depth of the Abyss wears its own colours over the realm's
    const ab = this.abyss && !this.menuMode ? ABYSS_TINT[(this.abyss - 1) % ABYSS_TINT.length] : null;
    if (ab) fogCol.lerp(new THREE.Color(ab.fog), 0.55);
    const fogDen = b.fog.density * (nm ? 1.12 : 1);
    this.scene.fog = new THREE.FogExp2(fogCol, fogDen);
    this.scene.background = fogCol.clone();
    this.particles.setFog(fogDen, fogCol.getHex());
    this.hemi.color.set(b.ambient.sky);
    if (ab) this.hemi.color.lerp(new THREE.Color(ab.rim), 0.35);
    this.hemi.groundColor.set(b.ambient.ground);
    this.hemi.intensity = b.ambient.intensity * 3 * (nm ? 0.82 : 1);
    this.baseHemi = this.hemi.intensity;
    this._victoryLight = false;
    this.moon.intensity = b.moon ? b.moon.intensity * 1.6 : 0;
    const shadows = !!b.moon && this.renderer.renderer.shadowMap.enabled;
    this.moon.castShadow = shadows;
    this.built.group.traverse((o) => { if (o.isMesh && !o.material.transparent && o.name?.startsWith('lvl_')) { o.castShadow = shadows; o.receiveShadow = shadows; } });
    this.shadowsOn = shadows;
    if (b.moon) this.moon.color.set(b.moon.color);
    let grade = b.grade;
    if (ab) grade = { ...grade, gain: (grade.gain ?? [1, 1, 1]).map((c, i) => c * ab.gain[i]), saturation: (grade.saturation ?? 0.85) * ab.sat };
    this.renderer.setGrade(nm ? { ...b.grade, gain: (b.grade.gain ?? [1, 1, 1]).map((c, i) => c * [1.08, 0.87, 0.87][i]), lift: (b.grade.lift ?? [0, 0, 0]).map((c, i) => c + [0.006, 0, 0][i]), saturation: (b.grade.saturation ?? 0.85) * 0.92, vignette: (b.grade.vignette ?? 0.62) * 1.15 } : grade);
    this.viewHemi.color.set(b.ambient.sky);
    this.viewHemi.intensity = 0.6 + b.ambient.intensity;
    // interactables from the level
    for (const p of this.built.interactables) {
      if (p.type === 'chest') this.interactables.push(makeChest(this, p));
      if (p.type === 'shrine') this.interactables.push({ kind: 'shrine', pos: new THREE.Vector3(p.x, 1.2, p.z), r: 2.6, used: false, label: 'Pray at the Shrine', id: 'shrine' + p.x });
      if (p.type === 'merchant') {
        const npc = getAvatar('chronomancer', this);
        npc.root.position.set(p.x, this.groundY(p.x, p.z), p.z - 0.2);
        npc.root.rotation.y = 0;
        npc.root.scale.setScalar(1.05);
        npc.setTint?.(0x6a4a2a, 0.45);
        this.scene.add(npc.root);
        this.lights.addTorch(new THREE.Vector3(p.x + 1.2, this.groundY(p.x, p.z) + 2.2, p.z + 0.8), { color: 0xffb060, intensity: 14, range: 8, flicker: 0.3 });
        this.interactables.push({
          kind: 'shop', pos: new THREE.Vector3(p.x, 1.2, p.z), r: 3.4, label: 'Trade with the Merchant', id: 'shop' + p.x, stock: null,
          update: (dt, t) => {
            // the merchant is ~50 draw calls: only draw and animate when you could see him
            const near = this.renderer.camera.position.distanceToSquared(npc.root.position) < 30 * 30;
            npc.root.visible = near;
            if (near) npc.update(dt, { anim: 'idle', t, speed: 0, pitch: Math.sin(t * 0.5) * 0.1, castProgress: 0, strafe: 0 });
          },
          dispose: () => { this.scene.remove(npc.root); npc.dispose?.(); },
        });
      }
    }
    // mimics, champions, room modifiers, altars, the gambler, secret walls
    this.encounters.setLevel(level);
    // place players
    this.player.rerolls = this.difficulty.rerolls ?? 1;
    const s = level.spawn;
    this.player.spawnAt(s.x, s.z, 0);
    if (this.player.downed) { this.player.downed = false; this.player.hp = Math.max(this.player.hp, Math.round(this.player.maxHp * 0.5)); }
    if (this.player.dead) { this.player.dead = false; this.player.hp = Math.round(this.player.maxHp * 0.5); }
    for (const r of this.remotes.values()) { r.pos.set(s.x, 0, s.z); r.net.x = s.x; r.net.z = s.z; }
    level.startRoom.visited = true;
    if (this.difficulty.rush && !this.menuMode) this._rushFloor(level, index);
    this._buildDoorSigns();
    const abr = this.abyss && !this.menuMode ? ABYSS_TINT[(this.abyss - 1) % ABYSS_TINT.length] : null;
    setEnemyRim(abr ? abr.rim : b.rim ?? 0x806a60, abr ? 0.7 : b.rimK ?? 0.45);
    this.audio?.setAmbience(b.id);
    this.audio?.setMusic(this._mus('explore'));
    this.audio?.play('floor_enter');
    this.ui?.onFloor(this, b, index);
    // Tight Deadline: each realm's clock (not in Boss Rush, where every realm is its guardian)
    this.deadline = this.difficulty.deadline && !this.difficulty.rush && !this.menuMode ? { t: this.difficulty.deadline, past: false } : null;
    this.fightLock = null;
    this.ui?.deadline(this.deadline);
    if (index === 0 && !this.menuMode) this._tutorialTips();
    this.events.emit('floor', index);
    // a storm over an open-air realm (before the prewarm, so the rain's program compiles with the rest)
    if (b.storm) {
      const q = this.settings.quality ?? 'high';
      this.storm = new Storm(this.scene, { count: q === 'low' ? 900 : q === 'medium' ? 1700 : 2600 });
      this.storm.onThunder = (delay) => this.audio?.play('thunder', { volume: 0.35 + 0.45 * (1 - delay / 2.4) });
      this.storm.onStrike = (first) => this._skyBolt(first);
    }
    this._prewarm(level);
  }

  // Compile shaders for everything that can appear on this floor (enemy and
  // summon models, projectile meshes, effect pools, drops, reward pedestals,
  // the portal, ground eruptions) so nothing compiles mid-fight. A program
  // compile is a visible freeze, worst on Windows where ANGLE translates to D3D.
  //
  // The warm objects are then kept (out of the scene) until the next floor's
  // prewarm: three.js destroys a program as soon as no live material uses it,
  // so disposing them would throw the work away - and so would the last
  // skeleton of a wave being cleaned up, making the next wave recompile.
  //
  // Async: the floor waits behind the loading veil (loadingFloor) until it's
  // done, and the main loop neither updates nor renders meanwhile - a render
  // now would force the very compiles this is spreading out.
  async _prewarm(level) {
    const token = (this._warmToken = (this._warmToken ?? 0) + 1);
    this.loadingFloor = true;
    const scene = this.scene;
    const kids = new Set(scene.children);
    const undo = [], extra = [], hold = [], warmTwins = [];
    let added = [];
    try {
      const b = level.biome;
      // the menu backdrop only shows the level: models, spells and rewards are a run's
      const menu = this.menuMode;
      const types = new Set(menu ? [] : [...b.enemies, ...this.director.invaders(level), ...(b.elites ?? []), b.boss, 'skeletonMinion', 'spiritWolf', ...this.encounters.warmTypes(level)]);
      const models = [...new Set([...types].map((t) => ENEMY_DEFS[t]?.model ?? BOSS_DEFS[t]?.model ?? t))];
      const cam = this.renderer.camera;
      const front = cam.position.clone().add(new THREE.Vector3(0, 0, -3).applyQuaternion(cam.quaternion));
      const place = (o) => { o.position.copy(front); scene.add(o); extra.push(o); return o; };
      for (const t of models) {
        const m = getEnemyModelSafe(t, this);
        if (!m) continue;
        if (this.shadowsOn) {
          m.root.traverse((o) => { if (o.isMesh && !o.material?.transparent) o.castShadow = true; });
          for (const o of m.shadowProxies ?? []) { this.renderer.shadowOnly.add(o); warmTwins.push(o); } // (shadow twins: see Rig.finish)
        }
        place(m.root);
        hold.push(() => m.dispose?.());
        // spawning and dying bodies fade, which switches their materials to
        // transparent - a different program - so warm a faded copy too
        const f = getEnemyModelSafe(t, this);
        if (!f?._applyMats) { f?.dispose?.(); continue; }
        f._opacity = 0.5; f._applyMats();
        place(f.root);
        hold.push(() => f.dispose?.());
        // and a corpse burning away swaps to its dissolve programs: warm a half-burnt copy
        const d = getEnemyModelSafe(t, this);
        if (d?.setDissolve) { d.setDissolve(0.5); place(d.root); hold.push(() => d.dispose?.()); } else d?.dispose?.();
      }
      for (const o of menu ? [] : this.spells.warmObjects()) place(o);
      for (const o of menu ? [] : warmEruptionMeshes()) place(o);
      for (const t of menu ? [] : ['gold', 'health']) place(makeDropMesh(t));
      // rewards build themselves into the scene (swept up below); mute their
      // arrival bursts and the portal hum while they're only being compiled
      const vfxExplosion = this.vfx.explosion, vfxDecal = this.vfx.decal, audio = this.audio;
      this.vfx.explosion = () => {}; this.vfx.decal = () => ({ visible: false }); this.audio = null;
      try {
        if (!menu) {
          const ped = makePedestal(this, front.clone(), 0);
          const portal = makePortal(this, front.clone());
          hold.push(() => { ped.dispose?.(); portal.dispose?.(); });
        }
      } finally { this.vfx.explosion = vfxExplosion; this.vfx.decal = vfxDecal; this.audio = audio; }
      for (const pool of [this.vfx.ringPool, this.vfx.telePool, this.vfx.beamPool, this.vfx.shellPool, this.vfx.slashPool, this.vfx.funnelPool, this.vfx.conePool, this.vfx.boltPool, this.vfx.sigilPool]) {
        const it = pool?.items[0];
        if (!it || it.visible) continue;
        it.visible = true;
        undo.push(() => { it.visible = false; });
      }
      // decals swap between a lit and a glowing material
      const dec = this.vfx.decalPool.items;
      for (const [i, key] of [[0, 'lit'], [1, 'glow']]) {
        const d = dec[i];
        if (d.visible || !d.userData[key]) continue;
        const was = d.material;
        d.material = d.userData[key]; d.visible = true;
        undo.push(() => { d.material = was; d.visible = false; });
      }
      // exactly what the prewarm put in the scene, fixed now: anything spawned
      // while the compile runs is left alone
      added = scene.children.filter((o) => !kids.has(o));
      // (the menu backdrop only shows the level: its hidden extras and the hands wait for a run)
      await this.renderer.compileScenes({ upload: !this.renderer.noRender, all: !this.menuMode });
    } catch (e) { console.warn('prewarm failed', e); }
    for (const f of undo) { try { f(); } catch { /* already gone */ } }
    for (const o of warmTwins) this.renderer.shadowOnly.delete(o);
    for (const o of added) scene.remove(o);
    for (const o of extra) scene.remove(o);
    // release the previous floor's set only now, so shared programs never drop to zero users
    for (const f of this._warmHold ?? []) { try { f(); } catch { /* already gone */ } }
    this._warmHold = hold;
    this._prewarmPrograms = this.renderer.renderer.info.programs.length; // tests compare against this
    if (token === this._warmToken) this.loadingFloor = false;
  }

  _tutorialTips() {
    let seen = 0;
    try { seen = +(localStorage.getItem('arcane-ascent-tips') ?? 0); } catch { /* ignore */ }
    if (seen >= 2) return;
    try { localStorage.setItem('arcane-ascent-tips', String(seen + 1)); } catch { /* ignore */ }
    const sp = this.player.cls.spells;
    // shown one at a time, and never over a boss fight, a cinematic or a menu
    this._tipQ = [
      `${['forward', 'left', 'back', 'right'].map(keyOf).join('')} to move · Mouse to aim · ${keyOf('jump')} to jump`,
      `Hold Left Click — ${sp.primary.name}`,
      `Right Click — ${sp.secondary.name}`,
      `${keyOf('ability1')} — ${sp.ability1.name} · ${keyOf('ability2')} — ${sp.ability2.name}`,
      `${keyOf('dash')} to dash — you are briefly invulnerable`,
      'Stagger or kill a foe as it winds up to interrupt its attack',
      'Dash through a blow at the last moment: a perfect dodge',
      `${keyOf('interact')} to interact · ${keyOf('map')} for the map · ${keyOf('ping')} to ping`,
    ];
    this._tipT = 2.5;
    // contextual tips fire when they become relevant
    this._ctxTips = { sigil: 'Sigils above doorways reveal what lies beyond', ult: `${keyOf('ultimate')} — ${sp.ultimate.name} is ready`, keg: 'Red powder kegs explode — lure foes close, then strike' };
  }

  // A once-ever tip for a mechanic a player might not find alone (kept across runs, so a veteran
  // still hears of one added later): shown the first time it matters; with no text, only marked
  // as known (the player found it themselves).
  learn(id, text) {
    if (this.menuMode) return;
    let L = this._learned;
    if (!L) { try { L = new Set(JSON.parse(localStorage.getItem('arcane-ascent-learned') ?? '[]')); } catch { L = new Set(); } this._learned = L; }
    if (L.has(id)) return;
    L.add(id);
    try { localStorage.setItem('arcane-ascent-learned', JSON.stringify([...L])); } catch { /* ignore */ }
    if (text) this.ui?.toast(text, '#e2c48a');
  }

  _updateTips(dt) {
    if (this.ended || !this._tipQ) return;
    const busy = this.cinematic || this.ui?.modalOpen || this.actors.list.some((a) => a.boss && !a.dead);
    if (this._ctxTips) {
      const p = this.player;
      if (this._ctxTips.ult && p.ult >= 100 && !busy) { this.ui?.toast(this._ctxTips.ult, '#e2c48a'); this._ctxTips.ult = null; }
      if (this._ctxTips.keg && this.director?.active && !busy && this.level.breakables.some((b) => b.alive && b.type === 'keg' && Math.hypot(b.x - p.pos.x, b.z - p.pos.z) < 9)) { this.ui?.toast(this._ctxTips.keg, '#e2c48a'); this._ctxTips.keg = null; }
    }
    if (!this._tipQ.length) return;
    this._tipT -= dt;
    if (this._tipT > 0 || busy) return;
    this.ui?.toast(this._tipQ.shift(), '#e2c48a');
    this._tipT = 4;
  }

  // floating sigils above doorways show what lies beyond (boss, shop, treasure...)
  _buildDoorSigns() {
    for (const s of this.doorSigns ?? []) { this.scene.remove(s.sprite); s.sprite.material.dispose(); }
    this.doorSigns = [];
    const L = this.level;
    const glyph = { boss: ['☠', '#ff5040'], shop: ['⚖', '#f0c050'], shrine: ['✚', '#ffe080'], treasure: ['♦', '#ffb030'], elite: ['★', '#ff9040'], trial: ['⧗', '#ffcf60'], combat: ['⚔', '#d8c8a8'], start: null };
    for (const door of L.doors) {
      const other = L.rooms[door.other];
      const g = this.encounters.sigil(other) ?? glyph[other.type];
      if (!g) continue;
      const tex = signTexture(g[0], g[1]);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
      const sp = new THREE.Sprite(mat);
      const doorH = this.biome.outdoor ? 6 : this.biome.ceilCorr;
      sp.position.set(door.x - door.nx * 1.2, Math.min(doorH + 0.9, (L.rooms[door.room].ceil ?? 8) - 0.6), door.z - door.ny * 1.2);
      sp.scale.setScalar(1.1);
      sp.renderOrder = 30;
      this.scene.add(sp);
      this.doorSigns.push({ sprite: sp, room: L.rooms[door.room], other, door });
    }
  }
  _updateDoorSigns(dt) {
    for (const s of this.doorSigns ?? []) {
      const show = s.room.visited && !s.other.visited;
      const m = s.sprite.material;
      m.opacity += ((show ? 0.9 : 0) - m.opacity) * Math.min(1, dt * 3);
      s.sprite.visible = m.opacity > 0.02;
      s.sprite.position.y += Math.sin(this.time * 2 + s.door.id) * 0.002;
    }
  }

  // ---------------------------------------------------------------- breakables
  breakablesNear(pos, radius) {
    const out = [];
    for (const b of this.level.breakables) {
      if (!b.alive) continue;
      const dx = b.x - pos.x, dz = b.z - pos.z;
      if (dx * dx + dz * dz < (radius + b.r) ** 2 && pos.y < this.groundY(b.x, b.z) + 1.4) out.push(b);
    }
    return out;
  }
  smashAt(pos, radius) {
    for (const b of this.breakablesNear(pos, radius)) this.breakProp(b.i, true);
    this.encounters.smash(pos, radius);
  }
  breakProp(i, local = false) {
    const b = this.level.breakables[i];
    if (!b || !b.alive) return;
    b.alive = false;
    this.collision.removeCollider(b.collider);
    this.built.hideBreakable(b);
    const gy = this.groundY(b.x, b.z);
    const c = new THREE.Vector3(b.x, gy + 0.5, b.z);
    this.vfx.burst(c, { count: 12, speed: 6, life: 1.1, size: 0.1, sprite: SPR.CHUNK, solid: true, color: [0.34, 0.22, 0.12], color2: [0.25, 0.16, 0.09], gravity: 16, spin: 8, upward: 0.8 });
    // and real wreckage: staves and a lid off a barrel, planks and battens off a crate (a keg's blast flings them)
    const D = this.debris, hard = b.type === 'keg' ? 1.8 : 1;
    if (D && b.type === 'crate') { D.burst(b.x, gy + 0.5, b.z, 8, 0.6, 0.13, 0.025, 4 * hard, 3.5 * hard); D.burst(b.x, gy + 0.5, b.z, 3, 0.55, 0.07, 0.06, 3 * hard, 3 * hard); }
    else if (D) { D.burst(b.x, gy + 0.5, b.z, 9, 0.12, 0.62, 0.025, 4 * hard, 3.5 * hard); D.burst(b.x, gy + 0.9, b.z, 2, 0.4, 0.4, 0.03, 2.5 * hard, 4.5 * hard, 0.1); }
    this.vfx.smoke(c, { count: 4, size: 0.6, color: [0.3, 0.26, 0.2], alpha: 0.4, life: 1.4 });
    if (b.type === 'barrel' && Math.random() < 0.5) this.vfx.burst(c, { count: 16, speed: 3, life: 0.8, size: 0.06, sprite: SPR.DROP, solid: true, color: [0.25, 0.12, 0.05], gravity: 12, upward: 1 });
    if (b.type === 'keg') this.spells.after(0.18, () => this._kegBlast(b, c, local));
    this.audio?.play('impact_earth', { pos: c, volume: 0.7 });
    if (local) this.net?.broadcastOrSend({ t: 'brk', i });
    if (this.isHost && Math.random() < 0.35) this.spawnDrop(Math.random() < 0.2 ? 'health' : 'gold', c, Math.random() < 0.2 ? 15 : 3 + this.floorIndex * 2);
  }

  onTrialResult(room, won) {
    if (!won) { this.ui?.banner('THE TRIAL IS LOST', 'Fight on — the reward has dimmed', '#a08870'); this.audio?.play('ui_error'); }
  }

  // A powder keg goes off. Everyone sees the blast and checks their own player;
  // the player who broke it deals the damage to enemies and sets off nearby kegs.
  _kegBlast(b, c, local) {
    const R = 3.6;
    this.vfx.explosion(c, 'fire', R, { groundY: c.y - 0.5 });
    this.critters?.startle(c, 14);
    this.rattleHangers(c, R * 2.2, 1.4);
    this.vfx.addShake?.(0.35);
    this.audio?.play('explosion_big', { pos: c });
    const p = this.player;
    if (p.alive && !p.downed && !p.dead && p.pos.distanceTo(c) < R + 0.4) p.takeDamage(Math.round(p.maxHp * 0.18), 'fire', c, { cause: 'a powder keg' });
    if (local) {
      this.localAreaHit(c, R, 70, 'fire', { burn: 2 });
      this.smashAt(c, R * 0.9);
    }
  }

  // An area blast owned by the local player (powder kegs, revive bursts); goes through
  // the normal hit path so co-op clients forward the damage to the host.
  localAreaHit(pos, radius, dmg, el = 'fire', st) {
    const at = new THREE.Vector3(pos.x, pos.y + 0.6, pos.z);
    return this.spells.damageArea(at, radius, { dmg: dmg * (1 + this.floorIndex * 0.6), el, st, kb: 9, src: this.player.id });
  }

  _ambient(dt) {
    const cam = this.renderer.camera.position;
    const id = this.biome.id;
    const P = this.particles;
    const rnd = (r) => (Math.random() - 0.5) * r;
    // dust motes everywhere (catch the torchlight)
    if (Math.random() < dt * 14) P.glow({ x: cam.x + rnd(16), y: cam.y + rnd(4), z: cam.z + rnd(16), vx: rnd(0.15), vy: rnd(0.08), vz: rnd(0.15), r: 0.5, g: 0.42, b: 0.32, life: 6, size: 0.025, sprite: SPR.GLOW, drag: 0.2 });
    // dust hanging in the window light: motes drift slowly through each beam near you, bright in it
    for (const sh of this.built.shafts) {
      if (Math.random() > dt * 9 || (sh.x - cam.x) ** 2 + ((sh.z0 + sh.z1) * 0.5 - cam.z) ** 2 > 500) continue;
      const t = Math.random() * 0.9;
      const k = 5 + Math.random() * 3;
      P.glow({ x: sh.x + rnd(sh.w * (1 + t * 0.3)), y: sh.top * (1 - t) + 0.05 * t, z: sh.z0 + (sh.z1 - sh.z0) * t + rnd(0.6), vx: rnd(0.08), vy: -0.02 + rnd(0.04), vz: rnd(0.08), r: sh.col.r * k + 0.15, g: sh.col.g * k + 0.13, b: sh.col.b * k + 0.12, life: 4 + Math.random() * 3, size: 0.024 + Math.random() * 0.016, sprite: SPR.GLOW, drag: 0.3 });
    }
    if (id === 'sewers' && Math.random() < dt * 4) {
      const x = cam.x + rnd(14), z = cam.z + rnd(14);
      const c = this.level.ceilAt(x, z);
      if (c < 50) {
        // a drip from the vault, gone where it lands; into the channel it rings the water
        const wet = this.level.kind[this.level.idx(Math.floor(x / T), Math.floor(z / T))] === K_WATER;
        const h = c - 0.1 - (wet ? WATER_Y : this.groundY(x, z)), fall = (-1 + Math.sqrt(1 + 24 * Math.max(0, h))) / 12;
        P.solid({ x, y: c - 0.1, z, vy: -1, r: 0.35, g: 0.45, b: 0.4, a: 0.7, life: fall, size: 0.04, sprite: SPR.DROP, gravity: 12, stretch: 0.02 });
        if (wet) this.spells.after(fall, () => waterRipple(x, z, 0.55));
      }
    }
    if (id === 'courtyard' && Math.random() < dt * 6) {
      P.glow({ x: cam.x + rnd(20), y: cam.y + rnd(2) - 0.5, z: cam.z + rnd(20), vx: rnd(0.6), vy: rnd(0.3), vz: rnd(0.6), r: 1.6, g: 2.2, b: 0.6, life: 4, size: 0.04, sprite: SPR.GLOW, drag: 0.1 });
    }
    // the storm's rain landing: a couple of flecks thrown up off the stones near you
    if (this.storm && Math.random() < dt * 40) {
      const x = cam.x + rnd(14), z = cam.z + rnd(14), gy = this.groundY(x, z);
      const cell = this.level.cells[Math.floor(z / T) * this.level.W + Math.floor(x / T)];
      if (cell === 1 && this.level.kind[Math.floor(z / T) * this.level.W + Math.floor(x / T)] === K_WATER) waterRipple(x, z, 0.4);
      else if (cell === 1) for (let k = 0; k < 2; k++) P.glow({ x, y: gy + 0.04, z, vx: rnd(1), vy: 1 + Math.random() * 1.2, vz: rnd(1), r: 0.42, g: 0.48, b: 0.6, life: 0.24, size: 0.022, size2: 0.012, sprite: SPR.GLOW, gravity: 10 });
    }
    if (id === 'courtyard' && Math.random() < dt * 3) {
      P.solid({ x: cam.x + rnd(24), y: cam.y + 6, z: cam.z + rnd(24), vx: 1.2, vy: -0.6, vz: rnd(0.5), r: 0.25, g: 0.2, b: 0.12, a: 0.8, life: 7, size: 0.06, sprite: SPR.FEATHER, spin: 2 });
    }
    // low ground mist drifting through the bailey and over the sewer channels
    if ((id === 'courtyard' || id === 'sewers') && Math.random() < dt * (id === 'courtyard' ? 7 : 5)) {
      const a = Math.random() * Math.PI * 2, d = 5 + Math.random() * 18;
      const x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d;
      const cell = this.level.cells[Math.floor(z / T) * this.level.W + Math.floor(x / T)];
      const wet = this.level.kind[Math.floor(z / T) * this.level.W + Math.floor(x / T)] === K_WATER;
      if (cell === 1 && (id === 'courtyard' || wet || Math.random() < 0.3)) {
        const gy = this.groundY(x, z);
        const col = id === 'courtyard' ? [0.32, 0.36, 0.46] : [0.2, 0.27, 0.21];
        P.solid({ x, y: gy + 0.25 + Math.random() * 0.3, z, vx: (id === 'courtyard' ? 0.35 : 0.1) + rnd(0.15), vy: 0.02, vz: rnd(0.2), r: col[0], g: col[1], b: col[2], a: id === 'courtyard' ? 0.13 : 0.16, life: 9 + Math.random() * 5, size: 2.4 + Math.random() * 2, size2: 4.5, sprite: SPR.SMOKE, spin: 0.05, drag: 0.05 });
      }
    }
    if (id === 'throne' && Math.random() < dt * 10) {
      P.glow({ x: cam.x + rnd(20), y: cam.y + 4 + rnd(2), z: cam.z + rnd(20), vx: rnd(0.3), vy: -0.4, vz: rnd(0.3), r: 1.2, g: 0.5, b: 1.6, r2: 0.2, g2: 0.05, b2: 0.3, life: 8, size: 0.04, sprite: SPR.EMBER, drag: 0.2 });
    }
    // the Abyss: motes in the depth's own colour, drifting up as if the place were sinking
    if (this.abyss && Math.random() < dt * 8) {
      const c = ABYSS_TINT[(this.abyss - 1) % ABYSS_TINT.length].rc;
      P.glow({ x: cam.x + rnd(18), y: cam.y - 1.5 + rnd(2), z: cam.z + rnd(18), vx: rnd(0.2), vy: 0.35 + Math.random() * 0.3, vz: rnd(0.2), r: c[0] * 1.4, g: c[1] * 1.4, b: c[2] * 1.4, r2: c[0] * 0.2, g2: c[1] * 0.2, b2: c[2] * 0.2, life: 6, size: 0.05, sprite: SPR.EMBER, drag: 0.15 });
    }
    // the oubliettes breathe: cold mist welling up out of each shaft near you and spilling over the grate
    for (const pit of this.level.pits) {
      if ((pit.x - cam.x) ** 2 + (pit.z - cam.z) ** 2 > 900 || Math.random() > dt * 7) continue;
      P.solid({ x: pit.x + rnd(1.4), y: pit.y - 1.2 - Math.random() * 1.2, z: pit.z + rnd(1.4), vx: rnd(0.2), vy: 0.55 + Math.random() * 0.35, vz: rnd(0.2), r: 0.3, g: 0.37, b: 0.42, a: 0.16, life: 4 + Math.random() * 2, size: 0.9, size2: 2.4, sprite: SPR.SMOKE, spin: 0.08, drag: 0.35 });
    }
    // the dungeon: grit sifting down from the vaults now and then
    if (id === 'dungeon' && Math.random() < dt * 1.5) {
      const x = cam.x + rnd(12), z = cam.z + rnd(12), c = this.level.ceilAt(x, z);
      if (c < 50) for (let k = 0; k < 4; k++) P.solid({ x: x + rnd(0.4), y: c - 0.1, z: z + rnd(0.4), vy: -0.5, r: 0.3, g: 0.26, b: 0.22, a: 0.6, life: 1.6, size: 0.025, sprite: SPR.CHUNK, gravity: 6 });
    }
    if (id === 'keep' && Math.random() < dt * 2) {
      P.glow({ x: cam.x + rnd(14), y: cam.y + rnd(2), z: cam.z + rnd(14), vy: 0.1, r: 0.6, g: 0.5, b: 1.2, life: 5, size: 0.08, sprite: SPR.RUNE, spin: 0.5, drag: 0.2 });
    }
  }

  // ======================================================================
  // per-frame update
  // ======================================================================
  update(dt) {
    if (!this.player) return;
    const realDt = dt;
    // hit-stop slows the world very briefly on big hits
    if (this.vfx.hitstop > 0) dt *= 0.15;
    // eased slow motion (the last kill of a fight), counted in real time
    if (this.slow) {
      this.slow.t += realDt;
      const u = this.slow.t / this.slow.dur;
      if (u >= 1) this.slow = null;
      else dt *= this.slow.k + (1 - this.slow.k) * u * u;
    }
    this.time += dt;
    if (!this.paused || !this.isSolo) this.stats.time += realDt; // a paused solo run isn't run time
    const input = this.input;
    const p = this.player;

    if (!this.paused) {
      p.update(dt, input);
      this._interactions(dt, input);
    }
    this._updatePings();
    for (const r of this.remotes.values()) r.update(dt);
    if (!this.paused || !this.isSolo) {
      if (this.deadline) this._deadlineTick(dt);
      if (this.isHost) this.director.update(dt);
      this.actors.update(dt);
      this.spells.update(dt);
      this.relics?.update(dt);
      this._updateHazards(dt);
      this._updatePools(dt);
      this._updateDrops(dt);
    }
    for (const it of this.interactables) it.update?.(dt, this.time);
    this.encounters.update(dt);
    this._updateTips(realDt);
    this.events.emit('tick', realDt);
    this._updateDoorSigns(realDt);
    this._roomMusic(realDt);
    this._ventTells(realDt);
    this._ambient(realDt);
    this.critters?.update(dt, this.time, this.renderer.camera.position, this.allPlayers());
    this.debris?.update(dt, this.actors._floor);
    this.hangers?.update(dt, this.time, this.renderer.camera.position);
    this.flotsam?.update(dt, this.time, this.renderer.camera.position);
    if (this.biome?.outdoor) this._grassPush();
    this.rubble?.update(dt, this.actors._floor);
    this.contact.update(this);
    if (this.storm) {
      this.storm.calm = !!this.settings.calm; this.storm.update(realDt, this.time, this.renderer.camera.position);
      if (this.built?.sky) this.built.sky.material.uniforms.uFlash.value = this.storm.flash;
    }
    if (this._gated) this._gateFx(dt);
    // big boss arenas outgrow the light pool: lift the ambient a little while you stand in one
    if (this.baseHemi && !this.ended && !this._victoryLight) {
      const br = this.level.bossRoom, pp = this.player.pos;
      const inArena = br && this.level.roomAt(pp.x, pp.z) === br && !this.biome.outdoor;
      const want = this.baseHemi * (inArena ? 1.9 : 1) * this.encounters.hemiK;
      this.hemi.intensity += (want - this.hemi.intensity) * Math.min(1, realDt * 1.5);
      // lightning: the sky lights the whole bailey for an instant (set, not eased: then straight back)
      const fl = this.storm?.flash ?? 0;
      if (fl > 0 || this._flashing) {
        this._flashing = fl > 0;
        this.hemi.intensity = want * (1 + 3.2 * fl);
        if (this.moon) this.moon.intensity = (this.biome.moon?.intensity ?? 0) * (1 + 2 * fl);
      }
    }

    // camera & lighting
    const cam = this.renderer.camera;
    p.updateCamera(cam, realDt, this.vfx, this.time);
    if (this.cinematic) this._cinematicCam(cam, realDt);
    else if (p.dead && !this.isSolo) this._spectate(cam, realDt);
    this.selfLight.position.copy(cam.position).add(_v.set(0, -0.2, 0));
    this.selfLight.intensity = (p.dead ? 0 : 2.2) * (this.settings.selfLight ?? 1) * this.encounters.selfK;
    // flames
    const cx = cam.position.x, cz = cam.position.z;
    for (const f of this.built.flames) {
      const dx = f.x - cx, dz = f.z - cz;
      if (dx * dx + dz * dz > 1300 || f.out || f.gpu !== undefined) continue; // (candles burn on the GPU: built.candles)
      this.vfx.flame(f, realDt);
    }
    this.lights.update(realDt, this.time, cam.position);
    this.built.update(realDt, this.time);
    // the dead court flees a hall while a fight is on in it
    if (this.built.court?.list.length) {
      let on = 0; for (const r of this.level.rooms) if (r._locked) { on = 1; break; }
      this._courtK += (on - this._courtK) * Math.min(1, realDt * (on ? 2.5 : 0.6));
      this.built.court.setFight(this._courtK);
    }
    this.vfx.update(dt, this.time, realDt);
    this.particles.update(this.time);
    this._viewModel(realDt);
    this._postFx(realDt);
    // moon follows the player so its (unused) shadow frustum would be centred
    const snap = 72 / 2048 * 4;
    const mx = Math.round(cx / snap) * snap, mz = Math.round(cz / snap) * snap;
    this.moon.target.position.set(mx, 0, mz);
    this.moon.position.set(mx + 30, 70, mz - 60);
    // a lightning flash lights the bailey from the bolt: the moon's light (and every shadow) swings to it
    // for the instant of the flash (the shadow map is redrawn each frame anyway)
    if (this.storm && this.storm.flash > 0.15) {
      const B = this._bolt.a;
      _v.set(B.x - mx, 0, B.z - mz).setLength(60); _v.y = 70;
      this.moon.position.set(mx + _v.x, _v.y, mz + _v.z);
    }
    // audio listener
    this.audio?.setListener(cam.position, p.forward());
    this.audio?.setIntensity?.(p.alive && !p.downed ? clamp(1 - p.hp / p.maxHp - 0.4, 0, 1) * 1.6 : 1);
    // net
    if (this.net) this.net.tick(realDt, this);
    // the crosshair turns gold over a weak point, so aim is something you can see and practise (20 Hz)
    if ((this._aimT -= realDt) <= 0) { this._aimT = 0.05; this.ui?.aimWeak?.(this._aimOnWeak(cam.position, p)); }
    this.ui?.update(realDt, this);
    this._checkRunEnd(realDt);
  }

  _viewModel(dt) {
    const vm = this.viewmodel;
    if (!vm) return;
    const p = this.player;
    const ca = p.castAnim;
    vm.root.visible = !p.dead && !this.cinematic && this.settings.showHands !== false;
    vm.update(dt, {
      t: this.time, speed: p.speedNorm ?? 0, grounded: p.grounded, look: p.lookDelta,
      cast: ca ? { slot: ca.slot, hand: ca.hand, t: ca.t, style: p.channel ? 'channel' : ca.style } : null,
      charge: p.channel ? Math.min(1, p.channel.t / p.channel.max) : 0, dash: p.dashT > 0, hurt: p.hurtPulse, downed: p.downed,
    });
    vm.setPower?.(p.ult >= 100 ? 1 : 0);
    // mirror the two strongest nearby world lights into the view scene so the
    // hands are lit by real torches and spells
    const cam = this.renderer.camera;
    // pick the strongest few scene lights for the hands without allocating each frame
    const all = (this._vlAll ??= [...this.lights.torchLights, ...this.lights.fxLights]);
    const scored = (this._vlScored ??= all.map((l) => ({ l, s: 0 })));
    for (const e of scored) e.s = e.l.intensity > 0.01 ? e.l.intensity / (1 + e.l.position.distanceToSquared(cam.position)) : -1;
    scored.sort((a, b) => b.s - a.s);
    const inv = cam.matrixWorldInverse;
    for (let i = 0; i < this.viewLights.length; i++) {
      const vl = this.viewLights[i];
      const src = scored[i]?.s > 0 ? scored[i].l : null;
      if (!src) { vl.intensity = 0; continue; }
      const d = src.position.distanceTo(cam.position);
      const local = _v.copy(src.position).applyMatrix4(inv);
      local.setLength(Math.min(2.5, Math.max(0.8, d * 0.3)));
      vl.position.copy(local);
      vl.color.copy(src.color);
      vl.intensity = src.intensity * 0.25 / (1 + d * 0.15);
    }
  }

  // anything wading through channel water trails rings and the odd splash
  wadeFx(e, speed, dt, r) {
    const L = this.level;
    const ci = L.idx(Math.floor(e.pos.x / T), Math.floor(e.pos.z / T));
    if (L.kind[ci] !== K_WATER) return;
    e._wadeT = (e._wadeT ?? Math.random() * 0.4) - dt * Math.min(speed, 6) / 3;
    if (e._wadeT > 0) return;
    e._wadeT = 0.5 + Math.random() * 0.2;
    // skip what nobody is near enough to notice
    const cam = this.renderer.camera.position;
    if ((cam.x - e.pos.x) ** 2 + (cam.z - e.pos.z) ** 2 > 600) return;
    this.vfx.ring({ x: e.pos.x, y: WATER_Y - 0.05, z: e.pos.z }, r + 0.45, WADE_C, 1.1, 0.07);
    waterRipple(e.pos.x, e.pos.z, 0.9);
    if (Math.random() < 0.5) this.vfx.burst(new THREE.Vector3(e.pos.x, WATER_Y, e.pos.z), { count: 4, speed: 1.6, upward: 1, gravity: 9, life: 0.35, size: 0.045, sprite: SPR.DROP, color: [0.5, 0.6, 0.6], solid: true });
  }

  _dashCol() {
    if (!this._dashColC || this._dashColFor !== this.player.classId) {
      const c = new THREE.Color(CLASS_META[this.player.classId]?.color ?? 0xffffff).lerp(new THREE.Color(0xffffff), 0.35);
      this._dashColC = [c.r * 0.6, c.g * 0.6, c.b * 0.6];
      this._dashColFor = this.player.classId;
    }
    return this._dashColC;
  }

  _postFx(dt) {
    const g = this.renderer.grade.uniforms;
    const p = this.player;
    const lowHp = p.alive && !p.downed ? clamp(1 - p.hp / p.maxHp, 0, 1) : 1;
    if (p.downed) {
      // bleeding out: a slow heartbeat at the edges of a drained, grey view
      const beat = Math.pow(Math.max(0, Math.sin(this.time * 4.2)), 8);
      g.uDamage.value = clamp(0.16 + beat * 0.22 + p.hurtPulse * 0.3, 0, 1);
    } else g.uDamage.value = clamp(p.hurtPulse * 0.8 + Math.max(0, lowHp - 0.6) * 1.2 * (0.7 + 0.3 * Math.sin(this.time * 6)), 0, 1);
    g.uHeal.value = Math.max(0, (this.healPulse ?? 0));
    // inside a danger zone that hasn't landed yet: the view's edges warn in its colour, faster as it nears
    const dz = this._inDanger(p);
    if (dz) {
      const k = dz.k, beat = 0.6 + 0.4 * Math.sin(this.time * (8 + 14 * k));
      g.uDanger.value = (0.12 + 0.3 * k) * beat;
      g.uDangerCol.value.set(dz.c[0], dz.c[1], dz.c[2]);
    } else g.uDanger.value = 0;
    // dash / blink speed smear: held while dashing, then eases off
    this.dashFx = p.dashT > 0 ? Math.max(this.dashFx ?? 0, 1) : Math.max(0, (this.dashFx ?? 0) - dt * 4.5);
    g.uDash.value = this.dashFx * 0.85;
    if (this.dashFx > 0) g.uDashCol.value.set(...this._dashCol());
    this.healPulse = Math.max(0, (this.healPulse ?? 0) - dt * 1.5);
    g.uDesat.value = p.downed || p.dead ? 0.85 : 0;
    if (this.tint.t > 0) {
      this.tint.t -= dt;
      const k = Math.min(1, this.tint.t * 3);
      g.uTint.value.set(1 + (this.tint.rgb[0] - 1) * k, 1 + (this.tint.rgb[1] - 1) * k, 1 + (this.tint.rgb[2] - 1) * k);
    } else g.uTint.value.set(...this.encounters.tint); // room modifiers grade the view while you're in them
    // a lightning flash: the view blooms cold and bright for the instant (calm mode's flash is already dimmed)
    const fl = this.storm?.flash ?? 0;
    if (fl > 0) { const t = g.uTint.value; t.set(t.x * (1 + 1.1 * fl), t.y * (1 + 1.25 * fl), t.z * (1 + 1.6 * fl)); }
    g.uFlash.value.set(0.018 * fl, 0.022 * fl, 0.034 * fl);
  }

  screenTint(rgb, dur) { this.tint = { rgb, t: dur }; }

  // dead in co-op: follow a living teammate from behind
  _spectate(cam) {
    const alive = [...this.remotes.values()].filter((r) => !r.dead);
    if (!alive.length) return;
    if (this.input.was('jump')) this._specIdx = (this._specIdx ?? 0) + 1;
    const r = alive[(this._specIdx ?? 0) % alive.length];
    const back = new THREE.Vector3(Math.sin(r.yaw), 0, Math.cos(r.yaw));
    const want = r.eye.clone().addScaledVector(back, 3.2).add(new THREE.Vector3(0, 0.8, 0));
    const dist = this.collision.raycast(r.eye.x, r.eye.y, r.eye.z, back.x, 0.25, back.z, 3.4);
    if (dist < 3.4) want.copy(r.eye).addScaledVector(back, Math.max(0.5, dist - 0.3)).add(new THREE.Vector3(0, 0.8 * dist / 3.4, 0));
    this._specPos = this._specPos ? this._specPos.lerp(want, 0.15) : want.clone();
    cam.position.copy(this._specPos);
    cam.lookAt(r.eye.x, r.eye.y - 0.2, r.eye.z);
    this.ui?.prompt(`Spectating ${r.name} — you return when the chamber is cleared · [Space] next`);
  }

  // boss intro: pull the camera's gaze to the boss for a moment
  _cinematicCam(cam, dt) {
    const c = this.cinematic;
    c.t += dt;
    const a = c.target;
    if (!a || a.dead || c.t >= c.dur) { this.cinematic = null; this.ui?.letterbox(false); return; }
    const k = c.t < 0.5 ? c.t / 0.5 : c.t > c.dur - 0.5 ? (c.dur - c.t) / 0.5 : 1;
    const e = k * k * (3 - 2 * k);
    const look = new THREE.Vector3(a.pos.x, a.pos.y + a.height * 0.65, a.pos.z);
    const m = new THREE.Matrix4().lookAt(cam.position, look, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    cam.quaternion.slerp(q, e);
    cam.fov = this.renderer.baseFov - 18 * e;
    cam.updateProjectionMatrix();
    if (c.t > 0.9 && !c.roared) { c.roared = true; this.vfx.addShake(0.5); this.audio?.play('boss_roar', { pos: a.pos }); }
  }

  groundY(x, z) { return this.level ? this.level.floorAt(x, z) : 0; }

  // the grass parts round the wizards and the foes nearest the eye (8 at most: see the grass shader)
  _grassPush() {
    const B = this.built, cam = this.renderer.camera.position, D = this._gpD, A = this._gpA;
    let n = 0, m = 0;
    for (const pl of this.allPlayers()) { if (n < 3 && !pl.dead) B.setGrassPush(n++, pl.pos.x, pl.pos.z, 0.9); }
    const cap = 8 - n;
    for (const a of this.actors.list) {
      if (a.dead || a.flying) continue;
      const d = (a.pos.x - cam.x) ** 2 + (a.pos.z - cam.z) ** 2;
      if (d > 400 || (m === cap && d >= D[m - 1])) continue;
      // (kept sorted, nearest first: insert, the farthest falling off the end)
      let j = m < cap ? m++ : m - 1;
      while (j > 0 && D[j - 1] > d) { D[j] = D[j - 1]; A[j] = A[j - 1]; j--; }
      D[j] = d; A[j] = a;
    }
    for (let k = 0; k < m; k++) B.setGrassPush(n++, A[k].pos.x, A[k].pos.z, 0.55 + A[k].radius);
    for (; n < 8; n++) B.setGrassPush(n, 0, 0, 0);
  }
  // an Oubliette room's cell doors fling open as its fight begins (the host decides; every peer opens them):
  // their bars stop blocking at once, and the doors swing out one after another with a bang and grit
  openCells(room, local) {
    if (!room?.cells || room.cellsOpen) return;
    room.cellsOpen = true;
    const level = this.level;
    room.cells.forEach((c, k) => {
      this.collision.removeCollider(c.col);
      c.open = true;
      this.spells.after(k * 0.14 + Math.random() * 0.08, () => {
        if (this.level !== level) return;
        this.built.openCellDoor(c.bars);
        const gy = this.groundY(c.bars.x, c.bars.z);
        this.audio?.play('cell_open', { pos: _splashV.set(c.bars.x, gy + 1.5, c.bars.z), volume: 0.85 });
        this.vfx.smoke(_splashV.set(c.bars.x, gy + 0.4, c.bars.z), { count: 4, size: 0.9, color: [0.3, 0.27, 0.24], alpha: 0.35, life: 1.6, spread: 1.6 });
        for (let i = 0; i < 6; i++) this.particles.solid({ x: c.bars.x + (Math.random() - 0.5) * 3, y: gy + 3.3, z: c.bars.z + (Math.random() - 0.5) * 0.4, vy: -0.5, r: 0.3, g: 0.26, b: 0.22, a: 0.6, life: 1.4, size: 0.03, sprite: SPR.CHUNK, gravity: 7 });
      });
    });
    if (local) this.net?.broadcast({ t: 'cells', r: room.id });
  }
  // a foe goes down an oubliette: its cry, the grate rattling, and the word over the pit (every peer)
  pitFallFx(a, pit, local) {
    this.audio?.play(a.def.sound ?? 'beast_growl', { pos: a.pos, volume: 0.9, pitch: 1.15 });
    this.audio?.play('cage_rattle', { pos: _splashV.set(pit.x, pit.y, pit.z), volume: 0.8 });
    this.ui?.floatText(new THREE.Vector3(pit.x, pit.y + 1.6, pit.z), 'FORGOTTEN', '#9ab8c8', true);
    this.spells.after(0.9, () => this.audio?.play('impact_earth', { pos: _splashV.set(pit.x, pit.y - 3, pit.z), volume: 0.5 }));
    if (local) this.net?.broadcast({ t: 'pitfall', id: a.id, i: pit.i });
  }
  // a blast swings the Oubliette's cages and chains overhead, and the one it shoved hardest rattles
  rattleHangers(p, r, k) {
    const h = this.hangers?.push(p, r, k);
    if (h) this.audio?.play('cage_rattle', { pos: _splashV.set(h.x, h.y - h.bottom * 0.8, h.z), volume: 0.7 });
  }
  // channel water here (its surface is WATER_Y; the floor under it is the bed)
  waterAt(x, z) { const L = this.level; return !!L && L.kind[L.idx(Math.floor(x / T), Math.floor(z / T))] === K_WATER; }
  // something landed in the water: rings it and throws up a splash, sized k (a footfall ~1, a blast 2-3)
  splash(x, z, k = 1) {
    waterRipple(x, z, Math.min(2.2, 0.8 + k * 0.5));
    const cam = this.renderer.camera.position;
    if ((cam.x - x) ** 2 + (cam.z - z) ** 2 > 900) return;
    this.vfx.burst(_splashV.set(x, WATER_Y, z), { count: Math.round(5 + k * 6), speed: 1.6 + k * 1.1, upward: 1.6, gravity: 9, life: 0.45 + k * 0.1, size: 0.05 + k * 0.012, sprite: SPR.DROP, color: [0.5, 0.6, 0.6], solid: true, jitter: 0.15 * k });
  }

  // a lightning bolt in the sky, 55-85 m off, ahead of the wizard where they'll see it; each flash of a
  // strike redraws it down the same path, newly forked
  _skyBolt(first) {
    const c = this.renderer.camera.position, B = this._bolt;
    if (first) {
      const ang = (this.player?.yaw ?? 0) + Math.PI + (Math.random() - 0.5) * 1.3, d = 55 + Math.random() * 30;
      const x = c.x + Math.sin(ang) * d, z = c.z + Math.cos(ang) * d;
      B.a.set(x + (Math.random() - 0.5) * 24, c.y + 75 + Math.random() * 20, z + (Math.random() - 0.5) * 24);
      B.b.set(x, c.y + 4, z);
      this.built?.sky?.material.uniforms.uBolt.value.set(B.a.x - c.x, B.a.y - c.y, B.a.z - c.z).normalize(); // (the clouds light up round it)
    }
    this.vfx.lightning(B.a, B.b, B.o);
  }

  footstepSurface(pos) {
    const L = this.level;
    const i = L.idx(Math.floor(pos.x / T), Math.floor(pos.z / T));
    const k = L.kind[i];
    const b = this.biome.id;
    if (b === 'courtyard') return k === K_ALT ? 'footstep_stone' : 'footstep_grass';
    if (b === 'keep') return k === K_ALT ? 'footstep_wood' : 'footstep_wood';
    return 'footstep_stone';
  }

  // ======================================================================
  // damage: local player -> actors
  // ======================================================================
  hitActor(a, H, pos) {
    if (!a || !a.alive) return;
    const p = this.player;
    const st = p.stats;
    const res = resolveHit(H, st, a);
    let mult = 1;
    for (const k in st.vs) if (a.mask & ST[k]) mult += st.vs[k];
    if (st.execute && a.hp / a.maxHp < 0.3) mult += st.execute;
    if (st.bossDmg && (a.boss || a.elite)) mult += st.bossDmg;
    if (this.relics) mult += this.relics.dmgMod(a, H);
    let dmg = Math.max(1, Math.round(res.dmg * mult));
    if (H.tag === 'dot') dmg = Math.max(0, Math.round(res.dmg * mult));
    const elShow = H.el;
    // reaction effects
    if (res.reaction) {
      const R = REACTIONS[res.reaction];
      // fast hitters re-trigger a reaction several times a second: the name,
      // sound and blast play once per target per beat, the damage every time
      if (!(this.time - (a._rxT ?? -9) < 0.7)) {
        a._rxT = this.time;
        this.ui?.floatText(pos.clone().add(_v.set(0, 0.6, 0)), R.name, R.color, true);
        this.audio?.play('reaction', { pos });
        this.vfx.explosion(pos, H.el === 'lightning' ? 'lightning' : H.el, 2.2, { groundY: this.groundY(pos.x, pos.z), shakeScale: 0.5 });
      } else this.vfx.impact(pos, H.el, 1.2);
      if (res.aoe) this.spells.damageArea(pos, res.aoe.radius, { dmg: res.aoe.dmg, el: res.aoe.el, st: res.aoe.st, noReact: true, src: p.id, tag: 'reaction' });
      if (res.chain) {
        const hitSet = new Set([a.id]);
        let cur = pos;
        for (let i = 0; i < res.chain; i++) {
          const n = this.spells.nearest(cur, 8, hitSet);
          if (!n) break;
          hitSet.add(n.id);
          const np = new THREE.Vector3(n.pos.x, n.pos.y + n.height * 0.5, n.pos.z);
          this.vfx.lightning(cur, np, { life: 0.15, branches: 1 });
          this.hitActor(n, { dmg: H.dmg * 0.6, el: 'lightning', st: { shock: 3 }, noReact: true, src: p.id, tag: 'reaction' }, np);
          cur = np;
        }
      }
      if (res.reaction === 'shatter') this.audio?.play('shatter', { pos });
    }
    if (res.crit && st.critHeal) p.heal(st.critHeal, true);
    // statuses: scale by status power and add class/tome extras
    let stPayload = H.st;
    if (stPayload && stPayload.poison && st.poisonBonus && H.tag !== 'dot') stPayload = { ...stPayload, poison: [stPayload.poison[0], stPayload.poison[1]] };
    // relic procs (lightning strikes, glyphs, overkill arcs...) and the statuses they add
    if (this.relics) {
      const sl = this.spells.slot; this.spells.slot = 'other'; // (a relic's proc, and its timers, are the relic's damage)
      stPayload = this.relics.onHit(a, H, res, dmg, pos, stPayload);
      this.spells.slot = sl;
    }
    // local feedback
    if (dmg > 0) {
      if (H.tag !== 'dot') {
        a.hitFlash = res.crit ? 0.6 : 0.4;
        // the body rocks the way the blow pushed (from the wizard if it carried no push), harder for a big hit
        const kd = H.kbDir, pp = this.player.pos;
        const k = Math.min(1, 0.3 + (dmg / Math.max(1, a.maxHp)) * 4 + (res.crit ? 0.2 : 0)) * (a.boss ? 0.35 : 1);
        if (kd) a.model?.kick?.(kd[0], kd[1], k); else a.model?.kick?.(a.pos.x - pp.x, a.pos.z - pp.z, k);
        // and something of what was struck flies off it, away from the blow: sparks from plate and stone,
        // chips from bone, goo from an ooze, blood from flesh (a few at most, near the camera, not every tick)
        const mk = a.type in MAT_OF ? MAT_OF[a.type] : a.def.hitSound;
        const M = mk === null ? null : MAT_HIT[mk] ?? MAT_HIT.enemy_hit;
        const cp = this.renderer.camera.position;
        if (this._matF !== this.time) { this._matF = this.time; this._matN = 0; } // (at most 6 a frame, however big the fight)
        if (M && this._matN < 6 && this.time >= (a._matT ?? 0) && (a.pos.x - cp.x) ** 2 + (a.pos.z - cp.z) ** 2 < 625 && !a.def.phase) {
          a._matT = this.time + 0.07; this._matN++;
          const dx = kd ? kd[0] : a.pos.x - pp.x, dz = kd ? kd[1] : a.pos.z - pp.z, dl = Math.hypot(dx, dz) || 1;
          M.dir = _mdir.set(dx / dl, 0.55, dz / dl);
          this.vfx.burst(pos, M);
        }
      }
      // shield-bearers turn frontal hits: show it, so players learn to flank or stun them
      if (a.def.frontShield && H.tag !== 'dot' && !(a.st.stun?.t > 0)) {
        const pp = this.player.pos, dx = pp.x - a.pos.x, dz = pp.z - a.pos.z, dl = Math.hypot(dx, dz) || 1;
        if ((Math.sin(a.yaw) * dx + Math.cos(a.yaw) * dz) / dl > 0.5) {
          this.vfx.burst(pos, { count: 8, speed: 6, life: 0.3, size: 0.04, sprite: SPR.SPARK, stretch: 0.04, gravity: 8, color: [3, 2.4, 1.4] });
          if (!(a._blockT > this.time)) { a._blockT = this.time + 1.6; this.ui?.floatText(pos.clone().add(_v.set(0, 0.5, 0)), 'BLOCKED — flank it', '#c8c0b0'); this.audio?.play('enemy_hit_armor', { pos, volume: 0.6 }); }
        }
      }
      // a flinch away from the caster, bigger for crits and chunky hits (not for damage over time)
      if (H.tag !== 'dot') {
        const pp = this.player.pos, dx = a.pos.x - pp.x, dz = a.pos.z - pp.z, dl = Math.hypot(dx, dz) || 1;
        this.actors.jolt(a, dx / dl, dz / dl, (res.crit ? 1 : 0.55) * Math.min(1, 0.35 + (dmg / a.maxHp) * 5));
      }
      if (!H.noNumber) this.ui?.damageNumber(pos, dmg, elShow, res.crit || H.weak, H.tag === 'dot', a.id);
      if (H.tag !== 'dot') {
        this.ui?.hitmarker(res.crit, a.hp - dmg <= 0, H.weak);
        if (H.weak) { this.events.emit('weakHit'); this.learn('weak', 'Weak point! Aimed hits to the head (the front of a beast) deal +35%'); if (this.time - (this._weakSndT ?? 0) > 0.08) { this._weakSndT = this.time; this.audio?.play('hitmarker', { volume: 0.7 }); } }
        if (this.time - this.hitSoundT > 0.05) {
          this.hitSoundT = this.time;
          this.audio?.play(a.def.hitSound ?? 'enemy_hit', { pos, volume: 0.6 });
          if (res.crit) this.audio?.play('crit', { volume: 0.5 });
        }
        if (res.crit) this.vfx.hitstop = Math.max(this.vfx.hitstop, 0.04);
      }
    }
    // predicted health for responsiveness
    const willKill = a.hp - dmg <= 0;
    // (a spell zone's ticks are tagged 'dot' but belong to their spell: status ticks credit 'dot' in onDotTick)
    p.onDealtDamage(dmg, false, a, H.tag === 'reaction' ? 'reaction' : H.relic ? 'other' : this.spells.slot ?? (H.tag === 'dot' ? 'dot' : 'other'));
    this.stats.damage += dmg;
    this.events.emit('hit', dmg, a, res, H);
    const kbMult = st.kbMult ?? 1;
    const payload = { dmg, el: H.el, st: stPayload, kb: (H.kb ?? 0) * kbMult, kbDir: H.kbDir, pull: H.pull, src: p.id, consume: res.consume, power: st.statusPower };
    if (this.isHost) this.actors.damage(a, payload);
    else {
      this.net.send({ t: 'hit', id: a.id, d: dmg, el: H.el, st: stPayload, kb: payload.kb, kd: H.kbDir, pl: H.pull, c: res.consume });
      a.hp -= dmg; // predicted; corrected by snapshots
      if (willKill) a.hp = Math.max(1, a.hp);
    }
  }

  // host: called when an actor dies
  onActorKilled(a, killer, el) {
    if (a.faction !== 'enemy') return;
    this.stats.kills++;
    // drops
    const share = this.director.partyShare(); // (a party meets more foes; everyone collects every coin)
    const gold = Math.floor((a.def.gold ?? 1) * (a.elite ? 4 : 1) * (1 + this.floorIndex * 0.2) * 0.85 * this.encounters.goldMult(a) * share + Math.random()); // (rounded at random: cheap foes still pay on average)
    if (gold > 0) this.spawnDrop('gold', a.pos, gold);
    if (Math.random() < (a.elite ? 1 : a.boss ? 0 : 0.1 * (this.difficulty.orbChance ?? 1))) this.spawnDrop('health', a.pos, 18 + this.floorIndex * 4);
    if (!a.boss && !a.def.hoarder && Math.random() < (a.elite ? 0.35 : (a.def.cost ?? 1) >= 8 ? 0.06 : 0.012) * share) this.spawnDrop('item', a.pos, randomItem());
    // a caught Hoarder bursts: a fountain of gold and an item for everyone
    if (a.def.hoarder) {
      this.spawnDrop('gold', a.pos, 60 + this.floorIndex * 30);
      this.spawnDrop('gold', a.pos, 30 + this.floorIndex * 15);
      this.spawnDrop('item', a.pos, randomItem());
      this.net?.broadcast({ t: 'hoard', k: 'caught', id: a.id });
      this.hoarderNews('caught', a);
    }
    // kill credit
    if (killer === this.player.id) this.onLocalKill(a);
    else if (killer) this.net?.sendTo(killer, { t: 'kc', id: a.id, el, x: a.pos.x, z: a.pos.z, hx: a.deathMask & ST.hex ? 1 : 0, b: a.deathMask & ST.burn ? 1 : 0, m: a.deathMask });
    if (a.boss) this.onBossKilled(a);
    this.encounters.onKilled(a);
  }

  // mask: the statuses the foe died with (actors.kill clears them first)
  onLocalKill(a, hexed, burning, mask = a?.deathMask ?? 0) {
    const p = this.player;
    p.onDealtDamage(0, true);
    this._streakKill(p);
    this.events.emit('kill', a);
    this.relics?.onKill(a, mask);
    if (p.stats.hexKill && (hexed ?? (mask & ST.hex))) {
      p.heal(5);
      for (const s in p.cds) if (p.cds[s] > 0) p.cds[s] = Math.max(0, p.cds[s] - 1);
    }
    // pyromancer: burning enemies explode
    if (p.stats.burnExplode && (burning ?? (mask & ST.burn)) && a) {
      const c = new THREE.Vector3(a.pos.x, a.pos.y + 1, a.pos.z);
      this.vfx.explosion(c, 'fire', 2.5);
      this.audio?.play('explosion', { pos: c, volume: 0.7 });
      this.spells.damageArea(c, 3, { dmg: 18, el: 'fire', st: { burn: [3, 4] }, src: p.id, noReact: true, tag: 'reaction' });
    }
    if (p.stats.raiseChance && a && Math.random() < p.stats.raiseChance && !a.boss) this.requestSummon('skeletonMinion', a.pos.clone(), 10, p.id);
  }

  // Carnage: kills landed within 1.6 s of each other chain into a streak, and its
  // tiers are called out under the crosshair, each paying a little gold and ultimate
  _streakKill(p) {
    const t = this.time;
    this._streakN = t - (this._streakT ?? -9) < 1.6 ? (this._streakN ?? 0) + 1 : 1;
    this._streakT = t;
    const tier = STREAKS.find((s) => s.n === this._streakN) ?? (this._streakN > 12 && this._streakN % 4 === 0 ? STREAKS[STREAKS.length - 1] : null);
    if (!tier) return;
    // each tier pays its gold once a streak; past 12 the callouts go on for ultimate only, so a
    // packed room (a full party's worth of foes) can't print gold
    const gold = this._streakN > 12 ? 0 : Math.round(tier.gold * (1 + 0.5 * this.floorIndex) * (this.difficulty.goldMult ?? 1));
    p.gold += gold; this.stats.gold += gold;
    p.ult = Math.min(100, p.ult + tier.ult);
    this.ui?.streak(this._streakN > 12 ? `${tier.name} ×${this._streakN}` : tier.name, gold ? `+${gold} gold` : `+${tier.ult}% ultimate`, tier.color);
    this.audio?.play(this._streakN >= 8 ? 'level_up' : 'ui_click', { volume: this._streakN >= 8 ? 0.45 : 0.6 });
  }

  onDotTick(a, dot) {
    const src = a.lastHitBy;
    const pos = new THREE.Vector3(a.pos.x, a.pos.y + a.height * 0.8, a.pos.z);
    if (src === this.player.id) this.ui?.damageNumber(pos, Math.round(dot), a.st.burn?.t > 0 ? 'fire' : a.st.poison?.t > 0 ? 'poison' : 'blood', false, true, a.id);
    else if (src) this.net?.sendTo(src, { t: 'dn', id: a.id, d: Math.round(dot) });
    if (src === this.player.id) { this.player.onDealtDamage(dot, false, a, 'dot'); this.stats.damage += dot; }
  }

  // ======================================================================
  // hazards (enemy attacks resolved by each victim locally)
  // ======================================================================
  broadcastHazard(h) {
    this.net?.broadcast({ t: 'hz', h });
    this.addHazard(h);
  }

  // a danger zone's colour by element (k dims it for lesser warnings);
  // the high-contrast setting draws every danger zone in one bright yellow, whatever its element
  teleColor(el, k = 1) {
    if (this.contrastTele) return [1.7, 1.45, 0.15];
    const c = el === 'enemyGreen' || el === 'poison' ? [1.0, 2.2, 0.2] : el === 'enemyPurple' || el === 'arcane' || el === 'necrotic' ? [1.6, 0.3, 2.6] : el === 'holy' ? [2.4, 1.9, 0.6] : el === 'frost' ? [0.6, 1.6, 2.6] : [2.6, 0.35, 0.1];
    return [c[0] * 0.55 * k, c[1] * 0.55 * k, c[2] * 0.55 * k];
  }

  addHazard(h) {
    const hz = { ...h, t: 0, done: false, hitLocal: false };
    hz.color = this.teleColor(h.el);
    if (h.vis && h.shape !== 'arc' && h.shape !== 'wave' && h.shape !== 'los') {
      const dur = h.teleDur ?? h.delay;
      const color = hz.color;
      let tele = null;
      if (h.shape === 'circle') tele = this.vfx.telegraph({ x: h.x, y: h.y ?? this.groundY(h.x, h.z), z: h.z }, { shape: 'circle', radius: h.r, dur, color });
      else if (h.shape === 'rect') tele = this.vfx.telegraph({ x: h.x, y: h.y ?? 0, z: h.z }, { shape: 'rect', width: h.w, length: h.len, rot: h.rot, dur, color });
      else if (h.shape === 'cone') tele = this.vfx.telegraph({ x: h.x, y: h.y ?? 0, z: h.z }, { shape: 'cone', radius: h.r, angle: h.angle, rot: h.rot, dur, color });
      if (tele) hz.tele = this.vfx.active[this.vfx.active.length - 1];
    }
    if (h.shape === 'los') {
      hz.beamFx = true;
      this.audio?.play('telegraph', { volume: 1 });
    }
    // falling object visuals
    if (h.blade || h.boulder || h.meteor) {
      const el = h.meteor ? 'enemyFire' : h.boulder ? 'earth' : 'physical';
      const start = new THREE.Vector3(h.x, this.level.ceilAt(h.x, h.z) - 0.5 > 30 ? 25 : this.level.ceilAt(h.x, h.z) - 0.5, h.z);
      const fallT = Math.min(h.delay, 0.6);
      this.spells.after(Math.max(0, h.delay - fallT), () => {
        this.spells.spawn({ local: false, faction: 'neutral', el, pos: start, vel: new THREE.Vector3(0, -(start.y - (h.y ?? 0)) / fallT, 0), radius: 0.3, life: fallT + 0.1, core: h.blade ? 0.2 : 1.2, mesh: h.boulder || h.meteor ? 'meteor' : 'blade', meshScale: h.blade ? 2 : 1, light: h.meteor ? 15 : 0, trail: 1.5, noWall: true });
      });
    }
    this.hazards.push(hz);
  }

  // Killing an enemy mid-windup interrupts its attack: the pending hazard is
  // dropped and its telegraph fades. Runs on every peer (from the death event).
  cancelHazardsFrom(id, pos) {
    let n = 0;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (h.src !== id || h.cancelled || h.t >= (h.delay ?? 0)) continue;
      if (h.tele && this.vfx.active.includes(h.tele)) h.tele.t = Math.max(h.tele.t, h.tele.life - 0.15);
      // (from inside _updateHazards - a landing hazard's blow, parried or reflected, killed its caster - it
      // is only marked: splicing under that loop shifted its indices, and it read past the end)
      if (this._hzBusy) h.cancelled = true; else this.hazards.splice(i, 1);
      n++;
    }
    if (n && pos) this.ui?.floatText(pos, 'INTERRUPTED', '#e8c070');
    return n;
  }

  // the pending zone the player stands in that lands soonest: { k: 0..1 of its wind-up, c: colour }, or null
  _inDanger(p) {
    if (!p.alive || p.downed || p.dead) return null;
    let best = null;
    for (const h of this.hazards) {
      if (!h.vis || h.cancelled || h.t >= (h.delay ?? 0) || !h.delay) continue;
      const dx = p.pos.x - h.x, dz = p.pos.z - h.z, d = Math.hypot(dx, dz), R = 0.4;
      let inside = false;
      if (h.shape === 'circle') inside = d <= h.r + R;
      else if (h.shape === 'cone' || h.shape === 'arc') {
        if (d <= h.r + R) { let diff = Math.abs(Math.atan2(dx, dz) - h.rot) % (Math.PI * 2); if (diff > Math.PI) diff = Math.PI * 2 - diff; inside = diff <= h.angle + 0.15 || d < 1; }
      } else if (h.shape === 'rect') {
        const fx = Math.sin(h.rot), fz = Math.cos(h.rot);
        const along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
        inside = along >= -0.5 && along <= h.len + 0.5 && side <= h.w / 2 + R;
      }
      if (!inside) continue;
      const k = h.t / h.delay;
      if (!best || k > best.k) best = { k, c: h.color };
    }
    return best;
  }

  // an enemy shot about to hit you from outside the view marks the screen edge it's coming from
  _warnIncoming() {
    const p = this.player;
    if (!p.alive || p.downed || p.dead) return;
    const cam = this.renderer.camera, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    for (const pr of this.spells.projectiles) {
      if (pr.warned || pr.dead || !(pr.faction === 'enemy' || pr.el.startsWith('enemy'))) continue;
      const rx = p.pos.x - pr.pos.x, ry = p.pos.y + 1 - pr.pos.y, rz = p.pos.z - pr.pos.z;
      const v2 = pr.vel.x * pr.vel.x + pr.vel.y * pr.vel.y + pr.vel.z * pr.vel.z;
      if (v2 < 1) continue;
      const tc = (rx * pr.vel.x + ry * pr.vel.y + rz * pr.vel.z) / v2; // time of closest approach
      if (tc < 0 || tc > 0.9) continue;
      const mx = rx - pr.vel.x * tc, my = ry - pr.vel.y * tc, mz = rz - pr.vel.z * tc;
      if (mx * mx + my * my + mz * mz > 1.3 * 1.3) continue;
      // in view? (roughly the horizontal half-angle of the camera)
      const dx = pr.pos.x - p.pos.x, dz = pr.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
      pr.warned = true;
      if ((fx * dx + fz * dz) / d > Math.cos(THREE.MathUtils.degToRad(cam.fov * cam.aspect * 0.45))) continue;
      this.ui?.damageDirection(pr.pos);
    }
  }

  _updateHazards(dt) {
    this._warnIncoming();
    this._hzBusy = true;
    try { this._stepHazards(dt); } finally { this._hzBusy = false; }
  }

  _stepHazards(dt) {
    const p = this.player;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (!h) continue;
      if (h.cancelled) { this.hazards.splice(i, 1); continue; }
      h.t += dt;
      if (h.shape === 'wave') {
        if (h.t < (h.delay ?? 0)) continue;
        const r = h.r + h.speed * (h.t - (h.delay ?? 0));
        // the wave as it is: a glowing wall standing exactly on the hit radius, bright all
        // the way out (it used to be a faint ring that eased ahead of the real one and faded)
        if (!h.wall) h.wall = this.vfx.waveWall({ x: h.x, y: h.y ?? 0, z: h.z }, h.color.map((c) => c * 1.7), 0.7);
        h.wall.r = r;
        h.wall.a = Math.min(1, (h.t - (h.delay ?? 0)) * 8) * Math.min(1, (h.maxR - r) / 1.5);
        if (Math.random() < 0.6) {
          const a = Math.random() * Math.PI * 2;
          this.vfx.P.glow({ x: h.x + Math.cos(a) * r, y: (h.y ?? 0) + 0.3, z: h.z + Math.sin(a) * r, vy: 2.5, r: h.color[0], g: h.color[1], b: h.color[2], life: 0.4, size: 0.35, sprite: SPR.GLOW });
        }
        if (!h.hitLocal && p.alive && !p.downed && !p.dead) {
          const d = Math.hypot(p.pos.x - h.x, p.pos.z - h.z);
          const airborne = p.pos.y - this.groundY(p.pos.x, p.pos.z) > 0.45;
          if (Math.abs(d - r) < 0.7 && !airborne && this.collision.los(h.x, (h.y ?? 0) + 1.0, h.z, p.pos.x, p.pos.y + 1.0, p.pos.z)) {
            h.hitLocal = true;
            p.takeDamage(h.dmg, h.el, new THREE.Vector3(h.x, 0, h.z), { by: h.src ? this.actors.byId.get(h.src) : null, move: h.mv, cause: h.cause });
            this._knock(p, h.x, h.z, h.kb ?? 6);
          }
        }
        if (r >= h.maxR) { h.wall?.end(); this.hazards.splice(i, 1); }
        continue;
      }
      if (h.shape === 'los') {
        // charging judgment: darken & glow
        const k = Math.min(1, h.t / h.delay);
        this.lights.request(new THREE.Vector3(h.x, h.y, h.z), 0xff40ff, 40 * k, 30);
        if (Math.random() < 0.6) this.vfx.P.glow({ x: h.x + rand(-6, 6), y: h.y + rand(-2, 4), z: h.z + rand(-6, 6), vx: 0, r: 2, g: 0.3, b: 2.6, life: 0.6, size: 0.3, sprite: SPR.WISP });
      }
      if (h.t < h.delay) continue;
      // resolve
      this._resolveHazard(h);
      this.hazards.splice(i, 1);
    }
  }

  _hazardReaches(h, to, gy) {
    let ox = h.x, oz = h.z;
    if (h.shape === 'rect') {
      const fx = Math.sin(h.rot), fz = Math.cos(h.rot);
      const t = Math.max(0, Math.min(h.len, (to.x - h.x) * fx + (to.z - h.z) * fz));
      ox = h.x + fx * t; oz = h.z + fz * t;
      if (!this.collision.los(h.x, gy + 1.0, h.z, ox, gy + 1.0, oz)) return false; // (the lane itself runs into the wall)
    }
    return this.collision.los(ox, gy + 1.0, oz, to.x, to.y + 1.0, to.z);
  }

  _resolveHazard(h) {
    const p = this.player;
    const gy = h.y ?? this.groundY(h.x, h.z);
    const center = new THREE.Vector3(h.x, gy + 0.6, h.z);
    // visuals
    if (h.shape === 'circle' && h.vis) {
      const el = h.fx ?? h.el;
      this.vfx.explosion(center, el === 'enemy' ? 'enemyFire' : el, h.r * 0.9, { groundY: gy, shakeScale: 0.6 });
      this.audio?.play(h.r > 3 ? 'explosion_big' : 'explosion', { pos: center, volume: 0.7 });
      if (h.pool) this.spawnPoolLocal(center, h.pool[0], h.pool[1], h.pool[2], h.el);
    } else if (h.shape === 'rect' && h.vis) {
      const f = new THREE.Vector3(Math.sin(h.rot), 0, Math.cos(h.rot));
      if (h.beam) {
        const b = this.vfx.beam({ element: h.el === 'enemyPurple' ? 'enemyPurple' : 'arcane', width: h.w * 0.35 });
        b.update(new THREE.Vector3(h.x, gy + 1.2, h.z), new THREE.Vector3(h.x + f.x * h.len, gy + 1.2, h.z + f.z * h.len), h.w * 0.35);
        b.release(0.35);
        this.audio?.play('cast_lightning_big', { pos: center, volume: 0.6 });
      } else {
        for (let k = 0; k < h.len; k += 2) this.vfx.smoke(new THREE.Vector3(h.x + f.x * k, gy + 0.3, h.z + f.z * k), { count: 1, size: 0.9, color: [0.3, 0.25, 0.2], alpha: 0.35 });
      }
    } else if (h.shape === 'cone' && h.vis) {
      const el = h.el;
      for (let k = 0; k < 30; k++) {
        const a = h.rot + rand(-h.angle, h.angle), r = rand(1, h.r);
        const fx = fxOf(el === 'physical' ? 'physical' : el);
        this.vfx.P.glow({ x: h.x + Math.sin(a) * r, y: gy + rand(0.3, 1.5), z: h.z + Math.cos(a) * r, vx: Math.sin(a) * 3, vz: Math.cos(a) * 3, r: fx.mid[0], g: fx.mid[1], b: fx.mid[2], life: 0.35, size: 0.3, sprite: el === 'enemyFire' ? SPR.FLAME : SPR.SPARK, stretch: 0.03 });
      }
    } else if (h.shape === 'los') {
      this.vfx.explosion(new THREE.Vector3(h.x, h.y, h.z), 'enemyPurple', 12);
      this.screenTint([1.6, 0.6, 1.8], 0.6);
      this.vfx.addShake(0.8);
      this.audio?.play('explosion_big');
    }
    // a trap's burst burns the foes standing in it too (host)
    if (this.isHost && h.trap && h.shape === 'circle') {
      for (const a of [...this.actors.hostiles()]) {
        const dx = a.pos.x - h.x, dz = a.pos.z - h.z, d = Math.hypot(dx, dz) || 1;
        if (a.dormant || d > h.r + a.radius || a.pos.y > gy + 2) continue;
        this.actors.damage(a, { dmg: h.trap, el: h.el === 'enemyGreen' ? 'poison' : h.el === 'enemyPurple' ? 'arcane' : 'fire', kb: 6, kbDir: [dx / d, dz / d] });
      }
    }
    // host: enemy attacks also hit allied summons
    if (this.isHost && h.shape !== 'los' && h.shape !== 'wave') {
      for (const al of this.actors.allies()) {
        const dx = al.pos.x - h.x, dz = al.pos.z - h.z;
        const d = Math.hypot(dx, dz);
        let inside = false;
        if (h.shape === 'circle') inside = d <= h.r + al.radius;
        else if (h.shape === 'arc' || h.shape === 'cone') {
          if (d <= h.r + al.radius) { let diff = Math.abs(Math.atan2(dx, dz) - h.rot) % (Math.PI * 2); if (diff > Math.PI) diff = Math.PI * 2 - diff; inside = diff <= h.angle + 0.2 || d < 1; }
        } else if (h.shape === 'rect') {
          const fx = Math.sin(h.rot), fz = Math.cos(h.rot);
          const along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
          inside = along >= -0.5 && along <= h.len + 0.5 && side <= h.w / 2 + al.radius;
        }
        if (inside && this._hazardReaches(h, al.pos, gy)) this.actors.damage(al, { dmg: h.dmg, el: h.el });
      }
    }
    // does it hit me?
    if (!p.alive || p.downed || p.dead) return;
    let hit = false;
    const dx = p.pos.x - h.x, dz = p.pos.z - h.z;
    const d = Math.hypot(dx, dz);
    switch (h.shape) {
      case 'circle': hit = d <= h.r + 0.35; break;
      case 'arc': case 'cone': {
        if (d <= h.r + 0.35) {
          const ang = Math.atan2(dx, dz);
          let diff = Math.abs(ang - h.rot) % (Math.PI * 2);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          hit = diff <= h.angle + 0.15 || d < 0.9;
        }
        break;
      }
      case 'rect': {
        const fx = Math.sin(h.rot), fz = Math.cos(h.rot);
        const along = dx * fx + dz * fz;
        const side = Math.abs(dx * fz - dz * fx);
        hit = along >= -0.5 && along <= h.len + 0.5 && side <= h.w / 2 + 0.35;
        break;
      }
      case 'los': {
        const eye = p.eye;
        hit = this.collision.los(h.x, h.y, h.z, eye.x, eye.y, eye.z);
        break;
      }
      default: break;
    }
    // walls stop blows: a swing, a breath, a blast or a charge lane reaches you only
    // with a clear line from where it comes (a lane: from its nearest point to you)
    if (hit && h.shape !== 'los' && !this._hazardReaches(h, p.pos, gy)) hit = false;
    // vertical tolerance (jumping over low swings doesn't count for circles)
    if (hit && h.shape !== 'los' && p.pos.y - (h.y ?? gy) > 2.5) hit = false;
    if (hit) {
      const attacker = h.src ? this.actors.byId.get(h.src) : null;
      const taken = p.takeDamage(h.dmg, h.el, new THREE.Vector3(h.x, 0, h.z), { attacker, move: h.mv, cause: h.cause });
      if (taken > 0) {
        if (h.kb) this._knock(p, h.x, h.z, h.kb);
        if (h.st?.stun) { p.stunT = h.st.stun; }
        if (attacker && hasAffix(attacker, 'vampiric')) {
          if (this.isHost) attacker.hp = Math.min(attacker.maxHp, attacker.hp + taken * 0.5);
          else this.net?.send({ t: 'vamp', id: attacker.id, d: taken });
        }
      }
    }
  }

  _knock(p, x, z, force) {
    const dx = p.pos.x - x, dz = p.pos.z - z;
    const d = Math.hypot(dx, dz) || 1;
    p.vel.x += dx / d * force * 0.8;
    p.vel.z += dz / d * force * 0.8;
    p.vel.y = Math.max(p.vel.y, force * 0.25);
    p.grounded = false;
  }

  // enemy projectiles (spawned identically on all peers)
  broadcastEnemyProjectile(e) {
    // (the Abyss's laws quicken straight shots; a lob keeps the arc it was aimed with)
    const k = this.difficulty.projSpeed ?? 1;
    if (k !== 1 && !e.gravity) { e.vx *= k; e.vy *= k; e.vz *= k; }
    this.net?.broadcast({ t: 'ep', e });
    this.spawnEnemyProjectile(e);
  }
  spawnEnemyProjectile(e) {
    const el = e.el ?? 'enemy';
    const pos = new THREE.Vector3(e.x, e.y, e.z);
    this.spells.spawn({
      local: true, faction: 'enemy', el, pos, vel: new THREE.Vector3(e.vx, e.vy, e.vz), radius: e.mesh === 'arrow' ? 0.15 : 0.3,
      life: e.gravity ? 4 : 3.5, gravity: e.gravity ?? 0, core: e.mesh === 'arrow' ? 0 : 0.7, mesh: e.mesh, light: e.mesh === 'arrow' ? 0 : 5, trail: e.mesh === 'arrow' ? 0.2 : 1,
      homing: e.homing ?? 0, homeOn: e.tg, hit: { dmg: e.dmg, st: e.st, by: e.src != null ? this.actors.byId.get(e.src) : null, move: e.mv }, // (by, not attacker: thorns answers only blows in reach)
      aoe: e.aoe ? { radius: e.aoe, dmg: e.dmg * 0.6, el } : null,
      onExpire: e.pool ? (pr, p) => this.spawnPoolLocal(p, e.pool[0], e.pool[1], e.pool[2], el) : null,
    });
    // a lob falls from above, often from out of view: mark where it will come down
    if (e.gravity) {
      const g = e.gravity;
      let x = e.x, z = e.z, t = 0;
      for (let i = 0; i < 3; i++) {
        const gy = this.groundY(x, z);
        t = (e.vy + Math.sqrt(Math.max(0, e.vy * e.vy + 2 * g * (e.y - gy)))) / g;
        x = e.x + e.vx * t; z = e.z + e.vz * t;
      }
      if (t > 0.25 && t < 4) this.vfx.telegraph({ x, y: this.groundY(x, z), z }, { shape: 'circle', radius: Math.max(0.9, e.pool?.[0] ?? 0, e.aoe ?? 0), dur: t, color: this.teleColor(el, 0.8) });
    }
  }
  enemyAreaHit(pos, radius, dmg, el, st) {
    const p = this.player;
    if (!p.alive || p.downed) return;
    if (p.pos.distanceTo(pos) <= radius + 0.4) p.takeDamage(dmg, el, pos);
    void st;
  }

  // lingering poison/fire pools (each peer damages only itself)
  spawnPool(pos, radius, dur, dps, el) {
    this.net?.broadcast({ t: 'pool', x: pos.x, z: pos.z, r: radius, d: dur, p: dps, el });
    this.spawnPoolLocal(pos, radius, dur, dps, el);
  }
  spawnPoolLocal(pos, radius, dur, dps, el = 'enemyGreen') {
    const gy = this.groundY(pos.x, pos.z);
    this.vfx.decal(new THREE.Vector3(pos.x, gy, pos.z), el === 'enemyPurple' ? 'scorch' : 'slime', radius * 2.2, dur + 1, el === 'enemyPurple' ? 0x6020a0 : undefined);
    this.pools.push({ x: pos.x, y: gy, z: pos.z, r: radius, t: dur, dps, el, acc: 0 });
  }
  _updatePools(dt) {
    const p = this.player;
    // overlapping pools don't stack: the strongest one you stand in ticks every 0.5 s
    this._poolT = (this._poolT ?? 0) + dt;
    let worst = 0, worstEl = null;
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const pl = this.pools[i];
      pl.t -= dt;
      if (pl.t <= 0) { this.pools.splice(i, 1); continue; }
      const fx = fxOf(pl.el);
      if (Math.random() < dt * pl.r * 3) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * pl.r;
        this.vfx.P.glow({ x: pl.x + Math.cos(a) * r, y: pl.y + 0.05, z: pl.z + Math.sin(a) * r, vy: 0.5, r: fx.mid[0] * 0.6, g: fx.mid[1] * 0.6, b: fx.mid[2] * 0.6, life: 1, size: 0.2, sprite: SPR.BUBBLE });
      }
      if (Math.hypot(p.pos.x - pl.x, p.pos.z - pl.z) < pl.r && p.pos.y - pl.y < 1 && pl.dps > worst) { worst = pl.dps; worstEl = pl.el; }
    }
    if (this._poolT >= 0.5) {
      if (worst > 0 && p.alive && !p.downed) { p.takeDamage(worst * 0.5, worstEl, null); this._poolT = 0; }
      else this._poolT = 0.5;
    }
  }

  // ======================================================================
  // drops & pickups
  // ======================================================================
  spawnDrop(type, pos, value, id) {
    const did = id ?? (this.isHost ? this.dropId++ : -1);
    if (type === 'gold' && id === undefined) value = Math.round(value * (this.difficulty?.goldMult ?? 1)); // (heat pays: +5% gold a point)
    if (this.isHost && id === undefined) this.net?.broadcast({ t: 'drop', id: did, ty: type, x: pos.x, y: pos.y, z: pos.z, v: value });
    const count = type === 'gold' ? Math.min(8, Math.ceil(value / 3)) : 1;
    for (let i = 0; i < count; i++) {
      const mesh = makeDropMesh(type, value);
      const d = {
        id: did, sub: i, type, value: type === 'gold' ? value / count : value,
        pos: new THREE.Vector3(pos.x, pos.y + 1, pos.z),
        vel: new THREE.Vector3(rand(-3, 3), rand(4, 7), rand(-3, 3)),
        mesh, t: 0,
      };
      mesh.position.copy(d.pos);
      this.scene.add(mesh);
      this.drops.push(d);
    }
  }
  _updateDrops(dt) {
    const p = this.player;
    const eye = p.pos.clone().add(_v.set(0, 1, 0));
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      const gy = this.groundY(d.pos.x, d.pos.z) + 0.25;
      const dist = d.pos.distanceTo(eye);
      const magnet = d.t > 0.6 && p.alive && !p.downed && (d.type === 'gold' ? dist < 6 : d.type === 'item' ? dist < 1.9 && !p.item : dist < 5 && p.hp < p.maxHp);
      if (magnet) {
        const dir = eye.clone().sub(d.pos).normalize();
        d.vel.lerp(dir.multiplyScalar(14), Math.min(1, dt * 6));
      } else {
        d.vel.y -= 18 * dt;
        d.vel.x *= Math.exp(-dt * 2); d.vel.z *= Math.exp(-dt * 2);
      }
      d.pos.addScaledVector(d.vel, dt);
      if (!magnet && d.pos.y < gy) { d.pos.y = gy; d.vel.y = Math.abs(d.vel.y) * 0.35; }
      d.mesh.position.copy(d.pos);
      d.mesh.rotation.y += dt * (d.type === 'item' ? 1.5 : 4);
      if (d.type === 'health') this.lights.request(d.pos, 0xff3040, 2, 3);
      else if (d.type === 'item') { d.mesh.position.y += 0.25 + Math.sin(d.t * 2.4) * 0.08; this.lights.request(d.pos, ITEMS[d.value]?.light ?? 0xffd080, 1.2, 3); }
      if (dist < 0.9 && magnet) {
        this._collect(d);
        this.scene.remove(d.mesh);
        this.drops.splice(i, 1);
      } else if (d.t > 60 && d.type !== 'item') { this.scene.remove(d.mesh); this.drops.splice(i, 1); }
    }
  }
  _collect(d) {
    const p = this.player;
    if (d.type === 'gold') {
      // gold is shared: every player collects their own coins (all coins drop for everyone)
      const v = d.value * p.stats.goldMult;
      p.gold += v;
      this.stats.gold += v;
      this.audio?.play('pickup_gold', { volume: 0.5 });
      this.ui?.goldPulse();
      this.relics?.onGold();
    } else if (d.type === 'item') {
      this.giveItem(d.value);
    } else if (d.type === 'health') {
      p.heal(d.value);
      this.healPulse = 0.6;
      this.audio?.play('pickup_health');
      if (d.id > 0) this.net?.broadcastOrSend({ t: 'pick', id: d.id });
    }
  }
  _aimOnWeak(o, p) {
    if (!p.alive || p.downed || p.dead || this.cinematic || this.menuMode) return false; // (dead: the camera is a spectator's)
    const cp = Math.cos(p.pitch);
    const a = this.spells.firstActor(o.x, o.y, o.z, -Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp, 60, 0.05, _aim);
    return !!a && isWeak(a, _aim.x, _aim.y, _aim.z); // (bosses too: their heads count as anyone's)
  }
  // An interrupt (a foe killed or staggered mid-wind-up) pays the wizard who did it: ult charge
  // and a call (host decides; a client's credit goes to it as 'intr')
  creditInterrupt(a, src) {
    if (src === this.player.id) this.onInterrupt(a.pos.x, a.pos.y + a.height + 0.6, a.pos.z);
    else if (src && this.remotes.has(src)) this.net?.sendTo(src, { t: 'intr', x: a.pos.x, y: a.pos.y + a.height + 0.6, z: a.pos.z });
  }
  onInterrupt(x, y, z) {
    const p = this.player;
    p.ult = Math.min(100, p.ult + 5);
    this.ui?.floatText(new THREE.Vector3(x, y + 0.35, z), 'INTERRUPT +5% ULT', '#ffd870');
    if (this.time - (this._intrSndT ?? 0) > 0.15) { this._intrSndT = this.time; this.audio?.play('crit', { volume: 0.5 }); }
    this.events.emit('interrupt');
  }
  // the Hoarder's comings and goings, called out on every peer
  hoarderNews(kind, a) {
    if (kind === 'spawn') { this.ui?.toast('A Hoarder! Catch it before it escapes', '#ffc040'); this.audio?.play('pickup_gold', { volume: 0.9 }); }
    else if (kind === 'caught') { this.events.emit('hoarder'); this.ui?.banner('HOARD BROKEN', 'Gold for everyone', '#ffc040', 2.5); this.audio?.play('chest_open'); if (a) this.vfx.burst(new THREE.Vector3(a.pos.x, a.pos.y + 0.6, a.pos.z), { count: 50, speed: 7, upward: 2, life: 1.4, size: 0.09, sprite: SPR.SPARK, color: [2.8, 2, 0.6], gravity: 10 }); }
    else if (kind === 'escape') this.ui?.toast('The Hoarder got away...', '#a08850');
  }
  // ---- consumable items (items.js): one slot, the item key
  // take an item into the slot; one already held is left on the ground at your feet
  giveItem(id, quiet = false) {
    const p = this.player, def = ITEMS[id];
    if (!def) return;
    if (p.item && p.item !== id) this.spawnDrop('item', p.pos, p.item, -1);
    p.item = id;
    if (!quiet) { this.ui?.toast(`${def.name} — [${keyOf('item')}] to use`, def.color); this.audio?.play('pickup_essence'); }
    this.events.emit('itemGot', id);
  }
  useItem() {
    const p = this.player, id = p.item, def = ITEMS[id];
    if (!def || !p.alive || p.downed || p.dead || this.ui?.modalOpen) { if (!def) this.audio?.play('ui_error', { volume: 0.4 }); return; }
    // (the Bottomless Satchel: a chance it isn't used up, more with each ascension star)
    const sat = p.relics.find((r) => r.def.id === 'satchel');
    if (sat && Math.random() < 0.35 * (1 + 0.5 * (sat.stars ?? 0))) { const t = p.eye.add(p.forward().multiplyScalar(2)); this.ui?.floatText(t, 'KEPT', def.color); }
    else p.item = null;
    const e = p.eye, f = p.forward();
    const at = { x: e.x + f.x * 0.6, y: e.y - 0.25, z: e.z + f.z * 0.6, dx: f.x, dy: f.y + 0.15, dz: f.z };
    this.spells.slot = 'item';
    def.use(this, p, itemK(this), at);
    this.spells.slot = null;
    def.show(this, id === 'flask' ? at : { x: p.pos.x, y: p.pos.y, z: p.pos.z });
    this.net?.broadcast({ t: 'itemfx', i: id, ...(id === 'flask' ? at : { x: p.pos.x, y: p.pos.y, z: p.pos.z }) });
    this.vfx.addFovKick?.(2);
    this.events.emit('itemUsed', id);
  }
  removeDrop(id) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      if (this.drops[i].id === id && this.drops[i].type === 'health') { this.scene.remove(this.drops[i].mesh); this.drops.splice(i, 1); }
    }
  }

  // ======================================================================
  // healing & support between players
  // ======================================================================
  healPlayersInRadius(pos, r, amount, srcId, includeSelf = true) {
    for (const pl of this.allPlayers()) {
      if (pl.dead || pl.downed) continue;
      if (Math.hypot(pl.pos.x - pos.x, pl.pos.z - pos.z) > r) continue;
      if (pl === this.player) { if (includeSelf) { pl.heal(amount); this.healPulse = 0.4; } }
      else this.net?.sendTo(pl.id, { t: 'heal', a: amount, s: srcId });
      this.vfx.burst(new THREE.Vector3(pl.pos.x, pl.pos.y + 1, pl.pos.z), { element: 'holy', count: 6, speed: 1.5, upward: 1, life: 0.8, size: 0.1, sprite: SPR.STAR });
    }
  }
  healPlayersOnRay(o, d, len, amount, srcId) {
    for (const pl of this.remotes.values()) {
      if (pl.dead || pl.downed) continue;
      const rel = pl.pos.clone().add(_v.set(0, 1, 0)).sub(o);
      const t = rel.dot(d);
      if (t < 0 || t > len) continue;
      const perp = rel.clone().addScaledVector(d, -t).length();
      if (perp < 0.9) this.net?.sendTo(pl.id, { t: 'heal', a: amount, s: srcId });
    }
  }
  shieldPlayersInRadius(pos, r, amount, dur) {
    for (const pl of this.allPlayers()) {
      if (pl.dead || pl.downed) continue;
      if (Math.hypot(pl.pos.x - pos.x, pl.pos.z - pos.z) > r) continue;
      if (pl === this.player) pl.addShield(amount, dur);
      else this.net?.sendTo(pl.id, { t: 'shield', a: amount, d: dur });
      this.vfx.shell(new THREE.Vector3(pl.pos.x, pl.pos.y + 1, pl.pos.z), { element: 'holy', radius: 1.3, life: 0.6 });
    }
  }
  reviveInRadius(pos, r) {
    for (const pl of this.remotes.values()) {
      if (!(pl.downed || pl.dead)) continue;
      if (Math.hypot(pl.pos.x - pos.x, pl.pos.z - pos.z) > r) continue;
      this.net?.sendTo(pl.id, { t: 'revive', f: 0.5 });
    }
  }
  auraRegenFor(pl) {
    let r = 0;
    for (const o of this.allPlayers()) {
      if (o.dead || o.downed) continue;
      const aura = o === this.player ? o.stats.aura : (o.cls?.stats?.aura ?? 0);
      if (!aura) continue;
      if (o === pl || o.pos.distanceTo(pl.pos) < 12) r += aura;
    }
    return r;
  }

  requestSummon(type, pos, life, owner) {
    if (this.isHost) {
      const def = this.actors;
      const a = def.spawn(type, pos.x, pos.z, { life, owner, hp: undefined, faction: 'ally', yaw: this.player.yaw + Math.PI });
      a.maxHp *= 1 + this.floorIndex * 0.5; a.hp = a.maxHp;
      a.dmg *= 1 + this.floorIndex * 0.45;
    } else this.net?.send({ t: 'summon', ty: type, x: pos.x, z: pos.z, l: life, o: owner });
  }

  requestTeleport(pid, x, z) {
    if (pid === this.player.id) {
      this.player.pos.set(x, this.groundY(x, z), z);
      this.player.history.length = 0;
      this.vfx.explosion(this.player.eye, 'arcane', 1.5);
      this.ui?.toast('You are drawn into the fray!');
    } else this.net?.sendTo(pid, { t: 'tp', x, z });
  }

  // ======================================================================
  // rooms, doors, rewards
  // ======================================================================
  setRoomLocked(roomId, locked) {
    const room = this.level.rooms[roomId];
    this.encounters.onLock(room, locked);
    for (const did of room.doors) {
      const door = this.level.doors[did];
      this.built.setDoor(did, locked);
      this.collision.setDoorBlocked(door, locked);
    }
    this.audio?.play(locked ? 'door_close' : 'door_open', { pos: new THREE.Vector3(room.cx, 1, room.cz) });
    this.events.emit('roomLock', room, locked);
    this.fightLock = locked ? room : null;
    if (!locked) this.fightEndT = this.time;
    if (locked && room.type === ROOM.BOSS) this._deadlineStop(); // (the clock stops at the guardian's door)
    if (locked) this.critters?.startle(new THREE.Vector3(room.cx, 1, room.cz), Math.max(room.w, room.h) * T);
    this.relics?.onRoomLock(room, locked);
    if (locked) {
      this.audio?.setMusic(this._mus(room.type === ROOM.BOSS ? 'boss' : 'combat'));
      if (room.type !== ROOM.BOSS && this.encounters.lockBanner(room)) { /* mimic, champion or modifier */ }
      else if (room.type === ROOM.TRIAL) { this.ui?.banner('TRIAL OF SPEED', `Slay them all within ${room.trialLimit ?? 45} seconds`, '#ffcf60'); this.audio?.play('boss_roar', { volume: 0.4 }); }
      else if (room.type === ROOM.ELITE) this.ui?.banner('ELITE CHAMBER', 'A champion bars the way', '#ff9040');
      else if (room.sentriesPlaced) this.ui?.banner('SENTRIES', 'Strike before they rally', '#d08040');
      else if (room.type !== ROOM.BOSS) this.ui?.banner('AMBUSH', 'The doors slam shut', '#d04030');
    }
  }

  // the world runs at k of normal speed, easing back over dur seconds
  slowMo(dur, k) { if (!this.slow || this.slow.k > k) this.slow = { t: 0, dur, k }; }

  onRoomCleared(room) {
    this._dreadCheck(room);
    this.events.emit('roomClear', room);
    this.relics?.onRoomClear(room);
    this.audio?.setMusic(this._mus('explore'));
    this.audio?.play('room_clear');
    // the last kill lands heavy: a breath of slow motion and a warm wash of light
    if (room.type !== ROOM.BOSS) {
      this.slowMo(0.55, 0.22);
      this.screenTint([1.12, 1.06, 0.96], 0.5);
    }
    if (room.type === ROOM.BOSS) return; // handled by boss death
    const enc = this.encounters.onRoomCleared(room); // champion hoards, modifier rewards
    if (enc?.banner) this.ui?.banner(...enc.banner);
    else if (room.type === ROOM.TRIAL) this.ui?.banner(room.trialWon ? 'TRIAL CONQUERED' : 'CHAMBER CLEARED', room.trialWon ? 'An epic tome is yours' : 'Too slow — a lesser reward', room.trialWon ? '#ffcf60' : '#e8c070');
    else this.ui?.banner('CHAMBER CLEARED', room.type === ROOM.ELITE ? 'A relic awaits' : 'Claim your reward', '#e8c070');
    // revive dead teammates at the end of a room
    if (this.player.dead) { this.player.dead = false; this.player.downed = false; this.player.hp = Math.round(this.player.maxHp * 0.3); this.player.spawnAt(room.cx, room.cz, this.player.yaw); this.ui?.toast('You return from beyond the veil'); }
    if (this.player.downed) this.player.revive(0.3);
    else if (this.player.alive && this.player.hp < this.player.maxHp) this.player.heal(this.player.maxHp * 0.1 * (this.difficulty.clearHeal ?? 1)); // a breath of respite between fights
    this.player.downsThisRoom = 0;
    // elite chambers offer a relic instead of a tome (a gold-ringed lectern)
    this.spawnPedestal(room, Math.max(enc?.rarity ?? 0, room.type === ROOM.TRIAL ? (room.trialWon ? 2 : 0) : room.type === ROOM.ELITE ? 3 : 0), room.type === ROOM.ELITE);
    if (this._ctxTips?.sigil) { this._tipQ?.unshift(this._ctxTips.sigil); this._ctxTips.sigil = null; }
    if (this.isHost) {
      const gold = Math.round((10 + this.floorIndex * 6) * (room.type === ROOM.ELITE ? 2.5 : room.type === ROOM.TRIAL && room.trialWon ? 3 : 1) * (enc?.gold ?? 1));
      this.spawnDrop('gold', new THREE.Vector3(room.cx, this.groundY(room.cx, room.cz), room.cz), gold);
    }
  }

  spawnPedestal(room, minRarity, relic = false, dx = 0, dz = 0) {
    minRarity = Math.max(minRarity, this.difficulty.minRarity ?? 0); // (Nightmare: never a Common tome)
    const x = room.cx + dx, z = room.cz + dz;
    const it = makePedestal(this, new THREE.Vector3(x, this.groundY(x, z), z), minRarity);
    if (relic) { it.relic = true; it.label = 'Claim a Relic'; it.minRarity = 1; } // (built gold-ringed, rolls like an elite tome if ever read as one)
    this.interactables.push(it);
  }

  // Boss Rush: every chamber but the boss's is already won and its side rewards
  // are gone; the party starts in the antechamber before the boss, before a row
  // of lecterns (more of them before the first boss, a relic from the second on),
  // whole again. Runs on every peer alike, since every peer builds the same floor.
  _rushFloor(level, index) {
    const boss = level.bossRoom;
    const main = level.rooms.filter((r) => r.main && r !== boss).sort((a, b) => b.order - a.order);
    const ante = main[0] ?? level.startRoom;
    for (const r of level.rooms) if (r !== boss) { r.cleared = true; r.visited = true; }
    this.interactables = this.interactables.filter((it) => {
      const side = it.kind === 'chest' || it.kind === 'shrine' || it.kind === 'shop' || it.kind === 'altar' || it.kind === 'gambler';
      if (side) it.dispose?.();
      return !side;
    });
    // (a pillar or statue may stand where a lectern would: nudge each to open floor in the room)
    const free = (dx, dz) => {
      for (let k = 0; k < 24; k++) {
        const a = k * 2.4, r = k === 0 ? 0 : 0.8 + k * 0.25;
        const x = ante.cx + dx + Math.cos(a) * r, z = ante.cz + dz + Math.sin(a) * r;
        if (level.roomAt(x, z) === ante && !this.collision.pushOut(x, z, 0.9)) return [x - ante.cx, z - ante.cz];
      }
      return [0, 0];
    };
    const n = index === 0 ? 4 : 3;
    for (let i = 0; i < n; i++) this.spawnPedestal(ante, index === 0 ? [0, 1, 1, 2][i] : [1, 1, 2][i], false, ...free((i - (n - 1) / 2) * 2.8, -1.5));
    if (index > 0) this.spawnPedestal(ante, 3, true, ...free(0, 2.2));
    const p = this.player;
    const [sx, sz] = free(0, 4.5);
    p.spawnAt(ante.cx + sx, ante.cz + sz, Math.PI);
    for (const r of this.remotes.values()) { r.pos.set(ante.cx + sx, 0, ante.cz + sz); r.net.x = ante.cx + sx; r.net.z = ante.cz + sz; }
    p.heal(p.maxHp);
    setTimeout(() => !this.ended && this.ui?.toast(`Boss Rush · ${index + 1} of ${BIOMES.length} — arm yourself, then face ${BOSS_DEFS[level.biome.boss]?.name ?? 'the guardian'}`, '#ffc060'), 4800);
  }

  onWave(n, of) {
    // a new wave replaces the room banner (SENTRIES / AMBUSH) rather than sitting under it
    if (n > 1 && this.ui?.h?.banner) { this.ui.h.banner.classList.remove('show'); this.ui.bannerT = 0; }
    this.ui?.wave(n, of);
  }

  // Pings say what they mark: a foe (the marker rides above it until it falls),
  // a thing (tome, chest, shop, portal...) or just a spot. Two per wizard at most.
  addPing(msg) {
    const pl = this.playerById(msg.pid);
    const kind = msg.k === 'foe' || msg.k === 'item' ? msg.k : 'spot';
    const pg = { pid: msg.pid, pos: new THREE.Vector3(+msg.x || 0, +msg.y || 0, +msg.z || 0), name: pl?.name ?? '?', color: pl ? '#' + pl.meta.color.toString(16).padStart(6, '0') : '#fff',
      kind, actorId: kind === 'foe' ? msg.a : -1, label: String(msg.l ?? '').slice(0, 40), born: this.time, life: kind === 'foe' ? 10 : 7 };
    const mine = this.pings.filter((x) => x.pid === msg.pid);
    if (mine.length >= 2) this.pings = this.pings.filter((x) => x !== mine[0]);
    this.pings.push(pg);
    this.audio?.play(kind === 'foe' ? 'telegraph' : kind === 'item' ? 'ui_click' : 'ui_hover', { volume: kind === 'foe' ? 0.35 : 0.6 });
  }
  _updatePings() {
    if (!this.pings.length) return;
    this.pings = this.pings.filter((pg) => {
      if (this.time - pg.born > pg.life) return false;
      if (pg.kind !== 'foe') return true;
      const a = this.actors.byId.get(pg.actorId);
      if (!a || a.dead) return false;
      pg.pos.set(a.pos.x, a.pos.y + (a.height ?? 2) + 0.6, a.pos.z);
      return true;
    });
  }
  _pingMsg(p) {
    const aim = p.aimInfo();
    const msg = { t: 'ping', pid: p.id, x: aim.point.x, y: aim.point.y, z: aim.point.z, k: 'spot', a: -1, l: '' };
    const a = aim.actor;
    if (a && a.faction === 'enemy' && !a.dead) {
      msg.k = 'foe'; msg.a = a.id;
      msg.l = (a.boss || a.champion ? a.def.name : (a.elite ? 'Champion ' : '') + (a.def.name ?? a.type));
      return msg;
    }
    // the thing nearest the aim ray, short of whatever the ray struck (a little
    // more forgiving the farther it is)
    const reach = aim.eye.distanceTo(aim.point) + 1.5;
    let best = null, bd = Infinity;
    for (const it of this.interactables) {
      if (!PING_NAMES[it.kind] || it.dormant) continue;
      const ox = it.pos.x - aim.eye.x, oy = it.pos.y - aim.eye.y, oz = it.pos.z - aim.eye.z;
      const t = ox * aim.dir.x + oy * aim.dir.y + oz * aim.dir.z;
      if (t < 0.5 || t > reach) continue;
      const perp = Math.hypot(ox - aim.dir.x * t, oy - aim.dir.y * t, oz - aim.dir.z * t);
      if (perp < 1.3 + 0.05 * t && perp < bd) { bd = perp; best = it; }
    }
    if (best) { msg.k = 'item'; msg.l = typeof PING_NAMES[best.kind] === 'function' ? PING_NAMES[best.kind](best) : PING_NAMES[best.kind]; msg.x = best.pos.x; msg.y = best.pos.y + 0.8; msg.z = best.pos.z; }
    return msg;
  }

  onBossSpawn(a) {
    // the bar's notches sit where this boss's phases turn (the Wrath pact brings them on sooner)
    const enr = this.difficulty?.bossEnrage ?? 0;
    a.phaseAts = (BOSS_SCRIPTS[a.type]?.phases ?? []).map((p) => p.at + enr).filter((f) => f > 0 && f < 1);
    this.cinematic = { target: a, t: 0, dur: 2.6 };
    this.ui?.letterbox(true);
    this.ui?.bossIntro(a);
    this.audio?.play('boss_intro');
    this.audio?.setMusic(this._mus('boss'));
    // in the Abyss a boss's theme starts a step harder
    if (this.abyss) this.audio?.setMusicIntensity?.(1);
  }

  // a cast everyone should notice: an ultimate flares the caster's rune circle on the ground
  castFlourish(caster, slot) {
    if (slot !== 'ultimate' || !caster?.pos) return;
    const meta = CLASS_META[caster.classId];
    this.vfx.groundSigil(caster.pos, sigilTexture(caster.classId), meta?.color ?? 0xffffff, 2.8, 1.9);
  }

  onBossKilled(a) {
    if (this.isHost) {
      const abyssOpen = !!this.abyssUnlocked;
      // the boss's court crumbles with it: no adds left standing during the victory beat
      for (const b of [...this.actors.list]) {
        if (b === a || b.faction !== 'enemy' || b.dead) continue;
        this.spells.after(0.15 + Math.random() * 0.5, () => { if (!b.dead) { b.hp = 0; this.actors.kill(b, 0, 'holy'); } }); // holy: skeletons don't reassemble
      }
      this.net?.broadcast({ t: 'bossdead', id: a.id, ab: abyssOpen ? 1 : 0 });
      this.bossDefeated(abyssOpen);
    }
  }

  // abyssOpen (the host's say: it has won a run before): the Hollow King's
  // fall opens two ways out, back to the dawn or down into the Abyss
  bossDefeated(abyssOpen = false) {
    const room = this.level.bossRoom;
    this.events.emit('bossDown');
    this.audio?.play('victory_sting');
    this.audio?.setMusic(this._mus('explore'));
    this.vfx.addShake(1);
    // slow-mo moment
    this.vfx.hitstop = 0.6;
    // the boss comes apart in its own element: blasts across the body, then a closing ring
    const B = this.actors.list.find((x) => x.boss && x.dead);
    if (B) {
      const el = { motherOfFilth: 'poison', executioner: 'enemyFire', stoneWyvern: 'earth', courtArchmage: 'arcane', hollowKing: 'enemyPurple' }[B.type] ?? 'enemyFire';
      const bx = B.pos.x, by = B.pos.y, bz = B.pos.z, h = B.height ?? 4;
      for (let i = 0; i < 6; i++) this.spells.after(0.12 + i * 0.2, () => this.vfx.explosion(new THREE.Vector3(bx + rand(-1.2, 1.2), by + h * (0.25 + Math.random() * 0.6), bz + rand(-1.2, 1.2)), el, 1.6 + i * 0.35, { shakeScale: 0.3 }));
      this.spells.after(1.45, () => {
        this.vfx.explosion(new THREE.Vector3(bx, by + h * 0.45, bz), el, 6);
        this.vfx.ring({ x: bx, y: by + 0.15, z: bz }, 16, fxOf(el).core, 1.1, 0.25);
        this.vfx.addShake(0.8);
      });
    }
    if (this.floorIndex >= BIOMES.length - 1) {
      if (this.abyss) this.ui?.banner('THE HOLLOW KING FALLS AGAIN', `Abyss ${this.abyss} is conquered`, '#ff7090', 5);
      else this.ui?.banner('THE HOLLOW KING HAS FALLEN', 'Dawn returns to the Ashen Keep', '#ffd860', 5);
      this.screenTint([1.35, 1.25, 1.0], 3);
      // the eclipse lifts: torches return to warm light
      for (const t of this.lights.torches) { t.intensity *= 2; t.color.set(0xffb060); }
      this.hemi.intensity = this.baseHemi * 2.4;
      this._victoryLight = true;
      const c = new THREE.Vector3(room.cx, this.groundY(room.cx, room.cz) + 3, room.cz);
      for (let i = 0; i < 6; i++) this.spells.after(i * 0.35, () => this.vfx.explosion(c.clone().add(new THREE.Vector3(rand(-6, 6), rand(0, 4), rand(-6, 6))), 'holy', 4));
      if (!abyssOpen) { this.spells.after(4.5, () => this.victory()); return; }
      this.spells.after(3.5, () => {
        if (this.player.dead || this.player.downed) this.player.revive(0.5);
        const ex = room.exit, gy = (x, z) => this.groundY(x, z);
        const side = new THREE.Vector3(ex.z - room.cz, 0, -(ex.x - room.cx)).normalize().multiplyScalar(3.2);
        const v = new THREE.Vector3(ex.x, 0, ex.z).add(side), d = new THREE.Vector3(ex.x, 0, ex.z).sub(side);
        this.interactables.push(makePortal(this, new THREE.Vector3(v.x, gy(v.x, v.z), v.z), { kind: 'victoryPortal', label: 'Claim your victory', look: 'dawn' }));
        this.interactables.push(makePortal(this, new THREE.Vector3(d.x, gy(d.x, d.z), d.z), { kind: 'abyssPortal', label: `Descend into the Abyss · depth ${this.abyss + 1}`, look: 'abyss' }));
        this.ui?.banner('TWO WAYS LIE OPEN', 'Claim your victory — or descend into the Abyss', '#e8a0b0', 5);
      });
      return;
    }
    this.ui?.banner('VANQUISHED', `${this.biome.name} is conquered`, '#ffd060');
    if (this.player.dead || this.player.downed) this.player.revive(0.5);
    this.player.heal(this.player.maxHp * 0.35);
    // legendary-leaning reward + gold + portal up
    if (this.difficulty.bossRelic) { this.spawnPedestal(room, 2, false, -2.2); this.spawnPedestal(room, 3, true, 2.2); } // (Nightmare: a relic from every boss)
    else this.spawnPedestal(room, 2);
    if (this.isHost) this.spawnDrop('gold', new THREE.Vector3(room.cx, 0, room.cz + 3), 60 + this.floorIndex * 30);
    if (this.isHost) this.spawnDrop('item', new THREE.Vector3(room.cx - 2, this.groundY(room.cx - 2, room.cz + 3), room.cz + 3), randomItem());
    const ex = room.exit;
    const portal = makePortal(this, new THREE.Vector3(ex.x, this.groundY(ex.x, ex.z), ex.z));
    this.interactables.push(portal);
  }

  goNextFloor() {
    if (!this.isHost) { this.net?.send({ t: 'nextfloor', f: this.floorIndex }); return; }
    if (this.transitioning) return;
    this.transitioning = true;
    const next = this.floorIndex + 1;
    this.net?.broadcast({ t: 'floor', i: next });
    this.transitionToFloor(next);
  }

  transitionToFloor(i) {
    this.ui?.fadeOut(0.8, () => {
      this.loadFloor(i);
      this.transitioning = false;
      this.ui?.fadeIn(1.2);
    });
  }

  // (host) down into the Abyss: the realms again from the first, laid out anew and far deadlier
  descendAbyss() {
    if (!this.isHost || this.transitioning || this.ended) return;
    this.transitioning = true;
    const d = this.abyss + 1;
    // each descent binds one more pact rank, the Abyssal curse: every depth plays
    // differently, and its heat counts toward the heat's rewards like any other
    const pk = this.difficulty.pacts ?? {};
    const open = PACTS.filter((pc) => (pk[pc.id] ?? 0) < pc.max);
    let c = null;
    if (open.length) { let r = Math.random() * open.reduce((s, pc) => s + pc.heat, 0); c = open.find((pc) => (r -= pc.heat) <= 0)?.id ?? open[0].id; }
    this.net?.broadcast({ t: 'abyss', d, c });
    this.enterAbyss(d, c);
  }
  enterAbyss(d, curse = null) {
    this.abyss = d;
    const pc = PACT_BY_ID[curse];
    let pk = this.difficulty.pacts ?? {};
    if (pc && pc.id !== 'nightmare') {
      pk = { ...pk };
      pk[pc.id] = Math.min(pc.max, (pk[pc.id] ?? 0) + 1);
      this._curseNote = `Abyssal curse — ${pc.name}${pc.max > 1 ? ' ' + 'I'.repeat(pk[pc.id]) : ''}: ${pc.desc(pk[pc.id])}`;
    }
    // the pacts as they now stand, then every Abyssal law down to this depth
    this.difficulty = abyssLaws(difficultyFor(pk, { daily: this.difficulty.daily ?? null }), d);
    const law = lawAt(d);
    this.events.emit('abyss', d);
    this.audio?.play('boss_roar', { volume: 0.6 });
    this.ui?.fadeOut(1.4, () => {
      this.loadFloor(0);
      this.transitioning = false;
      const p = this.player;
      if (p.dead || p.downed) p.revive(1);
      p.heal(p.maxHp);
      this.ui?.fadeIn(1.6);
      setTimeout(() => { if (!this.ended) { this.ui?.banner(`ABYSS ${d} · ${law.name.toUpperCase()}`, law.desc, law.color, 5); this.ui?.toast(`Abyssal law — ${law.name}: ${law.desc}`, law.color); } }, 2600);
      if (this._curseNote) { const n = this._curseNote; this._curseNote = null; setTimeout(() => !this.ended && this.ui?.toast(n, '#ff5878'), 5200); }
    });
  }

  victory() {
    if (this.ended) return;
    this.ended = true;
    this.net?.broadcast({ t: 'victory' });
    this.audio?.setMusic('victory');
    if (!this.events.emit('end', true)) this.ui?.endScreen(true, this); // the run summary (src/meta) listens
  }

  _checkRunEnd(dt = 1 / 60) {
    if (this.ended || !this.isHost) return;
    const ps = this.allPlayers();
    if (!ps.length) return;
    if (ps.every((p) => p.dead || p.downed)) {
      this._wipeT = (this._wipeT ?? 0) + dt;
      if (this._wipeT > 1.5) this.defeat();
    } else this._wipeT = 0;
  }

  defeat() {
    if (this.ended) return;
    this.ended = true;
    this.net?.broadcast({ t: 'defeat' });
    this.audio?.setMusic('defeat');
    this.audio?.play('defeat_sting');
    if (!this.events.emit('end', false)) this.ui?.endScreen(false, this);
  }

  onLocalDowned() {
    this.ui?.banner('YOU HAVE FALLEN', this.isSolo ? '' : 'Hold on — an ally can revive you', '#c02020');
    this.ui?.recap(this.meta?.recap?.());
  }
  onLocalDied() {
    this.ui?.banner('SLAIN', this.isSolo ? '' : 'You will return when the chamber is cleared', '#801010');
  }

  // ======================================================================
  // interaction (F key)
  // ======================================================================
  _interactions(dt, input) {
    const p = this.player;
    if (input.was('ping') && p.alive) {
      const msg = this._pingMsg(p);
      this.addPing(msg);
      this.net?.broadcastOrSend(msg);
    }
    if (!p.alive || p.dead || this.ui?.modalOpen) { this.ui?.prompt(null); return; }
    let best = null, bd = Infinity;
    const eye = p.eye;
    const fwd = p.forward();
    for (const it of this.interactables) {
      if (it.hidden || it.usedBy?.has(p.id) || it.used) continue;
      const d = it.pos.distanceTo(eye);
      if (d > it.r) continue;
      const to = it.pos.clone().sub(eye).normalize();
      const facing = to.dot(fwd);
      const score = d - facing * 2;
      if (facing > 0.2 && score < bd) { bd = score; best = it; }
    }
    // an item on the ground while the slot is full: interact swaps
    if (p.item) {
      for (const d of this.drops) {
        if (d.type !== 'item' || d.t < 0.6) continue;
        const dd = d.pos.distanceTo(eye);
        if (dd < 2.4 && dd - 1 < bd) { bd = dd - 1; best = (this._itemSwap ??= { kind: 'itemDrop', r: 3, pos: null, label: '', drop: null }); best.drop = d; best.pos = d.pos; best.label = `Take ${ITEMS[d.value]?.name ?? 'item'} (leave ${ITEMS[p.item]?.name ?? 'yours'})`; }
      }
    }
    // reviving downed teammates
    let reviveTarget = null;
    if (!p.downed) {
      for (const r of this.remotes.values()) {
        if (!r.downed) continue;
        if (r.pos.distanceTo(p.pos) < 2.6) { reviveTarget = r; break; }
      }
    }
    if (reviveTarget) {
      const holding = input.is('interact');
      this.reviveHold = holding ? (this.reviveHold ?? 0) + dt : 0;
      this.ui?.prompt(`Hold [${keyOf('interact')}] to revive ${reviveTarget.name}`, this.reviveHold / 3);
      if (holding && Math.random() < dt * 10) this.vfx.burst(reviveTarget.pos.clone().add(_v.set(0, 0.5, 0)), { element: 'holy', count: 2, speed: 1, upward: 1, life: 0.8, size: 0.1, sprite: SPR.STAR });
      if (this.reviveHold >= 3) {
        this.reviveHold = 0;
        this.net?.sendTo(reviveTarget.id, { t: 'revive', f: 0.4 });
        this.events.emit('revive', reviveTarget);
        this.audio?.play('revive');
      }
      return;
    }
    this.reviveHold = 0;
    if (p.downed) { this.ui?.prompt(this.isSolo ? null : `Bleeding out... ${Math.ceil(p.downT)}s`); return; }
    if (!best) { this.ui?.prompt(null); return; }
    this.ui?.prompt(`[${keyOf('interact')}] ${best.label}`);
    if (input.was('interact')) this.interact(best);
  }

  interact(it) {
    const p = this.player;
    switch (it.kind) {
      case 'pedestal': {
        this.audio?.play('tome_open');
        if (it.relic) {
          const relics = rollRelics(p, 3);
          if (!relics.length) { it.usedBy.add(p.id); break; }
          this.ui?.chooseRelic(relics, (r) => { if (!r) return; this.grantRelic(r); it.usedBy.add(p.id); it.onUsed?.(p.id); });
          break;
        }
        const offer = () => {
          const choices = rollTomes(p, this.difficulty.tomeChoices ?? 3, it.minRarity ?? 0); // (Narrow Path: two)
          const reroll = p.rerolls > 0 ? { left: p.rerolls, fn: () => { p.rerolls--; offer(); } } : null;
          this.ui?.chooseTome(choices, (c) => {
            if (!c) return;
            this.grantTome(c);
            it.usedBy.add(p.id);
            it.onUsed?.(p.id);
          }, reroll);
        };
        offer();
        break;
      }
      case 'itemDrop': {
        const d = it.drop, k = this.drops.indexOf(d);
        if (k < 0) break;
        this.scene.remove(d.mesh); this.drops.splice(k, 1);
        this.giveItem(d.value);
        break;
      }
      case 'chest': {
        it.open();
        this.net?.broadcastOrSend({ t: 'chest', id: it.id });
        it.usedBy.add(p.id);
        this.audio?.play('chest_open', { pos: it.pos });
        const gold = 25 + this.floorIndex * 15;
        p.gold += gold; this.stats.gold += gold;
        this.ui?.toast(`+${gold} gold`);
        if (Math.random() < 0.45) this.spawnDrop('item', it.pos, randomItem(), -1); // (only the opener sees it, as chests are per wizard)
        const relics = rollRelics(p, 3);
        if (relics.length) this.ui?.chooseRelic(relics, (r) => { if (r) this.grantRelic(r); });
        break;
      }
      case 'shrine': {
        this.audio?.play('shrine', { pos: it.pos });
        const sh = this._shrineOffers(p);
        this.ui?.chooseBlessing(sh.offers, () => { it.usedBy = it.usedBy ?? new Set(); it.usedBy.add(p.id); }, sh.title, sh.sub);
        break;
      }
      case 'shop': {
        if (!it.stock) it.stock = makeShopStock(this, p);
        this.ui?.openShop(it.stock, p, (item) => this.buy(item, it.stock));
        break;
      }
      case 'portal':
        this.goNextFloor();
        break;
      case 'victoryPortal':
        if (this.isHost) this.victory(); else this.net?.send({ t: 'claimVictory' });
        break;
      case 'abyssPortal':
        if (this.isHost) this.descendAbyss(); else this.net?.send({ t: 'descend' });
        break;
      default: this.encounters.interact(it); break;
    }
  }

  // Each realm's shrine answers differently: two dependable blessings and a
  // bargain in the realm's character.
  _shrineOffers(p) {
    const mend = { name: 'Blessing of Mending', desc: 'Restore all health.', icon: 'heart', apply: () => { p.heal(p.maxHp); this.healPulse = 1; } };
    const fort = { name: 'Blessing of Fortitude', desc: '+30 max health.', icon: 'shield', apply: () => { p.upgrades.push({ def: TOMES.find((t) => t.id === 'vitality'), rarity: 1, mult: 1.5 }); p.recomputeStats(); } };
    const tome = (min) => this.ui?.chooseTome(rollTomes(p, 3, min), (x) => x && this.grantTome(x));
    switch (this.biome.id) {
      case 'dungeon': return { title: "The Gaoler's Bargain", sub: 'Rusted keys hang from the altar', offers: [mend, fort,
        { name: 'Chains of Fate', desc: 'Lose 15 max health for good. Choose a relic.', icon: 'skull', apply: () => {
          p.upgrades.push({ def: TOMES.find((t) => t.id === 'vitality'), rarity: 0, mult: -0.75 }); p.recomputeStats();
          const r = rollRelics(p, 3); if (r.length) this.ui?.chooseRelic(r, (x) => x && this.grantRelic(x));
        } }] };
      case 'courtyard': {
        const dash = TOMES.find((t) => t.id === 'dash');
        const have = p.upgrades.filter((u) => u.def === dash).length;
        return { title: 'Cairn of the Fallen Guard', sub: 'Their oath can pass to you', offers: [mend, fort,
          have < (dash?.max ?? 2)
            ? { name: 'Oath of the Vanguard', desc: '+1 dash charge and dashes recharge 20% faster.', icon: 'dash', apply: () => { p.upgrades.push({ def: dash, rarity: 1, mult: 1 }); p.recomputeStats(); } }
            : { name: 'Pact of Blood', desc: 'Lose 30% of current health. Choose an Epic tome.', icon: 'drop', apply: () => { p.payHp(p.hp * 0.3); tome(2); } }] };
      }
      case 'keep': {
        const offers = [mend, { name: "Archivist's Insight", desc: '+2 tome rerolls.', icon: 'eye', apply: () => { p.rerolls = (p.rerolls ?? 0) + 2; } }];
        const last = [...p.upgrades].reverse().find((u) => u.def?.id !== 'vitality');
        offers.push(last
          ? { name: 'Transmutation', desc: `Give up ${last.def.name}. Choose an Epic tome.`, icon: 'hex', apply: () => { p.upgrades.splice(p.upgrades.lastIndexOf(last), 1); p.recomputeStats(); tome(2); } }
          : fort);
        return { title: "The Archivist's Lectern", sub: 'Knowledge, for a price', offers };
      }
      case 'throne': return { title: 'Altar of the Hollow Crown', sub: 'The crown asks much and gives more', offers: [mend, fort,
        { name: "The Crown's Price", desc: 'Lose 40% of current health. Choose a Legendary tome.', icon: 'crown', apply: () => { p.payHp(p.hp * 0.4); tome(3); } }] };
      default: return { title: 'The Drowned Idol', sub: 'Accept one blessing', offers: [mend, fort,
        { name: 'Pact of Blood', desc: 'Lose 30% of current health. Choose an Epic tome.', icon: 'drop', apply: () => { p.payHp(p.hp * 0.3); tome(2); } }] };
    }
  }

  grantTome(c) {
    const p = this.player;
    p.upgrades.push(c);
    p.recomputeStats();
    this.events.emit('tome', c);
    if (c.def.id === 'phoenix') { /* handled via stats.extraLives */ }
    this.audio?.play('tome_pick');
    this.vfx.burst(p.eye.clone().add(p.forward().multiplyScalar(1)), { element: 'arcane', count: 30, speed: 3, life: 1, size: 0.15, sprite: SPR.STAR });
    this.ui?.toast(`${c.def.name} (${RARITY[c.rarity].name})`, RARITY[c.rarity].color);
  }
  grantRelic(r, quiet = false) {
    const p = this.player;
    if (r.ascend) {
      // raise an owned relic a star
      const own = p.relics.find((x) => x.def.id === r.ascend);
      if (!own) return;
      own.stars = (own.stars ?? 0) + 1;
      p.recomputeStats();
      this.relics?.refresh(true);
      this.events.emit('relic', own);
      if (quiet) return;
      this.audio?.play('level_up', { volume: 0.8 });
      this.vfx.ring(p.pos, 2.6, [2.4, 1.8, 0.6], 0.9, 0.16);
      this.ui?.toast(`Relic ascended: ${own.def.name} ${'★'.repeat(own.stars)}`, relicColor(own.def));
      return;
    }
    p.relics.push(r);
    r.def.onGain?.(p);
    p.recomputeStats();
    this.relics?.refresh(quiet);
    this.events.emit('relic', r);
    if (quiet) return;
    this.audio?.play('tome_pick');
    if (r.def.cursed) this.audio?.play('ui_back', { volume: 0.6 });
    this.ui?.toast(`${r.def.cursed ? 'Cursed relic' : 'Relic'}: ${r.def.name}`, relicColor(r.def));
  }
  onLocalCast(slot) { this.relics?.onCast(slot); }
  onLocalDash() {
    this.relics?.onDash();
    if (++this._dashN === 6) this.learn('dashjump', `${keyOf('jump')} during a dash to dash-jump: a long, fast bound`);
  }
  buy(item, stock) {
    const p = this.player;
    if (item.sold || p.gold < item.price || (item.available && !item.available(p))) { this.audio?.play('ui_error'); return false; }
    const paid = item.price;
    p.gold -= paid;
    if (item.refine) item.uses++; else item.sold = true;
    if (stock) { stock.bought++; priceShop(this, stock); }
    this.audio?.play('buy');
    // (a refine the player walks away from is refunded, and doesn't count toward the markup)
    item.apply(p, () => { p.gold += paid; if (item.refine) item.uses--; if (stock) { stock.bought--; priceShop(this, stock); } });
    return true;
  }

  // Offer three of the player's tomes, each shown a rarity finer; the one chosen is raised.
  refineTome(p, refund) {
    const can = p.upgrades.filter((u) => u.def && !u.def.hidden && (u.rarity ?? 0) < 3 && u.def.id !== 'vitality');
    const pick = [];
    while (can.length && pick.length < 3) pick.push(can.splice(Math.floor(Math.random() * can.length), 1)[0]);
    if (!pick.length) { refund(); return; }
    const offers = pick.map((u) => ({ def: u.def, rarity: (u.rarity ?? 0) + 1, mult: RARITY[(u.rarity ?? 0) + 1].mult * (u.dr ?? 1), dr: u.dr, from: u.rarity ?? 0, src: u }));
    this.ui?.closeAllModals();
    this.ui?.chooseTome(offers, (c) => {
      if (!c) { refund(); return; }
      c.src.rarity = c.rarity; c.src.mult = c.mult;
      p.recomputeStats();
      this.audio?.play('tome_pick');
      this.ui?.toast(`${c.def.name} refined to ${RARITY[c.rarity].name}`, RARITY[c.rarity].color);
    }, null, { title: 'Refine a Tome', sub: 'Choose one to raise a rarity' });
  }

  // ======================================================================
  // visual effects requested by the boss scripts (all peers)
  // ======================================================================
  // a sealed room's trap vents smoulder between bursts, so a grate reads as a trap before it fires
  _ventTells(dt) {
    const r = this.level?.roomAt(this.player.pos.x, this.player.pos.z);
    if (!r?.vents || !r._locked || r.cleared) return;
    const b = this.biome.id, c = b === 'sewers' ? [0.5, 1.2, 0.15] : b === 'keep' ? [0.9, 0.25, 1.4] : [1.4, 0.5, 0.12];
    for (const v of r.vents) {
      if (Math.random() > dt * 6) continue;
      this.vfx.P.glow({ x: v.x + rand(-0.45, 0.45), y: this.groundY(v.x, v.z) + 0.1, z: v.z + rand(-0.45, 0.45), vy: rand(0.6, 1.4), r: c[0], g: c[1], b: c[2], life: 0.9, size: 0.12, sprite: SPR.GLOW });
    }
  }

  // places of rest have their own pieces: the merchant's waltz, a shrine's hush, a vault's
  // glitter. Checked twice a second, switched once you've stood in the room a second
  _roomMusic(dt) {
    if ((this._musT = (this._musT ?? 0) - dt) > 0) return;
    this._musT = 0.5;
    const cur = this.audio?._musicState;
    if (!cur || this.ended || this.menuMode || /^(combat|boss|victory|defeat)/.test(cur)) { this._musWant = null; return; }
    const r = this.level.roomAt(this.player.pos.x, this.player.pos.z);
    const want = PLACE_MUSIC[r?.type] ?? this._mus('explore');
    if (want === cur) { this._musWant = null; return; }
    if (this._musWant === want) this.audio.setMusic(want);
    this._musWant = want;
  }

  // the piece for a moment of play: the realm's own explore / combat theme
  // (the Abyss has its own), the floor boss's own theme
  _mus(state) { return themeFor(state, this.abyss ? 'abyss' : this.biome?.id, this.biome?.boss); }

  bossFx(kind, a, extra) {
    if (!a) return;
    // each phase drives the boss's theme harder
    if (kind === 'phase') this.audio?.setMusicIntensity?.(Math.min(2, (extra?.n ?? 1) + (this.abyss ? 1 : 0)));
    // the boss model reacts to its own moments (phase change, submerge, enrage...): visual only
    a.model?.bossFx?.(kind, extra ?? {});
    switch (kind) {
      case 'submerge':
        this.vfx.burst(new THREE.Vector3(a.pos.x, a.pos.y + 0.5, a.pos.z), { element: 'enemyGreen', count: 60, speed: 6, upward: 1, life: 1, size: 0.3, sprite: SPR.BUBBLE, gravity: 6 });
        a.hiddenT = 1.9;
        break;
      case 'emerge':
        this.vfx.explosion(new THREE.Vector3(a.pos.x, a.pos.y + 1, a.pos.z), 'poison', 5);
        a.hiddenT = 0;
        break;
      case 'lob': {
        const m = this.actors.muzzlePos(a);
        const tx = extra.x, tz = extra.z, T2 = extra.t;
        const gr = 14;
        const ty = this.groundY(tx, tz);
        this.spells.spawn({ local: false, faction: 'neutral', el: 'enemyGreen', pos: m, vel: new THREE.Vector3((tx - m.x) / T2, ((ty - m.y) + 0.5 * gr * T2 * T2) / T2, (tz - m.z) / T2), gravity: gr, radius: 0.3, life: T2 + 0.05, core: 0.9, light: 4, trail: 1, noWall: true });
        break;
      }
      case 'breath': {
        const dur = extra.dur ?? 1;
        const sweep = extra.sweep ?? 0;
        const steps = Math.round(dur * 40);
        for (let i = 0; i < steps; i++) {
          this.spells.after(i / 40, () => {
            const yaw = extra.yaw + (sweep * i) / steps;
            const m = this.actors.muzzlePos(a);
            for (let k = 0; k < 4; k++) {
              const s = 18 + Math.random() * 6;
              const yy = yaw + rand(-0.15, 0.15);
              const fx = fxOf('enemyFire');
              this.vfx.P.glow({ x: m.x, y: m.y, z: m.z, vx: Math.sin(yy) * s, vy: rand(-3, 0), vz: Math.cos(yy) * s, r: fx.core[0], g: fx.core[1], b: fx.core[2], r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: 0.6, size: 0.3, size2: 2.2, sprite: SPR.FLAME, drag: 1.5 });
            }
            this.lights.request(m, 0xff6020, 30, 16);
          });
        }
        this.audio?.play('cast_fire_big', { pos: a.pos });
        break;
      }
      case 'dread': // (Nightmare) the tell before a dread ring: the boss gathers a red halo
        this.vfx.ring({ x: a.pos.x, y: a.pos.y + 0.15, z: a.pos.z }, 4 + a.radius, [2.6, 0.15, 0.12], 0.7, 0.05);
        this.vfx.explosion(new THREE.Vector3(a.pos.x, a.pos.y + 1.4, a.pos.z), 'enemyFire', 1.6, { shakeScale: 0.2 });
        this.audio?.play('enemy_cast', { pos: a.pos, volume: 0.9 });
        break;
      case 'fly':
        a.model?.setFlying?.(!!extra.on);
        break;
      case 'laststand': // the theme at full cry, a red flash
        this.audio?.setMusicIntensity?.(2);
        this.screenTint([1.35, 0.85, 0.8], 0.8);
        break;
      case 'leap': // the boss springs: dust where it left, the arc is drawn by the actor (airT)
        a.airT = 0; a.airDur = extra.dur; a.airH = extra.h;
        this.vfx.smoke(new THREE.Vector3(a.pos.x, a.pos.y + 0.3, a.pos.z), { count: 10, size: 1.6, color: [0.3, 0.26, 0.22], alpha: 0.5, speed: 4 });
        this.audio?.play('dash', { pos: a.pos, volume: 0.8 });
        break;
      case 'exposed': // the punish window opens: a gold flare and a call over the boss (and its bar glows: ui)
        a.exposedUntil = this.time + (extra.t ?? 1.4);
        this.ui?.floatText(new THREE.Vector3(a.pos.x, a.pos.y + (a.height ?? 4) + 0.6, a.pos.z), 'EXPOSED', '#ffd070', true);
        this.vfx.ring({ x: a.pos.x, y: a.pos.y + 0.15, z: a.pos.z }, 2.5 + a.radius, [2.4, 1.8, 0.6], 0.5, 0.12);
        a.hitFlash = Math.max(a.hitFlash, 0.6);
        this.audio?.play('reaction', { pos: a.pos, volume: 0.8 });
        break;
      case 'land':
        this.vfx.explosion(new THREE.Vector3(a.pos.x, a.pos.y + 0.4, a.pos.z), extra.el ?? 'earth', extra.r ?? 4, { groundY: a.pos.y });
        break;
      case 'enrage':
        this.vfx.explosion(new THREE.Vector3(a.pos.x, a.pos.y + 2, a.pos.z), 'enemyFire', 5);
        a.model?.setTint?.(0xff3010, 0.25);
        break;
      case 'rise':
        this.vfx.explosion(new THREE.Vector3(a.pos.x, a.pos.y + 2, a.pos.z), 'enemyPurple', 6);
        this.screenTint([1.3, 0.8, 1.5], 1.2);
        break;
      case 'eclipse':
        this.screenTint([0.6, 0.45, 0.8], 999);
        this.hemi.intensity = this.baseHemi * 0.35;
        for (const t of this.lights.torches) { t.intensity *= 0.4; t.color.set(0x9a40ff); }
        break;
      case 'judgment':
        this.screenTint([0.4, 0.3, 0.6], 4);
        break;
      case 'gate': { // a gate rises (or falls): the boss takes its colour, a ring marks it, the bar names it (ui)
        const G = GATE_LOOK[extra.k];
        if (!G) break;
        const m = a.model, at = new THREE.Vector3(a.pos.x, a.pos.y + (a.height ?? 4) * 0.5, a.pos.z);
        if (extra.on) {
          const gl = [];
          for (let i = 0; extra.gl && i + 1 < extra.gl.length; i += 2) gl.push({ x: extra.gl[i], z: extra.gl[i + 1], lit: false, t: 0 });
          a.gate = { k: extra.k, n: extra.n ?? gl.length, dur: extra.dur ?? 15, until: this.time + (extra.dur ?? 15), gl, ids: extra.ids ?? null, pulse: 0, tint: m?._tint ? [m._tintHex, m._tintK] : null };
          m?.setTint?.(G.tint, 0.4);
          this.vfx.ring({ x: a.pos.x, y: a.pos.y + 0.1, z: a.pos.z }, 3 + a.radius * 1.5, G.col, 0.8, 0.15);
          this.vfx.burst(at, { element: G.el, count: 40, speed: 5, upward: 0.6, life: 0.9, size: 0.22 });
          this.audio?.play('enemy_cast', { pos: a.pos, volume: 1 });
          (this._gated ??= new Set()).add(a);
        } else if (a.gate) {
          const was = a.gate;
          a.gate = null;
          this._gated?.delete(a);
          if (was.tint) m?.setTint?.(was.tint[0], was.tint[1]); else m?.setTint?.(null);
          if (extra.broken) {
            this.vfx.explosion(at, G.el, 4 + a.radius, { shakeScale: 0.4 });
            // the Wyvern's stone shell comes off it in slabs
            if (was.k === 'stone') this.rubble?.burst(a.pos.x, a.pos.y + (a.height ?? 4) * 0.5, a.pos.z, 16, 0.42, 0.3, 0.12, 5, 4, a.radius * 0.8);
            this.ui?.floatText(new THREE.Vector3(a.pos.x, a.pos.y + (a.height ?? 4) + 1.2, a.pos.z), `${G.name.toUpperCase()} BROKEN`, '#ffe090', true);
            this.screenTint([1.25, 1.15, 0.9], 0.5);
          } else this.vfx.ring({ x: a.pos.x, y: a.pos.y + 0.1, z: a.pos.z }, 2 + a.radius, G.col, 0.5, 0.1);
        }
        this.ui?.bossGate?.(a);
        break;
      }
      case 'gatehit': { // a blow turned away: say why, over the boss, and spark where the ward took it
        const G = GATE_LOOK[extra.k];
        if (!G) break;
        this.ui?.floatText(new THREE.Vector3(a.pos.x, a.pos.y + (a.height ?? 4) * 0.8, a.pos.z), G.hit, '#c8c0d8'); // (on the body: over a tall boss's head it rose into its bar)
        this.vfx.burst(new THREE.Vector3(a.pos.x, a.pos.y + (a.height ?? 4) * 0.55, a.pos.z), { element: G.el, count: 10, speed: 4, life: 0.4, size: 0.14 });
        break;
      }
      case 'gatecount': // the gate weakens: one fewer to go
        if (!a.gate) break;
        a.gate.n = extra.n;
        if (a.gate.k === 'judgment') { // a crack in the ward
          this.vfx.explosion(new THREE.Vector3(a.pos.x, a.pos.y + (a.height ?? 4) * 0.55, a.pos.z), 'enemyPurple', 2.5, { shakeScale: 0.3 });
          this.ui?.floatText(new THREE.Vector3(a.pos.x, a.pos.y + (a.height ?? 4) + 0.9, a.pos.z), extra.n > 0 ? 'THE WARD CRACKS' : 'THE WARD SHATTERS', '#d0a0ff', true);
          this.audio?.play('crit', { pos: a.pos, volume: 0.9 });
        }
        this.ui?.bossGate?.(a);
        break;
      case 'glyph': { // a glyph burns gold
        const q = a.gate?.gl[extra.i];
        if (!q) break;
        q.lit = true;
        a.gate.n = a.gate.gl.reduce((n, g) => n + (g.lit ? 0 : 1), 0);
        const y = this.groundY(q.x, q.z);
        this.vfx.explosion(new THREE.Vector3(q.x, y + 0.6, q.z), 'holy', 2.6, { shakeScale: 0.2, groundY: y });
        this.vfx.ring({ x: q.x, y: y + 0.1, z: q.z }, 2.4, [2.4, 1.8, 0.6], 0.7, 0.2);
        q.d = 0;
        this.ui?.bossGate?.(a);
        break;
      }
      default: break;
    }
  }

  // the gate's look while it holds: a pulse about the boss in its colour, and for the Archmage's ward her
  // glyphs on the floor (each tethered to her until it burns) and for Gravemaw's stoneskin a gold mark on the
  // floor behind it, where blows bite. Pooled rings, telegraphs, bolts and lights only.
  _gateFx(dt) {
    for (const a of this._gated) {
      const gt = a.gate;
      if (!gt || a.dead || !a.alive) { this._gated.delete(a); if (a.gate) { a.gate = null; this.ui?.bossGate?.(a); } continue; }
      const G = GATE_LOOK[gt.k];
      gt.pulse -= dt;
      const beat = gt.pulse <= 0;
      if (beat) gt.pulse = 0.5;
      _gp.set(a.pos.x, a.pos.y + (a.height ?? 4) * 0.55, a.pos.z);
      this.lights.request(_gp, G.light, 2.5, 7 + a.radius);
      if (beat) {
        this.vfx.ring(_gq.set(a.pos.x, a.pos.y + 0.1, a.pos.z), 1.6 + a.radius * 1.2, G.col, 0.6, 0.08);
        if (gt.k === 'stone') this.vfx.telegraph(_gq, { shape: 'cone', radius: 4 + a.radius, rot: a.yaw + Math.PI, angle: 1.2, dur: 0.5, color: [1.4, 1.05, 0.3] });
        // her brood, each ringed in her colour: these are what shield her
        if (gt.ids) for (const id of gt.ids) { const m = this.actors.byId.get(id); if (m && !m.dead) this.vfx.ring(_gq.set(m.pos.x, m.pos.y + 0.1, m.pos.z), 0.9 + m.radius, G.col, 0.55, 0.12); }
      }
      for (const q of gt.gl) {
        const y = this.groundY(q.x, q.z);
        _gq.set(q.x, y + 0.8, q.z);
        this.lights.request(_gq, q.lit ? 0xffd070 : 0xc060ff, q.lit ? 2 : 3, 5);
        // the glyph itself, a rune on the floor (the decal pool's glow glyph, laid again before the last fades)
        q.d = (q.d ?? 0) - dt;
        if (q.d <= 0) { q.d = 1.6; this.vfx.decal(_gq.set(q.x, y, q.z), 'glyph', 3.9, 2, q.lit ? 0xd0a040 : 0x9040d0); }
        if (q.lit) { if (beat) this.vfx.ring(_gq.set(q.x, y + 0.1, q.z), 1.9, [1.8, 1.4, 0.5], 0.6, 0.06); continue; }
        // filling: the ring beats faster while a wizard stands in it
        let on = false;
        for (const p of this.allPlayers()) if (!p.dead && !p.downed && Math.hypot(p.pos.x - q.x, p.pos.z - q.z) < 1.9) on = true;
        q.t -= dt;
        if (q.t <= 0) {
          q.t = on ? 0.18 : 0.55;
          this.vfx.ring(_gq.set(q.x, y + 0.1, q.z), 1.9, on ? [2.2, 1.6, 0.8] : G.col, on ? 0.35 : 0.7, on ? 0.18 : 0.1);
          if (beat) this.vfx.lightning(_gq.set(q.x, y + 0.9, q.z), _gp, { color: G.col, life: 0.18, jag: 0.6, branches: 0 });
        }
      }
    }
  }

  // Tight Deadline: the realm's clock runs (each peer keeps its own; the floors start together) until the
  // guardian's door shuts. Run out, and the wizard withers, 1% of their health a second, until it falls.
  _deadlineTick(dt) {
    const D = this.deadline, p = this.player;
    if (D.stopped || this.ended || this.loadingFloor || this.transitioning) return;
    const was = D.t;
    D.t -= dt;
    if (was > 60 && D.t <= 60) { this.ui?.toast('One minute left to reach the guardian', '#ff9a60'); this.audio?.play('enemy_cast', { volume: 0.6 }); }
    if (D.t <= 0 && !D.past) {
      D.past = true;
      this.ui?.banner('THE DEADLINE PASSES', 'You wither until the guardian falls', '#ff5a40');
      this.audio?.play('boss_roar', { volume: 0.5 });
      this.screenTint([1.3, 0.75, 0.7], 1);
    }
    if (D.past && p.alive && !p.downed && !p.dead && !this.godMode) {
      D.acc = (D.acc ?? 0) + p.maxHp * 0.01 * dt;
      if (D.acc >= 1) { const n = Math.floor(D.acc); D.acc -= n; p.wither(n); }
    }
    this.ui?.deadline(D);
  }
  _deadlineStop() { if (this.deadline) { this.deadline.stopped = true; this.ui?.deadline(this.deadline); } }

  // a perfect dodge (ours, or a teammate's sent to us as host) cracks a boss's judgment
  _bossDodge() {
    for (const a of this.actors.list) if (a.boss && a.brain?.gate) a.brain.script.gateDodge?.(a.brain);
  }
}

// ---------------------------------------------------------------------------
function getEnemyModelSafe(t, game) { try { return getEnemyModel(t, game); } catch { return null; } }

const signCache = new Map();
function signTexture(ch, color) {
  const key = ch + color;
  if (signCache.has(key)) return signCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 10, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.75, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = color; g.lineWidth = 3; g.globalAlpha = 0.8;
  g.beginPath(); g.arc(64, 64, 48, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 1;
  g.font = '64px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 16;
  g.fillStyle = color; g.fillText(ch, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  signCache.set(key, t);
  return t;
}

const ITEM_DROP = new Map();
function itemDropMats(id) {
  let m = ITEM_DROP.get(id);
  if (m) return m;
  const c = new THREE.Color(ITEMS[id]?.color ?? '#ffd080');
  m = {
    orb: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.95) }),
    halo: new THREE.SpriteMaterial({ color: c.clone().multiplyScalar(0.45), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, map: HALO_MAT.map }),
    glyph: new THREE.SpriteMaterial({ map: signTexture(ITEMS[id]?.glyph ?? '?', ITEMS[id]?.color ?? '#ffd080'), depthWrite: false, transparent: true }),
  };
  ITEM_DROP.set(id, m);
  return m;
}
function makeDropMesh(type, value) {
  if (type === 'item') {
    const m = itemDropMats(value), g = new THREE.Group();
    const orb = new THREE.Mesh(ORB_GEO, m.orb); orb.scale.setScalar(1.1); g.add(orb);
    const halo = new THREE.Sprite(m.halo); halo.scale.setScalar(1.1); g.add(halo);
    const glyph = new THREE.Sprite(m.glyph); glyph.scale.setScalar(0.55); glyph.position.y = 0.62; g.add(glyph);
    return g;
  }
  if (type === 'gold') {
    const m = new THREE.Mesh(COIN_GEO, COIN_MAT);
    m.rotation.x = Math.PI / 2;
    return m;
  }
  const g = new THREE.Group();
  const s = new THREE.Mesh(ORB_GEO, ORB_MAT);
  g.add(s);
  const halo = new THREE.Sprite(HALO_MAT);
  halo.scale.setScalar(0.9);
  g.add(halo);
  return g;
}
const COIN_GEO = new THREE.CylinderGeometry(0.09, 0.09, 0.025, 12);
const COIN_MAT = new THREE.MeshStandardMaterial({ color: 0xffc040, metalness: 1, roughness: 0.25, emissive: 0x402800, emissiveIntensity: 1 });
const ORB_GEO = new THREE.SphereGeometry(0.16, 12, 8);
const ORB_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.4) });
const HALO_MAT = new THREE.SpriteMaterial({ color: new THREE.Color(1.2, 0.1, 0.15), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, map: (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})() });

// The merchant's stock. Gold should be a choice, not a shopping list: every
// purchase marks the rest of this merchant's wares up by a quarter (compounding),
// and refining a tome you already hold is always on offer, dearer each time, so
// spare gold still has a use but never buys everything.
const SHOP_MARKUP = 1.25;
function makeShopStock(game, p) {
  const f = game.floorIndex;
  const items = [];
  items.bought = 0;
  // (preview: the from -> to the shop shows; a `tome` is previewed from its stats)
  items.push({ name: 'Healing Draught', desc: 'Restore 50% health.', icon: 'heart', base: 30 + f * 12, apply: (pl) => { pl.heal(pl.maxHp * 0.5); game.healPulse = 1; },
    preview: (pl) => [['Health', `${Math.ceil(pl.hp)}`, `${Math.min(pl.maxHp, Math.ceil(pl.hp + pl.maxHp * 0.5))}`]] });
  const vigor = { def: TOMES.find((t) => t.id === 'vitality'), rarity: 0, mult: 1.25 };
  items.push({ name: 'Elixir of Vigor', desc: '+25 max health.', icon: 'heart', base: 70 + f * 22, tome: vigor, apply: (pl) => { pl.upgrades.push({ ...vigor }); pl.recomputeStats(); } });
  { const id = randomItem(), d = ITEMS[id]; items.push({ name: d.name, desc: d.desc + ' (Item: one use.)', icon: d.icon, color: d.color, relic: true, base: 45 + f * 14, apply: () => game.giveItem(id),
    preview: (pl) => [['Item', pl.item ? ITEMS[pl.item]?.name ?? 'none' : 'none', d.name]] }); }
  const tomes = rollTomes(p, 3, 1);
  for (const t of tomes) items.push({ name: t.def.name, desc: (t.def.aug ? `Augment · ${t.def.spellName}. ` : '') + t.def.desc(t.mult), icon: t.def.icon, rarity: t.rarity, base: [60, 110, 180, 290][t.rarity] + f * 28, tome: t, apply: () => game.grantTome(t) });
  const rel = rollRelics(p, 1);
  for (const r of rel) items.push({ name: r.def.name, desc: relicDesc(r.def), icon: r.def.icon, base: 200 + f * 45, relic: true, color: relicColor(r.def), apply: () => game.grantRelic(r) });
  // refining: three of your tomes, each a rarity finer; may be bought again (dearer)
  items.push({ name: 'Refine a Tome', desc: 'Raise one of three of your tomes a rarity (Common to Rare, Rare to Epic...).', icon: 'glyph', base: 120 + f * 35, refine: true, uses: 0,
    available: (pl) => pl.upgrades.some((u) => u.def && !u.def.hidden && (u.rarity ?? 0) < 3 && u.def.id !== 'vitality'),
    apply: (pl, refund) => game.refineTome(pl, refund) });
  priceShop(game, items);
  return items;
}
function priceShop(game, items) {
  const k = (game.difficulty.shopCost ?? 1) * SHOP_MARKUP ** items.bought; // (the Avarice pact, then the markup)
  for (const it of items) it.price = Math.round(it.base * k * (it.refine ? 1.6 ** it.uses : 1));
}

export { typeIndex, soundEl, K_WATER, ROOM };
