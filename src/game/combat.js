// ---------------------------------------------------------------------------
// Combat rules: status effects, elemental reactions, crits and damage
// resolution. Reactions are resolved on the attacker's machine (responsive in
// co-op) using the replicated status flags of the target; the host then
// applies the final numbers.
// ---------------------------------------------------------------------------

export const ST = {
  burn: 1, chill: 2, frozen: 4, shock: 8, poison: 16, hex: 32, bleed: 64, slow: 128, stun: 256, wet: 512, root: 1024, mark: 2048,
};
export const ST_NAMES = Object.keys(ST);

export const STATUS_INFO = {
  burn: { color: '#ff7a30', label: 'Burning' },
  chill: { color: '#7fd8ff', label: 'Chilled' },
  frozen: { color: '#c8f4ff', label: 'Frozen' },
  shock: { color: '#9fb4ff', label: 'Shocked' },
  poison: { color: '#9adf3a', label: 'Poisoned' },
  hex: { color: '#c050ff', label: 'Hexed' },
  bleed: { color: '#ff3048', label: 'Bleeding' },
  slow: { color: '#40e0c8', label: 'Slowed' },
  stun: { color: '#ffe080', label: 'Stunned' },
  wet: { color: '#4080ff', label: 'Wet' },
  root: { color: '#a0d040', label: 'Rooted' },
  mark: { color: '#ffd860', label: 'Judged' },
};

export const REACTIONS = {
  shatter: { name: 'SHATTER', color: '#c8f4ff' },
  melt: { name: 'MELT', color: '#ff9a40' },
  overload: { name: 'OVERLOAD', color: '#ffb0ff' },
  superconduct: { name: 'SUPERCONDUCT', color: '#a0c8ff' },
  electrocute: { name: 'ELECTROCUTE', color: '#9fb4ff' },
  combust: { name: 'COMBUST', color: '#d0ff60' },
  blight: { name: 'BLIGHT', color: '#7dff6a' },
  purge: { name: 'PURGE', color: '#fff0a0' },
  hemorrhage: { name: 'HEMORRHAGE', color: '#ff3048' },
  paradox: { name: 'PARADOX', color: '#40e0c8' },
  sandblast: { name: 'SANDSTORM', color: '#e0c080' },
};

// Status flags as a bitmask from a status object
export function statusMask(st) {
  let m = 0;
  for (const k in st) if (st[k] && st[k].t > 0 && ST[k]) m |= ST[k];
  return m;
}
export const has = (mask, name) => (mask & ST[name]) !== 0;

// Decide crits and reactions for a hit from a local player against an actor.
// hit: { dmg, el, st, crit?, tag, noReact }
// stats: attacker stats; target: actor (needs .mask, .stacks, .def)
// Returns resolved { dmg, crit, reaction, consume[], aoe? }
export function resolveHit(hit, stats, target) {
  let dmg = hit.dmg * (stats?.dmgMult ?? 1);
  const elMult = stats?.elementMult?.[hit.el] ?? 1;
  dmg *= elMult;
  const out = { dmg, crit: false, reaction: null, consume: [], aoe: null, chain: 0 };
  const mask = target.mask ?? 0;
  // crits
  const critChance = (stats?.critChance ?? 0.05) + (hit.critBonus ?? 0);
  if (hit.crit === true || Math.random() < critChance) {
    out.crit = true;
    dmg *= stats?.critMult ?? 1.75;
  }
  // target modifiers
  if (has(mask, 'hex')) dmg *= 1.25;
  if (has(mask, 'mark')) dmg *= 1.15;
  if (has(mask, 'shock') && hit.el !== 'lightning') dmg *= 1.1;
  const def = target.def ?? {};
  if (def.undead && hit.el === 'holy') dmg *= 1.5;
  if (def.resist && def.resist[hit.el]) dmg *= def.resist[hit.el];
  // reactions
  if (!hit.noReact) {
    const el = hit.el;
    if ((el === 'earth' || el === 'blade' || el === 'physical' || (el === 'frost' && hit.tag === 'shard')) && has(mask, 'frozen')) {
      out.reaction = 'shatter'; dmg *= 2.5; out.consume.push('frozen', 'chill');
    } else if (el === 'fire' && (has(mask, 'frozen') || has(mask, 'chill'))) {
      out.reaction = 'melt'; dmg *= 1.8; out.consume.push('frozen', 'chill');
    } else if (el === 'lightning' && has(mask, 'burn')) {
      out.reaction = 'overload'; out.aoe = { radius: 3.5, dmg: dmg * 0.6, el: 'fire' }; out.consume.push('burn');
    } else if (el === 'lightning' && has(mask, 'wet')) {
      out.reaction = 'electrocute'; dmg *= 1.5; out.chain = 3; out.consume.push('wet');
    } else if (el === 'frost' && has(mask, 'shock')) {
      out.reaction = 'superconduct'; out.aoe = { radius: 4, dmg: dmg * 0.4, el: 'frost', st: { chill: 2 } }; out.consume.push('shock');
    } else if (el === 'fire' && has(mask, 'poison')) {
      const n = target.stacks?.poison ?? 3;
      out.reaction = 'combust'; out.aoe = { radius: 4, dmg: dmg * 0.4 + n * 6, el: 'poison' }; out.consume.push('poison');
    } else if (el === 'necrotic' && (has(mask, 'poison') || has(mask, 'bleed'))) {
      out.reaction = 'blight'; out.aoe = { radius: 5, dmg: dmg * 0.3, el: 'necrotic', st: { poison: [2, 4] } };
    } else if (el === 'holy' && has(mask, 'hex')) {
      out.reaction = 'purge'; dmg *= 2; out.consume.push('hex');
    } else if ((el === 'blade' || el === 'physical' || el === 'blood') && has(mask, 'bleed') && hit.tag !== 'dot') {
      out.reaction = 'hemorrhage'; dmg *= 1.5;
    } else if (el === 'time' && has(mask, 'slow') && hit.tag === 'big') {
      out.reaction = 'paradox'; dmg *= 1.6;
    } else if (el === 'wind' && (has(mask, 'burn') || has(mask, 'poison'))) {
      out.reaction = 'sandblast'; out.aoe = { radius: 4, dmg: dmg * 0.5, el: has(mask, 'burn') ? 'fire' : 'poison', st: has(mask, 'burn') ? { burn: [3, 6] } : { poison: [2, 4] } };
    }
  }
  out.dmg = Math.max(1, Math.round(dmg));
  return out;
}

// Applied on the host: mutate actor status from a hit's status payload.
// st payload examples: { burn: [dur, dps], chill: n, poison: [n, dps], hex: dur, bleed: [dur, dps], slow: dur, stun: dur, root: dur, shock: dur, mark: dur }
export function applyStatus(actor, st, power = 1) {
  if (!st) return;
  const S = actor.st;
  const resist = actor.def?.statusResist ?? 1; // bosses resist hard CC
  for (const k in st) {
    const v = st[k];
    switch (k) {
      case 'burn': S.burn = { t: Math.max(S.burn?.t ?? 0, v[0]), dps: Math.max(S.burn?.t > 0 ? S.burn.dps : 0, v[1] * power) }; break;
      case 'bleed': S.bleed = { t: Math.max(S.bleed?.t ?? 0, v[0]), dps: Math.max(S.bleed?.t > 0 ? S.bleed.dps : 0, v[1] * power) }; break;
      case 'poison': {
        const n = Math.min(12, (S.poison?.t > 0 ? S.poison.n : 0) + v[0]);
        S.poison = { t: 5, n, dps: v[1] * power };
        break;
      }
      case 'chill': {
        if (S.frozen?.t > 0) break;
        const n = (S.chill?.t > 0 ? S.chill.n : 0) + v;
        if (n >= 5 * resist) { S.frozen = { t: 2.2 / resist }; S.chill = { t: 0, n: 0 }; }
        else S.chill = { t: 4, n };
        break;
      }
      case 'freeze': S.frozen = { t: v / resist }; S.chill = { t: 0, n: 0 }; break;
      default: {
        const dur = (k === 'stun' || k === 'root') ? v / resist : v;
        S[k] = { t: Math.max(S[k]?.t ?? 0, dur) };
      }
    }
  }
}

export function consumeStatus(actor, list) {
  for (const k of list) if (actor.st[k]) actor.st[k].t = 0;
}

// movement multiplier from statuses
export function moveMult(actor) {
  const S = actor.st;
  if (S.frozen?.t > 0 || S.stun?.t > 0 || S.root?.t > 0) return 0;
  let m = 1;
  if (S.chill?.t > 0) m *= 1 - 0.12 * S.chill.n;
  if (S.slow?.t > 0) m *= 0.5;
  return Math.max(0.15, m);
}
export function actMult(actor) {
  const S = actor.st;
  if (S.frozen?.t > 0 || S.stun?.t > 0) return 0;
  let m = 1;
  if (S.slow?.t > 0) m *= 0.5;
  if (S.chill?.t > 0) m *= 1 - 0.08 * S.chill.n;
  return m;
}

// Hyperbolic stacking for chance-based effects (never reaches 100%)
export const hyper = (k, n) => 1 - 1 / (1 + k * n);
