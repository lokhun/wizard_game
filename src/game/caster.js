import * as THREE from 'three';
import { SPR } from '../render/particles.js';
import { fxOf } from '../render/vfx.js';
import { rand } from '../core/rng.js';
import { soundEl } from './spells.js';

// ---------------------------------------------------------------------------
// The spell context ("ctx") handed to every spell's cast function. It hides
// the difference between a local cast (applies damage, moves the player) and
// a remote replay (visuals only), and applies the caster's upgrade stats.
// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

// shared geometry for ground eruptions
let spikeGeo, thornGeo, tentacleGeo, spikeMat, thornMat, tentacleMat;
function ensureGeo() {
  if (spikeGeo) return;
  // a jagged shard of rock, not a smooth cone
  spikeGeo = new THREE.ConeGeometry(0.45, 2.4, 6, 3);
  {
    const pa = spikeGeo.getAttribute('position');
    let sd = 7;
    const rnd = () => ((sd = (sd * 9301 + 49297) % 233280) / 233280);
    const key = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    const off = new Map();
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const k = key(x, y, z);
      if (!off.has(k)) off.set(k, [(rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.4, 0.7 + rnd() * 0.6]);
      const o = off.get(k), r = Math.hypot(x, z);
      if (r < 1e-3) continue; // keep the tip and the base centre where they are
      // ragged facets, and the shard leans and kinks a little as it rises
      const h = (y + 1.2) / 2.4;
      pa.setXYZ(i, x * o[3] + o[0] * (0.4 + h) + h * h * 0.25, y + o[1] * (y > -1.1 ? 1 : 0), z * o[3] + o[2] * (0.4 + h));
    }
    spikeGeo.computeVertexNormals();
  }
  spikeGeo.translate(0, 1.2, 0);
  spikeMat = new THREE.MeshStandardMaterial({ color: 0x4e443a, roughness: 0.95, flatShading: true, emissive: 0x3a1400, emissiveIntensity: 0.45 });
  thornGeo = new THREE.ConeGeometry(0.12, 1.5, 5, 1);
  thornGeo.translate(0, 0.75, 0);
  thornMat = new THREE.MeshStandardMaterial({ color: 0x2c3416, roughness: 0.6, emissive: 0x3a5c0c, emissiveIntensity: 0.55, flatShading: true });
  const pts = [];
  for (let i = 0; i <= 10; i++) pts.push(new THREE.Vector3(Math.sin(i * 0.5) * 0.3 * (i / 10), i * 0.42, Math.cos(i * 0.4) * 0.2 * (i / 10)));
  tentacleGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.32, 8, false);
  const p = tentacleGeo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 - (y / 4.2) * 0.85;
    const cx = Math.sin((y / 0.42) * 0.5) * 0.3 * (y / 4.2), cz = Math.cos((y / 0.42) * 0.4) * 0.2 * (y / 4.2);
    p.setX(i, cx + (p.getX(i) - cx) * k);
    p.setZ(i, cz + (p.getZ(i) - cz) * k);
  }
  tentacleGeo.computeVertexNormals();
  tentacleMat = new THREE.MeshStandardMaterial({ color: 0x2a1030, roughness: 0.35, metalness: 0.1, emissive: 0x4a0c90, emissiveIntensity: 0.6 });
}

// one mesh per eruption material, for shader prewarming at floor load
export function warmEruptionMeshes() {
  ensureGeo();
  return [new THREE.Mesh(spikeGeo, spikeMat), new THREE.Mesh(thornGeo, thornMat), new THREE.Mesh(tentacleGeo, tentacleMat)];
}

export function makeCtx(game, caster, o) {
  ensureGeo();
  const local = !!o.local;
  const stats = o.stats ?? {};
  const slot = o.slot;
  const rt = game.spells;
  const vfx = game.vfx;
  const counters = caster.counters ?? (caster.counters = {});

  const ctx = {
    g: game, rt, vfx, local, stats, slot,
    caster,
    pid: caster.id,
    origin: o.origin.clone(),
    dir: o.dir.clone().normalize(),
    aimPoint: o.aimPoint ? o.aimPoint.clone() : o.origin.clone().addScaledVector(o.dir, 20),
    get time() { return game.time; },

    sound(name, vol = 1, pos) {
      game.audio?.play(name.replace(/^(cast|impact)_(\w+?)(_big)?$/, (m, a, b, c) => `${a}_${soundEl(b)}${c ?? ''}`), { pos: pos ?? (local ? undefined : ctx.origin), volume: vol });
    },
    loop(name) { return game.audio?.loop(name, { pos: ctx.origin }) ?? null; },
    lightAt(pos, color, intensity, range) { game.lights.request(pos, color, intensity, range); },
    after(t, fn) { rt.after(t, fn); },
    groundAt(x, z) { return game.groundY(x, z); },
    aoe(r) { return r * (stats.aoeMult ?? 1); },
    counter(name) { const n = counters[name] ?? 0; counters[name] = n + 1; return n; },
    // swap the caster's first-person cast animation (e.g. backhand vs forehand)
    animStyle(style) { if (caster.castAnim) caster.castAnim.style = style; },
    kick(shake, fov) { if (local) { vfx.addShake(shake); vfx.addFovKick(fov); } },
    hitstop(t) { if (local) vfx.hitstop = Math.max(vfx.hitstop, t); },

    casterPos() { return caster.pos; },
    flatDir() { const d = new THREE.Vector3(ctx.dir.x, 0, ctx.dir.z); if (d.lengthSq() < 1e-6) d.set(0, 0, -1); return d.normalize(); },

    muzzle(el, scale = 1) { vfx.muzzle(ctx.origin, ctx.dir, el, scale); },

    // spread n directions around aim in a horizontal fan
    fan(n, spreadDeg, fn) {
      const extra = slot === 'primary' ? (stats.extraProj ?? 0) : 0;
      const total = n + extra;
      const gap = THREE.MathUtils.degToRad(Math.max(spreadDeg, 3));
      for (let i = 0; i < total; i++) {
        const off = (i - (total - 1) / 2) * gap;
        fn(ctx.dir.clone().applyAxisAngle(UP, -off), i);
      }
    },

    proj(opts) {
      const p = { ...opts };
      p.local = local;
      p.owner = caster.id;
      p.faction = 'player';
      p.pos = p.pos ? p.pos.clone() : ctx.origin.clone();
      const speedMult = stats.projSpeed ?? 1;
      p.vel = p.vel.clone().multiplyScalar(speedMult);
      if (p.hit) {
        p.hit = { ...p.hit };
        if (slot === 'primary' && stats.infuse) p.hit.st = { ...(p.hit.st ?? {}), ...stats.infuse };
      }
      if (slot !== 'ultimate' && p.mesh !== 'boulder') {
        p.pierce = (p.pierce ?? 0) + (stats.pierce ?? 0);
        p.bounce = (p.bounce ?? 0) + (stats.bounce ?? 0);
        if (stats.homing && !p.homing) p.homing = stats.homing;
      }
      if (p.noWallUntilGround) {
        p.noWall = true;
        const prevTick = p.onTick;
        p.onTick = (pr, dt) => {
          if (pr.noWall && pr.pos.y < game.level.ceilAt(pr.pos.x, pr.pos.z) - 0.3) pr.noWall = false;
          prevTick?.(pr, dt);
        };
      }
      if (stats.splitOnHit && slot === 'primary' && local) {
        const prevHit = p.onHit;
        p.onHit = (pr, a, pos) => {
          prevHit?.(pr, a, pos);
          if (pr.data.split) return;
          for (const s of [-1, 1]) {
            const d = pr.vel.clone().normalize().applyAxisAngle(UP, s * 0.5);
            const child = ctx.proj({ ...opts, pos: pos.clone(), vel: d.multiplyScalar(pr.vel.length() / speedMult), hit: { ...(opts.hit ?? {}), dmg: (opts.hit?.dmg ?? 5) * (stats.splitK ?? 0.5) }, data: { split: true }, life: 0.6 });
            child.hitIds.add(a?.id);
          }
        };
      }
      return rt.spawn(p);
    },

    hit(actor, H, pos) {
      if (!local) return;
      game.hitActor(actor, { ...H, src: caster.id }, pos);
    },
    area(pos, r, H) {
      if (!local) return [];
      return rt.damageArea(pos, r, { ...H, src: caster.id });
    },
    // exclude: an existing hit set to share (augment forks); skipFirst: don't re-hit `first`
    chain(first, firstPos, H, n, range, falloff, exclude, skipFirst) {
      const hitSet = exclude ?? new Set();
      hitSet.add(first.id);
      if (!skipFirst) ctx.hit(first, H, firstPos);
      let cur = first, curPos = firstPos, dmg = H.dmg;
      for (let i = 0; i < n; i++) {
        const next = rt.nearest(curPos, range, hitSet);
        if (!next) break;
        hitSet.add(next.id);
        dmg *= falloff;
        const np = new THREE.Vector3(next.pos.x, next.pos.y + next.height * 0.55, next.pos.z);
        const from = curPos.clone();
        ctx.after(0.04 * (i + 1), () => {
          vfx.lightning(from, np, { element: H.el, life: 0.14, branches: 0 });
          vfx.impact(np, H.el, 0.6);
        });
        ctx.hit(next, { ...H, dmg }, np);
        cur = next; curPos = np;
      }
      void cur;
      return hitSet;
    },
    zone(z) {
      const zone = { ...z, pos: z.pos.clone(), local };
      const userVisual = z.visual;
      zone.visual = (zz, dt) => {
        if (zz.follow) zz.pos.copy(caster.pos);
        if (zz.flames) burningGround(game, zz, dt);
        userVisual?.(zz, dt);
      };
      const userTick = z.onTick;
      zone.onTick = (zz) => {
        if (userTick) { userTick(zz); return; }
        if (!local) return;
        if (zz.dmg || zz.st || zz.pull) {
          for (const a of rt.inRadius(zz.pos, zz.radius)) {
            const H = { dmg: zz.dmg ?? 0, el: zz.el, st: zz.st, tag: 'dot', src: caster.id, noNumber: (zz.dmg ?? 0) < 1 };
            if (zz.pull) H.pull = [zz.pos.x, zz.pos.z, zz.pull];
            game.hitActor(a, H, new THREE.Vector3(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z));
          }
        }
        if (zz.healAllies) game.healPlayersInRadius(zz.pos, zz.radius, zz.healAllies * zz.interval * 2, caster.id);
      };
      return rt.zone(zone);
    },

    // ---- movement (local only; remote positions arrive over the network)
    dash(dist, dur, opts) { if (local) caster.dash?.(ctx.flatDir(), dist, dur, opts); },
    blink(dist) {
      if (local) return caster.blink?.(ctx.dir, dist) ?? null;
      return caster.pos.clone().addScaledVector(ctx.flatDir(), dist);
    },
    launch(vy, glide) { if (local) caster.launch?.(vy, glide); },
    rewind(sec) { return local ? caster.rewind?.(sec) ?? null : null; },
    parry(dur) { if (local) caster.startParry?.(dur); },

    // ---- self & allies
    hp() { return caster.hp ?? 100; },
    maxHp() { return caster.maxHp ?? 100; },
    payHp(n) { if (local) caster.payHp?.(n); },
    healSelf(n) { if (local) caster.heal?.(n); },
    healAllies(pos, r, n) { if (local) game.healPlayersInRadius(pos, r, n, caster.id, true); },
    healAlliesOnRay(o, d, len, n) { if (local) game.healPlayersOnRay(o, d, len, n, caster.id); },
    shieldAllies(pos, r, amount, dur) { if (local) game.shieldPlayersInRadius(pos, r, amount, dur); else vfx.shell(new THREE.Vector3(pos.x, pos.y + 1, pos.z), { element: 'holy', radius: 2, life: 0.5 }); },
    reviveAllies(pos, r) { if (local) game.reviveInRadius(pos, r); },
    buff(id, dur, mods) { if (local) caster.addBuff?.(id, dur, mods); },
    addCharge(n, max) { if (local) caster.addCharge?.(n, max); },
    useCharges() { return local ? caster.useCharges?.() ?? 0 : (o.charges ?? 0); },
    consumeStatic() { return local ? caster.consumeStatic?.() : false; },
    screenTint(rgb, dur) { if (local) game.screenTint(rgb, dur); },
    summon(type, pos, life) { if (local) game.requestSummon(type, pos, life, caster.id); },

    // ---- visual helpers
    spike(pos, scale = 1) { erupt(game, pos, spikeGeo, spikeMat, scale * rand(0.8, 1.2), 1.4, true); },
    thorn(pos) {
      for (let i = 0; i < 3; i++) erupt(game, new THREE.Vector3(pos.x + rand(-0.3, 0.3), pos.y, pos.z + rand(-0.3, 0.3)), thornGeo, thornMat, rand(0.7, 1.3), 2.2, false, rand(-0.5, 0.5));
      vfx.burst(new THREE.Vector3(pos.x, pos.y + 0.3, pos.z), { element: 'poison', count: 4, speed: 2, life: 0.6, size: 0.1, sprite: SPR.FEATHER, gravity: 4, upward: 1 });
      // torn earth and a sickly green flare where the briar breaks through
      vfx.burst(new THREE.Vector3(pos.x, pos.y + 0.15, pos.z), { count: 4, speed: 3, upward: 1.2, life: 0.6, size: 0.08, sprite: SPR.CHUNK, solid: true, gravity: 12, spin: 5, color: [0.2, 0.17, 0.1] });
      vfx.P.glow({ x: pos.x, y: pos.y + 0.3, z: pos.z, vy: 1, r: 0.35, g: 0.7, b: 0.12, life: 0.35, size: 0.9, size2: 0.3, sprite: SPR.GLOW });
    },
    tentacle(pos) {
      const m = new THREE.Mesh(tentacleGeo, tentacleMat);
      m.position.copy(pos);
      m.rotation.y = Math.random() * Math.PI * 2;
      m.scale.setScalar(0.01);
      game.scene.add(m);
      vfx.burst(new THREE.Vector3(pos.x, pos.y + 0.2, pos.z), { element: 'shadow', count: 20, speed: 4, upward: 1, life: 0.6, size: 0.25, sprite: SPR.WISP });
      vfx.decal(pos, 'crack', 3, 4);
      const tilt = rand(-0.3, 0.3);
      // the ground tears open in a glowing violet wound beneath it
      vfx.P.glow({ x: pos.x, y: pos.y + 0.15, z: pos.z, r: 0.5, g: 0.1, b: 0.9, life: 0.35, size: 0.4, size2: 2.6, sprite: SPR.RING });
      vfx.smoke(new THREE.Vector3(pos.x, pos.y + 0.3, pos.z), { count: 3, size: 0.8, color: [0.03, 0, 0.05], alpha: 0.7, life: 1.2, rise: 1.4 });
      const lp = new THREE.Vector3(pos.x, pos.y + 1.5, pos.z);
      vfx._track(m, 1.4, (k) => {
        const rise = k < 0.2 ? k / 0.2 : k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
        game.lights.request(lp, 0x9030f0, 6 * rise, 6);
        m.scale.set(1.1, 1.1 * Math.max(0.01, rise), 1.1);
        // whip down to slam around k=0.25
        m.rotation.x = k < 0.2 ? tilt : tilt + Math.min(1, (k - 0.2) / 0.08) * 1.25 - Math.max(0, k - 0.4) * 1.5;
      }, () => game.scene.remove(m));
      ctx.after(0.3, () => { vfx.explosion(new THREE.Vector3(pos.x, pos.y + 0.5, pos.z), 'shadow', 2); game.audio?.play('boss_slam', { pos, volume: 0.5 }); });
    },
  };
  return ctx;
}

// Burning ground (fireball, blazing step, slag): overlapping tongues of flame
// of every size, hottest and tallest at the heart and guttering at the rim,
// with embers and a little soot - a carpet of fire, not a field of candles.
// Rate-based (zz.eF* accumulators), so it is the same at any frame rate.
const _zl = new THREE.Vector3();
export function burningGround(game, zz, dt) {
  const vfx = game.vfx, fx = fxOf('fire');
  const R = zz.radius, cx = zz.pos.x, cy = zz.pos.y, cz = zz.pos.z;
  // catches fast, then gutters out over the last third of its life
  const k = Math.min(1, zz.age / 0.15) * Math.min(1, (zz.life - zz.age) / (zz.life * 0.35));
  zz.eF = (zz.eF ?? 0) + Math.min(170, 15 * R * R + 20) * k * dt;
  // standing in the fire (or looking back down a Blazing Step trail) puts
  // hundreds of these right against the lens, where they stack into a white
  // sheet: the ones rising around the eye burn low and small
  const cam = game.renderer.camera.position;
  for (; zz.eF >= 1; zz.eF--) {
    const a = Math.random() * Math.PI * 2, u = Math.sqrt(Math.random()), r = u * R;
    const heat = 1 - u * 0.75;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const dc = Math.hypot(x - cam.x, cy + 0.6 - cam.y, z - cam.z);
    const nk = dc < 3 ? Math.max(0.1, (dc - 0.6) / 2.4) : 1, ns = 0.5 + 0.5 * nk;
    if (Math.random() < 0.55) {
      // ragged glowing puffs rolling up off the floor (the body of the fire)
      const pk = 0.5 * nk, ek = 0.8 * nk;
      vfx.P.glow({ x, y: cy + 0.15, z, vx: rand(-0.2, 0.2), vy: rand(0.5, 1.2) * (0.6 + heat), vz: rand(-0.2, 0.2),
        r: fx.mid[0] * pk, g: fx.mid[1] * pk, b: fx.mid[2] * pk, r2: fx.end[0] * ek, g2: fx.end[1] * ek, b2: fx.end[2] * ek,
        life: rand(0.4, 0.8), size: rand(0.35, 0.7) * (0.6 + 0.6 * heat) * ns, size2: rand(0.6, 1.0) * (0.6 + 0.6 * heat) * ns, sprite: SPR.SMOKE, drag: 1, spin: rand(-1.5, 1.5) });
    } else {
      // and licking tongues, hotter toward the heart
      const hot = Math.random() < 0.3 * heat;
      const c0 = hot ? fx.core : fx.mid, ck = (hot ? 0.5 : 0.7) * nk;
      vfx.P.glow({ x, y: cy + 0.04, z, vx: rand(-0.25, 0.25), vy: rand(0.8, 1.8) * (0.6 + heat), vz: rand(-0.25, 0.25),
        r: c0[0] * ck, g: c0[1] * ck, b: c0[2] * ck, r2: fx.end[0] * nk, g2: fx.end[1] * nk, b2: fx.end[2] * nk,
        life: rand(0.3, 0.6), size: rand(0.2, 0.5) * (0.6 + 0.7 * heat) * ns, size2: 0.06, sprite: SPR.FLAME, drag: 1.2, spin: rand(1, 3) });
    }
  }
  zz.eE = (zz.eE ?? 0) + (4 + 3 * R) * k * dt;
  for (; zz.eE >= 1; zz.eE--) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R * 0.8;
    vfx.P.glow({ x: cx + Math.cos(a) * r, y: cy + 0.3, z: cz + Math.sin(a) * r, vx: rand(-0.6, 0.6), vy: rand(1.5, 3.2), vz: rand(-0.6, 0.6), r: 1.5, g: 0.45, b: 0.06, r2: 0.4, g2: 0.03, b2: 0, life: rand(0.7, 1.4), size: 0.03, sprite: SPR.EMBER, drag: 0.8, gravity: -0.4 });
  }
  zz.eS = (zz.eS ?? 0) + (0.8 + 0.5 * R) * k * dt;
  for (; zz.eS >= 1; zz.eS--) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * R * 0.6;
    vfx.P.solid({ x: cx + Math.cos(a) * r, y: cy + 0.9, z: cz + Math.sin(a) * r, vx: rand(-0.3, 0.3), vy: rand(0.6, 1.1), vz: rand(-0.3, 0.3), r: 0.05, g: 0.04, b: 0.035, a: 0.32, life: rand(1.6, 2.4), size: 0.6, size2: 1.8 + R * 0.3, sprite: SPR.SMOKE, drag: 0.8, spin: rand(-0.5, 0.5) });
  }
  game.lights.request(_zl.set(cx, cy + 0.8, cz), 0xff6020, (5 + 1.5 * R) * k * (0.85 + 0.15 * Math.sin(game.time * 23 + cx)), R * 3);
}

function erupt(game, pos, geo, mat, scale, life, dust, tilt = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(pos);
  m.rotation.set(tilt, Math.random() * 6.28, tilt * 0.5);
  m.scale.set(scale, 0.01, scale);
  game.scene.add(m);
  if (dust) {
    game.vfx.smoke(new THREE.Vector3(pos.x, pos.y + 0.2, pos.z), { count: 2, size: 0.6, color: [0.3, 0.25, 0.18], alpha: 0.4 });
    game.vfx.burst(new THREE.Vector3(pos.x, pos.y + 0.3, pos.z), { count: 5, speed: 4, life: 0.6, size: 0.1, sprite: SPR.CHUNK, solid: true, color: [0.3, 0.26, 0.2], gravity: 14, upward: 1 });
  }
  game.vfx._track(m, life, (k) => {
    const s = k < 0.1 ? k / 0.1 : k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    m.scale.y = scale * Math.max(0.01, k < 0.1 ? 1 - Math.pow(1 - s, 3) : s);
    m.position.y = pos.y - (k > 0.75 ? (k - 0.75) * 2 : 0);
  }, () => game.scene.remove(m));
}
