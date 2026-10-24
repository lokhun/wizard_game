// PeerJS and its WebRTC shims (~75 KB minified) load on the first host or
// join: solo players never download them
let peerjs = null;
const loadPeer = () => (peerjs ??= import('peerjs').catch((e) => { peerjs = null; throw e; }));

// ---------------------------------------------------------------------------
// Peer-to-peer co-op over WebRTC (PeerJS). One player hosts and shares a
// short party code; others connect directly to the host, which relays
// messages between clients. No game server is needed, so the game can be
// dropped onto any static website.
//
// Config (optional) — set window.ARCANE_NET before loading the game, or use
// URL params ?peerHost=&peerPort=&peerPath=&peerSecure= to point at your own
// PeerJS signalling server, plus `iceServers` for TURN relays. Both override
// what the site's ./net-config gives (see loadSiteNet).
// ---------------------------------------------------------------------------

const PREFIX = 'arcane-ascent-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// The site's own co-op service (deploy/signal/server.mjs): a PeerJS signalling
// server, so matchmaking doesn't depend on the free public one, and a
// short-lived login for its TURN relay, for players whose networks block
// direct connections. Fetched fresh for each host or join; anywhere without
// one (dev, other hosts) the public PeerJS server and STUN alone are used.
const loadSiteNet = () => fetch('./net-config', { cache: 'no-store', signal: AbortSignal.timeout(4000) })
  .then((r) => (r.ok ? r.json() : {}))
  .then((j) => ({ peer: j?.peer?.host ? j.peer : null, iceServers: Array.isArray(j?.iceServers) ? j.iceServers : [] }))
  .catch(() => ({ peer: null, iceServers: [] }));

function peerOptions(site = { peer: null, iceServers: [] }) {
  const cfg = { ...(site.peer ?? {}), ...(window.ARCANE_NET ?? {}) };
  const q = new URLSearchParams(location.search);
  if (q.get('peerHost')) {
    cfg.host = q.get('peerHost');
    cfg.port = +(q.get('peerPort') ?? 443);
    cfg.path = q.get('peerPath') ?? '/';
    cfg.secure = q.get('peerSecure') !== '0';
  }
  const opts = { debug: 1 };
  if (cfg.host) { opts.host = cfg.host; opts.port = cfg.port; opts.path = cfg.path; opts.secure = cfg.secure; }
  if (cfg.key) opts.key = cfg.key;
  opts.config = {
    iceServers: [...(cfg.iceServers ?? [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ]), ...site.iceServers],
  };
  return opts;
}

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export class Net {
  constructor() {
    this.isHost = false;
    this.peer = null;
    this.conns = new Map(); // host: playerId -> DataConnection
    this.hostConn = null;
    // A second, unordered channel per player for the 15-20 Hz state stream
    // (enemy snapshots, player positions). On the reliable ordered channel a
    // single lost packet held every later snapshot back until it was resent,
    // which showed as enemies stuttering and rubber-banding on real networks.
    // Events (casts, hits, pickups, rooms) stay on the reliable one.
    this.fast = new Map(); // host: playerId -> unordered DataConnection
    this.fastConn = null; // client -> host
    this.seq = 0;
    this.lastSeq = new Map(); // `${from}:${type}` -> newest seq seen
    this.id = null;
    this.code = null;
    this.handlers = new Set();
    this.onDisconnect = null;
    this.onPeerLeft = null;
    this.stateT = 0;
    this.snapT = 0;
    this.closed = false;
    this.rx = {};
  }

  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  // state messages carry a sequence number; on the unordered channel an old
  // one can arrive after a newer one, and is simply dropped
  _stale(msg, from) {
    if (msg.q === undefined) return false;
    const k = (msg.id ?? from) + ':' + msg.t;
    const last = this.lastSeq.get(k);
    if (last !== undefined && msg.q <= last && last - msg.q < 1e6) return true;
    this.lastSeq.set(k, msg.q);
    return false;
  }
  _emit(msg, from) { this.rx[msg.t] = (this.rx[msg.t] ?? 0) + 1; for (const h of this.handlers) { try { h(msg, from); } catch (e) { console.error('net handler', e); } } }

  // ------------------------------------------------------------- hosting
  host() {
    return Promise.all([loadPeer(), loadSiteNet()]).then(([{ Peer }, site]) => new Promise((resolve, reject) => {
      const attempt = (tries) => {
        const code = makeCode();
        const peer = new Peer(PREFIX + code, peerOptions(site));
        let opened = false;
        peer.on('open', () => {
          opened = true;
          this.peer = peer;
          this.isHost = true;
          this.code = code;
          this.id = 'host';
          resolve(code);
        });
        peer.on('error', (err) => {
          if (!opened && err.type === 'unavailable-id' && tries > 0) { peer.destroy(); attempt(tries - 1); return; }
          if (!opened) { peer.destroy(); reject(err); return; }
          console.warn('peer error', err);
        });
        peer.on('connection', (conn) => this._accept(conn));
        // (only the live host peer reconnects: a peer an id clash destroyed still fires this, and
        // reconnecting a destroyed peer throws)
        peer.on('disconnected', () => { if (!this.closed && peer === this.peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) { console.warn('peer reconnect', e); } } });
      };
      attempt(3);
    }));
  }

  _accept(conn) {
    const pid = 'p' + conn.peer.slice(-6);
    const onData = (msg) => {
      if (!msg || typeof msg !== 'object') return;
      // routing: targeted messages from clients
      if (msg.to && msg.to !== 'host') {
        const c = this.conns.get(msg.to);
        if (c?.open) c.send({ ...msg, from: pid });
        return;
      }
      if (this._stale(msg, pid)) return;
      if (msg.relay) {
        // forward to all other clients as well (state over their fast channel)
        const fwd = { ...msg, from: pid };
        for (const [id, c] of this.conns) if (id !== pid && c.open) (msg.q !== undefined && this.fast.get(id)?.open ? this.fast.get(id) : c).send(fwd);
      }
      this._emit(msg, pid);
    };
    if (conn.metadata?.fast) {
      conn.on('open', () => this.fast.set(pid, conn));
      conn.on('data', onData);
      conn.on('close', () => { if (this.fast.get(pid) === conn) this.fast.delete(pid); });
      conn.on('error', () => {});
      return;
    }
    conn.on('open', () => {
      this.conns.set(pid, conn);
      conn.pid = pid;
    });
    conn.on('data', onData);
    conn.on('close', () => {
      this.conns.delete(pid);
      this.onPeerLeft?.(pid);
    });
    conn.on('error', (e) => console.warn('conn error', e));
  }

  // ------------------------------------------------------------- joining
  join(code) {
    return Promise.all([loadPeer(), loadSiteNet()]).then(([{ Peer }, site]) => new Promise((resolve, reject) => {
      const peer = new Peer(undefined, peerOptions(site));
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('Timed out. Check the code, or the host may be behind a strict firewall.')); peer.destroy(); } }, 15000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          this.peer = peer;
          this.hostConn = conn;
          this.code = code.toUpperCase();
          this.id = 'p' + peer.id.slice(-6);
          resolve();
        });
        const onData = (msg) => { if (msg && typeof msg === 'object' && !this._stale(msg, msg.from ?? 'host')) this._emit(msg, msg.from ?? 'host'); };
        conn.on('data', onData);
        conn.on('close', () => { if (!this.closed) this.onDisconnect?.(); });
        conn.on('error', (e) => console.warn('conn error', e));
        // the unordered state channel; until (unless) it opens, state goes over the reliable one
        const fast = peer.connect(PREFIX + code.toUpperCase(), { reliable: false, serialization: 'json', metadata: { fast: 1 } });
        fast.on('open', () => { this.fastConn = fast; });
        fast.on('data', onData);
        fast.on('close', () => { if (this.fastConn === fast) this.fastConn = null; });
        fast.on('error', () => {});
      });
      peer.on('error', (err) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          try { peer.destroy(); } catch { /* ignore */ }
          reject(new Error(err.type === 'peer-unavailable' ? 'No party found with that code.' : `Connection failed (${err.type ?? err.message}).`));
        }
      });
    }));
  }

  // ------------------------------------------------------------- sending
  // client -> host (host: handled locally)
  send(msg) {
    if (this.isHost) { this._emit(msg, 'host'); return; }
    if (this.hostConn?.open) this.hostConn.send(msg);
  }
  // host -> all clients
  broadcast(msg, except) {
    if (!this.isHost) return;
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
  }
  // to a specific player
  sendTo(pid, msg) {
    if (pid === this.id) { this._emit(msg, this.id); return; }
    if (this.isHost) {
      const c = this.conns.get(pid);
      if (c?.open) c.send({ ...msg, from: 'host' });
    } else if (this.hostConn?.open) {
      this.hostConn.send({ ...msg, to: pid });
    }
  }
  // everyone else (host broadcasts; client asks host to relay)
  broadcastOrSend(msg) {
    if (this.isHost) this.broadcast({ ...msg, from: 'host' });
    else if (this.hostConn?.open) this.hostConn.send({ ...msg, relay: 1 });
  }
  sendCast(c) {
    const msg = { t: 'cast', pid: c.pid, slot: c.slot, chan: c.chan, ch: c.ch, au: c.au?.length ? c.au : undefined,
      o: c.o ? [r2(c.o.x), r2(c.o.y), r2(c.o.z)] : null, d: c.d ? [r3(c.d.x), r3(c.d.y), r3(c.d.z)] : null, ap: c.ap ? [r2(c.ap.x), r2(c.ap.y), r2(c.ap.z)] : null };
    this.broadcastOrSend(msg);
  }

  // latest-wins state: over the unordered channel where it's open
  sendState(msg) {
    msg.q = this.seq++;
    if (this.isHost) {
      const m = { ...msg, from: 'host' };
      for (const [id, c] of this.conns) if (c.open) (this.fast.get(id)?.open ? this.fast.get(id) : c).send(m);
    } else {
      const c = this.fastConn?.open ? this.fastConn : this.hostConn;
      if (c?.open) c.send({ ...msg, relay: 1 });
    }
  }

  get peerCount() { return this.isHost ? this.conns.size : 1; }

  // periodic replication (called by the game every frame)
  tick(dt, game) {
    const p = game.player;
    this.stateT += dt;
    if (this.stateT >= 1 / 20 && p) {
      this.stateT = 0;
      const s = { t: 'ps', id: p.id, p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], y: r3(p.yaw), pi: r3(p.pitch), hp: Math.ceil(p.hp), mh: p.maxHp, sh: Math.ceil(p.shield),
        dn: p.downed ? 1 : 0, dd: p.dead ? 1 : 0, u: Math.floor(p.ult), g: Math.floor(p.gold), lv: game.floorIndex };
      this.sendState(s);
    }
    if (this.isHost) {
      this.snapT += dt;
      if (this.snapT >= 1 / 15) {
        this.snapT = 0;
        const snap = game.actors.snapshot();
        if (snap.length) this.sendState({ t: 'snap', a: snap });
      }
    }
  }

  close() {
    this.closed = true;
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conns.clear();
    this.fast.clear();
    this.hostConn = null;
    this.fastConn = null;
  }
}

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
