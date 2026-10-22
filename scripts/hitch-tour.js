// Real-time hitch tour of one floor (run with scripts/hitch-edge.mjs, which records every
// frame, program link and GPU upload under the scenario tag this sets in window.__tag).
// Starts from the main menu ("Begin the Ascent" → class select → Begin Ascent) unless the
// URL autostarts, then: first fight of the floor and the first cast of every spell slot,
// reactions, deaths, the tome choice, the elite chamber and its relic, a chest (or mimic),
// shrine, merchant, the boss intro, its phase changes and death, and the portal into the
// next realm (the loading veil is timed) with a first fight there.
// &tour=short stops after the first fight.
(async () => {
  const Q = new URLSearchParams(location.search);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tag = (t) => { window.__tag = t; };
  const until = async (f, ms = 30000) => { const t0 = performance.now(); while (!f() && performance.now() - t0 < ms) await sleep(50); return f(); };
  const log = [];
  const click = (sel) => { const el = document.querySelector(sel); if (el) el.click(); return !!el; };
  while (!window.__game) await sleep(100);
  const g = window.__game;
  const veils = [];
  // how long a loading veil holds the world (loadingFloor) after it starts
  const timeVeil = async (name) => {
    const t0 = performance.now();
    await until(() => g.loadingFloor, 4000);
    const t1 = performance.now();
    await until(() => !g.loadingFloor && g.player, 60000);
    veils.push({ name, waitMs: Math.round(t1 - t0), veilMs: Math.round(performance.now() - t1) });
  };
  if (!Q.get('autostart')) {
    tag('boot');
    await until(() => document.querySelector('#bSolo') && !g.loadingFloor, 60000);
    tag('menu'); await sleep(2000);
    tag('select'); click('#bSolo'); await sleep(2500);
    tag('begin'); click('#bGo');
    await until(() => g.player?.id === 'solo', 10000);
    await timeVeil('menu→floor' + (g.floorIndex ?? 0));
  } else {
    tag('boot');
    await until(() => g.player?.id === 'solo' && !g.loadingFloor && !g.menuMode, 60000);
  }
  const p = g.player, inp = window.__input, L = () => g.level;
  // shadow depth materials are three's own (compile() never sees them): remember the object being
  // drawn into a shadow map, so a program linked there can be named (hitch-edge reads __shadowObj)
  window.__THREE.Object3D.prototype.onBeforeShadow = function () { window.__shadowObj = this; };
  window.__THREE.Object3D.prototype.onAfterShadow = function () { window.__shadowObj = null; };

  g.godMode = true;
  tag('spawn'); await sleep(2500);
  const hostiles = () => g.actors.hostiles().filter((a) => !a.dead && !a.dormant);
  const aim = () => {
    let best = null, bd = 1e9;
    for (const a of hostiles()) { const d = a.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = a; } }
    if (!best) return null;
    const dx = best.pos.x - p.pos.x, dz = best.pos.z - p.pos.z, dy = best.pos.y + (best.height ?? 1.6) * 0.5 - (p.pos.y + 1.6);
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return best;
  };
  // keep aiming while a phase runs
  const hold = async (ms, each) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { aim(); each?.(); await sleep(50); } };
  const goto = (room) => { p.pos.set(room.cx, g.groundY(room.cx, room.cz), room.cz); p.vel?.set?.(0, 0, 0); };
  const killAll = (el = 'fire', boss = false) => { for (const a of [...g.actors.list]) if (a.faction === 'enemy' && !a.dead && (boss || !a.boss)) { a.hp = 0; g.actors.kill(a, p.id, el); } };
  const castAll = async (pre) => {
    tag(pre + 'lmb'); inp.mouse.left = true; await hold(1800); inp.mouse.left = false;
    tag(pre + 'rmb'); inp.mouse.rightPressed = true; inp.mouse.right = true; await hold(1500); inp.mouse.right = false; await hold(300);
    tag(pre + 'Q'); inp.pressed.add('KeyQ'); await hold(1500);
    tag(pre + 'E'); inp.pressed.add('KeyE'); await hold(1500);
    tag(pre + 'R'); p.ult = 100; inp.pressed.add('KeyR'); await hold(2500);
    tag(pre + 'dash'); inp.pressed.add('ShiftLeft'); await hold(800);
  };
  const pick = async (name) => { // a choice modal: look at it a moment, take the first card
    tag(name); await sleep(1200);
    tag(name + ':pick'); if (!click('.modal [data-i="0"]')) click('.modal #bLeave'); await sleep(1200);
  };
  const clearRoom = async (pre) => {
    const els = ['fire', 'frost', 'lightning', 'necrotic', 'arcane', 'holy', 'poison', 'blood'];
    tag(pre + 'deaths');
    for (let i = 0; i < 25 && (g.director.active || hostiles().length); i++) { killAll(els[i % els.length]); await hold(700); }
    tag(pre + 'clear'); await sleep(2500);
  };
  const ped = () => g.interactables.find((i) => i.kind === 'pedestal' && !i.usedBy?.has(p.id));
  // ---- the first fight of the floor
  const main = L().rooms.filter((r) => r.main).sort((a, b) => a.order - b.order);
  const first = main.find((r) => r.type === 'combat');
  tag('enter'); goto(first); await until(() => hostiles().length > 0, 9000); await hold(1500);
  await castAll('');
  // reactions: soak and chill them, then hit with lightning / fire (and the rest), in the casting code path
  tag('reactions');
  const RX = [['earth', 'frozen'], ['fire', 'chill'], ['lightning', 'burn'], ['lightning', 'wet'], ['frost', 'shock'], ['fire', 'poison'], ['necrotic', 'bleed'], ['holy', 'hex'], ['blood', 'bleed'], ['time', 'slow', 'big'], ['wind', 'burn']];
  const ST = { burn: 1, chill: 2, frozen: 4, shock: 8, poison: 16, hex: 32, bleed: 64, slow: 128, wet: 512 };
  for (const [el, st, t] of RX) {
    const a = hostiles()[0];
    if (!a) break;
    a.mask |= ST[st]; a._rxT = -9;
    g.hitActor(a, { dmg: 1, el, tag: t, src: p.id }, a.pos.clone().add(new window.__THREE.Vector3(0, 1, 0)));
    await hold(250);
  }
  await hold(1500);
  await clearRoom('');
  const pd = ped();
  if (pd) { g.interact(pd); await pick('tome'); }
  log.push('first fight done: kills ' + g.stats.kills);
  if (Q.get('tour') !== 'short') {
    // ---- elite chamber
    const elite = L().rooms.find((r) => r.type === 'elite');
    if (elite) {
      tag('elite:enter'); goto(elite); await until(() => hostiles().length > 0, 9000); await hold(3000);
      tag('elite:fight'); inp.mouse.left = true; await hold(2500); inp.mouse.left = false;
      await clearRoom('elite:');
      const rp = ped(); if (rp) { g.interact(rp); await pick('relicUI'); }
    }
    // ---- treasure (a chest, or a mimic)
    const tr = L().rooms.find((r) => r.type === 'treasure');
    if (tr) {
      tag('treasure:enter'); goto(tr); await hold(1500);
      const ch = g.interactables.find((i) => (i.kind === 'chest' || i.kind === 'mimic') && !i.used && !i.usedBy?.has(p.id));
      if (ch) {
        tag('treasure:' + ch.kind); g.interact(ch); await sleep(600);
        if (document.querySelector('.modal')) await pick('chestRelic');
        else { await hold(2500); tag('mimic:kill'); killAll('fire'); await hold(3000); }
      }
    }
    // ---- shrine
    const sh = g.interactables.find((i) => i.kind === 'shrine');
    if (sh) { tag('shrine:enter'); p.pos.set(sh.pos.x, 0, sh.pos.z + 2); await sleep(1500); g.interact(sh); await pick('shrineUI'); }
    // ---- merchant
    const shop = g.interactables.find((i) => i.kind === 'shop');
    if (shop) { tag('shop:enter'); p.pos.set(shop.pos.x, 0, shop.pos.z + 3); p.yaw = 0; await sleep(2000); p.gold += 500; g.interact(shop); tag('shopUI'); await sleep(1200); tag('shopUI:buy'); click('.modal .shop-item'); await sleep(800); click('.modal #bLeave'); await sleep(800); }
    // ---- boss
    const br = L().bossRoom;
    if (br) {
      tag('boss:enter'); goto(br);
      await until(() => g.actors.list.some((a) => a.boss), 12000);
      tag('boss:intro'); await hold(4000);
      const boss = g.actors.list.find((a) => a.boss);
      tag('boss:fight'); inp.mouse.left = true; await hold(2500); inp.mouse.left = false;
      if (boss) {
        for (const [k, f] of [[1, 0.6], [2, 0.3]]) { tag('boss:phase' + (k + 1)); boss.hp = Math.min(boss.hp, boss.maxHp * f); await hold(4000); }
        tag('boss:death'); boss.hp = 1; killAll('fire', true); await hold(5000);
      }
      const bp = ped(); if (bp) { g.interact(bp); await pick('bossTome'); }
      const portal = g.interactables.find((i) => i.kind === 'portal');
      if (portal && g.floorIndex < 4) {
        const f0 = g.floorIndex;
        tag('portal'); g.interact(portal);
        await until(() => g.floorIndex !== f0, 10000);
        tag('veil'); await timeVeil('portal→floor' + g.floorIndex);
        tag('next:spawn'); await sleep(2500);
        const nf = g.level.rooms.filter((r) => r.main).sort((a, b) => a.order - b.order).find((r) => r.type === 'combat');
        tag('next:enter'); goto(nf); await until(() => hostiles().length > 0, 9000); await hold(1500);
        await castAll('next:');
        await clearRoom('next:');
      }
    }
  }
  tag('end'); await sleep(300);
  return { veils, log, programs: g.renderer.renderer.info.programs.length, prewarm: g._prewarmPrograms };
})()
