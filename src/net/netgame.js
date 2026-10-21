import * as THREE from 'three';

// In-run network message handling for both host and clients.
export function handleGameMessage(game, msg, from) {
  const t = msg.t;
  switch (t) {
    // ------------------------------------------------ player replication
    case 'ps': {
      const id = msg.id ?? from;
      if (id === game.player?.id) return;
      const r = game.remotes.get(id);
      if (r && msg.lv === game.floorIndex) r.applyState(msg);
      break;
    }
    case 'cast': {
      if (msg.pid === game.player?.id) return;
      game.remotes.get(msg.pid)?.replayCast(msg);
      break;
    }
    // ------------------------------------------------ client -> host
    case 'hit': {
      if (!game.isHost) return;
      const a = game.actors.byId.get(msg.id);
      if (!a || !a.alive) return;
      game.actors.damage(a, { dmg: msg.d, el: msg.el, st: msg.st, kb: msg.kb, kbDir: msg.kd, pull: msg.pl, src: from, consume: msg.c });
      break;
    }
    case 'summon': {
      if (!game.isHost) return;
      game.requestSummon(msg.ty, new THREE.Vector3(msg.x, 0, msg.z), msg.l, msg.o ?? from);
      break;
    }
    case 'vamp': {
      if (!game.isHost) return;
      const a = game.actors.byId.get(msg.id);
      if (a && a.alive) a.hp = Math.min(a.maxHp, a.hp + msg.d * 0.5);
      break;
    }
    case 'nextfloor': if (game.isHost && (msg.f === undefined || msg.f === game.floorIndex)) game.goNextFloor(); break;
    // ------------------------------------------------ shared events
    case 'pick': game.removeDrop(msg.id); break;
    case 'bat': { const a = game.actors.byId.get(msg.id); if (a) { a.brainAttackType = msg.a; a.attackType = msg.a; } break; }
    case 'brk': game.breakProp(msg.i, false); break;
    case 'chest': {
      const it = game.interactables.find((i) => i.id === msg.id);
      it?.open?.();
      break;
    }
    case 'heal': game.player.heal(msg.a); game.healPulse = 0.5; break;
    case 'shield': game.player.addShield(msg.a, msg.d); break;
    case 'revive': game.player.revive(msg.f ?? 0.4); break;
    case 'tp': game.requestTeleport(game.player.id, msg.x, msg.z); break;
    case 'kc': {
      const a = game.actors.byId.get(msg.id);
      game.onLocalKill(a ?? { pos: new THREE.Vector3(msg.x, 0, msg.z), boss: false, mask: 0 }, !!msg.hx, !!msg.b, msg.m ?? 0);
      break;
    }
    case 'dn': {
      const a = game.actors.byId.get(msg.id);
      if (a) {
        game.ui?.damageNumber(new THREE.Vector3(a.pos.x, a.pos.y + a.height * 0.8, a.pos.z), msg.d, 'fire', false, true, a.id);
        game.player.onDealtDamage(msg.d, false);
        game.stats.damage += msg.d;
      }
      break;
    }
    // ------------------------------------------------ host -> clients
    case 'snap': if (!game.isHost) game.actors.applySnapshot(msg.a); break;
    case 'trial': {
      if (game.isHost) return;
      const room = game.level.rooms[msg.r];
      if (!room) return;
      room.trialWon = !!msg.won;
      if (!msg.won) game.onTrialResult(room, false);
      break;
    }
    case 'wake': { const a = game.actors.byId.get(msg.id); if (a) a.dormant = false; break; }
    case 'spawn': {
      if (game.isHost || game.actors.byId.has(msg.id)) return;
      const a = game.actors.spawn(msg.ty, msg.x, msg.z, { id: msg.id, yaw: msg.yaw, elite: !!msg.e, hp: msg.hp, faction: msg.f ? 'ally' : 'enemy', affix: msg.af, life: msg.life, silent: true, spawnFx: msg.nf ? false : undefined, dormant: !!msg.dm, homeRoom: msg.hr >= 0 ? game.level.rooms[msg.hr] : null });
      a.net.x = msg.x; a.net.z = msg.z; a.net.yaw = msg.yaw;
      if (msg.fly) a.model?.setFlying?.(true);
      break;
    }
    case 'die': {
      if (game.isHost) return;
      const a = game.actors.byId.get(msg.id);
      if (a && !a.dead) {
        a.dead = true; a.deadT = 0; a.anim = 'death'; a.animT = 0; a.mask = 0;
        game.actors._rebuildLists();
        game.actors.deathFx(a, msg.el);
        game.stats.kills++;
      }
      break;
    }
    case 'collapse': { const a = game.actors.byId.get(msg.id); if (a) { a.collapsed = true; a.anim = 'death'; a.animT = 0; game.actors._rebuildLists(); } break; }
    case 'rise': { const a = game.actors.byId.get(msg.id); if (a) { a.collapsed = false; a.anim = 'spawn'; a.animT = 0; a.progress = 0; game.actors._rebuildLists(); } break; }
    case 'hz': if (!game.isHost) game.addHazard(msg.h); break;
    case 'ep': if (!game.isHost) game.spawnEnemyProjectile(msg.e); break;
    case 'pool': if (!game.isHost) game.spawnPoolLocal(new THREE.Vector3(msg.x, 0, msg.z), msg.r, msg.d, msg.p, msg.el); break;
    case 'lock': {
      if (game.isHost) return;
      const room = game.level.rooms[msg.r];
      if (!room) return;
      if (msg.sen) room.sentriesPlaced = true;
      if (msg.tl) { room.trialLimit = msg.tl; room.trialEnd = game.time + msg.tl; room.trialWon = null; }
      game.setRoomLocked(msg.r, !!msg.on);
      if (msg.clear) { room.cleared = true; game.onRoomCleared(room); }
      break;
    }
    case 'visit': { const room = game.level.rooms[msg.r]; if (room) room.visited = true; break; }
    case 'wave': game.ui?.wave(msg.n, msg.of); break;
    case 'boss': {
      const a = game.actors.byId.get(msg.id);
      if (a) game.onBossSpawn(a);
      else setTimeout(() => { const b = game.actors.byId.get(msg.id); if (b) game.onBossSpawn(b); }, 300);
      break;
    }
    case 'bossdead': if (!game.isHost) game.bossDefeated(); break;
    case 'banner': game.ui?.banner(msg.a, msg.b, msg.c); break;
    case 'shake': game.vfx.addShake(msg.k); break;
    case 'snd': game.audio?.play(msg.n, { pos: new THREE.Vector3(msg.x, msg.y, msg.z), volume: msg.v }); break;
    case 'bfx': game.bossFx(msg.k, game.actors.byId.get(msg.id), msg); break;
    case 'blinkfx': game.actors.blinkFx(new THREE.Vector3(msg.x, msg.y, msg.z)); break;
    case 'healfx': { const a = game.actors.byId.get(msg.id); if (a) game.vfx.burst(new THREE.Vector3(a.pos.x, a.pos.y + a.height * 0.6, a.pos.z), { element: msg.s ? 'holy' : 'poison', count: 12, speed: 1.5, upward: 1, life: 0.8, size: 0.12 }); break; }
    case 'drop': if (!game.isHost) game.spawnDrop(msg.ty, new THREE.Vector3(msg.x, msg.y, msg.z), msg.v, msg.id); break;
    case 'floor': if (!game.isHost) game.transitionToFloor(msg.i); break;
    case 'victory': if (!game.isHost) game.victory(); break;
    case 'defeat': if (!game.isHost) game.defeat(); break;
    case 'ping': game.addPing?.(msg); break;
    case 'rsum': game.events?.emit('net:rsum', msg, from); break; // a teammate's run summary (src/meta)
    case 'enc': game.encounters?.onNet(msg, from); break;
    case 'rfx': if (msg.p !== game.player?.id) game.relics?.fx(msg); break; // a teammate's relic proc (visual)
    default: break;
  }
}
