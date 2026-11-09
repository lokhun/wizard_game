import * as THREE from 'three';
import { CLASSES } from './classes.js';
import { CLASS_META } from './classMeta.js';
import { getAvatar } from './models.js';
import { angleDamp } from '../core/math.js';
import { makeCtx } from './caster.js';

const _frustum = new THREE.Frustum(), _m4 = new THREE.Matrix4(), _sph = new THREE.Sphere(new THREE.Vector3(), 1.6);

// A co-op teammate as seen on this machine: an animated avatar driven by
// network state, plus replay of their spells for visuals.
export class RemotePlayer {
  constructor(game, { id, name, classId }) {
    this.game = game;
    this.id = id;
    this.name = name;
    this.classId = classId;
    this.cls = CLASSES[classId];
    this.meta = CLASS_META[classId];
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.net = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.yaw = 0; this.pitch = 0;
    this.hp = 100; this.maxHp = 100; this.shield = 0;
    this.alive = true; this.downed = false; this.dead = false;
    this.reviveProgress = 0;
    this.radius = 0.4;
    this.avatar = getAvatar(classId, game);
    // Joining a floor in progress (its warm-up is over): the wizard's
    // programs are built on the driver's threads before it is drawn, not
    // linked in the middle of a frame (~0.3 s each on ANGLE/D3D11).
    if (game.loadingFloor || game.renderer.noRender) game.scene.add(this.avatar.root);
    else game.renderer.compileObject(this.avatar.root, game.scene, { all: true }).then(() => { if (!this.disposed) game.scene.add(this.avatar.root); });
    this.channel = null;
    this.castT = 0;
    this.counters = {};
    this.gold = 0;
    this.ult = 0;
    this.staticReady = false;
    this.edge = 0;
    this.disposed = false;
    this._poseDt = 0; this._posedAnim = null; this._lod = 0;
  }

  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z); }

  applyState(s) {
    const n = this.net;
    // (the partner's velocity, from the states' own steps: their avatar is led along it between them - see update;
    // nothing past a run's speed, so a dash's end is not overshot)
    {
      const now = this.game.time, gap = now - (n.t ?? -9);
      let vx = 0, vz = 0;
      if (gap > 0.02 && gap < 0.3) { vx = (s.p[0] - n.x) / gap; vz = (s.p[2] - n.z) / gap; }
      if (gap >= 0.3 || vx * vx + vz * vz > 144) n.vx = n.vz = 0;
      else { n.vx = (n.vx ?? 0) + (vx - (n.vx ?? 0)) * 0.5; n.vz = (n.vz ?? 0) + (vz - (n.vz ?? 0)) * 0.5; }
      n.t = now;
    }
    n.x = s.p[0]; n.y = s.p[1]; n.z = s.p[2];
    n.yaw = s.y; n.pitch = s.pi;
    // (a blow the partner took: their avatar recoils, by its share of their health)
    if (s.hp < this.hp - 0.5 && !s.dn && !s.dd) this._hurt = Math.max(this._hurt ?? 0, Math.min(1, 0.35 + (this.hp - s.hp) / Math.max(1, s.mh) * 4));
    this.hp = s.hp; this.maxHp = s.mh; this.shield = s.sh ?? 0;
    this.downed = !!s.dn; this.dead = !!s.dd;
    this.reviveProgress = s.rp ?? 0;
    this.ult = s.u ?? 0;
    this.gold = s.g ?? this.gold;
    this.damageDealt = s.dm ?? this.damageDealt ?? 0; this.kills = s.k ?? this.kills ?? 0; // (the party scores)
    this.level = s.lv;
  }

  forward() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  muzzleWorld() {
    const m = this.avatar.muzzle;
    if (m) { m.updateWorldMatrix(true, false); return m.getWorldPosition(new THREE.Vector3()); }
    return this.eye.add(this.forward().multiplyScalar(0.6));
  }

  replayCast(msg) {
    const sp = this.cls.spells[msg.slot];
    if (!sp) return;
    if (sp.mode === 'channel' && msg.chan === 0) {
      if (this.channel) { this.channel.sp.channel.end(this.channel.ctx, this.channel.S); this.channel = null; }
      return;
    }
    let origin = msg.o ? new THREE.Vector3(...msg.o) : this.muzzleWorld();
    let dir = msg.d ? new THREE.Vector3(...msg.d) : this.forward();
    const aim = msg.ap ? new THREE.Vector3(...msg.ap) : null;
    // replays are visual only (the caster's own client deals the damage), so start
    // them from this avatar's staff tip rather than the caster's first-person view,
    // still aimed at the point they aimed at
    if (msg.o && aim) {
      const tip = this.muzzleWorld();
      if (tip.distanceToSquared(origin) < 2.5 && aim.distanceToSquared(tip) > 1) {
        origin = tip;
        dir = aim.clone().sub(tip).normalize();
      }
    }
    this.castT = 0.5;
    this.game.castFlourish?.(this, msg.slot);
    if (sp.mode === 'channel') {
      if (msg.chan === 1) {
        if (this.channel) { this.channel.sp.channel.end(this.channel.ctx, this.channel.S); this.channel = null; }
        const ctx = makeCtx(this.game, this, { local: false, slot: msg.slot, origin, dir, aimPoint: aim, stats: { aug: new Set(msg.au ?? []) } });
        const S = {};
        sp.channel.start(ctx, S);
        this.channel = { sp, ctx, S };
      } else if (msg.chan === 0 && this.channel) {
        this.channel.sp.channel.end(this.channel.ctx, this.channel.S);
        this.channel = null;
      }
      return;
    }
    const ctx = makeCtx(this.game, this, { local: false, slot: msg.slot, origin, dir, aimPoint: aim, stats: { aug: new Set(msg.au ?? []) }, charges: msg.ch });
    try { sp.cast(ctx); } catch (e) { console.warn('remote cast failed', e); }
  }

  update(dt) {
    const n = this.net;
    const k = 1 - Math.exp(-dt * 14);
    const ox = this.pos.x, oz = this.pos.z;
    // (led along the states' velocity a moment past the newest, then eased toward that: chasing the newest state
    // alone, at 20 a second, a partner walking at 5 m/s had surged and checked between them, 3.1-6.9 m/s, and
    // their stride with it)
    const lead = Math.min(this.game.time - (n.t ?? this.game.time), 0.1), nvx = n.vx ?? 0, nvz = n.vz ?? 0;
    const tx = n.x + nvx * lead, tz = n.z + nvz * lead;
    if (Math.hypot(tx - this.pos.x, tz - this.pos.z) > 8) this.pos.set(tx, n.y, tz);
    this.pos.x += (tx - this.pos.x) * k;
    this.pos.y += (n.y - this.pos.y) * k;
    this.pos.z += (tz - this.pos.z) * k;
    this.vel.set((this.pos.x - ox) / Math.max(dt, 1e-3), 0, (this.pos.z - oz) / Math.max(dt, 1e-3));
    this.yaw = angleDamp(this.yaw, n.yaw, 14, dt);
    this.pitch += (n.pitch - this.pitch) * k;
    this.alive = !this.dead;
    // (the stride's speed from the states' velocity, eased, when there is one; a dash - past a run's speed - from the body's own motion)
    const rootSp = Math.hypot(this.vel.x, this.vel.z), nsp = Math.hypot(nvx, nvz);
    this._sp = nsp < 1e-3 && rootSp > 12 ? rootSp : (this._sp ?? rootSp) + (nsp - (this._sp ?? rootSp)) * k;
    const speed = this._sp;
    if (speed > 0.5 && this.pos.y < 0) this.game.wadeFx(this, speed, dt, 0.5);
    this.castT = Math.max(0, this.castT - dt);
    const av = this.avatar;
    av.root.position.copy(this.pos);
    av.root.rotation.y = this.yaw + Math.PI; // avatar faces +Z, player looks -Z
    av.root.visible = !this.dead || true;
    const anim = this.dead ? 'dead' : this.downed ? 'downed' : this.channel || this.castT > 0 ? 'cast' : speed > 0.4 ? 'move' : 'idle';
    // out of view, the wizard (bones, cloth) poses every 4th frame, the skipped
    // time carried; never while it casts, so spells leave from the right hand
    const cam = this.game.renderer.camera;
    _frustum.setFromProjectionMatrix(_m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    _sph.center.set(this.pos.x, this.pos.y + 1, this.pos.z);
    this._poseDt += dt;
    if (_frustum.intersectsSphere(_sph) || anim === 'cast' || anim !== this._posedAnim || ++this._lod % 4 === 0) {
      av.update(this._poseDt, { anim, t: this.game.time, speed, pitch: this.pitch, castProgress: this.channel ? 0.5 : 1 - this.castT * 2, strafe: 0, hurt: this._hurt ?? 0 });
      this._poseDt = 0; this._posedAnim = anim; this._hurt = 0;
    }
    if (this.channel) {
      const ctx = this.channel.ctx;
      ctx.origin.copy(this.muzzleWorld());
      ctx.dir.copy(this.forward());
      try { this.channel.sp.channel.update(ctx, this.channel.S, dt); } catch { /* ignore */ }
    }
  }

  dispose() {
    this.disposed = true;
    if (this.channel) { this.channel.sp.channel.end(this.channel.ctx, this.channel.S); this.channel = null; }
    this.game.scene.remove(this.avatar.root);
    this.avatar.dispose?.();
  }
}
