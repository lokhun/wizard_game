import * as THREE from 'three';
import { T, FLOOR, SOLID, K_WATER, K_ALT } from './levelgen.js';

// Ambient life: rats along the walls, bats under the vaults, crows in the bailey.
// Purely cosmetic and local to each machine. One InstancedMesh per kind; wing
// flaps and tail sway run in the vertex shader from a per-instance flap value.

const MAX = { rat: 26, bat: 28, crow: 18 };
const BIOME_KINDS = {
  sewers: { rat: 26 },
  dungeon: { rat: 16, bat: 22 },
  courtyard: { crow: 18 },
  keep: { bat: 24 },
  throne: { bat: 12 },
};

// geometry with an 'aWing' attribute: 0 body, +-1 wing tips (or tail for rats)
function buildGeo(kind) {
  const pos = [], wing = [], idx = [];
  const v = (x, y, z, w) => { pos.push(x, y, z); wing.push(w); return pos.length / 3 - 1; };
  const tri = (a, b, c) => idx.push(a, b, c, a, c, b); // double-sided by duplication
  if (kind === 'bat' || kind === 'crow') {
    const s = kind === 'bat' ? 1 : 1.25;
    const span = kind === 'bat' ? 0.34 : 0.4;
    // body: a stretched diamond
    const n = v(0, 0, 0.09 * s, 0), t = v(0, 0, -0.08 * s, 0), up = v(0, 0.035 * s, 0, 0), dn = v(0, -0.03 * s, 0, 0), l = v(-0.03 * s, 0, 0, 0), r = v(0.03 * s, 0, 0, 0);
    tri(n, up, l); tri(n, r, up); tri(n, l, dn); tri(n, dn, r); tri(t, l, up); tri(t, up, r); tri(t, dn, l); tri(t, r, dn);
    for (const side of [-1, 1]) {
      const root0 = v(side * 0.02 * s, 0, 0.04 * s, 0), root1 = v(side * 0.02 * s, 0, -0.05 * s, 0);
      const mid = v(side * span * 0.55 * s, 0.01, 0.03 * s, side * 0.55);
      const tip = v(side * span * s, 0, -0.02 * s, side);
      const trail = v(side * span * 0.6 * s, 0, kind === 'bat' ? -0.11 * s : -0.08 * s, side * 0.6);
      const trail2 = v(side * span * 0.25 * s, 0, kind === 'bat' ? -0.07 * s : -0.09 * s, side * 0.25);
      tri(root0, mid, root1); tri(mid, tip, trail); tri(mid, trail, root1); tri(root1, trail, trail2);
    }
    if (kind === 'crow') { const b0 = v(0, 0.005, 0.13, 0), bl = v(-0.012, 0, 0.09, 0), br = v(0.012, 0, 0.09, 0); tri(b0, bl, br); const t0 = v(-0.035, 0, -0.08, 0), t1 = v(0.035, 0, -0.08, 0), t2 = v(0, 0, -0.17, 0); tri(t0, t1, t2); }
  } else {
    // rat: a low wedge body, head, and a long tail (aWing = tail weight)
    const L = 0.2, W = 0.055, H = 0.06;
    const nose = v(0, 0.025, L * 0.75, 0), back = v(0, H, -L * 0.15, 0), rump = v(0, 0.03, -L * 0.5, 0);
    const lF = v(-W, 0.02, L * 0.2, 0), rF = v(W, 0.02, L * 0.2, 0), lB = v(-W * 1.1, 0.015, -L * 0.35, 0), rB = v(W * 1.1, 0.015, -L * 0.35, 0);
    const belly = v(0, 0.004, 0, 0);
    tri(nose, lF, back); tri(nose, back, rF); tri(lF, lB, back); tri(rF, back, rB); tri(lB, rump, back); tri(rB, back, rump);
    tri(nose, belly, lF); tri(nose, rF, belly); tri(lF, belly, lB); tri(rF, rB, belly); tri(lB, belly, rump); tri(rB, rump, belly);
    const earL = v(-0.025, 0.055, L * 0.42, 0), earR = v(0.025, 0.055, L * 0.42, 0), eb = v(0, 0.035, L * 0.38, 0);
    tri(earL, eb, nose); tri(eb, earR, nose);
    let prev0 = v(-0.008, 0.02, -L * 0.5, 0), prev1 = v(0.008, 0.02, -L * 0.5, 0);
    for (let i = 1; i <= 5; i++) {
      const z = -L * 0.5 - i * 0.045, w = 0.007 * (1 - i / 6), k = i / 5;
      const a = v(-w, 0.012, z, k), b = v(w, 0.012, z, k);
      tri(prev0, a, prev1); tri(prev1, a, b);
      prev0 = a; prev1 = b;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function makeMat(kind, uTime) {
  const color = kind === 'rat' ? 0x4a3f36 : kind === 'bat' ? 0x3a3034 : 0x16161c;
  // a faint sheen so a dark critter still separates from a dark floor
  const m = new THREE.MeshStandardMaterial({ color, roughness: kind === 'crow' ? 0.45 : 0.8, metalness: 0, emissive: kind === 'crow' ? 0x0a0c18 : 0x0c0806 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'uniform float uTime;\nattribute float aWing;\nattribute vec2 aFlap;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      // aFlap.x = flap amount (0 perched), aFlap.y = phase
      ${kind === 'rat'
        ? 'transformed.x += sin(uTime * 14.0 + aFlap.y + aWing * 3.0) * 0.03 * aWing * (0.4 + aFlap.x);'
        : 'float fl = sin(uTime * ' + (kind === 'bat' ? '26.0' : '15.0') + ' + aFlap.y) * aFlap.x; float a = fl * abs(aWing) * 1.1; transformed.y += sin(a) * abs(transformed.x) * 1.4; transformed.x *= mix(1.0, cos(a), abs(aWing)); transformed.x *= mix(1.0, 0.35, (1.0 - aFlap.x) * step(0.01, abs(aWing)));'}
    `);
  };
  m.customProgramCacheKey = () => 'critter_' + kind;
  return m;
}

export class Critters {
  constructor(scene, level) {
    this.scene = scene;
    this.level = level;
    this.uTime = { value: 0 };
    this.kinds = {};
    const want = BIOME_KINDS[level.biome.id] ?? {};
    for (const [kind, n] of Object.entries(want)) {
      const count = Math.min(n, MAX[kind]);
      const geo = buildGeo(kind);
      const flap = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
      flap.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aFlap', flap);
      const mesh = new THREE.InstancedMesh(geo, makeMat(kind, this.uTime), count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
      const list = [];
      for (let i = 0; i < count; i++) {
        const c = { i, kind, pos: new THREE.Vector3(), vel: new THREE.Vector3(), home: new THREE.Vector3(), yaw: Math.random() * 6.28, state: 'idle', t: Math.random() * 5, phase: Math.random() * 20, gone: 0, perchY: 0 };
        if (!this._place(c)) c.gone = 1e9;
        flap.setXY(i, 0, c.phase);
        list.push(c);
      }
      this.kinds[kind] = { mesh, list, flap };
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
  }

  // pick a fresh home for a critter: rats hug walls, bats hang under the ceiling, crows sit on the cobbles
  _place(c) {
    const L = this.level;
    for (let tries = 0; tries < 40; tries++) {
      const x = 1 + Math.floor(Math.random() * (L.W - 2)), y = 1 + Math.floor(Math.random() * (L.H - 2));
      const i = y * L.W + x;
      if (L.cells[i] !== FLOOR || L.kind[i] === K_WATER) continue;
      if (c.kind === 'crow' && (L.roomId[i] < 0 || L.kind[i] !== K_ALT)) continue; // on the open cobbles, not hidden in the grass
      let wallDir = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (L.get(x + dx, y + dy) === SOLID) { wallDir = [dx, dy]; break; }
      if (c.kind === 'rat' && !wallDir) continue;
      const wx = (x + 0.5) * T, wz = (y + 0.5) * T;
      const gy = L.hgt[i];
      if (c.kind === 'rat') {
        c.home.set(wx + wallDir[0] * 0.75 + (Math.random() - 0.5) * 1.2 * Math.abs(wallDir[1]), gy, wz + wallDir[1] * 0.75 + (Math.random() - 0.5) * 1.2 * Math.abs(wallDir[0]));
        c.wall = wallDir;
        c.yaw = Math.atan2(wallDir[1] !== 0 ? 1 : 0, wallDir[0] !== 0 ? 1 : 0) + (Math.random() < 0.5 ? 0 : Math.PI);
      } else if (c.kind === 'bat') {
        const ceil = L.ceil[i];
        if (ceil > 30 || ceil < 3.5) continue;
        c.home.set(wx + (Math.random() - 0.5) * 1.4, ceil - 0.18, wz + (Math.random() - 0.5) * 1.4);
      } else {
        c.home.set(wx + (Math.random() - 0.5) * 1.6, gy, wz + (Math.random() - 0.5) * 1.6);
      }
      c.pos.copy(c.home);
      c.state = 'idle';
      c.vel.set(0, 0, 0);
      c.gone = 0;
      return true;
    }
    return false;
  }

  // something loud happened (a door slam, an explosion): nearby critters scatter
  startle(pos, radius) {
    for (const k of Object.values(this.kinds)) for (const c of k.list) if (c.state === 'idle' && !c.gone && c.pos.distanceTo(pos) < radius) this._flee(c, pos);
  }

  _flee(c, from) {
    c.state = 'flee';
    c.t = 0;
    const dx = c.pos.x - from.x, dz = c.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    if (c.kind === 'rat') {
      // scurry along the wall, away from the threat
      const ax = c.wall?.[1] !== 0 ? 1 : 0, az = c.wall?.[0] !== 0 ? 1 : 0;
      const s = Math.sign(ax * dx + az * dz) || 1;
      c.vel.set(ax * s * 4.5, 0, az * s * 4.5);
      c.yaw = Math.atan2(c.vel.x, c.vel.z);
    } else {
      const sp = c.kind === 'bat' ? 6 : 5;
      c.vel.set(dx / d * sp + (Math.random() - 0.5) * 2, c.kind === 'crow' ? 4.5 : -0.6, dz / d * sp + (Math.random() - 0.5) * 2);
    }
  }

  update(dt, time, cam, players) {
    this.uTime.value = time;
    const m = this._m, q = this._q, e = this._e, sc = this._s;
    for (const k of Object.values(this.kinds)) {
      const { mesh, list, flap } = k;
      let flapDirty = false;
      for (const c of list) {
        c.t += dt;
        if (c.gone) {
          // respawn out of sight after a while
          c.gone -= dt;
          if (c.gone <= 0 && c.gone > -1e8) { this._place(c); if (c.pos.distanceTo(cam) < 14) c.gone = 3; }
          m.makeScale(0, 0, 0);
          mesh.setMatrixAt(c.i, m);
          continue;
        }
        const camD = c.pos.distanceTo(cam);
        if (c.state === 'idle') {
          // notice anyone close
          let near = null;
          for (const p of players) { if (!p.alive || p.dead) continue; const d = Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z); if (d < (c.kind === 'rat' ? 4.5 : c.kind === 'bat' ? 6 : 7.5)) { near = p.pos; break; } }
          if (near) this._flee(c, near);
          // idle motion: rats twitch and shuffle, crows hop and peck, bats sway on their perch
          if (c.kind === 'rat' && Math.random() < dt * 0.6) c.yaw += (Math.random() - 0.5) * 1.5;
          if (c.kind === 'crow' && Math.random() < dt * 0.8) { c.yaw += (Math.random() - 0.5) * 2; c.hop = 0.18; }
          if (c.hop > 0) c.hop -= dt;
        } else {
          const v = c.vel;
          if (c.kind === 'bat') {
            // erratic flutter, staying under the vault
            v.x += (Math.random() - 0.5) * 30 * dt; v.z += (Math.random() - 0.5) * 30 * dt; v.y += (Math.random() - 0.5) * 12 * dt;
            const ceil = this.level.ceilAt(c.pos.x, c.pos.z);
            if (c.pos.y > ceil - 0.4) v.y -= 8 * dt;
            if (c.pos.y < 1.8) v.y += 8 * dt;
          } else if (c.kind === 'crow') {
            v.y += 2.5 * dt;
          }
          const nx = c.pos.x + v.x * dt, nz = c.pos.z + v.z * dt;
          const cx = Math.floor(nx / T), cz = Math.floor(nz / T);
          if (this.level.get(cx, cz) === SOLID && c.kind !== 'crow') {
            if (c.kind === 'rat') { c.gone = 6 + Math.random() * 10; continue; } // into a crack in the wall
            v.x *= -0.8; v.z *= -0.8;
          } else { c.pos.x = nx; c.pos.z = nz; }
          c.pos.y += v.y * dt;
          if (c.kind !== 'rat') c.yaw = Math.atan2(v.x, v.z);
          if (c.t > (c.kind === 'rat' ? 2.5 : c.kind === 'bat' ? 5 : 4) && camD > 6) c.gone = 8 + Math.random() * 12;
          if (c.kind === 'crow' && c.pos.y > 22) c.gone = 10 + Math.random() * 10;
        }
        const flying = c.state === 'flee' && c.kind !== 'rat';
        const want = flying ? 1 : c.kind === 'rat' ? (c.state === 'flee' ? 1 : 0.15) : 0;
        if (flap.getX(c.i) !== want) { flap.setX(c.i, want); flapDirty = true; }
        // pose
        const bob = c.kind === 'crow' && c.hop > 0 ? Math.sin((0.18 - c.hop) / 0.18 * Math.PI) * 0.08 : 0;
        const s = camD > 34 ? 0 : 1;
        if (c.kind === 'bat' && !flying) e.set(Math.PI, c.yaw, 0, 'YXZ'); // hanging upside down
        else e.set(flying ? -0.15 : 0, c.yaw, 0, 'YXZ');
        q.setFromEuler(e);
        sc.setScalar(s * (c.kind === 'crow' ? 1.6 : c.kind === 'bat' ? 1.5 : 1.4));
        m.compose(_p.set(c.pos.x, c.pos.y + bob + (c.kind === 'crow' && !flying ? 0.06 : 0), c.pos.z), q, sc);
        mesh.setMatrixAt(c.i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (flapDirty) flap.needsUpdate = true;
    }
  }

  dispose() {
    for (const k of Object.values(this.kinds)) { this.scene.remove(k.mesh); k.mesh.geometry.dispose(); k.mesh.material.dispose(); }
    this.kinds = {};
  }
}
const _p = new THREE.Vector3();
