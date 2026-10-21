// ---------------------------------------------------------------------------
// The five realm bosses. Each lives in its own module; the shared tools they
// build on (fx meshes, ropes, haft IK, weapon arcs) are in bossKit.js.
//   motherOfFilth  bossFilth.js     Drowned Sewers
//   executioner    bossHeadsman.js  Oubliette
//   stoneWyvern    bossWyvern.js    Moonlit Bailey
//   courtArchmage  bossArchmage.js  Hall of Whispers
//   hollowKing     bossKing.js      Hollow Throne
// ---------------------------------------------------------------------------
import { motherOfFilth } from './bossFilth.js';
import { executioner } from './bossHeadsman.js';
import { stoneWyvern } from './bossWyvern.js';
import { courtArchmage } from './bossArchmage.js';
import { hollowKing } from './bossKing.js';

export { motherOfFilth, executioner, stoneWyvern, courtArchmage, hollowKing };
export const BOSS_TYPES = [motherOfFilth, executioner, stoneWyvern, courtArchmage, hollowKing];
