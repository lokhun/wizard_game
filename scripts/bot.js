// Regression (run with smoke.mjs "?autostart=necromancer&test=1&norender=1&god=1", wait 3000).
// Bot playthrough: teleports through main-path rooms, fights, takes tomes, kills bosses, ascends.
(async () => {
  while (!window.__game || window.__game.menuMode || !window.__game.player || window.__game.player.id !== 'solo') await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 500));
  const g = window.__game;
  const inp = window.__input;
  const god = new URLSearchParams(location.search).get('god') === '1';
  g.godMode = god;
  const log = [];
  const aimAt = () => {
    const p = g.player;
    let best = null, bd = 1e9;
    for (const a of g.actors.hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = a; } }
    if (!best) return null;
    const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z, dy = best.pos.y + best.height * 0.5 - (p.pos.y + 1.6);
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return { best, d: bd };
  };
  const start = performance.now();
  const origDefeat = g.defeat.bind(g);
  g.defeat = () => { log.push('DEFEAT called: hp=' + g.player.hp + ' downed=' + g.player.downed + ' dead=' + g.player.dead + ' stack=' + new Error().stack.split('\n').slice(1, 4).join('|')); origDefeat(); };
  for (let floor = g.floorIndex; floor < 5; floor++) {
    const L = g.level;
    const main = L.rooms.filter((r) => r.main).sort((a, b) => a.order - b.order);
    for (const room of main.slice(1)) {
      g.player.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz);
      let t = 0, frames = 0;
      window.__sim(0.5);
      while ((g.director.active || (room.type === 'boss' && !room.cleared && !g.interactables.some((i) => i.kind === 'portal'))) && t < 240) {
        window.__sim(0.5, 1 / 30, (tt) => {
          const tgt = aimAt();
          inp.mouse.left = !!tgt;
          // strafe in circles
          frames++;
          if (frames % 90 < 45) { inp.down.add('KeyA'); inp.down.delete('KeyD'); } else { inp.down.add('KeyD'); inp.down.delete('KeyA'); }
          const melee = g.player.classId === 'spellblade';
          if (tgt && tgt.d < (melee ? 1.5 : 5)) inp.down.add('KeyS'); else inp.down.delete('KeyS');
          if (tgt && tgt.d > (melee ? 3 : 14)) inp.down.add('KeyW'); else inp.down.delete('KeyW');
          if (frames % 70 === 0) inp.pressed.add('KeyQ');
          if (frames % 97 === 0) inp.pressed.add('KeyE');
          if (frames % 50 === 0) { inp.mouse.rightPressed = true; inp.mouse.right = true; }
          if (frames % 50 === 30) inp.mouse.right = false;
          if (frames % 120 === 0) inp.pressed.add('ShiftLeft');
          if (frames % 37 === 0) inp.pressed.add('Space');
          if (g.player.ult >= 100) inp.pressed.add('KeyR');
          if (g.player.downed && god) g.player.revive(1);
        });
        t += 0.5;
        if (g.ended) break;
      }
      inp.down.clear(); inp.mouse.left = false; inp.mouse.right = false;
      if (g.ended) break;
      // take a tome from any pedestal
      for (const it of g.interactables) if (it.kind === 'pedestal' && !it.usedBy.has(g.player.id)) { const { rollTomes } = await import('/src/game/upgrades.js'); const c = rollTomes(g.player, 3, it.minRarity); g.grantTome(c[0]); it.usedBy.add(g.player.id); }
      log.push(`[down=${g.player.downed} dead=${g.player.dead} sr=${g.player.selfRevives} ended=${g.ended}] F${floor} ${room.type} t=${t.toFixed(0)}s hp=${Math.round(g.player.hp)}/${g.player.maxHp} kills=${g.stats.kills} dmg=${Math.round(g.stats.damage)} tomes=${g.player.upgrades.length} boss=${(()=>{const b=g.actors.list?.find?.((a)=>a.boss)??[...(g.actors.actors??[])].find((a)=>a.boss);return b?Math.round(b.hp)+'/'+b.maxHp+' ph'+(b.brain?.phase)+' hostiles='+g.actors.hostiles().length:'none'})()}`);
    }
    if (g.ended) { log.push('ENDED victory=' + (g.floorIndex >= 4)); break; }
    if (floor < 4) {
      const portal = g.interactables.find((i) => i.kind === 'portal');
      if (!portal) { log.push('no portal on floor ' + floor); break; }
      g.loadFloor(floor + 1);
    }
  }
  return { ms: Math.round(performance.now() - start), log, ended: g.ended, floor: g.floorIndex };
})()
