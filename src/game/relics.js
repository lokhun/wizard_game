import * as THREE from 'three';
import { SPR } from '../render/particles.js';
import { fxOf } from '../render/vfx.js';
import { ST } from './combat.js';
import { rand } from '../core/rng.js';
import { segPointDist2 } from '../core/math.js';
import { RELICS } from './upgrades.js';
import { soundEl } from './spells.js';
import { SETS, setCounts, ascendK } from './relicDefs.js';

// the relic behind each proc (its ascension raises the proc's damage)
const PROC_OF = { smite: 'stormcrown', glyph: 'ashglyph', trail: 'emberstride', kindle: 'kindling', meteor: 'meteorbrand', clap: 'thunderclap', wisp: 'soullantern', bell: 'gravebell', mine: 'rimewake', mineb: 'rimewake', thorns: 'thornheart', volley: 'metronome', fam: 'familiar', sent: 'stillwater', echo: 'afterimage' };

// ---------------------------------------------------------------------------
// Relic procs. Everything a relic does in a fight is decided here, on the
// machine of the player who owns it (where their damage is computed, like
// every spell hit), and goes through game.hitActor so co-op clients forward the
// numbers to the host as usual. Each proc is played as a named visual (_play)
// that is also broadcast ('rfx') so teammates see the same thing, visual only.
// Persistent visuals (orbiting motes, the familiar, the frost sentinel) are
// rebuilt on every machine from the owner's relic list ('own'), so they cost
// no traffic. Nothing here creates a material: sprites reuse the spell core
// materials, and the rest is the pooled VFX library (rings, bolts, decals,
// shells, explosions) and spell projectiles.
// ---------------------------------------------------------------------------

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const r2 = (x) => Math.round(x * 100) / 100;
const pk = (v) => [r2(v.x), r2(v.y), r2(v.z)];
const uv = (a) => V(a[0], a[1], a[2]);
const cen = (a) => V(a.pos.x, a.pos.y + (a.height ?? 1.6) * 0.55, a.pos.z);
const _v = new THREE.Vector3();
const TAU = Math.PI * 2;

// a familiar's bolt carries the sting of its master's school
const EL_ST = { fire: { burn: [3, 4] }, frost: { chill: 1 }, lightning: { shock: 2 }, poison: { poison: [1, 3] }, blood: { bleed: [3, 3] }, shadow: { hex: 1.5 }, time: { slow: 1 } };

export class RelicRuntime {
  constructor(game) {
    this._cur = null;
    this.g = game;
    this.own = new Set();     // the local player's relic ids
    this.sets = {};
    this.rigs = new Map();    // pid -> persistent visuals
    this.peerOwn = new Map(); // pid -> a teammate's relic ids (drives their rig here)
    this.mines = [];          // frost mines (local and teammates')
    this.echoes = [];         // afterimages waiting to burst
    this.mineId = 1;
    this.reset();
  }

  reset() {
    this.t = {}; this.kills = []; this.first = new WeakSet(); this.casts = 0; this.abil = 0;
    this.breathUsed = false; this.inFight = false; this.kindleT = 0; this.fever = 0; this.howl = false; this.stillT = 0; this.die = 0;
    this._fb = null;
  }

  get p() { return this.g.player; }
  has(id) { return this.own.has(id); }
  set(k) { return this.sets[k] ?? 0; }
  // proc damage grows a little with the realm (enemies grow ×4.8 by the last);
  // stats.dmgMult, crits and the rest still apply in hitActor
  // proc damage: grows with the realm (and keeps growing in the Abyss, where the realms
  // count again from the first), times the source relic's ascension
  pd(x, id = this._cur) {
    const f = (this.g.floorIndex ?? 0) + 5 * (this.g.abyss ?? 0);
    return x * (1 + 0.3 * f) * this.k(id);
  }
  k(id) { if (!id) return 1; const r = this.p.relics.find((x) => x.def.id === id); return ascendK(r?.stars); }
  ready(k, cd) { const t = this.g.time; if ((this.t[k] ?? -1e9) > t) return false; this.t[k] = t + cd; return true; }
  cdLeft(k) { return Math.max(0, (this.t[k] ?? 0) - this.g.time); }

  // ======================================================================
  // lifecycle
  // ======================================================================
  onRunStart() {
    this.reset();
    this.own = new Set(); this.sets = {};
    for (const pid of [...this.rigs.keys()]) this._dropRig(pid);
    this.peerOwn.clear();
    this._clearTransient();
    const g = this.g;
    // test hook: ?test=1&relics=id1,id2 grants relics at run start (for filming)
    const q = new URLSearchParams(location.search);
    if (q.get('test') && q.get('relics') && !g.menuMode) {
      for (const id of q.get('relics').split(',')) {
        const def = RELICS.find((r) => r.id === id.trim());
        if (def) g.grantRelic({ def }, true);
      }
    }
  }
  onFloor() {
    this._clearTransient();
    this.inFight = false;
    this._send('own', { ids: [...this.own] });
  }
  onPeerJoin() { this._send('own', { ids: [...this.own] }); }
  _clearTransient() {
    for (const m of this.mines) this.g.scene.remove(m.spr);
    this.mines.length = 0;
    this.echoes.length = 0;
  }

  // after a relic is gained: owned set, set bonuses crossing 2 or 3, and the
  // list teammates need to draw this player's rig
  refresh(quiet = false) {
    const p = this.p;
    this.own = new Set(p.relics.map((r) => r.def.id));
    const before = this.sets;
    this.sets = setCounts(p.relics);
    for (const k in this.sets) {
      const n = this.sets[k], was = before[k] ?? 0, S = SETS[k];
      if (quiet || !S || n === was || (n !== 2 && n !== 3)) continue;
      this.g.ui?.banner(`${S.name.toUpperCase()} AWAKENS`, `Set bonus (${n}) — ${n === 2 ? S.b2 : S.b3}`, S.color, 3.5);
      this.g.ui?.toast(`${S.name} set (${n}): ${n === 2 ? S.b2 : S.b3}`, S.color);
      this.g.audio?.play('level_up', { volume: 0.7 });
      this.g.vfx.ring(p.pos, 2.4, hexRGB(S.color, 1.6), 0.8, 0.14);
    }
    this._send('own', { ids: [...this.own] });
  }

  // ======================================================================
  // hooks from the game (local player only)
  // ======================================================================
  // extra damage multiplier for a hit (added to hitActor's mult)
  dmgMod(a, H) {
    if (H.tag === 'dot' || !this.has('firstblood') || this.first.has(a)) return 0;
    this.first.add(a);
    this._fb = a;
    return 0.6;
  }

  // after a hit is resolved (before it lands): procs, and the status payload it carries
  onHit(a, H, res, dmg, pos, stp) {
    const p = this.p, s = p.stats, g = this.g;
    const proc = H.tag !== 'dot' && !H.relic;
    if (this._fb === a) {
      this._fb = null;
      stp = { ...(stp ?? {}), mark: 4 };
      this._emit('imp', { a: pk(pos), e: 'blood', s: 1.4 });
    }
    if (stp?.burn && s.burnAmp) stp = { ...stp, burn: [stp.burn[0], stp.burn[1] * s.burnAmp] };
    if (proc && this.kindleT > 0 && !stp?.burn) stp = { ...(stp ?? {}), burn: [3, this.pd(5, 'kindling') * (s.burnAmp ?? 1)] };
    if (proc && res.crit && this.set('fang') >= 3) { stp = { ...(stp ?? {}), bleed: [3, this.pd(5)] }; p.heal(1, true); }
    // lightning from a clear sky (Storm Crown, Storm set)
    if (proc && s.smite && Math.random() < s.smite) this._smite(a, pos);
    if (proc && res.crit && this.has('ashglyph') && this.ready('glyph', 0.35)) this._emit('glyph', { a: [r2(a.pos.x), r2(g.groundY(a.pos.x, a.pos.z)), r2(a.pos.z)] });
    // overkill arcs on (an arc that overkills arcs again, a few times at most)
    if (this.has('conductor') && H.tag !== 'dot' && dmg > a.hp && (H.arc ?? 0) < 4) {
      const over = dmg - Math.max(0, a.hp);
      const n = over >= 4 ? g.spells.nearest(pos, 9, new Set([a.id])) : null;
      if (n) {
        const np = cen(n);
        this._emit('arcs', { s: [[...pk(pos), ...pk(np)]], e: 'lightning' });
        const arc = (H.arc ?? 0) + 1;
        g.spells.after(0.04, () => this._hit(n, Math.min(over * 0.8, this.pd(120, 'conductor')), 'lightning', { shock: 2 }, { arc }));
      }
    }
    return stp;
  }

  _smite(a, pos) {
    const g = this.g;
    this._emit('smite', { a: pk(pos) });
    g.spells.after(0.02, () => {
      // flat, as Storm Crown always was: it procs off every hit, so realm scaling made it
      // over half of a fast caster's damage (bot tally); tomes still scale it via dmgMult
      this._hit(a, 25, 'lightning', { shock: 2 }, { tag: 'smite' });
      if (this.set('storm') < 3) return;
      // Storm set (3): the strike arcs on to two more foes
      const hit = new Set([a.id]);
      let from = pos;
      const segs = [];
      for (let i = 0; i < 2; i++) {
        const n = g.spells.nearest(from, 8, hit);
        if (!n) break;
        hit.add(n.id);
        const np = cen(n);
        segs.push([...pk(from), ...pk(np)]);
        this._hit(n, 15, 'lightning', { shock: 2 });
        from = np;
      }
      if (segs.length) this._emit('arcs', { s: segs, e: 'lightning' });
    });
  }

  // a(ctor) died to this player's damage; mask: its statuses as it died
  onKill(a, mask = 0) {
    const g = this.g, p = this.p;
    if (!p || !a?.pos) return;
    const at = cen(a), t = g.time;
    this.kills.push(t);
    while (this.kills.length && t - this.kills[0] > 2.5) this.kills.shift();
    if (this.has('gravebell') && this.kills.length >= 3 && this.ready('bell', 2.5)) {
      this.kills.length = 0;
      this._emit('bell', { a: [r2(a.pos.x), r2(g.groundY(a.pos.x, a.pos.z)), r2(a.pos.z)] });
    }
    const wisps = (this.has('soullantern') ? 1 : 0) + (this.set('grave') >= 3 ? 1 : 0);
    for (let i = 0; i < wisps; i++) this._wisp(at, a);
    if (mask && this.has('plaguecenser')) this._spread(a, at, mask);
    if (this.set('pyre') >= 3 && (mask & ST.burn)) this._emit('nova', { a: pk(at) });
    if (this.set('tide') >= 3 && (mask & (ST.chill | ST.frozen))) this._emit('shat', { a: pk(at) });
  }

  _wisp(at, dead) {
    const g = this.g;
    // a dozen souls in flight is plenty
    if (g.spells.projectiles.reduce((n, pr) => n + (pr.data.wisp ? 1 : 0), 0) >= 12) return;
    const tg = g.spells.nearest(at, 22, new Set([dead.id]));
    const v = tg ? cen(tg).sub(at).normalize().multiplyScalar(9).add(V(rand(-2, 2), 3, rand(-2, 2))) : V(rand(-2, 2), 5, rand(-2, 2));
    this._emit('wisp', { a: pk(at), v: pk(v) });
  }

  // Plague Censer: the dead foe's afflictions leap to its neighbours
  _spread(a, at, mask) {
    const st = {}, els = [];
    if (mask & ST.burn) { st.burn = [3, this.pd(5, 'plaguecenser')]; els.push('fire'); }
    if (mask & ST.poison) { st.poison = [2, this.pd(3, 'plaguecenser')]; els.push('poison'); }
    if (mask & (ST.chill | ST.frozen)) { st.chill = mask & ST.frozen ? 3 : 2; els.push('frost'); }
    if (mask & ST.shock) { st.shock = 3; els.push('lightning'); }
    if (mask & ST.bleed) { st.bleed = [3, this.pd(4, 'plaguecenser')]; els.push('blood'); }
    if (mask & ST.hex) { st.hex = 3; els.push('shadow'); }
    if (!els.length) return;
    const tg = this.g.spells.inRadius(at, 5).filter((x) => x.id !== a.id).slice(0, 6);
    if (!tg.length) return;
    const segs = tg.map((x) => [...pk(at), ...pk(cen(x))]);
    // statuses only: a zero-damage 'dot' tagged hit carries them to the host
    for (const x of tg) this._hit(x, 0.01, els[0], st, { tag: 'dot', noNumber: true });
    this._emit('arcs', { s: segs, e: els });
  }

  onHurt(dmg) {
    const p = this.p;
    if (!(dmg > 0) || p.hp <= 0) return;
    if (this.has('thornheart') && this.ready('thorn', 0.8)) this._emit('thorns', { a: pk(V(p.pos.x, p.pos.y + 1.0, p.pos.z)), r: r2(rand(0, TAU)) });
    if (this.has('lastbreath') && !this.breathUsed && p.hp / p.maxHp < 0.3) {
      this.breathUsed = true;
      for (const a of this.g.actors.hostiles()) if (a.pos.distanceToSquared(p.pos) < 18 * 18) this._hit(a, 0.01, 'time', { slow: 4 }, { tag: 'dot', noNumber: true });
      p.hasteT = 4; p.recomputeStats();
      if (this.g.isSolo) this.g.slowMo(1.1, 0.3);
      this.g.screenTint([0.75, 1.15, 1.1], 1.4);
      this._emit('sands', { a: pk(p.pos) });
    }
  }

  onDash() {
    const g = this.g, p = this.p;
    const from = p.pos.clone();
    if (this.has('afterimage')) this._emit('echo', { a: pk(from) });
    if (!this.has('emberstride') && !this.has('thunderclap') && !this.has('rimewake')) return;
    // the dash lasts 0.18 s: the rest happens where it ends
    g.spells.after(0.2, () => {
      if (g.player !== p) return;
      const to = p.pos.clone();
      if (this.has('emberstride')) this._emit('trail', { a: [r2(from.x), r2(from.z)], b: [r2(to.x), r2(to.z)] });
      if (this.has('thunderclap')) this._emit('clap', { a: pk(to) });
      if (this.has('rimewake')) {
        for (let i = 0; i < 3; i++) {
          const k = (i + 0.5) / 3, x = from.x + (to.x - from.x) * k + rand(-0.7, 0.7), z = from.z + (to.z - from.z) * k + rand(-0.7, 0.7);
          if (g.collision.pointSolid(x, g.groundY(x, z) + 0.3, z)) continue;
          this._emit('mine', { i: this.mineId++, a: [r2(x), r2(g.groundY(x, z)), r2(z)] });
        }
      }
    });
  }

  onCast(slot) {
    const g = this.g, p = this.p;
    if (slot === 'primary') {
      if (this.has('metronome') && ++this.casts % 5 === 0) {
        const o = p.muzzleWorld('right'), d = p.aimInfo().point.sub(o).normalize();
        this._emit('volley', { o: pk(o), d: pk(d) });
      }
      return;
    }
    if (this.has('voidpact')) {
      p.payHp(p.maxHp * 0.05);
      g.vfx.burst(p.muzzleWorld('right'), { element: 'shadow', count: 10, speed: 2, life: 0.5, size: 0.08, sprite: SPR.WISP, upward: 0.5 });
    }
    if (this.has('meteorbrand') && this.ready('meteor', 8)) {
      const pt = p.aimInfo().point;
      const dx = pt.x - p.pos.x, dz = pt.z - p.pos.z, d = Math.hypot(dx, dz), k = d > 24 ? 24 / d : 1;
      const x = p.pos.x + dx * k, z = p.pos.z + dz * k;
      this._emit('meteor', { a: [r2(x), r2(g.groundY(x, z)), r2(z)] });
    }
    // Arcanum set (3): every 4th ability cast refunds its charge
    if (this.set('arcanum') >= 3 && slot !== 'ultimate' && ++this.abil % 4 === 0) {
      p.chargesLeft[slot]++;
      g.ui?.floatText(p.eye.add(p.forward().multiplyScalar(2)), 'ARCANUM', SETS.arcanum.color);
    }
  }

  onGold() {
    const p = this.p;
    if (!this.has('goldfever') || !this.ready('fever', 0.12)) return;
    this.fever = p.buffs.some((b) => b.id === 'midas') ? Math.min(10, this.fever + 1) : 1;
    p.addBuff('midas', 6, { dmgMult: 0.04 * this.fever });
    const b = p.buffs.find((x) => x.id === 'midas');
    if (b) b.icon = 'tooth';
    this.g.vfx.burst(p.muzzleWorld('right'), { count: 6, speed: 1.5, life: 0.6, size: 0.06, sprite: SPR.STAR, upward: 0.6, color: [1.6, 1.2, 0.3] });
  }

  // doors slam (true) or open (false); runs on every peer, for the local player
  onRoomLock(room, locked) {
    const p = this.p;
    if (!locked) { this.inFight = false; this._endDie(); return; }
    if (this.inFight) return;
    this.inFight = true;
    this.breathUsed = false;
    if (!p.alive || p.dead) return;
    if (this.has('kindling')) {
      p.addBuff('kindling', 8, { dmgMult: 0.25 });
      const b = p.buffs.find((x) => x.id === 'kindling');
      if (b) b.icon = 'fireball';
      this.kindleT = 8;
      this._emit('kindle', {});
    }
    if (this.has('undertow')) { p.addShield(Math.round(p.maxHp * 0.25), 10); this._emit('ward', {}); }
    if (this.has('gamblersdie')) this._roll();
  }

  onRoomClear() {
    const p = this.p;
    this.inFight = false;
    this._endDie();
    if (this.has('laurel') && p.alive && !p.dead) {
      p.laurels = (p.laurels ?? 0) + 1;
      p.recomputeStats();
      this.g.ui?.floatText(p.eye.add(p.forward().multiplyScalar(2.5)), `LAUREL +2% · ${p.laurels * 2}%`, '#ffd860');
      this._emit('laurel', {});
    }
  }

  _roll() {
    this._endDie();
    const p = this.p, f = 1 + Math.floor(Math.random() * 6);
    const boons = [{ dmgMult: 0.5 }, { rateMult: 0.4 }, { moveSpeed: p.stats.moveSpeed * 0.35, cdRate: 0.35 }, { critMult: 1 }];
    const names = ['+50% damage', '+40% attack speed', 'swift: +35% speed and cooldown rate', '+100% crit damage'];
    let mods, txt;
    if (f === 1) { mods = { dmgMult: -0.3 }; txt = 'Snake eyes — −30% damage this fight'; }
    else if (f === 6) { mods = {}; for (const b of boons) for (const k in b) mods[k] = (mods[k] ?? 0) + b[k]; txt = 'SIX — every boon is yours'; }
    else { mods = boons[f - 2]; txt = names[f - 2]; }
    this.die = f;
    p.addBuff('die', 9999, mods);
    const b = p.buffs.find((x) => x.id === 'die');
    if (b) { b.icon = 'dice'; b.label = String(f); }
    this.g.ui?.banner(`THE DIE SHOWS ${f}`, txt, f === 1 ? '#c02040' : '#e0306a', 2.5);
    this._emit('die', { f });
  }
  _endDie() {
    const p = this.p;
    if (!this.die || !p) return;
    this.die = 0;
    const i = p.buffs.findIndex((b) => b.id === 'die');
    if (i >= 0) { p.buffs.splice(i, 1); p.recomputeStats(); }
  }

  // ======================================================================
  // damage helpers (local)
  // ======================================================================
  _hit(a, dmg, el, st, extra) {
    if (!a?.alive) return;
    this.g.hitActor(a, { dmg, el, st, src: this.p.id, relic: 1, ...extra }, cen(a));
  }
  _area(pos, r, dmg, el, st, extra) {
    return this.g.spells.damageArea(V(pos.x, pos.y, pos.z), r, { dmg, el, st, kb: 4, src: this.p.id, relic: 1, ...extra });
  }
  _proj(pl, local, o) {
    return this.g.spells.spawn({ local, faction: 'player', owner: pl.id, ...o, hit: o.hit && { ...o.hit, relic: 1 } });
  }

  // ======================================================================
  // visuals (+ the owner's damage for effects that land later)
  // ======================================================================
  _send(k, o) { if (this.p && this.g.net) this.g.net.broadcastOrSend({ t: 'rfx', k, p: this.p.id, ...o }); }
  _emit(k, o) { this._play(k, o, this.p, true); this._send(k, o); }
  // a teammate's proc
  fx(msg) {
    if (msg.k === 'own') { this.peerOwn.set(msg.p, new Set(msg.ids ?? [])); return; }
    const pl = this.g.remotes.get(msg.p);
    if (pl) this._play(msg.k, msg, pl, false);
  }

  // (procs read their relic's ascension through pd() while they play)
  _play(k, o, pl, local) {
    this._cur = PROC_OF[k] ?? null;
    try { this._play0(k, o, pl, local); } finally { this._cur = null; }
  }
  _play0(k, o, pl, local) {
    const g = this.g, vfx = g.vfx, P = vfx.P, au = g.audio;
    const at = o.a?.length === 3 ? uv(o.a) : null;
    switch (k) {
      case 'smite': {
        const top = V(at.x + rand(-1, 1), at.y + 12, at.z + rand(-1, 1));
        vfx.lightning(top, at, { life: 0.2, branches: 2, width: 0.12 });
        vfx.impact(at, 'lightning', 0.9);
        au?.play('impact_lightning', { pos: at, volume: 0.45 });
        break;
      }
      case 'arcs': {
        const els = Array.isArray(o.e) ? o.e : [o.e];
        o.s.forEach((s, i) => {
          const a = V(s[0], s[1], s[2]), b = V(s[3], s[4], s[5]), el = els[i % els.length];
          vfx.lightning(a, b, { element: el, life: 0.22, branches: 1, width: 0.07 });
          vfx.impact(b, el, 0.7);
        });
        au?.play('impact_lightning', { pos: uv(o.s[0].slice(3)), volume: 0.4 });
        break;
      }
      case 'imp': vfx.impact(at, o.e, o.s ?? 1); break;
      // ---------------------------------------------------------- Pyre
      case 'glyph': {
        // a burning sigil sears into the floor, then erupts
        vfx.decal(at, 'glyph', 2.8, 1.1, 0xff5010);
        vfx.ring(at, 1.3, fxOf('fire').mid, 0.7, 0.18);
        au?.play('burn_tick', { pos: at, volume: 0.6 });
        g.spells.after(0.7, () => {
          const c = V(at.x, at.y + 0.6, at.z);
          vfx.explosion(c, 'fire', 2.2, { groundY: at.y, shakeScale: 0.4 });
          au?.play('explosion', { pos: c, volume: 0.6 });
          if (local) this._area(c, 2.4, this.pd(30), 'fire', { burn: [3, this.pd(5)] });
        });
        break;
      }
      case 'trail': {
        const ax = o.a[0], az = o.a[1], bx = o.b[0], bz = o.b[1];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(len / 1.3));
        for (let i = 0; i <= n; i++) { const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n; vfx.decal(V(x, g.groundY(x, z), z), 'scorch', 1.7, 4.5); }
        const mid = V((ax + bx) / 2, g.groundY((ax + bx) / 2, (az + bz) / 2) + 0.5, (az + bz) / 2);
        const fx = fxOf('fire');
        au?.play('cast_fire', { pos: mid, volume: 0.5 });
        g.spells.zone({ life: 3, interval: 0.4, local,
          visual: (z, dt) => {
            const fade = Math.min(1, (3 - z.age) * 2);
            // a hedge of flame tongues along the path, licking up out of a low glow
            for (let i = 0, m = Math.round((len + 1) * 22 * dt * fade + Math.random()); i < m; i++) {
              const k2 = Math.random(), x = ax + (bx - ax) * k2 + rand(-0.35, 0.35), zz = az + (bz - az) * k2 + rand(-0.35, 0.35), gy = g.groundY(x, zz);
              P.glow({ x, y: gy + 0.05, z: zz, vx: rand(-0.3, 0.3), vy: rand(1.4, 3), vz: rand(-0.3, 0.3), r: fx.mid[0] * 0.85, g: fx.mid[1] * 0.85, b: fx.mid[2] * 0.85, r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: rand(0.4, 0.75), size: rand(0.3, 0.55), size2: 0.08, sprite: SPR.FLAME, drag: 1.5, spin: 1.5 });
              if (i % 3 === 0) P.glow({ x, y: gy + 0.08, z: zz, r: fx.mid[0] * 0.3, g: fx.mid[1] * 0.3, b: fx.mid[2] * 0.3, life: 0.5, size: 0.9, size2: 0.6, sprite: SPR.GLOW });
            }
            g.lights.request(mid, fx.light, 7 * fade, 7);
          },
          onTick: () => {
            if (!local) return;
            for (const a of g.actors.hostiles()) {
              const d2 = segPointDist2(ax, 0, az, bx, 0, bz, a.pos.x, 0, a.pos.z);
              if (d2 < (1.1 + a.radius) ** 2 && a.pos.y < g.groundY(a.pos.x, a.pos.z) + 1.5) this._hit(a, this.pd(7), 'fire', { burn: [2, this.pd(6)] });
            }
          } });
        break;
      }
      case 'kindle': {
        const c = V(pl.pos.x, pl.pos.y + 1, pl.pos.z);
        vfx.ring(pl.pos, 2.2, fxOf('fire').mid, 0.6, 0.2);
        vfx.burst(c, { element: 'fire', count: 26, speed: 3.5, life: 0.7, size: 0.35, size2: 0.05, sprite: SPR.FLAME, upward: 0.9, drag: 2, jitter: 0.6 });
        au?.play('cast_fire_big', { pos: local ? undefined : c, volume: 0.55 });
        this._rig(pl).kindleT = 8;
        if (local) g.screenTint([1.18, 1.02, 0.86], 0.6);
        break;
      }
      case 'meteor': {
        const fx = fxOf('fire');
        vfx.ring(at, 3.2, fx.mid, 0.6, 0.08);
        const start = V(at.x + rand(-3, 3), at.y + 15, at.z + rand(-3, 3)), T = 0.55;
        g.spells.spawn({ local: false, faction: 'neutral', el: 'fire', pos: start, vel: V((at.x - start.x) / T, (at.y - start.y) / T, (at.z - start.z) / T), radius: 0.3, life: T, core: 0.8, mesh: 'meteor', meshScale: 0.75, light: 12, trail: 1.6, noWall: true });
        au?.play('cast_fire_big', { pos: at, volume: 0.5 });
        g.spells.after(T, () => {
          const c = V(at.x, at.y + 0.5, at.z);
          vfx.explosion(c, 'fire', 3.2, { groundY: at.y });
          au?.play('explosion_big', { pos: c, volume: 0.8 });
          if (local) this._area(c, 3.4, this.pd(70), 'fire', { burn: [4, this.pd(6)] }, { kb: 8 });
        });
        break;
      }
      case 'nova': {
        vfx.explosion(at, 'fire', 3, { groundY: g.groundY(at.x, at.z), shakeScale: 0.4 });
        au?.play('explosion', { pos: at, volume: 0.6 });
        if (local) this._area(at, 3.5, this.pd(35), 'fire', { burn: [3, this.pd(5)] });
        break;
      }
      // ---------------------------------------------------------- Storm
      case 'clap': {
        const fx = fxOf('lightning'), gy = g.groundY(at.x, at.z), c = V(at.x, gy + 0.3, at.z);
        vfx.ring({ x: at.x, y: gy, z: at.z }, 4.2, fx.mid, 0.45, 0.12);
        // bolts crawl out along the floor (they fade where they pass the lens)
        for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + rand(-0.2, 0.2), r = rand(3.2, 4.3); vfx.lightning(c, V(at.x + Math.cos(a) * r, gy + rand(0.1, 0.6), at.z + Math.sin(a) * r), { life: 0.22, branches: 1, width: 0.07 }); }
        vfx.dustWave(V(at.x, gy, at.z), 4, { color: [0.18, 0.18, 0.24], alpha: 0.3, glow: [fx.core[0] * 0.4, fx.core[1] * 0.4, fx.core[2] * 0.4] });
        vfx.flash(c, fx.light, 18, 9, 0.25);
        au?.play('cast_lightning_big', { pos: local ? undefined : c, volume: 0.7 });
        if (local) { vfx.addShake(0.15); this._area(V(at.x, gy + 0.8, at.z), 4, this.pd(28), 'lightning', { shock: 3, stun: 0.6 }, { kb: 7 }); }
        break;
      }
      // ---------------------------------------------------------- Grave
      case 'wisp': {
        vfx.burst(at, { element: 'necrotic', count: 8, speed: 1.6, life: 0.6, size: 0.22, sprite: SPR.WISP, upward: 0.8, drag: 2 });
        const pr = this._proj(pl, local, { el: 'necrotic', pos: at, vel: uv(o.v), radius: 0.3, life: 3.5, core: 0.55, light: 2, trail: 1.3, homing: 6, homingRange: 24, data: { wisp: 1 },
          hit: { dmg: this.pd(30), el: 'necrotic' } });
        pr.data.wisp = 1;
        break;
      }
      case 'bell': {
        const fx = fxOf('necrotic'), c = V(at.x, at.y + 1, at.z);
        // (the wide ring sweeps right under you: kept dim so it reads as a wave, not a wall)
        vfx.ring(at, 7, [fx.mid[0] * 0.45, fx.mid[1] * 0.45, fx.mid[2] * 0.45], 0.8, 0.06);
        g.spells.after(0.15, () => vfx.ring(at, 4.5, [fx.core[0] * 0.5, fx.core[1] * 0.5, fx.core[2] * 0.5], 0.6, 0.08));
        vfx.dustWave(at, 7, { color: [0.04, 0.08, 0.04], alpha: 0.4, glow: [fx.mid[0] * 0.5, fx.mid[1] * 0.5, fx.mid[2] * 0.5] });
        vfx.explosion(c, 'necrotic', 2.2, { groundY: at.y, shakeScale: 0.5 });
        au?.play('shockwave', { pos: c, volume: 0.8 });
        au?.play('summon', { pos: c, volume: 0.6 });
        if (local) this._area(c, 7, this.pd(40), 'necrotic', { slow: 3 }, { kb: 6, falloff: true });
        break;
      }
      // ---------------------------------------------------------- Tide
      case 'mine': {
        const spr = this._spr('frost', 0.32);
        spr.position.set(at.x, at.y + 0.3, at.z);
        this.mines.push({ key: pl.id + ':' + o.i, i: o.i, local, pos: at, spr, t: 0 });
        vfx.burst(V(at.x, at.y + 0.3, at.z), { element: 'frost', count: 6, speed: 1.5, life: 0.5, size: 0.06, sprite: SPR.SNOW, upward: 0.5 });
        break;
      }
      case 'mineb': {
        const key = pl.id + ':' + o.i, i = this.mines.findIndex((m) => m.key === key);
        if (i < 0) break;
        const m = this.mines[i];
        this.mines.splice(i, 1);
        g.scene.remove(m.spr);
        const c = V(m.pos.x, m.pos.y + 0.6, m.pos.z);
        vfx.explosion(c, 'frost', 2.4, { groundY: m.pos.y, shakeScale: 0.3 });
        au?.play('shatter', { pos: c, volume: 0.7 });
        if (local) this._area(c, 2.6, this.pd(30), 'frost', { chill: 3 }, { tag: 'shard' });
        break;
      }
      case 'ward': {
        vfx.ring(pl.pos, 1.8, fxOf('frost').mid, 0.7, 0.2);
        vfx.burst(V(pl.pos.x, pl.pos.y + 1, pl.pos.z), { element: 'frost', count: 20, speed: 2.5, life: 0.9, size: 0.08, sprite: SPR.SNOW, upward: 0.4, jitter: 0.6 });
        if (!local) vfx.shell(V(pl.pos.x, pl.pos.y + 1, pl.pos.z), { element: 'frost', radius: 1.3, life: 0.6, alpha: 0.6 });
        au?.play('shield', { pos: local ? undefined : pl.pos, volume: 0.6 });
        break;
      }
      case 'sands': {
        const fx = fxOf('time'), gy = g.groundY(at.x, at.z);
        vfx.ring({ x: at.x, y: gy, z: at.z }, 18, fx.mid, 1.2, 0.04);
        vfx.ring({ x: at.x, y: gy, z: at.z }, 4, fx.core, 0.9, 0.12);
        // the rings fly out low along the floor: from chest height they burst on the lens (glare.js)
        vfx.burst(V(at.x, gy + 0.3, at.z), { element: 'time', count: 18, speed: 7, life: 1.1, size: 0.2, sprite: SPR.RING, drag: 2.5, dir: V(0, 0.15, 0), spread: 3, color: [fx.mid[0] * 0.6, fx.mid[1] * 0.6, fx.mid[2] * 0.6] });
        au?.play('cast_time_big', { pos: local ? undefined : at, volume: 0.8 });
        break;
      }
      case 'shat': {
        vfx.explosion(at, 'frost', 3, { groundY: g.groundY(at.x, at.z), shakeScale: 0.4 });
        au?.play('shatter', { pos: at, volume: 0.6 });
        if (local) this._area(at, 4, this.pd(30), 'frost', { chill: 2 }, { tag: 'shard' });
        break;
      }
      // ---------------------------------------------------------- Fang
      case 'thorns': {
        const c = at;
        vfx.ring(V(c.x, g.groundY(c.x, c.z), c.z), 1.6, fxOf('blood').mid, 0.4, 0.2);
        for (let i = 0; i < 12; i++) {
          const a = o.r + (i / 12) * TAU, d = V(Math.cos(a), rand(-0.05, 0.15), Math.sin(a));
          // spawned clear of the lens: they start a stride out from the body
          this._proj(pl, local, { el: 'blood', pos: c.clone().addScaledVector(d, 0.9), vel: d.multiplyScalar(22), radius: 0.25, life: 0.55, core: 0.2, mesh: 'thorn', light: 0, trail: 0.3, pierce: 1,
            hit: { dmg: this.pd(18), el: 'blood', st: { bleed: [3, this.pd(4)] } } });
        }
        au?.play('impact_blood', { pos: local ? undefined : c, volume: 0.7 });
        break;
      }
      // ---------------------------------------------------------- Arcanum
      case 'volley': {
        let origin = uv(o.o);
        const d = uv(o.d);
        if (!local) { const tip = pl.muzzleWorld(); if (tip.distanceToSquared(origin) < 2.5) origin = tip; }
        vfx.muzzle(origin, d, 'arcane', 1.3);
        for (let i = 0; i < 5; i++) {
          const v = d.clone().applyAxisAngle(_up, (i - 2) * 0.22).add(V(0, (i % 2) * 0.08, 0)).normalize().multiplyScalar(24);
          this._proj(pl, local, { el: 'arcane', pos: origin, vel: v, radius: 0.18, life: 1.8, core: 0.42, light: i === 2 ? 3 : 0, trail: 0.8, homing: 7, hit: { dmg: this.pd(14), el: 'arcane' } });
        }
        au?.play('cast_arcane_big', { pos: local ? undefined : origin, volume: 0.5 });
        break;
      }
      case 'fam': case 'sent': {
        const frost = k === 'sent', el = frost ? 'frost' : o.e;
        const org = uv(o.o);
        vfx.burst(org, { element: el, count: 5, speed: 2, life: 0.25, size: 0.05, sprite: SPR.SPARK, drag: 3 });
        this._proj(pl, local, { el, pos: org, vel: uv(o.v), radius: 0.2, life: 1.6, core: 0.4, mesh: frost ? 'shard' : undefined, light: 2, trail: 0.8, homing: 3,
          hit: frost ? { dmg: this.pd(16), el: 'frost', st: { chill: 1 }, tag: 'shard' } : { dmg: this.pd(14), el, st: EL_ST[el] } });
        au?.play(`cast_${frost ? 'frost' : soundEl(el)}`, { pos: org, volume: 0.3 });
        break;
      }
      case 'echo': {
        this.echoes.push({ pos: at, t: 0, local, pid: pl.id });
        vfx.ring(at, 3, fxOf('arcane').mid, 1.0, 0.06);
        break;
      }
      case 'laurel': {
        vfx.ring(pl.pos, 1.8, [2.2, 1.7, 0.6], 0.9, 0.18);
        vfx.burst(V(pl.pos.x, pl.pos.y + 1.2, pl.pos.z), { count: 24, speed: 2, life: 1.2, size: 0.08, sprite: SPR.STAR, upward: 1, gravity: -1, color: [1.8, 1.4, 0.4], jitter: 0.5 });
        au?.play('level_up', { pos: local ? undefined : pl.pos, volume: 0.5 });
        break;
      }
      case 'die': {
        vfx.burst(V(pl.pos.x, pl.pos.y + 1.4, pl.pos.z), { count: 16, speed: 3, life: 0.8, size: 0.07, sprite: SPR.SPARK, upward: 0.8, color: o.f === 1 ? [1.6, 0.1, 0.25] : [1.8, 1.3, 0.4], jitter: 0.4 });
        au?.play(o.f === 1 ? 'ui_error' : 'pickup_gold', { pos: local ? undefined : pl.pos, volume: 0.6 });
        break;
      }
      default: break;
    }
  }

  // ======================================================================
  // per frame
  // ======================================================================
  update(dt) {
    const g = this.g, p = this.p;
    if (!p || g.menuMode) return;
    const alive = p.alive && !p.downed && !p.dead;
    if (this.kindleT > 0) this.kindleT -= dt;
    // Moonhowl: the bonus follows health both ways (heals don't recompute stats)
    if (this.has('moonhowl')) {
      const low = p.hp > 0 && p.hp / p.maxHp < 0.4;
      if (low !== this.howl) { this.howl = low; p.recomputeStats(); if (low) g.ui?.floatText(p.eye.add(p.forward().multiplyScalar(2)), 'MOONHOWL', '#ff5060'); }
      if (low && alive && Math.random() < dt * 14) { const m = p.muzzleWorld('right'); g.vfx.P.glow({ x: m.x + rand(-0.1, 0.1), y: m.y, z: m.z + rand(-0.1, 0.1), vy: 0.6, r: 1.1, g: 0.08, b: 0.12, life: 0.5, size: 0.05, sprite: SPR.EMBER }); }
    }
    // the Hungering Codex feeds while the doors are sealed (never kills outright)
    if (this.has('hungertome') && this.inFight && alive && p.hp > 1) {
      p.hp = Math.max(1, p.hp - p.maxHp * 0.012 * dt);
      if (Math.random() < dt * 3) { const m = p.muzzleWorld('left'); g.vfx.P.solid({ x: m.x, y: m.y, z: m.z, vy: -0.5, r: 0.3, g: 0, b: 0.03, life: 0.6, size: 0.04, sprite: SPR.DROP, gravity: 8 }); }
    }
    this.stillT = alive && p.grounded && (p.speedNorm ?? 0) < 0.08 ? this.stillT + dt : 0;
    this._updateMines(dt);
    this._updateEchoes(dt);
    this._updateRigs(dt);
  }

  _updateMines(dt) {
    const g = this.g;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.t += dt;
      const pulse = 0.5 + 0.5 * Math.sin(m.t * 6);
      m.spr.position.y = m.pos.y + 0.3 + pulse * 0.06;
      m.spr.scale.setScalar(0.26 + pulse * 0.08);
      if ((m.t % 0.9) < dt) g.vfx.ring(m.pos, 1.6, fxOf('frost').mid, 0.6, 0.06);
      if (!m.local) { if (m.t > 10) { g.scene.remove(m.spr); this.mines.splice(i, 1); } continue; }
      if (m.t < 0.4) continue;
      let trip = m.t > 8;
      if (!trip) for (const a of g.actors.hostiles()) { if ((a.pos.x - m.pos.x) ** 2 + (a.pos.z - m.pos.z) ** 2 < (1.6 + a.radius) ** 2) { trip = true; break; } }
      if (trip) this._emit('mineb', { i: m.i });
    }
  }

  // afterimage: a shimmering silhouette where you dashed from, bursting after 1 s
  _updateEchoes(dt) {
    const g = this.g, P = g.vfx.P, fx = fxOf('arcane');
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      const e = this.echoes[i];
      e.t += dt;
      const k = Math.min(1, e.t);
      for (let n = 0, m = Math.round(70 * dt + Math.random()); n < m; n++) {
        const h = Math.random(), r = (h > 0.82 ? 0.16 : 0.26) * (1 - k * 0.3), a = Math.random() * TAU;
        P.glow({ x: e.pos.x + Math.cos(a) * r, y: e.pos.y + 0.1 + h * 1.7, z: e.pos.z + Math.sin(a) * r, vx: rand(-0.1, 0.1), vy: rand(0.1, 0.5), vz: rand(-0.1, 0.1), r: fx.mid[0] * 0.5, g: fx.mid[1] * 0.5, b: fx.mid[2] * 0.5, r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: rand(0.25, 0.45), size: rand(0.12, 0.22), size2: 0.03, sprite: SPR.WISP, drag: 2 });
      }
      g.lights.request(_v.set(e.pos.x, e.pos.y + 1, e.pos.z), fx.light, 2 + 4 * k, 5);
      if (e.t < 1) continue;
      this.echoes.splice(i, 1);
      const c = V(e.pos.x, e.pos.y + 1, e.pos.z);
      g.vfx.explosion(c, 'arcane', 3, { groundY: e.pos.y, shakeScale: 0.4 });
      g.audio?.play('explosion', { pos: c, volume: 0.6 });
      if (e.local && g.player.id === e.pid) this._area(c, 3.2, this.pd(45), 'arcane', null, { kb: 7 });
    }
  }

  // ------------------------------------------------------------ rigs
  _rig(pl) {
    let r = this.rigs.get(pl.id);
    if (!r) { r = { motes: [], fam: null, sent: null, famT: 0.6, sentT: 0, kindleT: 0, still: 0, zap: new Map(), seen: true }; this.rigs.set(pl.id, r); }
    return r;
  }
  _dropRig(pid) {
    const r = this.rigs.get(pid);
    if (!r) return;
    for (const m of r.motes) this.g.scene.remove(m);
    this.g.scene.remove(r.fam?.s); this.g.scene.remove(r.sent?.s);
    this.rigs.delete(pid);
  }
  _spr(el, s) {
    const sp = new THREE.Sprite(this.g.spells._spriteMat(el));
    sp.scale.setScalar(s);
    this.g.scene.add(sp);
    return sp;
  }

  _updateRigs(dt) {
    const g = this.g, p = this.p;
    for (const r of this.rigs.values()) r.seen = false;
    const who = [[p, this.own, true]];
    for (const r of g.remotes.values()) { const ids = this.peerOwn.get(r.id); if (ids?.size) who.push([r, ids, false]); }
    for (const [pl, ids, local] of who) {
      const up = !pl.dead && !pl.downed;
      const r = this._rig(pl);
      r.seen = true;
      this._motes(pl, r, up && ids.has('stormwheel'), local, dt);
      this._familiar(pl, r, up && ids.has('familiar'), local, dt);
      this._sentinel(pl, r, up && ids.has('stillwater'), local, dt);
      // Kindling Heart: flames lick up the body (teammates) or off the hands (you)
      if (r.kindleT > 0) {
        r.kindleT -= dt;
        if (up && Math.random() < dt * 30) {
          const fx = fxOf('fire');
          const s = local ? p.muzzleWorld(Math.random() < 0.5 ? 'right' : 'left') : V(pl.pos.x + rand(-0.3, 0.3), pl.pos.y + rand(0.3, 1.6), pl.pos.z + rand(-0.3, 0.3));
          g.vfx.P.glow({ x: s.x, y: s.y, z: s.z, vx: rand(-0.2, 0.2), vy: rand(0.6, 1.4), vz: rand(-0.2, 0.2), r: fx.mid[0] * 0.6, g: fx.mid[1] * 0.6, b: fx.mid[2] * 0.6, r2: fx.end[0], g2: fx.end[1], b2: fx.end[2], life: 0.4, size: local ? 0.06 : 0.18, size2: 0.02, sprite: SPR.FLAME, drag: 1 });
        }
      }
    }
    for (const [pid, r] of this.rigs) if (!r.seen) this._dropRig(pid);
  }

  // Stormwheel: three motes circling at the waist; they zap what they touch
  _motes(pl, r, on, local, dt) {
    const g = this.g;
    if (!on) { if (r.motes.length) { for (const m of r.motes) g.scene.remove(m); r.motes.length = 0; } return; }
    while (r.motes.length < 3) r.motes.push(this._spr('lightning', 0.32));
    const t = g.time, R = 1.75 + Math.sin(t * 1.3) * 0.35;
    const hostiles = g.actors.hostiles();
    for (let i = 0; i < 3; i++) {
      const m = r.motes[i], a = t * 2.6 + i * TAU / 3;
      const prev = _v.copy(m.position);
      m.position.set(pl.pos.x + Math.cos(a) * R, pl.pos.y + 0.95 + Math.sin(t * 3 + i) * 0.12, pl.pos.z + Math.sin(a) * R);
      if (Math.random() < 0.5) g.vfx.trail(m.position, prev.sub(m.position).multiplyScalar(-1 / Math.max(dt, 1e-3)), 'lightning', 0.35, dt);
      for (const e of hostiles) {
        const dx = e.pos.x - m.position.x, dz = e.pos.z - m.position.z, rr = e.radius + 0.5;
        if (dx * dx + dz * dz > rr * rr || m.position.y < e.pos.y - 0.2 || m.position.y > e.pos.y + e.height + 0.3) continue;
        if ((r.zap.get(e.id) ?? 0) > t) continue;
        r.zap.set(e.id, t + 0.45);
        const c = cen(e);
        g.vfx.lightning(m.position, c, { life: 0.12, branches: 0, width: 0.05 });
        g.vfx.impact(c, 'lightning', 0.5);
        if (local) this._hit(e, this.pd(12, 'stormwheel'), 'lightning', { shock: 1 });
      }
    }
    if (r.zap.size > 40) for (const [id, until] of r.zap) if (until < t) r.zap.delete(id);
  }

  // where a hovering companion sits: for you, up in a corner of the view
  // (it fades near the lens like every spell core); for a teammate, at their shoulder
  _perch(pl, local, side, fwd, up, out) {
    const sx = Math.cos(pl.yaw), sz = -Math.sin(pl.yaw), fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
    const bob = Math.sin(this.g.time * 2.2 + side) * 0.06;
    if (local) { const e = pl.eye; return out.set(e.x + sx * side + fx * fwd, e.y + up + bob, e.z + sz * side + fz * fwd); }
    return out.set(pl.pos.x + sx * side * 0.7, pl.pos.y + 2.1 + up * 0.4 + bob, pl.pos.z + sz * side * 0.7);
  }

  _target(from, range) {
    const g = this.g;
    let best = null, bd = range * range;
    for (const a of g.actors.hostiles()) {
      const c = cen(a), d2 = c.distanceToSquared(from);
      if (d2 >= bd || !g.collision.los(from.x, from.y, from.z, c.x, c.y, c.z)) continue;
      bd = d2; best = c;
    }
    return best;
  }

  // Spectral Familiar: looses a bolt of your school at a foe every 1.2 s
  _familiar(pl, r, on, local, dt) {
    const g = this.g;
    if (!on) { if (r.fam) { g.scene.remove(r.fam.s); r.fam = null; } return; }
    const el = pl.meta?.element ?? 'arcane';
    if (!r.fam) r.fam = { s: this._spr(el, 0.38), pos: new THREE.Vector3() };
    const pos = this._perch(pl, local, 0.8, 1.0, 0.42, r.fam.pos);
    r.fam.s.position.copy(pos);
    if (Math.random() < dt * 20) { const fx = fxOf(el); g.vfx.P.glow({ x: pos.x + rand(-0.06, 0.06), y: pos.y, z: pos.z + rand(-0.06, 0.06), vy: -0.3, r: fx.mid[0] * 0.5, g: fx.mid[1] * 0.5, b: fx.mid[2] * 0.5, life: 0.4, size: 0.07, size2: 0.01, sprite: fx.spark, drag: 2 }); }
    if (!local) return;
    r.famT -= dt;
    if (r.famT > 0) return;
    const tg = this._target(pos, 20);
    r.famT = tg ? 1.2 : 0.3;
    if (tg) this._emit('fam', { o: pk(pos), v: pk(tg.sub(pos).normalize().multiplyScalar(30)), e: el });
  }

  // Stillwater Idol: hold still and a frost sentinel rises to fight beside you
  _sentinel(pl, r, on, local, dt) {
    const g = this.g;
    // teammates: read stillness off their replicated motion
    if (!local) r.still = Math.hypot(pl.vel.x, pl.vel.z) < 0.3 ? r.still + dt : 0;
    const still = local ? this.stillT : r.still;
    const want = on && still > 0.8 ? 1 : 0;
    if (!r.sent) { if (!want) return; r.sent = { s: this._spr('frost', 0.5), pos: new THREE.Vector3(), k: 0 }; }
    const S = r.sent;
    S.k = Math.max(0, Math.min(1, S.k + (want ? dt * 3 : -dt * 4)));
    if (S.k <= 0 && !want) { g.scene.remove(S.s); r.sent = null; return; }
    const pos = this._perch(pl, local, -0.85, 0.9, 0.5 + S.k * 0.15, S.pos);
    pos.y -= (1 - S.k) * 0.8;
    S.s.position.copy(pos);
    S.s.scale.setScalar(0.5 * S.k);
    const fx = fxOf('frost');
    if (Math.random() < dt * 24 * S.k) { const a = Math.random() * TAU; g.vfx.P.glow({ x: pos.x + Math.cos(a) * 0.22, y: pos.y + rand(-0.1, 0.1), z: pos.z + Math.sin(a) * 0.22, vx: -Math.sin(a) * 0.6, vz: Math.cos(a) * 0.6, r: fx.mid[0] * 0.5, g: fx.mid[1] * 0.5, b: fx.mid[2] * 0.5, life: 0.5, size: 0.05, sprite: SPR.SNOW, spin: 3, drag: 1 }); }
    if (!local) return;
    r.sentT -= dt;
    if (!want || S.k < 0.9 || r.sentT > 0) return;
    const tg = this._target(pos, 22);
    r.sentT = tg ? 0.6 : 0.25;
    if (tg) this._emit('sent', { o: pk(pos), v: pk(tg.sub(pos).normalize().multiplyScalar(34)) });
  }

  // ======================================================================
  // HUD: per-relic state for the shelf (k: cooldown 0..1, n: badge, on: lit)
  // ======================================================================
  meter(id) {
    const p = this.p;
    switch (id) {
      case 'meteorbrand': return { k: this.cdLeft('meteor') / 8 };
      case 'metronome': return { n: String(5 - (this.casts % 5)), on: this.casts % 5 === 4 };
      case 'gravebell': return { n: this.kills.length ? String(this.kills.length) : '', on: this.kills.length >= 2 };
      case 'lastbreath': return { k: this.breathUsed ? 1 : 0 };
      case 'stillwater': return { on: this.stillT > 0.8, k: this.stillT > 0 && this.stillT < 0.8 ? 1 - this.stillT / 0.8 : 0 };
      case 'goldfever': { const b = p.buffs.find((x) => x.id === 'midas'); return { n: b ? String(this.fever) : '', on: !!b }; }
      case 'moonhowl': return { on: this.howl };
      case 'kindling': return { on: this.kindleT > 0 };
      case 'laurel': return { n: p.laurels ? String(p.laurels) : '' };
      case 'gamblersdie': return { n: this.die ? String(this.die) : '', on: !!this.die };
      case 'hungertome': return { on: this.inFight };
      case 'undertow': return { on: this.inFight && p.shield > 0 };
      default: return null;
    }
  }
}

const _up = new THREE.Vector3(0, 1, 0);
function hexRGB(h, k = 1) { const c = new THREE.Color(h); return [c.r * k, c.g * k, c.b * k]; }
