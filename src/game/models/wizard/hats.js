import * as THREE from 'three';
import {
  V, sphere, torus, lathe, tubeVar, mergeGeos, xf, noisify, mulberry, roundedBox, flat, leaf, feather,
  skullParts, branches, cyl, jitter, crystal,
} from './shapes.js';
import { add, grp } from './common.js';

// ---------------------------------------------------------------------------
// Headwear for the third-person avatars. Everything is authored around the
// head centre (origin), avatar facing +Z, head radius ~0.1.
// Returns { group, shoulders?: [geoL, geoR, mat], update?(t), hidesHair }.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

// Hood shell open toward +Z. peak pulls the crown back into a point,
// drape flares the lower edge over the shoulders, deep pushes the opening
// forward (cowl).
export function hoodGeo(o = {}) {
  const r = o.r ?? 0.13;
  const gap = o.gap ?? 1.55;
  const thetaLen = o.thetaLen ?? 2.25;
  const g = new THREE.SphereGeometry(r, o.ws ?? 26, o.hs ?? 16, Math.PI / 2 + gap / 2, TAU - gap, 0, thetaLen);
  const p = g.getAttribute('position');
  const peak = o.peak ?? 0.08, drape = o.drape ?? 1, deep = o.deep ?? 0.02;
  const deform = (v) => {
    let { x, y, z } = v;
    // crown peak trailing back
    const k = Math.max(0, y / r) * Math.max(0, -z / r + 0.3);
    z -= k * k * peak; y += k * k * peak * 0.35;
    // drape down onto the shoulders
    if (y < -0.01) {
      const d = (-0.01 - y) / r;
      x *= 1 + d * 0.75 * drape; z *= 1 + d * 0.45 * drape; y -= d * 0.03;
    }
    // cowl depth: the rim near the face comes forward
    if (z > 0) z += (z / r) * deep;
    v.set(x, y, z);
    return v;
  };
  const v = V();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    deform(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // rim along the face opening
  const pts = [];
  const n = 16;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i <= n; i++) {
      const th = side < 0 ? thetaLen * (1 - i / n) : thetaLen * (i / n);
      const ph = Math.PI / 2 + side * (gap / 2);
      const q = V(-r * Math.cos(ph) * Math.sin(th), r * Math.cos(th), r * Math.sin(ph) * Math.sin(th));
      if (side > 0 && i === 0) continue;
      pts.push(deform(q));
    }
  }
  const rim = tubeVar(pts, o.rimR ?? 0.007, 48, 6, true);
  return { shell: g, rim };
}

// short shoulder mantle (lathe), tattered hem
function mantleGeo(rTop = 0.085, rBot = 0.29, h = 0.19, seed = 1, jag = 0.03) {
  rBot = Math.max(rBot, 0.29); h = Math.max(h, 0.19);
  const g = lathe([[rTop, 0], [rTop + 0.03, -0.02], [rBot * 0.86, -h * 0.5], [rBot, -h]], 28);
  const p = g.getAttribute('position');
  const rnd = mulberry(seed);
  const J = Array.from({ length: 29 }, () => rnd());
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = Math.round(((a + Math.PI) / TAU) * 28) % 28;
    const yy = y < -h + 0.001 ? y - J[k] * jag : y;
    p.setXYZ(i, x, yy, z * 0.78);
  }
  g.computeVertexNormals();
  return g;
}

// skull cap of hair with a hairline: the front edge rises above the brow
function hairCap(r, thetaLen) {
  const g = new THREE.SphereGeometry(r, 18, 10, 0, TAU, 0, thetaLen);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), y = p.getY(i), x = p.getX(i);
    const front = Math.max(0, z / r - 0.2) / 0.8;
    const line = r * (0.42 - 0.18 * Math.min(1, Math.abs(x) / (r * 0.7)));
    if (front > 0 && y < line) p.setY(i, line + (y - line) * (1 - front) * 0.4);
  }
  g.computeVertexNormals();
  return g;
}

function starGeo(r) {
  const s = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * TAU + Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return new THREE.ExtrudeGeometry(s, { depth: r * 0.15, bevelEnabled: false });
}

// pointed wizard hat: brim radius, cone height, bend amount
function pointedHat(kit, mat, o) {
  const G = new THREE.Group();
  const rIn = 0.112, rOut = o.brim;
  const rnd = mulberry(o.seed ?? 3);
  const J = Array.from({ length: 41 }, () => rnd());
  const brim = lathe([[rIn, 0.004], [rIn + 0.02, 0.002], [rOut, -0.004], [rOut + 0.002, -0.01], [rOut - 0.01, -0.012], [rIn, -0.006]], 40);
  const bp = brim.getAttribute('position');
  for (let i = 0; i < bp.count; i++) {
    let x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    const t = Math.max(0, (r - rIn) / (rOut - rIn));
    const k = Math.round(((a + Math.PI) / TAU) * 40) % 40;
    const jag = o.ragged ? (1 - J[k] * 0.12 * t * t) : 1;
    x *= jag; z *= jag;
    y += -t * t * (o.droop ?? 0.05) + Math.sin(a * 3 + 1) * 0.018 * t * t + (z > 0 ? -0.01 * t : 0.012 * t);
    bp.setXYZ(i, x, y, z);
  }
  brim.computeVertexNormals();
  add(G, brim, mat);
  // cone
  const H = o.height;
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    prof.push([rIn * 0.97 * Math.pow(1 - t, 0.85) * (1 - 0.08 * Math.sin(t * Math.PI)), t * H]);
  }
  const cone = lathe(prof, 24);
  const bend = (v) => {
    const t = Math.max(0, v.y / H);
    v.z -= Math.pow(t, 2.2) * (o.bend ?? 0.15);
    v.y -= Math.pow(t, 3) * (o.bend ?? 0.15) * 0.4;
    v.x += Math.pow(t, 3) * (o.twist ?? 0.03);
    return v;
  };
  const cp = cone.getAttribute('position');
  const v = V();
  for (let i = 0; i < cp.count; i++) { v.fromBufferAttribute(cp, i); bend(v); cp.setXYZ(i, v.x, v.y, v.z); }
  cone.computeVertexNormals();
  if (o.crumple) noisify(cone, o.crumple, 30, o.seed ?? 3, 2);
  add(G, cone, mat);
  // band
  add(G, lathe([[rIn * 1.0, 0.002], [rIn * 0.99, 0.04], [rIn * 0.96, 0.042]], 24), o.bandMat ?? kit.leather(0x2a1a10));
  if (o.buckle) add(G, xf(new THREE.TorusGeometry(0.014, 0.003, 4, 4), { z: rIn + 0.002, y: 0.021, rz: Math.PI / 4 }), kit.gold());
  return { G, bend, H };
}

// opts.mantle = false: skip the shoulder mantle (avatars build their own
// shoulders); hood shells are listed in res.drape so the avatar can skin
// their lower edge to the chest.
export function buildHat(classId, kit, meta, glows, opts = {}) {
  const G = new THREE.Group();
  const robe = kit.clothDS(meta.robe);
  const trim = kit.cloth(meta.trim);
  const res = { group: G, shoulders: null, update: null, face: 'shadow', drape: [], hood: false };
  const hood = (o = {}) => {
    const h = hoodGeo(o);
    res.drape.push(add(G, h.shell, o.mat ?? robe, { y: o.y ?? 0.01, z: o.z ?? -0.012 }));
    res.drape.push(add(G, h.rim, o.rimMat ?? trim, { y: o.y ?? 0.01, z: o.z ?? -0.012 }));
    res.hood = true;
    return h;
  };
  const mantle = (mat, o = {}) => (opts.mantle === false ? null : add(G, mantleGeo(o.rTop, o.rBot, o.h, o.seed, o.jag), mat, { y: o.y ?? -0.1, z: -0.01 }));

  switch (classId) {
    case 'pyromancer': {
      const hat = pointedHat(kit, kit.cloth(0x3a1810), { brim: 0.29, height: 0.42, bend: 0.2, droop: 0.07, ragged: true, crumple: 0.006, seed: 5, buckle: true });
      hat.G.position.set(0, 0.055, -0.005); hat.G.rotation.x = -0.12;
      G.add(hat.G);
      // singed, ember-lit brim edge
      const em = glows.add(kit.glow(meta.color, 1.3), 1);
      const pts = [];
      const rnd = mulberry(8);
      for (let i = 0; i < 6; i++) {
        const a0 = rnd() * TAU, l = 0.25 + rnd() * 0.3;
        const seg = [];
        for (let k = 0; k <= 5; k++) {
          const a = a0 + (k / 5) * l;
          const r = 0.27;
          seg.push(V(Math.cos(a) * r, -0.055 + Math.sin(a * 3 + 1) * 0.018 + (Math.sin(a) > 0 ? -0.01 : 0.012), Math.sin(a) * r));
        }
        pts.push(tubeVar(seg, 0.0025, 8, 3, true));
      }
      add(hat.G, mergeGeos(pts), em);
      mantle(kit.clothDS(meta.robe), { rBot: 0.25, h: 0.15, y: -0.12, seed: 2 });
      res.beard = 0x5a5550;
      res.face = 'open';
      break;
    }
    case 'cryomancer': {
      hood({ peak: 0.05, gap: 1.6 });
      // fur trim around the face opening (thick noisy ring)
      const ring = new THREE.TorusGeometry(0.105, 0.03, 10, 30);
      xf(ring, { sx: 0.95, sy: 1.25, sz: 0.6 });
      noisify(ring, 0.008, 70, 4, 2);
      { const u = ring.getAttribute('uv'); for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * 2, u.getY(i) * 0.4); }
      add(G, ring, kit.fur(0xe8e8e8), { y: -0.01, z: 0.075, rx: -0.1 });
      mantle(kit.fur(0xd8d8d8), { rBot: 0.25, h: 0.12, y: -0.11, jag: 0.02, seed: 3 });
      break;
    }
    case 'stormcaller': {
      hood({ peak: 0.07 });
      mantle(robe, { rBot: 0.26, h: 0.16, seed: 4 });
      const brass = kit.brass();
      const gog = [];
      for (const s of [-1, 1]) {
        gog.push(xf(lathe([[0.02, 0], [0.024, 0.004], [0.024, 0.018], [0.02, 0.02]], 14), { rx: Math.PI / 2 - 0.5, x: s * 0.038, y: 0.065, z: 0.088 }));
      }
      gog.push(xf(new THREE.BoxGeometry(0.02, 0.008, 0.01), { y: 0.07, z: 0.1, rx: -0.5 }));
      add(G, mergeGeos(gog), brass);
      add(G, xf(torus(0.112, 0.006, 4, 30, Math.PI * 1.2, { rx: Math.PI / 2, rz: -0.1 * Math.PI }), { y: 0.05, rx: -0.4 }), kit.leather(0x3a2414));
      const lens = glows.add(kit.glow(meta.color, 1.2), 1);
      for (const s of [-1, 1]) add(G, new THREE.CircleGeometry(0.019, 16), lens, { x: s * 0.038, y: 0.077, z: 0.107, rx: -0.5 });
      break;
    }
    case 'arcanist': {
      const hat = pointedHat(kit, kit.cloth(meta.robe), { brim: 0.2, height: 0.62, bend: 0.22, droop: 0.03, seed: 9, bandMat: kit.cloth(meta.trim), buckle: false, twist: 0.05 });
      hat.G.position.set(0, 0.05, -0.005); hat.G.rotation.x = -0.08;
      G.add(hat.G);
      const sm = glows.add(kit.glow(meta.color2, 2.4), 1);
      const stars = [];
      const rnd = mulberry(4);
      for (let i = 0; i < 9; i++) {
        const t = 0.12 + (i / 9) * 0.7;
        const a = rnd() * TAU;
        const r = 0.112 * 0.97 * Math.pow(1 - t, 0.85) + 0.002;
        const p = hat.bend(V(Math.cos(a) * r, t * hat.H, Math.sin(a) * r));
        const sg = starGeo(0.012 + rnd() * 0.008);
        const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), V(Math.cos(a), 0.2, Math.sin(a)).normalize());
        sg.applyQuaternion(q); sg.translate(p.x, p.y, p.z);
        stars.push(sg);
      }
      add(hat.G, mergeGeos(stars), sm);
      add(hat.G, xf(torus(0.012, 0.004, 6, 12), { y: hat.H - 0.08, z: -0.2 }), kit.gold());
      res.beard = 0xc8c4bc;
      res.face = 'open';
      break;
    }
    case 'necromancer': {
      hood({ peak: 0.04, gap: 1.25, deep: 0.06, r: 0.14 });
      mantle(kit.clothDS(meta.trim), { rBot: 0.27, h: 0.18, seed: 6, jag: 0.05 });
      const sk = skullParts(0.82, 0.6);
      const mask = grp(G, { y: -0.012, z: 0.05 });
      add(mask, sk.bone, kit.bone(0xd8d0c0));
      add(mask, sk.sockets, kit.void());
      res.eyePos = [sk.eyeL.clone().add(V(0, -0.012, 0.045)), sk.eyeR.clone().add(V(0, -0.012, 0.045))];
      res.face = 'mask';
      break;
    }
    case 'bloodmage': {
      hood({ peak: 0.1, gap: 1.45 });
      mantle(kit.clothDS(meta.robe), { rBot: 0.3, h: 0.24, seed: 7, jag: 0.06 });
      add(G, xf(torus(0.24, 0.006, 4, 40, Math.PI * 2), { rx: Math.PI / 2, y: -0.27, sz: 0.78 }), kit.cloth(meta.trim));
      break;
    }
    case 'chronomancer': {
      // hair cap + gold circlet + floating clock hands
      add(G, hairCap(0.103, 1.7), kit.cloth(0x2a2420), { y: 0.005, z: -0.008, sx: 1, sy: 1.02, sz: 1.06 });
      add(G, xf(torus(0.104, 0.006, 6, 32), { rx: Math.PI / 2 + 0.18, y: 0.035 }), kit.gold());
      const gm = glows.add(kit.glow(meta.color, 3), 1);
      add(G, new THREE.OctahedronGeometry(0.01), gm, { y: 0.04, z: 0.105 });
      const hm = glows.add(kit.glow(meta.color, 2.4), 1);
      const hands = [];
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Shape();
        const L = 0.07 + i * 0.03;
        s.moveTo(-0.004, 0); s.lineTo(0.004, 0); s.lineTo(0.0025, L * 0.8); s.lineTo(0.009, L * 0.8); s.lineTo(0, L); s.lineTo(-0.009, L * 0.8); s.lineTo(-0.0025, L * 0.8); s.closePath();
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: false });
        const piv = grp(G, { y: 0.2 });
        const m = add(piv, g, hm, { ro: 3 });
        m.rotation.x = Math.PI / 2;
        hands.push({ piv, sp: (i + 1) * 0.35 * (i % 2 ? -1 : 1), ph: i });
      }
      add(G, xf(torus(0.06, 0.0015, 4, 36), { rx: Math.PI / 2, y: 0.2 }), hm);
      res.update = (t) => hands.forEach((h) => { h.piv.rotation.y = t * h.sp + h.ph; h.piv.position.y = 0.2 + Math.sin(t * 1.5 + h.ph) * 0.006; });
      mantle(kit.clothDS(meta.robe), { rBot: 0.27, h: 0.16, seed: 8 });
      res.face = 'open';
      res.beard = 0x3a302a;
      break;
    }
    case 'warlock': {
      hood({ peak: 0.03, gap: 1.4, deep: 0.04 });
      mantle(robe, { rBot: 0.28, h: 0.2, seed: 9, jag: 0.06 });
      const horns = [];
      for (const s of [-1, 1]) {
        const pts = [V(s * 0.08, 0.07, -0.01), V(s * 0.13, 0.12, -0.04), V(s * 0.155, 0.19, -0.1), V(s * 0.135, 0.245, -0.17), V(s * 0.1, 0.255, -0.21)];
        const h = tubeVar(pts, (t) => 0.024 * Math.pow(1 - t, 0.9) + 0.0015, 24, 8, true);
        // ridges
        const hp = h.getAttribute('position');
        for (let i = 0; i < hp.count; i++) {
          const y = hp.getY(i);
          const k = 1 + Math.sin(y * 260) * 0.03;
          hp.setXYZ(i, hp.getX(i) * k, y, hp.getZ(i) * k);
        }
        h.computeVertexNormals();
        horns.push(h);
      }
      add(G, mergeGeos(horns), kit.bone(0x3a3034));
      break;
    }
    case 'lightbinder': {
      hood({ peak: 0.05, mat: kit.clothDS(0xe8e2d4), rimMat: kit.gold() });
      mantle(kit.clothDS(0xe8e2d4), { rBot: 0.27, h: 0.17, seed: 10, jag: 0.015 });
      add(G, xf(torus(0.112, 0.006, 6, 32), { rx: Math.PI / 2 + 0.25, y: 0.045, z: 0.01 }), kit.gold());
      const gm = glows.add(kit.glow(meta.color, 3.2), 1);
      add(G, xf(new THREE.OctahedronGeometry(0.012), { sy: 1.5 }), gm, { y: 0.08, z: 0.11 });
      break;
    }
    case 'geomancer': {
      hood({ peak: 0.04, mat: kit.leather(0x6a5038), rimMat: kit.leather(0x3a2a1c) });
      mantle(kit.leather(0x5a4430), { rBot: 0.24, h: 0.13, seed: 11, jag: 0.02 });
      const p = (s) => {
        const g = roundedBox(0.16, 0.06, 0.15, 0.025, 2);
        noisify(g, 0.008, 25, 20 + s, 2);
        const g2 = roundedBox(0.1, 0.05, 0.11, 0.02, 2);
        noisify(g2, 0.006, 30, 30 + s, 2);
        g2.translate(s * 0.03, 0.035, 0);
        return flat(mergeGeos([g, g2]));
      };
      res.shoulders = [p(1), p(-1), kit.rock(0x8a8076)];
      break;
    }
    case 'druid': {
      // wooden circlet with antlers and leaves; hair cap
      add(G, hairCap(0.104, 1.75), kit.cloth(0x2a2016), { y: 0.0, z: -0.01, sz: 1.06 });
      const wood = kit.wood(0x6a5038, 0.9);
      add(G, xf(torus(0.106, 0.008, 6, 30), { rx: Math.PI / 2 + 0.15, y: 0.04 }), wood);
      const rnd = mulberry(12);
      const segs = [];
      for (const s of [-1, 1]) branches(V(s * 0.07, 0.07, -0.01), V(s * 0.6, 1, -0.2), 0.16, 0.011, 2, rnd, segs);
      add(G, mergeGeos(segs.map((b) => tubeVar(b.pts, (t) => b.r0 * (1 - t) + b.r1 * t, 8, 5, true))), kit.bone(0xc8b898));
      const lm = kit.plainDS(0x4a7a24, 0.7);
      const lv = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        const lg = leaf(0.05, 0.016, 0.3);
        xf(lg, { rx: -0.6, ry: -a + Math.PI / 2 });
        lg.translate(Math.cos(a) * 0.105, 0.045, Math.sin(a) * 0.105);
        lv.push(lg);
      }
      add(G, mergeGeos(lv), lm);
      mantle(kit.clothDS(meta.trim), { rBot: 0.26, h: 0.17, seed: 13, jag: 0.06 });
      res.face = 'open';
      res.beard = 0x4a3a28;
      break;
    }
    case 'spellblade': {
      const h = hoodGeo({ peak: 0.03, gap: 2.6, r: 0.142, thetaLen: 2.35 });
      res.drape.push(add(G, h.shell, robe, { y: 0.0, z: -0.02 }));
      res.hood = true;
      const steel = kit.metal(0xa8b0bc, 0.7);
      const helm = new THREE.SphereGeometry(0.118, 24, 12, 0, TAU, 0, 1.55);
      add(G, helm, steel, { y: 0.012, sz: 1.08 });
      const parts = [
        xf(torus(0.118, 0.006, 6, 32), { rx: Math.PI / 2, y: 0.012, sz: 1.08 }),
        xf(new THREE.BoxGeometry(0.014, 0.075, 0.012), { y: -0.012, z: 0.125 }),
        xf(torus(0.118, 0.004, 4, 24, Math.PI * 0.8), { rz: Math.PI / 2 - Math.PI * 0.4, y: 0.012, z: 0, ry: Math.PI / 2 }),
      ];
      for (const s of [-1, 1]) {
        const c = new THREE.SphereGeometry(0.122, 10, 8, s > 0 ? 0.25 : Math.PI - 0.25 - 0.9, 0.9, 1.45, 0.7);
        parts.push(c);
      }
      add(G, mergeGeos(parts), steel);
      const rm = glows.add(kit.glow(meta.color, 2), 1);
      add(G, xf(new THREE.BoxGeometry(0.003, 0.05, 0.004), { y: 0.06, z: 0.124, rx: -0.35 }), rm);
      mantle(robe, { rBot: 0.27, h: 0.17, seed: 14 });
      res.face = 'helm';
      break;
    }
    case 'tempest': {
      hood({ peak: 0.06, gap: 1.6 });
      mantle(robe, { rBot: 0.26, h: 0.16, seed: 15, jag: 0.05 });
      const fm = kit.plainDS(0xe8e4dc, 0.85), fm2 = kit.plainDS(0x5a5a62, 0.85);
      const fa = [], fb = [];
      for (let i = 0; i < 7; i++) {
        const a = -0.9 + (i / 6) * 1.8;
        const f = feather(0.13 + (3 - Math.abs(i - 3)) * 0.025, 0.018, 20 + i);
        xf(f, { rx: -0.5 - Math.abs(a) * 0.3, rz: -a * 0.9 });
        f.translate(Math.sin(a) * 0.08, 0.1, -0.06 - Math.cos(a) * 0.02);
        (i % 2 ? fb : fa).push(f);
      }
      add(G, mergeGeos(fa), fm); add(G, mergeGeos(fb), fm2);
      add(G, xf(torus(0.03, 0.006, 6, 14), { y: 0.1, z: -0.07, rx: 0.4 }), kit.leather(0x4a3a2a));
      break;
    }
    default:
      hood();
  }
  return res;
}
