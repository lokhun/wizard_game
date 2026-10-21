// Functional test of the encounters (run with smoke.mjs, e.g.
//   "?autostart=pyromancer&test=1&norender=1&floor=1&seed=4242&enc=mimic,champion,gambler,secret,haunted", wait 3000).
// Opens a mimic and kills it, uses the altar or the gambler, fights every main-path room (modifiers, champion,
// curse), then breaks the secret wall with spells and walks in. Every line of the log should read cleared/broken.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.player.id !== 'solo' || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  const g = window.__game, inp = window.__input, L = g.level, p = g.player;
  g.godMode = true;
  const log = [];
  const errs = [];
  window.addEventListener('error', (e) => errs.push(e.message));
  const aim = (t) => { const dx = t.x - p.pos.x, dz = t.z - p.pos.z, dy = (t.y ?? 1) - (p.pos.y + 1.6); p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); };
  const fight = (room, maxT = 120) => {
    let t = 0;
    while ((g.director.active || g.actors.hostiles().some((a) => !a.dormant && a.homeRoom === room)) && t < maxT) {
      window.__sim(0.5, 1 / 30, () => {
        let best = null, bd = 1e9;
        for (const a of g.actors.hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd && !a.dormant) { bd = d; best = a; } }
        if (best) aim({ x: best.pos.x, y: best.pos.y + best.height * 0.5, z: best.pos.z });
        inp.mouse.left = !!best;
        if (p.downed) p.revive(1);
      });
      t += 0.5;
    }
    inp.mouse.left = false;
    return t;
  };
  // ---- blessings: auto-pick by index
  let pick = 0;
  const origBless = g.ui.chooseBlessing.bind(g.ui);
  g.ui.chooseBlessing = (list, cb, title) => { log.push('bless:' + title + ':' + list.map((b) => b.name).join('|')); const b = list[pick]; b.apply(); cb?.(b); };
  g.ui.chooseTome = (c, cb) => { log.push('tome:' + c.map((x) => x.def.name + '/' + x.rarity).join(',')); cb(c[0]); };
  g.ui.chooseRelic = (c, cb) => { log.push('relic:' + c.map((x) => x.def.name).join(',')); cb(c[0]); };
  void origBless;
  // ---- mimic
  const tr = L.rooms.find((r) => r.mimicAt);
  if (tr) {
    p.pos.set(tr.cx, 0, tr.cz + 3.5);
    window.__sim(1);
    const m = g.actors.list.find((a) => a.type === 'mimic');
    log.push('mimic spawned=' + !!m + ' dormant=' + m?.dormant + ' disguised=' + m?.model?.disguised);
    const it = g.interactables.find((i) => i.kind === 'mimic');
    g.interact(it);
    window.__sim(0.5);
    log.push('after open: dormant=' + m?.dormant + ' active=' + (g.director.active?.room === tr) + ' locked=' + tr._locked);
    const t = fight(tr);
    window.__sim(2);
    log.push(`mimic fight ${t}s, dead=${m?.dead} cleared=${tr.cleared} chests=${g.interactables.filter((i) => i.kind === 'chest').length} peds=${g.interactables.filter((i) => i.kind === 'pedestal').length}`);
  } else log.push('no mimic room');
  // ---- altar
  const al = L.rooms.find((r) => r.type === 'altar');
  if (al) {
    const it = g.interactables.find((i) => i.kind === 'altar');
    pick = 1; const hp0 = p.hp; g.interact(it);
    log.push(`altar curse=${g.encounters.curse} hp ${Math.round(hp0)}->${Math.round(p.hp)} relics=${p.relics.length}`);
  }
  const gm = L.rooms.find((r) => r.type === 'gambler');
  if (gm) {
    const it = g.interactables.find((i) => i.kind === 'gambler');
    p.gold = 500; pick = 0; g.interact(it); pick = 1; g.interact(it);
    log.push(`gambler gold=${Math.round(p.gold)} wagers=${it.wagers} tomes=${p.upgrades.length}`);
  }
  // ---- main path fights (mods, champion, curse)
  const main = L.rooms.filter((r) => r.main).sort((a, b) => a.order - b.order);
  for (const room of main.slice(1, -1)) {
    if (room.type !== 'combat' && room.type !== 'elite') continue;
    p.pos.set(room.cx, 0, room.cz);
    window.__sim(0.6);
    let champ = null, specters = 0, maxTint = 0;
    let t = 0, fr = 0;
    while (g.director.active && t < 150) {
      window.__sim(0.5, 1 / 30, () => {
        let best = null, bd = 1e9;
        for (const a of g.actors.hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd && !a.dormant) { bd = d; best = a; } }
        if (best) aim({ x: best.pos.x, y: best.pos.y + best.height * 0.5, z: best.pos.z });
        inp.mouse.left = !!best;
        if (p.downed) p.revive(1);
        fr++;
        if (fr % 90 < 45) { inp.down.add('KeyA'); inp.down.delete('KeyD'); } else { inp.down.add('KeyD'); inp.down.delete('KeyA'); }
        if (best && bd > 9) inp.down.add('KeyW'); else inp.down.delete('KeyW');
      });
      t += 0.5;
      champ = champ ?? g.actors.list.find((a) => a.champion);
      specters = Math.max(specters, g.actors.list.filter((a) => a.type === 'specter').length);
      maxTint = Math.max(maxTint, Math.abs(g.encounters.tint[0] - 1) + Math.abs(g.encounters.tint[2] - 1));
    }
    inp.mouse.left = false; inp.down.clear();
    if (t >= 150) log.push('STUCK: active=' + g.director.active?.room.id + ' room=' + room.id + ' ' + g.actors.list.filter((a) => a.faction === 'enemy' && !a.dead).map((a) => `${a.type}#${a.id} ${a.state}/${a.anim} dorm=${a.dormant} hp=${Math.round(a.hp)} at ${a.pos.x.toFixed(1)},${a.pos.z.toFixed(1)} rm=${g.level.roomAt(a.pos.x, a.pos.z)?.id} home=${a.homeRoom?.id} cell=${g.level.cells[Math.floor(a.pos.z/2)*g.level.W+Math.floor(a.pos.x/2)]}`).join(' | ') + ' player ' + p.pos.x.toFixed(1) + ',' + p.pos.z.toFixed(1));
    log.push(`${room.type} ${room.mod ?? ''} t=${t} cleared=${room.cleared} champ=${champ ? champ.def.name + ' [' + champ.def.title + '] hp ' + Math.round(champ.maxHp) : '-'} specters=${specters} tint=${maxTint.toFixed(2)} hemiK=${g.encounters.hemiK.toFixed(2)} cursed=${!!room.cursed} peds=${g.interactables.filter((i) => i.kind === 'pedestal').map((i) => i.minRarity).join(',')}`);
  }
  // ---- secret wall
  const sr = L.rooms.find((r) => r.secret);
  if (sr) {
    const s = sr.secret;
    p.pos.set(s.x - s.nx * 6, 0, s.z - s.nz * 6);
    window.__sim(0.3);
    aim({ x: s.x, y: 1.4, z: s.z });
    const blockedBefore = g.collision.dyn[s.cell];
    inp.mouse.left = true;
    window.__sim(2.5, 1 / 30, () => aim({ x: s.x, y: 1.4, z: s.z }));
    inp.mouse.left = false;
    window.__sim(0.5);
    log.push(`secret: blocked ${blockedBefore} -> ${g.collision.dyn[s.cell]} broken=${sr._secret.broken}`);
    // walk in
    p.pos.set(sr.cx, 0, sr.cz);
    window.__sim(0.5);
    log.push('secret visited=' + sr.visited + ' chest=' + g.interactables.some((i) => i.kind === 'chest' && Math.hypot(i.pos.x - sr.cx, i.pos.z - sr.cz) < 4));
  } else log.push('no secret room');
  return { log, errs };
})()
