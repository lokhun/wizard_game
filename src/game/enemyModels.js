// ---------------------------------------------------------------------------
// Procedural enemy models for Arcane Ascent.
//
//   const m = createEnemyModel('skeleton', { factory });
//   scene.add(m.root);
//   m.update(dt, { anim: 'move', t, speed, progress, attackType });
//
// Every model is a rigidly-skinned bone hierarchy built from primitives; all
// parts sharing a material are merged into a single SkinnedMesh, so each enemy
// costs ~4-8 draw calls. Templates (geometry + base materials) are cached per
// TextureFactory; each instance clones only its materials (hit flash / tint).
// See src/game/models/*.js for the individual type definitions.
// ---------------------------------------------------------------------------
import { Rig, EnemyInstance, materialLib, setEnemyRim } from './models/core.js';
export { setEnemyRim };
import { SEWER_TYPES } from './models/sewers.js';
import { DUNGEON_TYPES } from './models/dungeon.js';
import { COURTYARD_TYPES } from './models/courtyard.js';
import { KEEP_TYPES } from './models/keep.js';
import { BOSS_TYPES } from './models/bosses.js';
import { THRONE_TYPES } from './models/throne.js';

const SPECS = {};
for (const list of [SEWER_TYPES, DUNGEON_TYPES, COURTYARD_TYPES, KEEP_TYPES, THRONE_TYPES, BOSS_TYPES]) for (const s of list) SPECS[s.id] = s;

export const ENEMY_TYPES = Object.keys(SPECS);

// Static info per type without building it (height, radius, flying, attack variants...)
export function enemyInfo(type) {
  const s = SPECS[type];
  if (!s) return null;
  return { id: s.id, height: s.height, radius: s.radius, flying: !!s.flying, eyeColor: s.eyeColor, magicColor: s.magicColor ?? s.eyeColor, attackTypes: s.attackTypes ?? [s.defaultAttack], defaultAttack: s.defaultAttack, boss: !!s.boss, elite: !!s.elite };
}

const templates = new WeakMap();

function getTemplate(spec, factory) {
  let map = templates.get(factory);
  if (!map) { map = new Map(); templates.set(factory, map); }
  let tpl = map.get(spec.id);
  if (!tpl) {
    const lib = materialLib(factory);
    const rig = new Rig();
    const dims = spec.build(rig);
    if (dims) spec.dims = dims;
    rig.finish(lib);
    tpl = { root: rig.root, tris: rig.tris, meshes: rig.root.children.filter((c) => c.isMesh).length };
    map.set(spec.id, tpl);
  }
  return tpl;
}

// Pre-build templates (e.g. during a loading screen) so the first spawn doesn't hitch.
export function preloadEnemyModels(types, ctx) {
  for (const t of types) if (SPECS[t]) getTemplate(SPECS[t], ctx.factory);
}

export function createEnemyModel(type, ctx) {
  const spec = SPECS[type];
  if (!spec) throw new Error('unknown enemy type ' + type);
  const tpl = getTemplate(spec, ctx.factory);
  const inst = new EnemyInstance(spec, tpl, materialLib(ctx.factory));
  inst.tris = tpl.tris;
  return inst;
}
