import * as THREE from 'three';
import { TextureFactory } from '../render/textures.js';
import { LightPool } from '../render/lights.js';
import { Particles, SPR } from '../render/particles.js';
import { VFX, fxOf } from '../render/vfx.js';
import { generateLevel, ROOM, T, K_ALT, K_WATER } from '../world/levelgen.js';
import { buildLevel } from '../world/builder.js';
import { Collision } from '../world/collision.js';
import { BIOMES } from '../world/biomes.js';
import { SpellRuntime, soundEl } from './spells.js';
import { ActorManager, typeIndex } from './actors.js';
import { Director } from './director.js';
import { LocalPlayer } from './player.js';
import { RemotePlayer } from './remote.js';
import { resolveHit, ST, REACTIONS } from '../game/combat.js';
import { getViewModel, preloadEnemies, getEnemyModel, getAvatar, setEnemyRim } from './models.js';
import { rollTomes, rollRelics, RARITY, TOMES } from './upgrades.js';
import { makeChest, makePedestal, makePortal } from './interactables.js';
import { CLASS_META } from './classMeta.js';
import { ENEMY_DEFS, BOSS_DEFS } from './enemyDefs.js';
import { rand } from '../core/rng.js';
import { clamp } from '../core/math.js';

// ---------------------------------------------------------------------------
// Game: owns the world for one run and wires every system together.
// ---------------------------------------------------------------------------

const _v = new THREE.Vector3();

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
    this.particles = new Particles(this.scene);
    this.vfx = new VFX(this.scene, renderer.camera, this.particles, this.lights);
    this.spells = new SpellRuntime(this);
    this.actors = new ActorManager(this);
    this.director = new Director(this);
    this.time = 0;
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
  }

  // ======================================================================
  // run setup
  // ======================================================================
  startRun({ seed, localId, name, classId, isHost, net, players = [], floor = 0 }) {
    this.player?.endChannel();
    this.cinematic = null;
    this.ui?.letterbox?.(false);
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
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
    this.ended = false;
    for (const p of players) if (p.id !== localId) this.addRemote(p);
    this._setViewModel(classId);
    this.ui?.onRunStart(this);
    this.loadFloor(floor);
  }

  _setViewModel(classId) {
    if (this.viewmodel) { this.renderer.viewScene.remove(this.viewmodel.root); this.viewmodel.dispose?.(); }
    this.viewmodel = getViewModel(classId, this);
    this.renderer.viewScene.add(this.viewmodel.root);
    this.selfLight.color.set(CLASS_META[classId].color);
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
    this.isSolo = false;
    this.ui?.toast(`${p.name} joined as ${CLASS_META[p.classId].name}`);
  }
  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.dispose();
    this.remotes.delete(id);
    this.ui?.toast(`${r.name} left the party`);
  }

  allPlayers() {
    const out = this.player ? [this.player] : [];
    for (const r of this.remotes.values()) out.push(r);
    return out;
  }
  playerById(id) { return id === this.player?.id ? this.player : this.remotes.get(id); }

  loadFloor(index) {
    this.player?.endChannel();
    // tear down
    if (this.built) { this.scene.remove(this.built.group); this.built.dispose(); }
    for (const i of this.interactables) i.dispose?.();
    this.interactables = [];
    this.spells.clear();
    this.actors.clear();
    for (const d of this.drops) this.scene.remove(d.mesh);
    this.drops = [];
    this.hazards = [];
    this.pools = [];

    this.floorIndex = index;
    const level = generateLevel(this.seed, index);
    this.level = level;
    this.biome = level.biome;
    this.collision = new Collision(level);
    this.built = buildLevel(level, this.texFactory, this.lights);
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
    preloadEnemies([...new Set([...b0.enemies, ...b0.elites, b0.boss, 'skeleton', 'hound', 'slime', 'slimeling'].map((t) => ENEMY_DEFS[t]?.model ?? BOSS_DEFS[t]?.model ?? t))], this);
    // atmosphere
    const b = this.biome;
    this.scene.fog = new THREE.FogExp2(b.fog.color, b.fog.density);
    this.scene.background = new THREE.Color(b.fog.color);
    this.particles.setFog(b.fog.density, b.fog.color);
    this.hemi.color.set(b.ambient.sky);
    this.hemi.groundColor.set(b.ambient.ground);
    this.hemi.intensity = b.ambient.intensity * 3;
    this.baseHemi = this.hemi.intensity;
    this.moon.intensity = b.moon ? b.moon.intensity * 1.6 : 0;
    const shadows = !!b.moon && this.renderer.renderer.shadowMap.enabled;
    this.moon.castShadow = shadows;
    this.built.group.traverse((o) => { if (o.isMesh && !o.material.transparent && o.name?.startsWith('lvl_')) { o.castShadow = shadows; o.receiveShadow = shadows; } });
    this.shadowsOn = shadows;
    if (b.moon) this.moon.color.set(b.moon.color);
    this.renderer.setGrade(b.grade);
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
          update: (dt, t) => npc.update(dt, { anim: 'idle', t, speed: 0, pitch: Math.sin(t * 0.5) * 0.1, castProgress: 0, strafe: 0 }),
          dispose: () => { this.scene.remove(npc.root); npc.dispose?.(); },
        });
      }
    }
    // place players
    this.player.rerolls = 1;
    const s = level.spawn;
    this.player.spawnAt(s.x, s.z, 0);
    if (this.player.downed) { this.player.downed = false; this.player.hp = Math.max(this.player.hp, Math.round(this.player.maxHp * 0.5)); }
    if (this.player.dead) { this.player.dead = false; this.player.hp = Math.round(this.player.maxHp * 0.5); }
    for (const r of this.remotes.values()) { r.pos.set(s.x, 0, s.z); r.net.x = s.x; r.net.z = s.z; }
    level.startRoom.visited = true;
    this._buildDoorSigns();
    setEnemyRim(b.rim ?? 0x806a60, 0.45);
    this.audio?.setAmbience(b.id);
    this.audio?.setMusic(index === 0 ? 'explore' : 'explore');
    this.audio?.play('floor_enter');
    this.ui?.onFloor(this, b, index);
    if (index === 0 && !this.menuMode) this._tutorialTips();
    this._prewarm(level);
  }

  // Compile shaders for everything that will appear on this floor (enemy
  // models, projectile meshes, effect pools) so first appearances don't hitch.
  _prewarm(level) {
    const tmp = [];
    try {
      const b = level.biome;
      const types = [...new Set([...b.enemies, ...b.elites, b.boss].map((t) => ENEMY_DEFS[t]?.model ?? BOSS_DEFS[t]?.model ?? t))];
      const cam = this.renderer.camera;
      const front = cam.position.clone().add(new THREE.Vector3(0, 0, -3).applyQuaternion(cam.quaternion));
      for (const t of types) {
        const m = getEnemyModelSafe(t, this);
        if (!m) continue;
        m.root.position.copy(front);
        this.scene.add(m.root);
        tmp.push(() => { this.scene.remove(m.root); m.dispose?.(); });
      }
      for (const key of Object.keys(this.spells.meshCache)) {
        const def = this.spells.meshCache[key];
        const mesh = new THREE.Mesh(def.geo, def.mat ?? this.spells._orbMat('arcane'));
        mesh.position.copy(front);
        this.scene.add(mesh);
        tmp.push(() => this.scene.remove(mesh));
      }
      for (const pool of [this.vfx.ringPool, this.vfx.telePool, this.vfx.beamPool, this.vfx.shellPool, this.vfx.decalPool, this.vfx.boltPool]) {
        const it = pool.items[0];
        if (it.visible) continue;
        it.visible = true;
        tmp.push(() => { it.visible = false; });
      }
      this.renderer.renderer.compile(this.scene, cam);
      this.renderer.renderer.compile(this.renderer.viewScene, this.renderer.viewCamera);
    } catch (e) { console.warn('prewarm failed', e); }
    for (const f of tmp) f();
  }

  _tutorialTips() {
    let seen = 0;
    try { seen = +(localStorage.getItem('arcane-ascent-tips') ?? 0); } catch { /* ignore */ }
    if (seen >= 2) return;
    try { localStorage.setItem('arcane-ascent-tips', String(seen + 1)); } catch { /* ignore */ }
    const sp = this.player.cls.spells;
    // shown one at a time, and never over a boss fight, a cinematic or a menu
    this._tipQ = [
      'WASD to move · Mouse to aim · Space to jump',
      `Hold Left Click — ${sp.primary.name}`,
      `Right Click — ${sp.secondary.name}`,
      `Q — ${sp.ability1.name} · E — ${sp.ability2.name}`,
      'Shift to dash — you are briefly invulnerable',
      'Kill an enemy mid-windup to interrupt its attack',
      'F to interact · Tab for the map · G to ping',
    ];
    this._tipT = 2.5;
    // contextual tips fire when they become relevant
    this._ctxTips = { sigil: 'Sigils above doorways reveal what lies beyond', ult: `R — ${sp.ultimate.name} is ready`, keg: 'Red powder kegs explode — lure foes close, then strike' };
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
    const glyph = { boss: ['☠', '#ff5040'], shop: ['⚖', '#f0c050'], shrine: ['✚', '#ffe080'], treasure: ['♦', '#ffb030'], elite: ['★', '#ff9040'], combat: ['⚔', '#d8c8a8'], start: null };
    for (const door of L.doors) {
      const other = L.rooms[door.other];
      const g = glyph[other.type];
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
  }
  breakProp(i, local = false) {
    const b = this.level.breakables[i];
    if (!b || !b.alive) return;
    b.alive = false;
    this.collision.removeCollider(b.collider);
    this.built.hideBreakable(b);
    const gy = this.groundY(b.x, b.z);
    const c = new THREE.Vector3(b.x, gy + 0.5, b.z);
    this.vfx.burst(c, { count: 22, speed: 6, life: 1.1, size: 0.12, sprite: SPR.CHUNK, solid: true, color: [0.34, 0.22, 0.12], color2: [0.25, 0.16, 0.09], gravity: 16, spin: 8, upward: 0.8 });
    this.vfx.smoke(c, { count: 4, size: 0.6, color: [0.3, 0.26, 0.2], alpha: 0.4, life: 1.4 });
    if (b.type === 'barrel' && Math.random() < 0.5) this.vfx.burst(c, { count: 16, speed: 3, life: 0.8, size: 0.06, sprite: SPR.DROP, solid: true, color: [0.25, 0.12, 0.05], gravity: 12, upward: 1 });
    if (b.type === 'keg') this.spells.after(0.18, () => this._kegBlast(b, c, local));
    this.audio?.play('impact_earth', { pos: c, volume: 0.7 });
    if (local) this.net?.broadcastOrSend({ t: 'brk', i });
    if (this.isHost && Math.random() < 0.35) this.spawnDrop(Math.random() < 0.2 ? 'health' : 'gold', c, Math.random() < 0.2 ? 15 : 3 + this.floorIndex * 2);
  }

  // A powder keg goes off. Everyone sees the blast and checks their own player;
  // the player who broke it deals the damage to enemies and sets off nearby kegs.
  _kegBlast(b, c, local) {
    const R = 3.6;
    this.vfx.explosion(c, 'fire', R, { groundY: c.y - 0.5 });
    this.vfx.addShake?.(0.35);
    this.audio?.play('explosion_big', { pos: c });
    const p = this.player;
    if (p.alive && !p.downed && !p.dead && p.pos.distanceTo(c) < R + 0.4) p.takeDamage(Math.round(p.maxHp * 0.18), 'fire', c);
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
    if (id === 'sewers' && Math.random() < dt * 4) {
      const x = cam.x + rnd(14), z = cam.z + rnd(14);
      const c = this.level.ceilAt(x, z);
      if (c < 50) P.solid({ x, y: c - 0.1, z, vy: -1, r: 0.35, g: 0.45, b: 0.4, a: 0.7, life: 1.2, size: 0.04, sprite: SPR.DROP, gravity: 12, stretch: 0.02 });
    }
    if (id === 'courtyard' && Math.random() < dt * 6) {
      P.glow({ x: cam.x + rnd(20), y: cam.y + rnd(2) - 0.5, z: cam.z + rnd(20), vx: rnd(0.6), vy: rnd(0.3), vz: rnd(0.6), r: 1.6, g: 2.2, b: 0.6, life: 4, size: 0.04, sprite: SPR.GLOW, drag: 0.1 });
    }
    if (id === 'courtyard' && Math.random() < dt * 3) {
      P.solid({ x: cam.x + rnd(24), y: cam.y + 6, z: cam.z + rnd(24), vx: 1.2, vy: -0.6, vz: rnd(0.5), r: 0.25, g: 0.2, b: 0.12, a: 0.8, life: 7, size: 0.06, sprite: SPR.FEATHER, spin: 2 });
    }
    if (id === 'throne' && Math.random() < dt * 10) {
      P.glow({ x: cam.x + rnd(20), y: cam.y + 4 + rnd(2), z: cam.z + rnd(20), vx: rnd(0.3), vy: -0.4, vz: rnd(0.3), r: 1.2, g: 0.5, b: 1.6, r2: 0.2, g2: 0.05, b2: 0.3, life: 8, size: 0.04, sprite: SPR.EMBER, drag: 0.2 });
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
    this.time += dt;
    this.stats.time += realDt;
    const input = this.input;
    const p = this.player;

    if (!this.paused) {
      p.update(dt, input);
      this._interactions(dt, input);
    }
    for (const r of this.remotes.values()) r.update(dt);
    if (!this.paused || !this.isSolo) {
      if (this.isHost) this.director.update(dt);
      this.actors.update(dt);
      this.spells.update(dt);
      this._updateHazards(dt);
      this._updatePools(dt);
      this._updateDrops(dt);
    }
    for (const it of this.interactables) it.update?.(dt, this.time);
    this._updateTips(realDt);
    this._updateDoorSigns(realDt);
    this._ambient(realDt);

    // camera & lighting
    const cam = this.renderer.camera;
    p.updateCamera(cam, realDt, this.vfx, this.time);
    if (this.cinematic) this._cinematicCam(cam, realDt);
    else if (p.dead && !this.isSolo) this._spectate(cam, realDt);
    this.selfLight.position.copy(cam.position).add(_v.set(0, -0.2, 0));
    this.selfLight.intensity = (p.dead ? 0 : 2.2) * (this.settings.selfLight ?? 1);
    // flames
    const cx = cam.position.x, cz = cam.position.z;
    for (const f of this.built.flames) {
      const dx = f.x - cx, dz = f.z - cz;
      if (dx * dx + dz * dz > 1300) continue;
      this.vfx.flame(f, realDt);
    }
    this.lights.update(realDt, this.time, cam.position);
    this.built.update(realDt, this.time);
    this.vfx.update(dt, this.time, realDt);
    this.particles.update(this.time);
    this._viewModel(realDt);
    this._postFx(realDt);
    // moon follows the player so its (unused) shadow frustum would be centred
    const snap = 72 / 2048 * 4;
    const mx = Math.round(cx / snap) * snap, mz = Math.round(cz / snap) * snap;
    this.moon.target.position.set(mx, 0, mz);
    this.moon.position.set(mx + 30, 70, mz - 60);
    // audio listener
    this.audio?.setListener(cam.position, p.forward());
    this.audio?.setIntensity?.(p.alive && !p.downed ? clamp(1 - p.hp / p.maxHp - 0.4, 0, 1) * 1.6 : 1);
    // net
    if (this.net) this.net.tick(realDt, this);
    this.ui?.update(realDt, this);
    this._checkRunEnd(realDt);
  }

  _viewModel(dt) {
    const vm = this.viewmodel;
    if (!vm) return;
    const p = this.player;
    const ca = p.castAnim;
    vm.root.visible = !p.dead && this.settings.showHands !== false;
    vm.update(dt, {
      t: this.time, speed: p.speedNorm ?? 0, grounded: p.grounded, look: p.lookDelta,
      cast: ca ? { slot: ca.slot, hand: ca.hand, t: ca.t, style: p.channel ? 'channel' : ca.style } : null,
      charge: p.channel ? Math.min(1, p.channel.t / p.channel.max) : 0, dash: p.dashT > 0, hurt: p.hurtPulse, downed: p.downed,
    });
    vm.setPower?.(p.ult >= 100 ? 1 : 0);
    // mirror the two strongest nearby world lights into the view scene so the
    // hands are lit by real torches and spells
    const cam = this.renderer.camera;
    const all = [...this.lights.torchLights, ...this.lights.fxLights];
    const scored = all.filter((l) => l.intensity > 0.01).map((l) => ({ l, s: l.intensity / (1 + l.position.distanceToSquared(cam.position)) })).sort((a, b) => b.s - a.s);
    const inv = cam.matrixWorldInverse;
    for (let i = 0; i < this.viewLights.length; i++) {
      const vl = this.viewLights[i];
      const src = scored[i]?.l;
      if (!src) { vl.intensity = 0; continue; }
      const d = src.position.distanceTo(cam.position);
      const local = src.position.clone().applyMatrix4(inv);
      local.setLength(Math.min(2.5, Math.max(0.8, d * 0.3)));
      vl.position.copy(local);
      vl.color.copy(src.color);
      vl.intensity = src.intensity * 0.25 / (1 + d * 0.15);
    }
  }

  _postFx(dt) {
    const g = this.renderer.grade.uniforms;
    const p = this.player;
    const lowHp = p.alive && !p.downed ? clamp(1 - p.hp / p.maxHp, 0, 1) : 1;
    g.uDamage.value = clamp(p.hurtPulse * 0.8 + Math.max(0, lowHp - 0.6) * 1.2 * (0.7 + 0.3 * Math.sin(this.time * 6)), 0, 1);
    g.uHeal.value = Math.max(0, (this.healPulse ?? 0));
    this.healPulse = Math.max(0, (this.healPulse ?? 0) - dt * 1.5);
    g.uDesat.value = p.downed || p.dead ? 0.85 : 0;
    if (this.tint.t > 0) {
      this.tint.t -= dt;
      const k = Math.min(1, this.tint.t * 3);
      g.uTint.value.set(1 + (this.tint.rgb[0] - 1) * k, 1 + (this.tint.rgb[1] - 1) * k, 1 + (this.tint.rgb[2] - 1) * k);
    } else g.uTint.value.set(1, 1, 1);
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
    let dmg = Math.max(1, Math.round(res.dmg * mult));
    if (H.tag === 'dot') dmg = Math.max(0, Math.round(res.dmg * mult));
    const elShow = H.el;
    // reaction effects
    if (res.reaction) {
      const R = REACTIONS[res.reaction];
      this.ui?.floatText(pos.clone().add(_v.set(0, 0.6, 0)), R.name, R.color, true);
      this.audio?.play('reaction', { pos });
      this.vfx.explosion(pos, H.el === 'lightning' ? 'lightning' : H.el, 2.2, { groundY: this.groundY(pos.x, pos.z), shakeScale: 0.5 });
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
          this.hitActor(n, { dmg: H.dmg * 0.6, el: 'lightning', st: { shock: 3 }, noReact: true, src: p.id }, np);
          cur = np;
        }
      }
      if (res.reaction === 'shatter') this.audio?.play('shatter', { pos });
    }
    // relic procs
    if (st.smite && H.tag !== 'dot' && H.tag !== 'smite' && Math.random() < st.smite) {
      const top = new THREE.Vector3(a.pos.x + rand(-1, 1), a.pos.y + 12, a.pos.z + rand(-1, 1));
      this.vfx.lightning(top, new THREE.Vector3(a.pos.x, a.pos.y + 0.5, a.pos.z), { life: 0.2, branches: 2, width: 0.12 });
      this.spells.after(0.02, () => this.hitActor(a, { dmg: 25, el: 'lightning', tag: 'smite', st: { shock: 2 }, src: p.id }, pos));
    }
    if (res.crit && st.critHeal) p.heal(st.critHeal, true);
    // statuses: scale by status power and add class/tome extras
    let stPayload = H.st;
    if (stPayload && stPayload.poison && st.poisonBonus && H.tag !== 'dot') stPayload = { ...stPayload, poison: [stPayload.poison[0], stPayload.poison[1]] };
    // local feedback
    if (dmg > 0) {
      if (H.tag !== 'dot') a.hitFlash = res.crit ? 0.6 : 0.4;
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
      if (!H.noNumber) this.ui?.damageNumber(pos, dmg, elShow, res.crit, H.tag === 'dot', a.id);
      if (H.tag !== 'dot') {
        this.ui?.hitmarker(res.crit, a.hp - dmg <= 0);
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
    p.onDealtDamage(dmg, false);
    this.stats.damage += dmg;
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
    const gold = Math.round((a.def.gold ?? 1) * (a.elite ? 4 : 1) * (1 + this.floorIndex * 0.25));
    if (gold > 0) this.spawnDrop('gold', a.pos, gold);
    if (Math.random() < (a.elite ? 1 : a.boss ? 0 : 0.1)) this.spawnDrop('health', a.pos, 18 + this.floorIndex * 4);
    // kill credit
    if (killer === this.player.id) this.onLocalKill(a);
    else if (killer) this.net?.sendTo(killer, { t: 'kc', id: a.id, el, x: a.pos.x, z: a.pos.z, hx: a.mask & ST.hex ? 1 : 0, b: a.mask & ST.burn ? 1 : 0 });
    if (a.boss) this.onBossKilled(a);
  }

  onLocalKill(a, hexed, burning) {
    const p = this.player;
    p.onDealtDamage(0, true);
    if (p.stats.hexKill && (hexed ?? (a && a.mask & ST.hex))) {
      p.heal(5);
      for (const s in p.cds) if (p.cds[s] > 0) p.cds[s] = Math.max(0, p.cds[s] - 1);
    }
    // pyromancer: burning enemies explode
    if (p.stats.burnExplode && (burning ?? (a && a.mask & ST.burn)) && a) {
      const c = new THREE.Vector3(a.pos.x, a.pos.y + 1, a.pos.z);
      this.vfx.explosion(c, 'fire', 2.5);
      this.audio?.play('explosion', { pos: c, volume: 0.7 });
      this.spells.damageArea(c, 3, { dmg: 18, el: 'fire', st: { burn: [3, 4] }, src: p.id, noReact: true, tag: 'reaction' });
    }
    if (p.stats.raiseChance && a && Math.random() < p.stats.raiseChance && !a.boss) this.requestSummon('skeletonMinion', a.pos.clone(), 10, p.id);
  }

  onDotTick(a, dot) {
    const src = a.lastHitBy;
    const pos = new THREE.Vector3(a.pos.x, a.pos.y + a.height * 0.8, a.pos.z);
    if (src === this.player.id) this.ui?.damageNumber(pos, Math.round(dot), a.st.burn?.t > 0 ? 'fire' : a.st.poison?.t > 0 ? 'poison' : 'blood', false, true, a.id);
    else if (src) this.net?.sendTo(src, { t: 'dn', id: a.id, d: Math.round(dot) });
    if (src === this.player.id) { this.player.onDealtDamage(dot, false); this.stats.damage += dot; }
  }

  // ======================================================================
  // hazards (enemy attacks resolved by each victim locally)
  // ======================================================================
  broadcastHazard(h) {
    this.net?.broadcast({ t: 'hz', h });
    this.addHazard(h);
  }

  addHazard(h) {
    const hz = { ...h, t: 0, done: false, hitLocal: false };
    const color = h.el === 'enemyGreen' || h.el === 'poison' ? [1.0, 2.2, 0.2] : h.el === 'enemyPurple' || h.el === 'arcane' || h.el === 'necrotic' ? [1.6, 0.3, 2.6] : h.el === 'holy' ? [2.4, 1.9, 0.6] : h.el === 'frost' ? [0.6, 1.6, 2.6] : [2.6, 0.35, 0.1];
    hz.color = color.map((c) => c * 0.55);
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
      if (h.src !== id || h.t >= (h.delay ?? 0)) continue;
      if (h.tele && this.vfx.active.includes(h.tele)) h.tele.t = Math.max(h.tele.t, h.tele.life - 0.15);
      this.hazards.splice(i, 1);
      n++;
    }
    if (n && pos) this.ui?.floatText(pos, 'INTERRUPTED', '#e8c070');
    return n;
  }

  _updateHazards(dt) {
    const p = this.player;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.t += dt;
      if (h.shape === 'wave') {
        if (h.t < (h.delay ?? 0)) continue;
        const r = h.r + h.speed * (h.t - (h.delay ?? 0));
        // visual ring
        if (!h.ringMesh) {
          h.ringMesh = true;
          this.vfx.ring({ x: h.x, y: h.y ?? 0, z: h.z }, h.maxR, h.color, (h.maxR - h.r) / h.speed, 0.04);
        }
        if (Math.random() < 0.8) {
          const a = Math.random() * Math.PI * 2;
          this.vfx.P.glow({ x: h.x + Math.cos(a) * r, y: (h.y ?? 0) + 0.2, z: h.z + Math.sin(a) * r, vy: 2, r: h.color[0], g: h.color[1], b: h.color[2], life: 0.4, size: 0.4, sprite: SPR.GLOW });
          this.vfx.smoke({ x: h.x + Math.cos(a) * r, y: (h.y ?? 0) + 0.2, z: h.z + Math.sin(a) * r }, { count: 1, size: 0.5, alpha: 0.3, color: [0.25, 0.2, 0.15] });
        }
        if (!h.hitLocal && p.alive && !p.downed && !p.dead) {
          const d = Math.hypot(p.pos.x - h.x, p.pos.z - h.z);
          const airborne = p.pos.y - this.groundY(p.pos.x, p.pos.z) > 0.45;
          if (Math.abs(d - r) < 0.7 && !airborne) {
            h.hitLocal = true;
            p.takeDamage(h.dmg, h.el, new THREE.Vector3(h.x, 0, h.z));
            this._knock(p, h.x, h.z, h.kb ?? 6);
          }
        }
        if (r >= h.maxR) this.hazards.splice(i, 1);
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
        if (inside) this.actors.damage(al, { dmg: h.dmg, el: h.el });
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
    // vertical tolerance (jumping over low swings doesn't count for circles)
    if (hit && h.shape !== 'los' && p.pos.y - (h.y ?? gy) > 2.5) hit = false;
    if (hit) {
      const attacker = h.src ? this.actors.byId.get(h.src) : null;
      const taken = p.takeDamage(h.dmg, h.el, new THREE.Vector3(h.x, 0, h.z), { attacker });
      if (taken > 0) {
        if (h.kb) this._knock(p, h.x, h.z, h.kb);
        if (h.st?.stun) { p.stunT = h.st.stun; }
        if (attacker?.affix === 'vampiric') {
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
    this.net?.broadcast({ t: 'ep', e });
    this.spawnEnemyProjectile(e);
  }
  spawnEnemyProjectile(e) {
    const el = e.el ?? 'enemy';
    const pos = new THREE.Vector3(e.x, e.y, e.z);
    this.spells.spawn({
      local: true, faction: 'enemy', el, pos, vel: new THREE.Vector3(e.vx, e.vy, e.vz), radius: e.mesh === 'arrow' ? 0.15 : 0.3,
      life: e.gravity ? 4 : 3.5, gravity: e.gravity ?? 0, core: e.mesh === 'arrow' ? 0 : 0.7, mesh: e.mesh, light: e.mesh === 'arrow' ? 0 : 5, trail: e.mesh === 'arrow' ? 0.2 : 1,
      homing: e.homing ?? 0, hit: { dmg: e.dmg, st: e.st },
      aoe: e.aoe ? { radius: e.aoe, dmg: e.dmg * 0.6, el } : null,
      onExpire: e.pool ? (pr, p) => this.spawnPoolLocal(p, e.pool[0], e.pool[1], e.pool[2], el) : null,
    });
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
    if (this.isHost && id === undefined) this.net?.broadcast({ t: 'drop', id: did, ty: type, x: pos.x, y: pos.y, z: pos.z, v: value });
    const count = type === 'gold' ? Math.min(8, Math.ceil(value / 3)) : 1;
    for (let i = 0; i < count; i++) {
      const mesh = makeDropMesh(type);
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
      const magnet = d.t > 0.6 && p.alive && !p.downed && (d.type === 'gold' ? dist < 6 : dist < 5 && p.hp < p.maxHp);
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
      d.mesh.rotation.y += dt * 4;
      if (d.type === 'health') this.lights.request(d.pos, 0xff3040, 2, 3);
      if (dist < 0.9 && magnet) {
        this._collect(d);
        this.scene.remove(d.mesh);
        this.drops.splice(i, 1);
      } else if (d.t > 60) { this.scene.remove(d.mesh); this.drops.splice(i, 1); }
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
    } else if (d.type === 'health') {
      p.heal(d.value);
      this.healPulse = 0.6;
      this.audio?.play('pickup_health');
      if (d.id > 0) this.net?.broadcastOrSend({ t: 'pick', id: d.id });
    }
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
    for (const did of room.doors) {
      const door = this.level.doors[did];
      this.built.setDoor(did, locked);
      this.collision.setDoorBlocked(door, locked);
    }
    this.audio?.play(locked ? 'door_close' : 'door_open', { pos: new THREE.Vector3(room.cx, 1, room.cz) });
    if (locked) {
      this.audio?.setMusic(room.type === ROOM.BOSS ? 'boss' : 'combat');
      if (room.type === ROOM.ELITE) this.ui?.banner('ELITE CHAMBER', 'A champion bars the way', '#ff9040');
      else if (room.sentriesPlaced) this.ui?.banner('SENTRIES', 'Strike before they rally', '#d08040');
      else if (room.type !== ROOM.BOSS) this.ui?.banner('AMBUSH', 'The doors slam shut', '#d04030');
    }
  }

  onRoomCleared(room) {
    this.audio?.setMusic('explore');
    this.audio?.play('room_clear');
    if (room.type === ROOM.BOSS) return; // handled by boss death
    this.ui?.banner('CHAMBER CLEARED', room.type === ROOM.ELITE ? 'A rare tome awaits' : 'Claim your reward', '#e8c070');
    // revive dead teammates at the end of a room
    if (this.player.dead) { this.player.dead = false; this.player.downed = false; this.player.hp = Math.round(this.player.maxHp * 0.3); this.player.spawnAt(room.cx, room.cz, this.player.yaw); this.ui?.toast('You return from beyond the veil'); }
    if (this.player.downed) this.player.revive(0.3);
    else if (this.player.alive && this.player.hp < this.player.maxHp) this.player.heal(this.player.maxHp * 0.15); // a breath of respite between fights
    this.spawnPedestal(room, room.type === ROOM.ELITE ? 1 : 0);
    if (this._ctxTips?.sigil) { this._tipQ?.unshift(this._ctxTips.sigil); this._ctxTips.sigil = null; }
    if (this.isHost) {
      const gold = Math.round((10 + this.floorIndex * 6) * (room.type === ROOM.ELITE ? 2.5 : 1));
      this.spawnDrop('gold', new THREE.Vector3(room.cx, this.groundY(room.cx, room.cz), room.cz), gold);
    }
  }

  spawnPedestal(room, minRarity) {
    const it = makePedestal(this, new THREE.Vector3(room.cx, this.groundY(room.cx, room.cz), room.cz), minRarity);
    this.interactables.push(it);
  }

  onWave(n, of) { this.ui?.wave(n, of); }

  addPing(msg) {
    const pl = this.playerById(msg.pid);
    const pg = { pos: new THREE.Vector3(msg.x, msg.y, msg.z), name: pl?.name ?? '?', color: pl ? '#' + pl.meta.color.toString(16).padStart(6, '0') : '#fff', t: 6 };
    this.pings.push(pg);
    this.audio?.play('ui_hover', { volume: 0.6 });
    setTimeout(() => { this.pings = this.pings.filter((x) => x !== pg); }, 6000);
  }

  onBossSpawn(a) {
    this.cinematic = { target: a, t: 0, dur: 2.6 };
    this.ui?.letterbox(true);
    this.ui?.bossIntro(a);
    this.audio?.play('boss_intro');
    this.audio?.setMusic('boss');
  }

  onBossKilled(a) {
    if (this.isHost) {
      this.net?.broadcast({ t: 'bossdead', id: a.id });
      this.bossDefeated(a.id);
    }
  }

  bossDefeated() {
    const room = this.level.bossRoom;
    this.audio?.play('victory_sting');
    this.audio?.setMusic('explore');
    this.vfx.addShake(1);
    // slow-mo moment
    this.vfx.hitstop = 0.6;
    if (this.floorIndex >= BIOMES.length - 1) {
      this.ui?.banner('THE HOLLOW KING HAS FALLEN', 'Dawn returns to the Ashen Keep', '#ffd860', 5);
      this.screenTint([1.35, 1.25, 1.0], 3);
      // the eclipse lifts: torches return to warm light
      for (const t of this.lights.torches) { t.intensity *= 2; t.color.set(0xffb060); }
      this.hemi.intensity = this.baseHemi * 1.6;
      const c = new THREE.Vector3(room.cx, this.groundY(room.cx, room.cz) + 3, room.cz);
      for (let i = 0; i < 6; i++) this.spells.after(i * 0.35, () => this.vfx.explosion(c.clone().add(new THREE.Vector3(rand(-6, 6), rand(0, 4), rand(-6, 6))), 'holy', 4));
      this.spells.after(4.5, () => this.victory());
      return;
    }
    this.ui?.banner('VANQUISHED', `${this.biome.name} is conquered`, '#ffd060');
    if (this.player.dead || this.player.downed) this.player.revive(0.5);
    this.player.heal(this.player.maxHp * 0.35);
    // legendary-leaning reward + gold + portal up
    this.spawnPedestal(room, 2);
    if (this.isHost) this.spawnDrop('gold', new THREE.Vector3(room.cx, 0, room.cz + 3), 60 + this.floorIndex * 30);
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

  victory() {
    if (this.ended) return;
    this.ended = true;
    this.net?.broadcast({ t: 'victory' });
    this.audio?.setMusic('victory');
    this.ui?.endScreen(true, this);
    saveRunStats(this, true);
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
    this.ui?.endScreen(false, this);
    saveRunStats(this, false);
  }

  onLocalDowned() {
    this.ui?.banner('YOU HAVE FALLEN', this.isSolo ? '' : 'Hold on — an ally can revive you', '#c02020');
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
      const aim = p.aimInfo();
      const msg = { t: 'ping', pid: p.id, x: aim.point.x, y: aim.point.y, z: aim.point.z };
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
      this.ui?.prompt(`Hold [F] to revive ${reviveTarget.name}`, this.reviveHold / 3);
      if (holding && Math.random() < dt * 10) this.vfx.burst(reviveTarget.pos.clone().add(_v.set(0, 0.5, 0)), { element: 'holy', count: 2, speed: 1, upward: 1, life: 0.8, size: 0.1, sprite: SPR.STAR });
      if (this.reviveHold >= 3) {
        this.reviveHold = 0;
        this.net?.sendTo(reviveTarget.id, { t: 'revive', f: 0.4 });
        this.audio?.play('revive');
      }
      return;
    }
    this.reviveHold = 0;
    if (p.downed) { this.ui?.prompt(this.isSolo ? null : `Bleeding out... ${Math.ceil(p.downT)}s`); return; }
    if (!best) { this.ui?.prompt(null); return; }
    this.ui?.prompt(`[F] ${best.label}`);
    if (input.was('interact')) this.interact(best);
  }

  interact(it) {
    const p = this.player;
    switch (it.kind) {
      case 'pedestal': {
        this.audio?.play('tome_open');
        const offer = () => {
          const choices = rollTomes(p, 3, it.minRarity ?? 0);
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
      case 'chest': {
        it.open();
        this.net?.broadcastOrSend({ t: 'chest', id: it.id });
        it.usedBy.add(p.id);
        this.audio?.play('chest_open', { pos: it.pos });
        const gold = 25 + this.floorIndex * 15;
        p.gold += gold; this.stats.gold += gold;
        this.ui?.toast(`+${gold} gold`);
        const relics = rollRelics(p, 3);
        if (relics.length) this.ui?.chooseRelic(relics, (r) => { if (r) this.grantRelic(r); });
        break;
      }
      case 'shrine': {
        this.audio?.play('shrine', { pos: it.pos });
        this.ui?.chooseBlessing([
          { name: 'Blessing of Mending', desc: 'Restore all health.', icon: 'heart', apply: () => { p.heal(p.maxHp); this.healPulse = 1; } },
          { name: 'Blessing of Fortitude', desc: '+30 max health.', icon: 'shield', apply: () => { p.upgrades.push({ def: TOMES.find((t) => t.id === 'vitality'), rarity: 1, mult: 1.5 }); p.recomputeStats(); } },
          { name: 'Pact of Blood', desc: 'Lose 30% of current health. Gain an Epic tome.', icon: 'drop', apply: () => { p.payHp(p.hp * 0.3); const c = rollTomes(p, 3, 2); this.ui?.chooseTome(c, (x) => x && this.grantTome(x)); } },
        ], () => { it.usedBy = it.usedBy ?? new Set(); it.usedBy.add(p.id); });
        break;
      }
      case 'shop': {
        if (!it.stock) it.stock = makeShopStock(this, p);
        this.ui?.openShop(it.stock, p, (item) => this.buy(item));
        break;
      }
      case 'portal':
        this.goNextFloor();
        break;
      default: break;
    }
  }

  grantTome(c) {
    const p = this.player;
    p.upgrades.push(c);
    p.recomputeStats();
    if (c.def.id === 'phoenix') { /* handled via stats.extraLives */ }
    this.audio?.play('tome_pick');
    this.vfx.burst(p.eye.clone().add(p.forward().multiplyScalar(1)), { element: 'arcane', count: 30, speed: 3, life: 1, size: 0.15, sprite: SPR.STAR });
    this.ui?.toast(`${c.def.name} (${RARITY[c.rarity].name})`, RARITY[c.rarity].color);
  }
  grantRelic(r) {
    const p = this.player;
    p.relics.push(r);
    r.def.onGain?.(p);
    p.recomputeStats();
    this.audio?.play('tome_pick');
    this.ui?.toast(`Relic: ${r.def.name}`, '#ffb030');
  }
  buy(item) {
    const p = this.player;
    if (item.sold || p.gold < item.price) { this.audio?.play('ui_error'); return false; }
    p.gold -= item.price;
    item.sold = true;
    this.audio?.play('buy');
    item.apply(p);
    return true;
  }

  // ======================================================================
  // visual effects requested by the boss scripts (all peers)
  // ======================================================================
  bossFx(kind, a, extra) {
    if (!a) return;
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
      case 'fly':
        a.model?.setFlying?.(!!extra.on);
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
      default: break;
    }
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

function makeDropMesh(type) {
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

function makeShopStock(game, p) {
  const f = game.floorIndex;
  const items = [];
  items.push({ name: 'Healing Draught', desc: 'Restore 50% health.', icon: 'heart', price: 30 + f * 10, apply: (pl) => { pl.heal(pl.maxHp * 0.5); game.healPulse = 1; } });
  items.push({ name: 'Elixir of Vigor', desc: '+25 max health.', icon: 'heart', price: 60 + f * 15, apply: (pl) => { pl.upgrades.push({ def: TOMES.find((t) => t.id === 'vitality'), rarity: 0, mult: 1.25 }); pl.recomputeStats(); } });
  const tomes = rollTomes(p, 3, 1);
  for (const t of tomes) items.push({ name: t.def.name, desc: t.def.desc(t.mult), icon: t.def.icon, rarity: t.rarity, price: [50, 90, 150, 240][t.rarity] + f * 15, apply: () => game.grantTome(t) });
  const rel = rollRelics(p, 1);
  for (const r of rel) items.push({ name: r.def.name, desc: r.def.desc, icon: r.def.icon, price: 180 + f * 25, relic: true, apply: () => game.grantRelic(r) });
  return items;
}

function saveRunStats(game, won) {
  try {
    const key = 'arcane-ascent-stats';
    const s = JSON.parse(localStorage.getItem(key) || '{}');
    s.runs = (s.runs ?? 0) + 1;
    if (won) s.wins = (s.wins ?? 0) + 1;
    s.bestFloor = Math.max(s.bestFloor ?? 0, game.floorIndex + 1);
    s.kills = (s.kills ?? 0) + game.stats.kills;
    const c = game.player.classId;
    s.classWins = s.classWins ?? {};
    if (won) s.classWins[c] = (s.classWins[c] ?? 0) + 1;
    localStorage.setItem(key, JSON.stringify(s));
  } catch { /* storage unavailable */ }
}

export { typeIndex, soundEl, K_WATER, ROOM };
