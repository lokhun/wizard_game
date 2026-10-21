// Regression: every class fights a room (run with smoke.mjs "?test=1", wait 3000). Expect "errs":[].
(async () => {
  while (!window.__game || !window.__game.player) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 1500));
  const g = window.__game; const inp = window.__input;
  const ids = ['pyromancer','cryomancer','stormcaller','arcanist','necromancer','bloodmage','chronomancer','warlock','lightbinder','geomancer','druid','spellblade','tempest'];
  const out = {};
  const errs = [];
  window.addEventListener('error', (e) => errs.push(e.message));
  for (const cls of ids) {
    try {
      g.startRun({ seed: 777, localId: 'solo', name: 'T', classId: cls, isHost: true, net: null, floor: 1 });
      g.menuMode = false; g.godMode = true;
      const room = g.level.rooms.find((r) => r.type === 'combat');
      g.player.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz);
      let frames = 0;
      const aimAt = () => {
        const p = g.player; let best = null, bd = 1e9;
        for (const a of g.actors.hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = a; } }
        if (!best) return null;
        const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z, dy = best.pos.y + best.height * 0.5 - (p.pos.y + 1.6);
        p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); return best;
      };
      window.__sim(20, 1 / 30, () => {
        frames++;
        const t = aimAt();
        inp.mouse.left = !!t && frames % 200 < 150;
        if (frames % 60 === 10) inp.pressed.add('KeyQ');
        if (frames % 60 === 30) inp.pressed.add('KeyE');
        if (frames % 80 === 5) { inp.mouse.rightPressed = true; inp.mouse.right = true; }
        if (frames % 80 === 45) inp.mouse.right = false;
        if (frames === 200) { g.player.ult = 100; inp.pressed.add('KeyR'); }
        if (frames % 90 === 0) inp.pressed.add('ShiftLeft');
      });
      inp.mouse.left = false; inp.mouse.right = false;
      out[cls] = { dmg: Math.round(g.stats.damage), kills: g.stats.kills, cleared: room.cleared, hp: Math.round(g.player.hp), allies: g.actors.allies().length };
    } catch (e) { out[cls] = 'ERR ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' | '); }
  }
  return { out, errs: errs.slice(0, 10) };
})()
