import * as THREE from 'three';
import { CLASSES } from './classes.js';
import { CLASS_META } from './classMeta.js';
import { getAvatar } from './models.js';
import { angleDamp } from '../core/math.js';
import { makeCtx } from './caster.js';

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
    game.scene.add(this.avatar.root);
    this.channel = null;
    this.castT = 0;
    this.counters = {};
    this.gold = 0;
    this.ult = 0;
    this.staticReady = false;
    this.edge = 0;
  }

  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z); }

  applyState(s) {
    const n = this.net;
    n.x = s.p[0]; n.y = s.p[1]; n.z = s.p[2];
    n.yaw = s.y; n.pitch = s.pi;
    this.hp = s.hp; this.maxHp = s.mh; this.shield = s.sh ?? 0;
    this.downed = !!s.dn; this.dead = !!s.dd;
    this.reviveProgress = s.rp ?? 0;
    this.ult = s.u ?? 0;
    this.gold = s.g ?? this.gold;
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
    const origin = new THREE.Vector3(...msg.o);
    const dir = new THREE.Vector3(...msg.d);
    const aim = msg.ap ? new THREE.Vector3(...msg.ap) : null;
    this.castT = 0.5;
    if (sp.mode === 'channel') {
      if (msg.chan === 1) {
        const ctx = makeCtx(this.game, this, { local: false, slot: msg.slot, origin, dir, aimPoint: aim, stats: {} });
        const S = {};
        sp.channel.start(ctx, S);
        this.channel = { sp, ctx, S };
      } else if (msg.chan === 0 && this.channel) {
        this.channel.sp.channel.end(this.channel.ctx, this.channel.S);
        this.channel = null;
      }
      return;
    }
    const ctx = makeCtx(this.game, this, { local: false, slot: msg.slot, origin, dir, aimPoint: aim, stats: {}, charges: msg.ch });
    try { sp.cast(ctx); } catch (e) { console.warn('remote cast failed', e); }
  }

  update(dt) {
    const n = this.net;
    const k = 1 - Math.exp(-dt * 14);
    const ox = this.pos.x, oz = this.pos.z;
    if (Math.hypot(n.x - this.pos.x, n.z - this.pos.z) > 8) this.pos.set(n.x, n.y, n.z);
    this.pos.x += (n.x - this.pos.x) * k;
    this.pos.y += (n.y - this.pos.y) * k;
    this.pos.z += (n.z - this.pos.z) * k;
    this.vel.set((this.pos.x - ox) / Math.max(dt, 1e-3), 0, (this.pos.z - oz) / Math.max(dt, 1e-3));
    this.yaw = angleDamp(this.yaw, n.yaw, 14, dt);
    this.pitch += (n.pitch - this.pitch) * k;
    this.alive = !this.dead;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.castT = Math.max(0, this.castT - dt);
    const av = this.avatar;
    av.root.position.copy(this.pos);
    av.root.rotation.y = this.yaw + Math.PI; // avatar faces +Z, player looks -Z
    av.root.visible = !this.dead || true;
    const anim = this.dead ? 'dead' : this.downed ? 'downed' : this.channel || this.castT > 0 ? 'cast' : speed > 0.4 ? 'move' : 'idle';
    av.update(dt, { anim, t: this.game.time, speed, pitch: this.pitch, castProgress: this.channel ? 0.5 : 1 - this.castT * 2, strafe: 0 });
    if (this.channel) {
      const ctx = this.channel.ctx;
      ctx.origin.copy(this.muzzleWorld());
      ctx.dir.copy(this.forward());
      try { this.channel.sp.channel.update(ctx, this.channel.S, dt); } catch { /* ignore */ }
    }
  }

  dispose() {
    if (this.channel) { this.channel.sp.channel.end(this.channel.ctx, this.channel.S); this.channel = null; }
    this.game.scene.remove(this.avatar.root);
    this.avatar.dispose?.();
  }
}
