import * as A from './focusA.js';
import * as B from './focusB.js';

const BUILDERS = {
  pyromancer: A.pyromancer,
  cryomancer: A.cryomancer,
  stormcaller: A.stormcaller,
  arcanist: A.arcanist,
  necromancer: A.necromancer,
  bloodmage: A.bloodmage,
  chronomancer: A.chronomancer,
  warlock: B.warlock,
  lightbinder: B.lightbinder,
  geomancer: B.geomancer,
  druid: B.druid,
  spellblade: B.spellblade,
  tempest: B.tempest,
};

// Build the class focus (see focusA.js header for the returned shape).
// o = { glows: GlowSet, detail: 1 | 0.5, view: bool }
export function buildFocus(classId, kit, meta, o) {
  const b = BUILDERS[classId] ?? A.pyromancer;
  return b(kit, meta, o);
}
