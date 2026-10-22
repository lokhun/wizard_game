// Co-op networking service for play.lokhunproject.fun, on loopback behind Caddy:
//  - /peerjs/arcane  PeerJS signalling (WebSocket): players find each other here
//    instead of on the free public PeerJS server, which drops sessions at times.
//    Only the handshake passes through; game traffic goes peer to peer.
//  - /net-config     what the game should use: this signalling server, plus a
//    short-lived login for the TURN relay (coturn's use-auth-secret, the "TURN
//    REST API": username "<unix expiry>:arcane", password
//    base64(HMAC-SHA1(secret, username))). The secret never leaves the server.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import { ExpressPeerServer } from 'peer';

const secret = readFileSync(process.env.TURN_SECRET_FILE ?? '/run/turn.secret', 'utf8').trim();
if (secret.length < 32) throw new Error('TURN secret missing or too short');
const HOST = 'play.lokhunproject.fun';
const TTL = 24 * 3600; // a login outlives any run; coturn refuses it after that

const app = express();
app.disable('x-powered-by');
app.get('/net-config', (req, res) => {
  const username = `${Math.floor(Date.now() / 1000) + TTL}:arcane`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  res.set('cache-control', 'no-store').json({
    peer: { host: HOST, port: 443, path: '/peerjs/arcane', secure: true },
    iceServers: [{ urls: [`turn:${HOST}:40050?transport=udp`], username, credential }],
  });
});
app.get('/healthz', (req, res) => res.send('ok'));

const server = app.listen(3004, '127.0.0.1');
app.use('/peerjs', ExpressPeerServer(server, {
  path: '/arcane',
  proxied: true, // behind Caddy: client addresses come from X-Forwarded-For
  allow_discovery: false, // nobody can list who is online
  alive_timeout: 60000,
  concurrent_limit: 2000,
}));
