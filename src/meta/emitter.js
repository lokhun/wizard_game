// A tiny synchronous event emitter. The game emits what happened (a kill, a
// hit, a room cleared) and the meta layer (run tracking, feats, the summary)
// listens, so progression code never threads through combat code.
// emit() is on hot paths (every hit): no allocation, and cheap with no listeners.
export class Emitter {
  constructor() { this.map = new Map(); }
  on(ev, fn) {
    let a = this.map.get(ev);
    if (!a) this.map.set(ev, (a = []));
    a.push(fn);
    return () => { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  }
  // returns true when someone listened (callers can fall back otherwise)
  emit(ev, a, b, c, d) {
    const l = this.map.get(ev);
    if (!l || !l.length) return false;
    for (let i = 0; i < l.length; i++) {
      try { l[i](a, b, c, d); } catch (e) { console.error('event', ev, e); }
    }
    return true;
  }
}
