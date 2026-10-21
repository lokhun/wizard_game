// Shader check for the encounters (run with smoke.mjs, rendering on, e.g.
//   "?autostart=pyromancer&test=1&quality=med&floor=1&seed=4242&enc=mimic,champion,haunted,secret,altar", wait 3000).
// The world steps in __sim and every half second of it is rendered (real-time frames are too slow on a
// software-GL machine to get through the script): springs and kills a mimic, brings on the champion,
// breaks the secret wall and lets specters out in a haunted fight. Reports every shader program compiled after the floor's prewarm.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.player.id !== 'solo' || window.__game.loadingFloor) await new Promise((r) => setTimeout(r, 200));
  const g = window.__game, p = g.player, inp = window.__input, L = g.level, R = g.renderer.renderer;
  g.godMode = true;
  g.ui.chooseRelic = (c, cb) => cb(c[0]); g.ui.chooseTome = (c, cb) => cb(c[0]); g.ui.chooseBlessing = (l) => l[0].apply();
  window.__freeze = true;
  const wait = async (ms) => { for (let t = 0; t < ms / 1000; t += 0.5) { window.__sim(0.5); g.renderer.render(g.time); await new Promise((r) => setTimeout(r, 0)); } };
  await wait(1000);
  const base = R.info.programs.length, seen = new Set(R.info.programs);
  const newProgs = [], log = [];
  const check = (tag) => { for (const pr of R.info.programs) if (!seen.has(pr)) { seen.add(pr); newProgs.push(tag + ': ' + pr.name + ' ' + String(pr.cacheKey).slice(0, 120)); } };
  const look = (x, y, z) => { const dx = x - p.pos.x, dz = z - p.pos.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(y - p.pos.y - 1.6, Math.hypot(dx, dz)); };
  const killAll = () => { for (const a of [...g.actors.list]) if (a.faction === 'enemy' && !a.dead && !a.champion) { a.hp = 0; g.actors.kill(a, p.id, 'fire'); } };
  // mimic: spring it, let it hop about, kill it (death fades the body: the transparent variant)
  const tr = L.rooms.find((r) => r.mimicAt);
  if (tr) {
    p.pos.set(tr.cx, 0, tr.cz + 3.5); look(tr.cx, 0.6, tr.cz); await wait(2500);
    g.interact(g.interactables.find((i) => i.kind === 'mimic')); await wait(4000); check('mimic');
    const m = g.actors.list.find((a) => a.type === 'mimic'); log.push('mimic awake ' + (m && !m.dormant));
    if (m) { m.hp = 0; g.actors.kill(m, p.id, 'fire'); }
    await wait(5000); check('mimic death');
  }
  // champion
  const er = L.rooms.find((r) => r.type === 'elite' && r.champ);
  if (er && !g.director.active) {
    p.pos.set(er.cx, 0, er.cz); await wait(3000);
    for (let i = 0; i < 6 && !g.actors.list.some((a) => a.champion); i++) { killAll(); await wait(2000); }
    const c = g.actors.list.find((a) => a.champion);
    if (c) look(c.pos.x, 1.5, c.pos.z);
    await wait(6000); check('champion');
    log.push('champion ' + (c?.def.name ?? '-'));
  }
  // the secret wall
  const sr = L.rooms.find((r) => r.secret);
  if (sr) {
    const s = sr.secret; L.rooms[s.host].cleared = true;
    p.pos.set(s.x - s.nx * 5, 0, s.z - s.nz * 5); look(s.x, 1.3, s.z); await wait(1500);
    inp.mouse.left = true; await wait(2500); inp.mouse.left = false; await wait(2000); check('secret');
    log.push('secret broken ' + sr._secret.broken);
  }
  // haunted fight: wait for specters out of the walls
  const hr = L.rooms.find((r) => r.mod === 'haunted' && !r.cleared);
  if (hr) {
    p.pos.set(hr.cx, 0, hr.cz); await wait(9000);
    const sp = g.actors.list.filter((a) => a.type === 'specter'); log.push('specters ' + sp.length);
    for (const a of sp) look(a.pos.x, 1.5, a.pos.z);
    await wait(2000); check('haunted');
    for (let i = 0; i < 20 && g.director.active; i++) { killAll(); await wait(1500); }
    check('haunted clear');
  }
  window.__freeze = false;
  return { base, prewarm: g._prewarmPrograms, programs: R.info.programs.length, newProgs, log };
})()
