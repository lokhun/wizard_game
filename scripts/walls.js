// Through-wall audit (run with smoke.mjs "?test=1&norender=1", wait 3000; &cls=a,b for some classes only).
// For each class: a wizard stands a metre from a thin wall (one cell, 2 m) with a foe pinned a metre behind
// it, aims straight at the foe and casts each slot in turn (primary held, secondary, Q, E, the ultimate).
// Reports any damage the foe took per slot and from what (element, tag), and any blow the foe landed on the
// wizard through the wall. Summons that walk round the wall are counted apart. A clean class prints "ok".
(async () => {
  while (!window.__game || !window.__game.player) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 1500));
  const g = window.__game, inp = window.__input, Q = new URLSearchParams(location.search);
  const ids = Q.get('cls') ? Q.get('cls').split(',') : ['pyromancer', 'cryomancer', 'stormcaller', 'arcanist', 'necromancer', 'bloodmage', 'chronomancer', 'warlock', 'lightbinder', 'geomancer', 'druid', 'spellblade', 'tempest'];
  const { FLOOR } = await import('/src/world/levelgen.js');
  const out = [], errs = [];
  window.addEventListener('error', (e) => errs.push(e.message));
  for (const cls of ids) {
    g.startRun({ seed: 777, localId: 'solo', name: 'T', classId: cls, isHost: true, net: null, floor: 1 });
    g.menuMode = false; g.godMode = false;
    const L = g.level, p = g.player;
    for (const a of [...g.actors.list]) { a.hp = 0; g.actors.kill(a, 0, 'holy'); }
    for (const r of L.rooms) r.cleared = true;
    // a thin straight wall: floor | solid | floor along x, the same for the rows either side, all one height
    // the thinnest straight wall between two floors (1 to 3 cells): floor | solid x n | floor along x, the same
    // for the rows either side, the floors at one height
    let spot = null;
    const fl = (x, y) => L.inb(x, y) && L.cells[y * L.W + x] === FLOOR && L.roomId[y * L.W + x] >= 0;
    const so = (x, y) => L.inb(x, y) && L.cells[y * L.W + x] !== FLOOR;
    for (let n = 1; n <= 3 && !spot; n++) for (let y = 2; y < L.H - 2 && !spot; y++) for (let x = 2; x < L.W - n - 3 && !spot; x++) {
      let ok = true;
      for (let k = -1; k <= 1 && ok; k++) {
        ok = fl(x - 1, y + k) && fl(x, y + k) && fl(x + n + 1, y + k) && fl(x + n + 2, y + k) && L.hgt[(y + k) * L.W + x] === L.hgt[(y + k) * L.W + x + n + 1];
        for (let j = 1; j <= n && ok; j++) ok = so(x + j, y + k);
      }
      if (ok) spot = { x, y, n };
    }
    if (!spot) { out.push(`?    ${cls}: no wall to test on this floor`); continue; }
    const px = spot.x * 2 + 1, pz = spot.y * 2 + 1, ex = (spot.x + spot.n + 1) * 2 + 1, gy = g.groundY(px, pz);
    const foe = g.director.spawnEnemy('skeleton', ex, pz, { noCredit: true });
    foe.maxHp = foe.hp = 1e7;
    const dmg = {}; let slot = 'none', thru = 0;
    const dm = g.actors.damage.bind(g.actors);
    // (a summon's own blow names it in H.by, and a status its bite left ticks on for a few seconds after:
    // both are the summon's, which walked round the wall, not the spell's)
    let sumT = -1e9;
    g.actors.damage = (a, H) => { const b = a.hp; const r = dm(a, H); if (a === foe && b - a.hp > 0) { const ally = g.actors.byId.get(H.by ?? H.src)?.faction === 'ally'; if (ally) sumT = g.time; const src = ally || (H.tag === 'dot' && g.time - sumT < 6) ? 'summon' : (H.tag ? H.tag + '/' : '') + (H.el ?? '?'); (dmg[slot] ??= {})[src] = Math.round(((dmg[slot] ?? {})[src] ?? 0) + b - a.hp); } return r; };
    const onHurt = (d) => { thru += d; };
    g.events.on('hurt', onHurt);
    const pin = () => { foe.pos.x = ex; foe.pos.z = pz; foe.kb.x = foe.kb.z = 0; p.pos.x = px; p.pos.z = pz; p.hp = p.maxHp; if (p.downed) p.revive(1); const dx = ex - px; p.yaw = Math.atan2(-dx, 0); p.pitch = Math.atan2(foe.pos.y + 1 - (p.pos.y + 1.6), dx); };
    p.pos.set(px, gy, pz);
    window.__sim(1, 1 / 30, pin);
    const run = (name, sec, each) => { slot = name; let f = 0; window.__sim(sec, 1 / 30, () => { pin(); each?.(f++); }); inp.mouse.left = false; inp.mouse.right = false; slot = name + '+'; window.__sim(1.2, 1 / 30, pin); };
    run('primary', 3, () => { inp.mouse.left = true; });
    run('secondary', 2.5, (f) => { if (f === 0) { inp.mouse.rightPressed = true; } inp.mouse.right = f < 45; });
    run('Q', 2, (f) => { if (f === 0) inp.pressed.add('KeyQ'); });
    run('E', 2, (f) => { if (f === 0) inp.pressed.add('KeyE'); });
    run('ult', 5, (f) => { if (f === 0) { p.ult = 100; inp.pressed.add('KeyR'); } });
    g.actors.damage = dm; g.events.off?.('hurt', onHurt);
    const lines = Object.entries(dmg).map(([s, v]) => `${s}: ${Object.entries(v).map(([k, n]) => k + ' ' + n).join(', ')}`);
    const real = Object.entries(dmg).filter(([, v]) => Object.keys(v).some((k) => k !== 'summon'));
    out.push(`${real.length || thru ? 'FAIL' : 'ok  '} ${cls} (wall ${spot.n * 2} m)${lines.length ? ' — ' + lines.join(' | ') : ''}${thru ? ` | the foe hit the wizard through the wall for ${Math.round(thru)}` : ''}`);
  }
  return { log: out, errs: errs.slice(0, 10) };
})();
