import { loadProfile, saveProfile, classRec } from './profile.js';
import { checkFeats } from './feats.js';
import { riteScore, prevDay } from './pacts.js';
import { BOSS_DEFS } from '../game/enemyDefs.js';

// ---------------------------------------------------------------------------
// The run tracker listens to the game's event bus and keeps this machine's
// record of the run: what you killed and how hard you hit, a timeline of every
// fight, what finally brought you down. It awards feats as they happen and,
// when the run ends, writes the profile and builds the summary (which it also
// sends to the party, so every machine can show every wizard's column).
// Each player's numbers are gathered where they happen: on their own machine.
// ---------------------------------------------------------------------------

const FIGHT = new Set(['combat', 'elite', 'trial', 'boss']);
const MULTI_WINDOW = 0.3; // kills this close together count as one spell's work

export class RunTracker {
  constructor(game, hooks = {}) {
    this.g = game;
    this.hooks = hooks; // { onEnd(summary, records, tracker), onFeat(feat) }
    this.run = null;
    this.remote = new Map();
    const E = game.events;
    E.on('runStart', () => this.start());
    E.on('tick', (dt) => this.run && this.tick(dt));
    E.on('hurt', (dmg, el, opts, from) => this.run && this.hurt(dmg, el, opts, from));
    E.on('hit', (dmg, a, res, H) => this.run && this.hit(dmg, a, res, H));
    E.on('kill', (a) => this.run && this.kill(a));
    E.on('roomLock', (room, on) => this.run && on && this.roomStart(room));
    E.on('roomClear', (room) => this.run && this.roomClear(room));
    E.on('bossDown', () => this.run && this.bossDown());
    E.on('floor', (i) => this.run && this.floor(i));
    E.on('tome', (c) => this.run && this.tome(c));
    E.on('relic', () => this.run && this.fire('relic', this.g.player.relics.length));
    E.on('revive', () => this.run && this.fire('revive'));
    E.on('abyss', (d) => this.run && this.abyss(d));
    E.on('end', (won) => this.end(won));
    E.on('abandon', () => this.abandon());
    E.on('net:rsum', (msg) => this.remoteSummary(msg));
  }

  get practice() { return !!this.g.godMode; } // test runs never touch the profile

  start() {
    const g = this.g;
    this.remote.clear();
    if (g.menuMode) { this.run = null; return; }
    const d = g.difficulty ?? {};
    this.run = {
      classId: g.player.classId, name: g.player.name, coop: !g.isSolo, heat: d.heat ?? 0, pacts: { ...(d.pacts ?? {}) }, daily: d.daily ?? null,
      kills: 0, bestiary: {}, bosses: [], reactions: 0, biggest: 0, biggestOn: '', taken: 0, downs: 0, dashes: 0,
      tomesTaken: 0, bestRarity: -1, augments: 0, rooms: [], cur: null, flawlessChain: 0, killer: null, killerType: null,
      feats: [], maxFloor: 0, won: false, ended: false, abyss: 0, winTime: 0,
    };
    this._kt = [];
    this._dash = g.player.dashCharges;
    this._goldT = 0;
  }

  // award any feat listening to `ev` (in-run feats are saved at once, so quitting keeps them)
  fire(ev, x) {
    const r = this.run, p = loadProfile();
    if (this.practice) return;
    const got = checkFeats(ev, r, p, x);
    if (!got.length) return;
    for (const f of got) { r?.feats.push(f.id); p.feats[f.id] = Date.now(); this.hooks.onFeat?.(f); }
    saveProfile();
  }

  tick(dt) {
    const p = this.g.player, r = this.run;
    // dashes are counted from the charges, so blink spells and knockbacks don't count
    if (p.dashCharges < this._dash) { r.dashes++; if (r.cur) r.cur.dashes++; }
    this._dash = p.dashCharges;
    if (p.downed && !this._downed) r.downs++;
    this._downed = p.downed;
    if ((this._goldT -= dt) <= 0) { this._goldT = 0.5; this.fire('gold', p.gold); }
  }

  hurt(dmg, el, opts, from) {
    const r = this.run, p = this.g.player;
    r.taken += dmg;
    if (r.cur) r.cur.dmg += dmg;
    // a lethal blow names the killer (a phoenix feather may still save you: downs are counted in tick)
    if (p.hp <= 0) {
      const src = this.source(el, opts, from);
      r.killer = src.name; r.killerType = src.type;
    }
  }

  // Name what dealt a blow. Melee and telegraphed attacks carry their attacker;
  // projectiles don't, so blame the boss if one is up, else the nearest shooter.
  source(el, opts, from) {
    if (opts?.cause) return { name: opts.cause, type: null };
    // reads after "Slain by": "a Drowned Ghoul", "an Animated Armor", "Gravemaw", "The Executioner"
    const named = (a) => {
      const n = a.def.name ?? a.type;
      return { name: (a.boss || /^The /.test(n) ? n : (/^[AEIOU]/.test(n) ? 'an ' : 'a ') + n) + (a.affix ? ` (${a.affix}${a.affix2 ? ' ' + a.affix2 : ''} champion)` : ''), type: a.type };
    };
    if (opts?.attacker?.def) return named(opts.attacker);
    const g = this.g, at = from ?? g.player.pos;
    let best = null, bd = Infinity;
    for (const a of g.actors.hostiles()) {
      if (a.boss) return named(a);
      if (!a.def.attacks?.some((k) => k.kind === 'shoot' || k.kind === 'lob')) continue;
      const d = (a.pos.x - at.x) ** 2 + (a.pos.z - at.z) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    if (best && from) return named(best);
    if (!from) return { name: el === 'enemyPurple' ? 'a pool of hexfire' : el === 'fire' || el === 'enemyFire' ? 'lingering flames' : 'a festering pool', type: null };
    return { name: 'the darkness', type: null };
  }

  hit(dmg, a, res, H) {
    const r = this.run;
    if (res?.reaction && H?.tag !== 'dot') { r.reactions++; this.fire('reaction', r.reactions); }
    if (H?.tag === 'dot' || dmg <= r.biggest) return;
    r.biggest = dmg;
    r.biggestOn = a?.def?.name ?? '';
    this.fire('bigHit', dmg);
  }

  kill(a) {
    const r = this.run, t = this.g.time;
    r.kills++;
    if (r.cur) r.cur.kills++;
    if (a?.type && !a.def?.ally) r.bestiary[a.type] = (r.bestiary[a.type] ?? 0) + 1;
    const kt = this._kt;
    kt.push(t);
    while (kt.length && t - kt[0] > MULTI_WINDOW) kt.shift();
    this.fire('kill', r.kills);
    if (kt.length >= 2) this.fire('multikill', kt.length);
  }

  roomStart(room) {
    const r = this.run;
    if (!FIGHT.has(room.type) || r.cur?.id === room.id) return;
    if (r.cur) this._closeRoom(false);
    r.cur = { id: room.id, f: this.g.floorIndex, type: room.type, t0: this.g.stats.time, t: 0, dmg: 0, dashes: 0, kills: 0, done: false, trial: null };
  }

  _closeRoom(done) {
    const r = this.run, c = r.cur;
    if (!c) return null;
    c.t = this.g.stats.time - c.t0;
    c.done = done;
    r.rooms.push(c);
    r.cur = null;
    return c;
  }

  roomClear(room) {
    const r = this.run;
    if (r.cur?.id !== room.id) return;
    const c = this._closeRoom(true);
    c.trial = room.type === 'trial' ? !!room.trialWon : null;
    r.flawlessChain = c.dmg === 0 ? r.flawlessChain + 1 : 0;
    this.fire('roomClear', c);
  }

  bossDown() {
    const r = this.run, g = this.g, p = g.player;
    const type = g.level?.biome?.boss;
    if (type) r.bosses.push(type);
    const room = r.cur?.type === 'boss' ? r.cur : null;
    this.fire('bossDown', { type, room, hpFrac: p.downed || p.dead ? 0 : p.hp / p.maxHp });
  }

  floor(i) {
    const r = this.run;
    if (r.cur) this._closeRoom(false);
    r.maxFloor = Math.max(r.maxFloor, i);
    this.fire('floor', i);
  }

  tome(c) {
    const r = this.run;
    r.tomesTaken++;
    r.bestRarity = Math.max(r.bestRarity, c.rarity ?? 0);
    if (c.def?.aug) r.augments++;
    this.fire('tome', c);
  }

  // descending banks the victory: the Hollow King fell, whatever the Abyss does next
  abyss(d) {
    const r = this.run, g = this.g;
    if (!r.won) { r.won = true; r.winTime = g.stats.time; }
    r.abyss = Math.max(r.abyss, d);
    if (r.cur) this._closeRoom(false);
    this.fire('abyss', d);
  }

  // ------------------------------------------------------------------ run end
  summary() {
    const g = this.g, p = g.player, r = this.run;
    const tomes = new Map();
    for (const u of p.upgrades) {
      if (!u?.def?.id) continue;
      const e = tomes.get(u.def.id) ?? [u.def.id, u.rarity ?? 0, 0];
      e[1] = Math.max(e[1], u.rarity ?? 0); e[2]++;
      tomes.set(u.def.id, e);
    }
    return {
      v: 1, pid: p.id, name: p.name, classId: r.classId, won: r.won, time: Math.round(r.time), floor: r.maxFloor, biome: g.level?.biome?.id ?? '',
      kills: r.kills, partyKills: g.stats.kills, damage: Math.round(p.damageDealt ?? 0), biggest: Math.round(r.biggest), biggestOn: r.biggestOn,
      taken: Math.round(r.taken), downs: r.downs, reactions: r.reactions, gold: Math.round(g.stats.gold ?? 0), heat: r.heat, pacts: r.pacts, daily: r.daily,
      abyss: r.abyss, fell: !!r.fell, killer: r.won && !r.fell ? null : r.killer, coop: r.coop, practice: this.practice, feats: [...r.feats],
      tomes: [...tomes.values()], relics: p.relics.map((x) => x.def?.id).filter(Boolean),
      rooms: r.rooms.map((c) => [c.f, c.type, Math.round(c.t), Math.round(c.dmg), (c.done ? 1 : 0) | (c.trial ? 2 : 0), c.kills]),
    };
  }

  end(won) {
    const r = this.run;
    if (!r || r.ended) return;
    const g = this.g;
    r.ended = true;
    r.fell = !won && r.won; // perished in the Abyss after the throne was already taken
    r.won ||= !!won;
    r.coop ||= !g.isSolo; // someone may have joined mid-run
    r.time = g.stats.time;
    r.winTime ||= r.time;
    r.maxFloor = Math.max(r.maxFloor, g.floorIndex);
    if (r.cur) this._closeRoom(false);
    if (!won && !r.killer) r.killer = 'the darkness';
    this.fire('end');
    const records = this.record();
    const S = this.summary();
    S.records = records;
    // every machine shows every wizard: send ours to the party
    g.net?.broadcastOrSend({ t: 'rsum', s: S });
    this.hooks.onEnd?.(S, this);
  }

  abandon() {
    const r = this.run;
    if (!r || r.ended) return;
    r.ended = true; r.abandoned = true;
    r.time = this.g.stats.time;
    r.winTime ||= r.time;
    this.record();
  }

  // fold the run into the profile; returns which records it broke
  record() {
    const r = this.run, g = this.g;
    const rec = {};
    if (this.practice) return rec;
    const p = loadProfile();
    const c = classRec(p, r.classId);
    const veteran = p.runs > 0; // a first run breaks every record; only flag real improvements
    const realm = r.maxFloor + 1;
    const damage = Math.round(g.player.damageDealt ?? 0);
    if (veteran && r.biggest > p.records.biggestHit) rec.biggest = true;
    if (veteran && damage > p.records.mostDamage) rec.damage = true;
    if (veteran && r.kills > p.records.mostKills) rec.kills = true;
    if (c.runs > 0 && realm > c.bestFloor) rec.floor = true;
    if (r.won && c.wins > 0 && (!c.fastest || r.winTime < c.fastest)) rec.fastest = true;
    if (r.won && r.heat > Math.max(0, c.bestHeat)) rec.heat = true;
    if (r.abyss && p.records.deepestAbyss > 0 && r.abyss > p.records.deepestAbyss) rec.abyss = true;
    p.records.biggestHit = Math.max(p.records.biggestHit, Math.round(r.biggest));
    p.records.mostDamage = Math.max(p.records.mostDamage, damage);
    p.records.mostKills = Math.max(p.records.mostKills, r.kills);
    p.runs++; c.runs++;
    if (r.won) {
      p.wins++; c.wins++;
      if (r.coop) p.coopWins++;
      const wt = Math.round(r.winTime);
      c.fastest = c.fastest ? Math.min(c.fastest, wt) : wt;
      p.records.fastestWin = p.records.fastestWin ? Math.min(p.records.fastestWin, wt) : wt;
      c.bestAbyss = Math.max(c.bestAbyss, r.abyss);
      p.records.deepestAbyss = Math.max(p.records.deepestAbyss, r.abyss);
      c.bestHeat = Math.max(c.bestHeat, r.heat);
      p.records.highestHeat = Math.max(p.records.highestHeat, r.heat);
    }
    if ((!r.won || r.fell) && !r.abandoned) {
      p.deaths++;
      if (r.killerType) p.killedBy[r.killerType] = (p.killedBy[r.killerType] ?? 0) + 1;
    }
    p.bestFloor = Math.max(p.bestFloor, realm);
    c.bestFloor = Math.max(c.bestFloor, realm);
    p.kills += r.kills; c.kills += r.kills;
    p.damage += damage; p.time += Math.round(r.time); p.gold += Math.round(g.stats.gold ?? 0);
    p.tomes += r.tomesTaken;
    p.rooms += r.rooms.filter((x) => x.done).length;
    p.flawless += r.rooms.filter((x) => x.done && x.dmg === 0).length;
    for (const [t, n] of Object.entries(r.bestiary)) p.bestiary[t] = (p.bestiary[t] ?? 0) + n;
    for (const b of r.bosses) if (BOSS_DEFS[b]) p.bosses[b] = (p.bosses[b] ?? 0) + 1;
    if (r.daily && !r.abandoned) {
      const d = p.daily;
      if (d.last !== r.daily) { d.streak = d.last === prevDay(r.daily) ? d.streak + 1 : 1; d.last = r.daily; }
      d.bestStreak = Math.max(d.bestStreak, d.streak);
      d.runs++;
      const res = { date: r.daily, floor: realm, won: r.won, time: Math.round(r.time), kills: r.kills };
      res.score = riteScore(res);
      if (!d.best || d.best.date !== r.daily || res.score > d.best.score) { if (d.best?.date === r.daily) rec.daily = true; d.best = res; }
    }
    this.fire('profile');
    saveProfile();
    return rec;
  }

  remoteSummary(msg) {
    const s = msg?.s;
    if (!s || typeof s !== 'object' || !s.pid || s.pid === this.g.player?.id) return;
    this.remote.set(s.pid, s);
    this.hooks.onRemote?.(s);
  }
}
