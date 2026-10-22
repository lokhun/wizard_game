import * as THREE from 'three';
import { PROPS, chestLid } from '../world/props.js';
import { getSharedMaterials } from '../world/materials.js';
import { SPR } from '../render/particles.js';
import { rand } from '../core/rng.js';

// Interactive world objects: treasure chests, tome pedestals, exit portals.

function partsToGroup(parts, mats) {
  const g = new THREE.Group();
  for (const [key, geo] of parts) {
    const m = new THREE.Mesh(geo, mats[key] ?? mats.wood);
    g.add(m);
  }
  return g;
}

export function makeChest(game, p) {
  const mats = getSharedMaterials(game.texFactory);
  const root = new THREE.Group();
  const y = game.groundY(p.x, p.z);
  root.position.set(p.x, y, p.z);
  root.rotation.y = p.rot ?? 0;
  root.scale.setScalar(p.big ? 1.3 : 1);
  root.add(partsToGroup(PROPS.chest(), mats));
  const lid = partsToGroup(chestLid(), mats);
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.55, -0.31);
  lid.position.set(0, 0, 0);
  hinge.add(lid);
  root.add(hinge);
  // glow from inside: borrowed from the light pool (adding a light of its own
  // would change the light count and recompile every shader in the scene)
  const glowAt = new THREE.Vector3(p.x, y + 0.8, p.z);
  game.scene.add(root);
  let open = 0, opening = false;
  const it = {
    kind: 'chest', id: 'chest' + Math.round(p.x * 10) + '_' + Math.round(p.z * 10),
    pos: new THREE.Vector3(p.x, y + 0.6, p.z), r: 2.8, label: 'Open the Chest', usedBy: new Set(),
    open() {
      if (opening) return;
      opening = true;
      for (let i = 0; i < 30; i++) game.vfx.P.glow({ x: p.x, y: y + 0.8, z: p.z, vx: rand(-1.5, 1.5), vy: rand(2, 5), vz: rand(-1.5, 1.5), r: 3, g: 2.2, b: 0.6, life: 1.2, size: 0.1, sprite: SPR.STAR, gravity: 4 });
    },
    update(dt, t) {
      if (opening) open = Math.min(1, open + dt * 2.5);
      hinge.rotation.x = -open * 1.9;
      if (open > 0.01) game.lights.request(glowAt, 0xffb040, open * (4 + Math.sin(t * 8) * 0.5), 4);
      if (!opening && Math.random() < dt * 3) game.vfx.P.glow({ x: p.x + rand(-0.5, 0.5), y: y + 0.7, z: p.z + rand(-0.3, 0.3), vy: 0.4, r: 2.5, g: 1.8, b: 0.5, life: 1, size: 0.05, sprite: SPR.STAR });
    },
    dispose() { game.scene.remove(root); },
  };
  return it;
}

// Lectern with a floating, glowing tome: each player may claim one choice.
export function makePedestal(game, pos, minRarity = 0) {
  const mats = getSharedMaterials(game.texFactory);
  const root = new THREE.Group();
  root.position.copy(pos);
  const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 0.25, 8), mats.stone);
  stone.position.y = 0.12;
  root.add(stone);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.9, 8), mats.stone);
  col.position.y = 0.7;
  root.add(col);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.55), mats.wood);
  top.position.set(0, 1.18, 0);
  top.rotation.x = -0.35;
  root.add(top);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...[[1.6, 1.4, 1], [0.6, 1.4, 3], [2, 0.8, 3], [3, 2, 0.5]][minRarity]), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.015, 6, 32), ringMat);
  ring.position.y = 1.75;
  root.add(ring);
  const ring2 = ring.clone();
  ring2.scale.setScalar(0.75);
  root.add(ring2);
  // the book
  const book = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.38), mats.leather);
  book.add(cover);
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.34), new THREE.MeshStandardMaterial({ color: 0xf0e6c8, emissive: 0xffe0a0, emissiveIntensity: 0.6 }));
  pages.position.y = 0.05;
  book.add(pages);
  book.position.y = 1.75;
  root.add(book);
  const lightAt = pos.clone().add(new THREE.Vector3(0, 1.9, 0)); // pooled light, see makeChest
  game.scene.add(root);
  root.scale.setScalar(0.01);
  let appear = 0;
  game.vfx.explosion(pos.clone().add(new THREE.Vector3(0, 1.5, 0)), 'holy', 2);
  const glyph = game.vfx.decal(pos, 'glyph', 3, 9999, 0xffc060);
  const it = {
    kind: 'pedestal', pos: pos.clone().add(new THREE.Vector3(0, 1.4, 0)), r: 3, label: 'Read the Arcane Tome', usedBy: new Set(), minRarity,
    update(dt, t) {
      appear = Math.min(1, appear + dt * 1.5);
      root.scale.setScalar(Math.max(0.01, 1 - Math.pow(1 - appear, 3)));
      const used = it.usedBy.has(game.player.id);
      book.visible = !used;
      book.position.y = 1.75 + Math.sin(t * 2) * 0.06;
      book.rotation.y = t * 0.6;
      ring.rotation.set(Math.PI / 2 + Math.sin(t) * 0.3, t * 0.8, 0);
      ring2.rotation.set(Math.PI / 2 - Math.sin(t * 1.3) * 0.4, -t, 0.5);
      ringMat.opacity = used ? 0.15 : 0.9;
      game.lights.request(lightAt, 0xffd080, (used ? 0.5 : 5 + Math.sin(t * 3)) * appear, 6);
      if (!used && Math.random() < dt * 12) {
        const a = Math.random() * Math.PI * 2;
        game.vfx.P.glow({ x: pos.x + Math.cos(a) * 0.6, y: pos.y + 1.3, z: pos.z + Math.sin(a) * 0.6, vx: -Math.cos(a) * 0.3, vy: 0.8, vz: -Math.sin(a) * 0.3, r: 3, g: 2.4, b: 1, life: 1, size: 0.06, sprite: SPR.STAR });
        if (Math.random() < 0.2) game.vfx.P.glow({ x: pos.x, y: pos.y + 1.8, z: pos.z, vy: 0.5, r: 2, g: 1.6, b: 0.8, life: 1.5, size: 0.3, sprite: SPR.RUNE, spin: 1 });
      }
    },
    dispose() {
      game.scene.remove(root);
      glyph.visible = false;
      const a = game.vfx.active.find((x) => x.mesh === glyph);
      if (a) a.t = a.life;
      root.traverse((o) => { if (o.isMesh && o.material !== mats.stone && o.material !== mats.wood && o.material !== mats.leather) { o.geometry.dispose(); o.material.dispose?.(); } else if (o.isMesh) o.geometry.dispose(); });
    },
  };
  return it;
}

// Swirling portal that carries the party to the next floor.
// The way on. opts.kind / label / look: the Hollow King's two ways out, back
// to the dawn ('dawn', gold) or down into the Abyss ('abyss', blood and dark).
// The look is only colours (uniforms): every portal shares one program.
const PORTAL_LOOKS = {
  arcane: { a: [0.6, 0.2, 1.6], b: [2.2, 1.4, 3.2], c: [1.5, 1.2, 2.5], light: 0xa060ff, spark: [1.6, 0.8, 3], arch: 0x401060, burst: 'arcane' },
  dawn: { a: [1.0, 0.55, 0.12], b: [1.9, 1.35, 0.5], c: [1.1, 0.9, 0.5], light: 0xffc060, spark: [3, 2, 0.8], arch: 0x604010, burst: 'holy' },
  abyss: { a: [0.22, 0.0, 0.03], b: [1.15, 0.03, 0.14], c: [0, 0, 0], light: 0xc01040, void: true, spark: [2.6, 0.2, 0.5], arch: 0x500818, burst: 'enemyFire' },
};
export function makePortal(game, pos, opts = {}) {
  const look = PORTAL_LOOKS[opts.look] ?? PORTAL_LOOKS.arcane;
  const root = new THREE.Group();
  root.position.copy(pos);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Vector3(...look.a) }, uB: { value: new THREE.Vector3(...look.b) }, uC: { value: new THREE.Vector3(...look.c) }, uVoid: { value: look.void ? 1 : 0 } },
    // a void portal is a hole in the world (normal blending, opaque black core); the rest glow additively
    transparent: true, depthWrite: false, blending: look.void ? THREE.NormalBlending : THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `
      uniform float uTime, uVoid; uniform vec3 uA, uB, uC; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2. - 1.;
        float r = length(p);
        float a = atan(p.y, p.x);
        float swirl = sin(a * 5. + r * 12. - uTime * 5.) * 0.5 + 0.5;
        float edge = smoothstep(1.0, 0.85, r) * smoothstep(0.0, 0.5, r) * mix(1., smoothstep(0.35, 0.85, r), uVoid);
        float core = smoothstep(0.7, 0.0, r);
        vec3 c = mix(uA, uB, swirl) * edge + uC * core * 0.6;
        float m = smoothstep(1.0, 0.9, r);
        gl_FragColor = vec4(c * m, mix(1., m, uVoid));
      }`,
  });
  mat.forceSinglePass = true; // it always faces the camera; keeps one program for every look
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), mat);
  disc.position.y = 2;
  root.add(disc);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.18, 8, 32), new THREE.MeshStandardMaterial({ color: 0x40384a, roughness: 0.6, emissive: look.arch, emissiveIntensity: 0.8 }));
  arch.position.y = 2;
  root.add(arch);
  const lightAt = pos.clone().add(new THREE.Vector3(0, 2, 0)); // pooled light, see makeChest
  game.scene.add(root);
  const snd = game.audio?.loop('loop_portal', { pos });
  game.vfx.explosion(pos.clone().add(new THREE.Vector3(0, 2, 0)), look.burst, 4);
  return {
    kind: opts.kind ?? 'portal', pos: pos.clone().add(new THREE.Vector3(0, 1.5, 0)), r: opts.kind ? 2.6 : 3.5, label: opts.label ?? 'Ascend to the next floor', usedBy: new Set(),
    update(dt, t) {
      mat.uniforms.uTime.value = t;
      const cam = game.renderer.camera.position;
      disc.lookAt(cam.x, pos.y + 2, cam.z);
      arch.lookAt(cam.x, pos.y + 2, cam.z);
      game.lights.request(lightAt, look.light, 10 + Math.sin(t * 4) * 3, 12);
      if (Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2;
        game.vfx.P.glow({ x: pos.x + Math.cos(a) * 1.7, y: pos.y + 2 + Math.sin(a) * 1.7, z: pos.z, vx: -Math.cos(a) * 1.5, vy: -Math.sin(a) * 1.5, r: look.spark[0], g: look.spark[1], b: look.spark[2], life: 0.9, size: 0.08, sprite: SPR.SPARK });
      }
    },
    dispose() {
      game.scene.remove(root);
      snd?.stop(0.3);
      root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    },
  };
}
