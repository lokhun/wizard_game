import * as THREE from 'three';
import { getSurface, glowTexture } from './surfaces.js';

// ---------------------------------------------------------------------------
// Material library for the wizard models. Opaque surface materials are cached
// per TextureFactory and shared between the viewmodel and all avatars; glow
// materials are created per instance so their brightness can be animated.
// ---------------------------------------------------------------------------

const kits = new WeakMap();

const hexKey = (c) => (c instanceof THREE.Color ? c.getHexString() : typeof c === 'number' ? c.toString(16) : String(c));

export function getKit(factory) {
  if (kits.has(factory)) return kits.get(factory);
  const cache = new Map();
  const shared = (key, make) => {
    if (!cache.has(key)) {
      const m = make();
      m.userData.shared = true;
      m.name = key;
      cache.set(key, m);
    }
    return cache.get(key);
  };
  const surfMat = (surf, opts = {}) => {
    const t = getSurface(factory, surf, opts.size ?? 512, opts.seed ?? 1);
    const m = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.ormMap, metalnessMap: t.ormMap, aoMap: t.ormMap,
      roughness: opts.roughness ?? 1, metalness: opts.metalness ?? 1,
      color: opts.color ?? 0xffffff,
      normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
      side: opts.side ?? THREE.FrontSide,
    });
    if (opts.emissive !== undefined) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = opts.emissiveIntensity ?? 1;
      if (opts.emissiveMap) m.emissiveMap = opts.emissiveMap;
    }
    return m;
  };
  const col = (c, k = 1) => new THREE.Color(c).multiplyScalar(k);

  const kit = {
    factory,
    // staff wood: grain along v. tint multiplies the neutral brown
    wood: (tint = 0xffffff, k = 1) => shared(`wood:${hexKey(tint)}:${k}`, () => surfMat('bark', { color: col(tint, k), normalScale: 1.2 })),
    metal: (tint = 0xffffff, rough = 1) => shared(`metal:${hexKey(tint)}:${rough}`, () => surfMat('metal', { color: tint, roughness: rough })),
    brass: () => kit.metal(0xd8a050, 1),
    gold: () => kit.metal(0xffc860, 0.9),
    copper: () => kit.metal(0xe07848, 1),
    silver: () => kit.metal(0xd8dce8, 0.85),
    steel: () => kit.metal(0x9aa2ae, 0.9),
    darkIron: () => kit.metal(0x3a3a40, 1.2),
    iron: () => shared('iron', () => surfMat('iron', { size: 1024 })),
    leather: (tint = 0x6a4a30) => shared(`leather:${hexKey(tint)}`, () => surfMat('glove', { color: tint, normalScale: 1.3 })),
    glove: (tint = 0xffffff) => shared(`glove:${hexKey(tint)}`, () => surfMat('glove', { color: tint })),
    cloth: (color) => shared(`cloth:${hexKey(color)}`, () => surfMat('robe', { color: col(color, 1.2) })),
    clothDS: (color) => shared(`clothDS:${hexKey(color)}`, () => surfMat('robe', { color: col(color, 1.2), side: THREE.DoubleSide })),
    skin: (tone = 0xffffff, emissiveMap = null, emissive = 0x000000, ei = 1) => shared(`skin:${hexKey(tone)}:${emissiveMap ? emissiveMap.uuid : ''}:${hexKey(emissive)}`, () => surfMat('skin', { color: tone, emissive, emissiveMap, emissiveIntensity: ei })),
    bone: (tint = 0xffffff) => shared(`bone:${hexKey(tint)}`, () => surfMat('bone', { color: tint, size: 1024 })),
    rock: (tint = 0xffffff) => shared(`rock:${hexKey(tint)}`, () => surfMat('rock', { color: tint, size: 1024, normalScale: 1.2 })),
    fur: (tint = 0xffffff) => shared(`fur:${hexKey(tint)}`, () => surfMat('fur', { color: tint, normalScale: 1.2 })),
    plain: (color, rough = 0.8, metal = 0) => shared(`plain:${hexKey(color)}:${rough}:${metal}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })),
    plainDS: (color, rough = 0.8) => shared(`plainDS:${hexKey(color)}:${rough}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, side: THREE.DoubleSide })),
    // dark inner cavity (eye sockets, mouth, hood interior)
    void: () => shared('void', () => new THREE.MeshBasicMaterial({ color: 0x020202 })),

    // ---- per-instance animated materials -----------------------------------
    // solid HDR glow (bloom). intensity > 1 blooms.
    glow: (color, intensity = 3, opts = {}) => {
      const m = new THREE.MeshBasicMaterial({
        color: col(color, intensity),
        transparent: !!opts.additive || opts.opacity !== undefined,
        opacity: opts.opacity ?? 1,
        blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: !opts.additive && opts.opacity === undefined,
        side: opts.side ?? THREE.FrontSide,
        map: opts.map ?? null,
        alphaMap: opts.alphaMap ?? null,
        fog: false,
      });
      m.userData.glow = { base: new THREE.Color(color), intensity };
      return m;
    },
    halo: (color, intensity = 2) => {
      const m = new THREE.MeshBasicMaterial({
        color: col(color, intensity), map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, fog: false,
      });
      m.userData.glow = { base: new THREE.Color(color), intensity };
      return m;
    },
    // translucent crystal shell around a glowing core
    shell: (color, opacity = 0.45, emissiveK = 0.35) => {
      const m = new THREE.MeshStandardMaterial({
        color: col(color, 0.6).lerp(new THREE.Color(1, 1, 1), 0.25), roughness: 0.12, metalness: 0.15,
        transparent: true, opacity, depthWrite: false,
        emissive: new THREE.Color(color), emissiveIntensity: emissiveK,
      });
      m.userData.glowStd = { base: emissiveK };
      return m;
    },
    // surface material whose emissive (map) pulses: runes on wood/metal/stone
    runed: (surf, tint, emissiveColor, emissiveMap, ei = 2, extra = {}) => {
      const t = getSurface(factory, surf, surf === 'rock' || surf === 'leather' || surf === 'bone' ? 1024 : 512, 1);
      const m = new THREE.MeshStandardMaterial({
        map: t.map, normalMap: t.normalMap, roughnessMap: t.ormMap, metalnessMap: t.ormMap, aoMap: t.ormMap,
        roughness: 1, metalness: 1, color: tint, emissive: new THREE.Color(emissiveColor), emissiveMap, emissiveIntensity: ei,
        ...extra,
      });
      m.userData.glowStd = { base: ei };
      return m;
    },
  };
  kits.set(factory, kit);
  return kit;
}

// Collects per-instance glow materials and drives their brightness.
export class GlowSet {
  constructor() { this.items = []; }
  add(mat, weight = 1) {
    if (mat.userData.glow) this.items.push({ mat, kind: 'basic', base: mat.userData.glow.base.clone(), k: mat.userData.glow.intensity, weight });
    else if (mat.userData.glowStd) this.items.push({ mat, kind: 'std', k: mat.userData.glowStd.base, weight });
    return mat;
  }
  // scale: overall multiplier (1 = authored)
  set(scale) {
    for (const it of this.items) {
      const s = 1 + (scale - 1) * it.weight;
      if (it.kind === 'basic') it.mat.color.copy(it.base).multiplyScalar(it.k * s);
      else it.mat.emissiveIntensity = it.k * s;
    }
  }
  dispose() { for (const it of this.items) it.mat.dispose(); this.items.length = 0; }
}
