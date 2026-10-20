import { Peer } from 'peerjs';

// ---------------------------------------------------------------------------
// Peer-to-peer co-op over WebRTC (PeerJS). One player hosts and shares a
// short party code; others connect directly to the host, which relays
// messages between clients. No game server is needed, so the game can be
// dropped onto any static website.
//
// Config (optional) — set window.ARCANE_NET before loading the game, or use
// URL params ?peerHost=&peerPort=&peerPath=&peerSecure= to point at your own
// PeerJS signalling server, plus `iceServers` for TURN relays.
// ---------------------------------------------------------------------------

const PREFIX = 'arcane-ascent-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function peerOptions() {
  const cfg = { ...(window.ARCANE_NET ?? {}) };
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
    iceServers: cfg.iceServers ?? [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ],
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
  _emit(msg, from) { this.rx[msg.t] = (this.rx[msg.t] ?? 0) + 1; for (const h of this.handlers) { try { h(msg, from); } catch (e) { console.error('net handler', e); } } }

  // ------------------------------------------------------------- hosting
  host() {
    return new Promise((resolve, reject) => {
      const attempt = (tries) => {
        const code = makeCode();
        const peer = new Peer(PREFIX + code, peerOptions());
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
        peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); });
      };
      attempt(3);
    });
  }

  _accept(conn) {
    const pid = 'p' + conn.peer.slice(-6);
    conn.on('open', () => {
      this.conns.set(pid, conn);
      conn.pid = pid;
    });
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      // routing: targeted messages from clients
      if (msg.to && msg.to !== 'host') {
        const c = this.conns.get(msg.to);
        if (c?.open) c.send({ ...msg, from: pid });
        return;
      }
      if (msg.relay) {
        // forward to all other clients as well
        for (const [id, c] of this.conns) if (id !== pid && c.open) c.send({ ...msg, from: pid });
      }
      this._emit(msg, pid);
    });
    conn.on('close', () => {
      this.conns.delete(pid);
      this.onPeerLeft?.(pid);
    });
    conn.on('error', (e) => console.warn('conn error', e));
  }

  // ------------------------------------------------------------- joining
  join(code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(undefined, peerOptions());
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
        conn.on('data', (msg) => { if (msg && typeof msg === 'object') this._emit(msg, msg.from ?? 'host'); });
        conn.on('close', () => { if (!this.closed) this.onDisconnect?.(); });
        conn.on('error', (e) => console.warn('conn error', e));
      });
      peer.on('error', (err) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          try { peer.destroy(); } catch { /* ignore */ }
          reject(new Error(err.type === 'peer-unavailable' ? 'No party found with that code.' : `Connection failed (${err.type ?? err.message}).`));
        }
      });
    });
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

  get peerCount() { return this.isHost ? this.conns.size : 1; }

  // periodic replication (called by the game every frame)
  tick(dt, game) {
    const p = game.player;
    this.stateT += dt;
    if (this.stateT >= 1 / 20 && p) {
      this.stateT = 0;
      const s = { t: 'ps', id: p.id, p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], y: r3(p.yaw), pi: r3(p.pitch), hp: Math.ceil(p.hp), mh: p.maxHp, sh: Math.ceil(p.shield),
        dn: p.downed ? 1 : 0, dd: p.dead ? 1 : 0, u: Math.floor(p.ult), g: Math.floor(p.gold), lv: game.floorIndex };
      this.broadcastOrSend(s);
    }
    if (this.isHost) {
      this.snapT += dt;
      if (this.snapT >= 1 / 15) {
        this.snapT = 0;
        const snap = game.actors.snapshot();
        if (snap.length) this.broadcast({ t: 'snap', a: snap });
      }
    }
  }

  close() {
    this.closed = true;
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conns.clear();
    this.hostConn = null;
  }
}

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
