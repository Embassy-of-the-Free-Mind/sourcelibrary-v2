// Write guard for the reader-origin box (#8384). Preloaded with NODE_OPTIONS=--require.
//
// PRIOR ART: the #8374 shadow-run guard (job scratch, not in the repo); this is that file
// with a build mode and a Mongo command counter added.
//
// Refuses and logs: every Mongo write command (wire level, below the Collection API),
// every socket to a host that is not Atlas, Supabase or loopback, every non-read
// HTTP request (Supabase: GET/HEAD and read-only RPCs; loopback: GET/HEAD only).
// GUARD_MODE=build: loopback sockets only, so a `next build` reads no production data.
//
// It stays on until the box has a Mongo user that can write only the reader-analytics
// collections (README, "needs Derek"); after that the database enforces the scope and
// this file can come out of NODE_OPTIONS.
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');

const LOG = process.env.GUARD_LOG || '/tmp/shadow-guard.jsonl';
const counts = { mongo_write: 0, socket: 0, http: 0 };
function log(kind, detail) {
  counts[kind] = (counts[kind] || 0) + 1;
  try { fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), pid: process.pid, kind, ...detail }) + '\n'); } catch {}
}
function refusal(msg) { const e = new Error(`SL-WEB-GUARD refused: ${msg}`); e.code = 'SHADOW_GUARD'; return e; }

const SUPA = (() => { try { return new URL(process.env.SUPABASE_URL).hostname; } catch { return null; } })();
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const BUILD = process.env.GUARD_MODE === 'build';
function hostAllowed(h) {
  if (!h) return true; // unix sockets / pre-resolved: no host
  h = String(h).toLowerCase().replace(/^\[|\]$/g, '');
  if (BUILD) return LOOPBACK.has(h);
  return LOOPBACK.has(h) || h.endsWith('.mongodb.net') || (SUPA && h === SUPA);
}
const READ_RPC = /^(match_|search_|get_)/;
function methodAllowed(method, url) {
  const m = String(method || 'GET').toUpperCase();
  let u; try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return true; // inline, no network
  const h = u.hostname.replace(/^\[|\]$/g, '');
  if (LOOPBACK.has(h)) return m === 'GET' || m === 'HEAD';
  if (BUILD) return false;
  if (SUPA && h === SUPA) {
    if (m === 'GET' || m === 'HEAD') return true;
    const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);
    return m === 'POST' && !!rpc && READ_RPC.test(rpc[1]);
  }
  return false;
}

// --- sockets ---------------------------------------------------------------
function hostOf(args) {
  const a = args[0];
  if (a && typeof a === 'object') return a.host || a.hostname || a.servername || (a.path ? null : 'localhost');
  if (typeof a === 'number') return typeof args[1] === 'string' ? args[1] : 'localhost';
  if (typeof a === 'string' && !/^\d+$/.test(a)) return null; // unix socket path
  return 'localhost';
}
// Byte accounting per destination class, for "bytes read from Mongo per request".
const STATS = process.env.GUARD_STATS;
const bytes = { mongo: { r: 0, w: 0 }, supabase: { r: 0, w: 0 }, loopback: { r: 0, w: 0 } };
// Mongo commands sent (every one is a round trip to Atlas), by command name.
const mongoCmds = { total: 0, by: {} };
const live = new Set();
function classOf(h) { h = String(h || '').toLowerCase(); return h.endsWith('.mongodb.net') ? 'mongo' : (SUPA && h === SUPA) ? 'supabase' : 'loopback'; }
function track(sock, cls) {
  if (!sock || typeof sock.on !== 'function' || cls === 'loopback') return sock;
  const rec = { sock, cls }; live.add(rec);
  sock.once('close', () => { bytes[cls].r += sock.bytesRead || 0; bytes[cls].w += sock.bytesWritten || 0; live.delete(rec); });
  return sock;
}
if (STATS) {
  const t = setInterval(() => {
    const snap = JSON.parse(JSON.stringify({ ...bytes, mongoCmds }));
    for (const { sock, cls } of live) { snap[cls].r += sock.bytesRead || 0; snap[cls].w += sock.bytesWritten || 0; }
    try { fs.writeFileSync(`${STATS}.${process.pid}`, JSON.stringify({ t: Date.now(), ...snap })); } catch {}
  }, 2000); t.unref();
}
for (const [mod, name] of [[net, 'connect'], [net, 'createConnection'], [tls, 'connect']]) {
  const orig = mod[name];
  mod[name] = function guardedConnect(...args) {
    const h = hostOf(args);
    if (!hostAllowed(h)) {
      log('socket', { host: h, via: name });
      throw refusal(`socket to ${h}`);
    }
    const sock = orig.apply(this, args);
    // A tls.connect wrapping an existing socket would count that socket twice.
    const wraps = mod === tls && args[0] && typeof args[0] === 'object' && args[0].socket;
    return wraps ? sock : track(sock, classOf(h));
  };
}

// --- http(s).request -------------------------------------------------------
for (const [mod, proto] of [[http, 'http:'], [https, 'https:']]) {
  for (const name of ['request', 'get']) {
    const orig = mod[name];
    mod[name] = function guardedRequest(...args) {
      let url, method;
      if (typeof args[0] === 'string' || args[0] instanceof URL) {
        url = String(args[0]);
        method = (args[1] && typeof args[1] === 'object' && args[1].method) || (name === 'get' ? 'GET' : 'GET');
      } else {
        const o = args[0] || {};
        url = `${o.protocol || proto}//${o.hostname || o.host || 'localhost'}${o.port ? ':' + o.port : ''}${o.path || '/'}`;
        method = o.method || 'GET';
      }
      if (!methodAllowed(method, url)) {
        log('http', { method, url: url.slice(0, 200), via: `${proto}${name}` });
        throw refusal(`${method} ${url.slice(0, 120)}`);
      }
      return orig.apply(this, args);
    };
  }
}

// --- fetch -----------------------------------------------------------------
const origFetch = globalThis.fetch;
if (origFetch) {
  globalThis.fetch = async function guardedFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
    const method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
    if (!methodAllowed(method, url)) {
      log('http', { method, url: String(url).slice(0, 200), via: 'fetch' });
      throw refusal(`${method} ${String(url).slice(0, 120)}`);
    }
    return origFetch.call(this, input, init);
  };
}

// --- mongodb (wire level) --------------------------------------------------
const WRITE_CMDS = new Set(['insert', 'update', 'delete', 'findandmodify', 'createindexes', 'dropindexes', 'drop',
  'create', 'renamecollection', 'dropdatabase', 'collmod', 'mapreduce', 'bulkwrite', 'createuser', 'updateuser',
  'dropuser', 'applyops', 'commitTransaction'.toLowerCase(), 'abortTransaction'.toLowerCase(), 'clonecollectionascapped',
  'converttocapped', 'compact', 'shardcollection', 'createsearchindexes', 'updatesearchindex', 'dropsearchindex']);
function isWrite(cmd) {
  const first = Object.keys(cmd || {})[0] || '';
  const k = first.toLowerCase();
  if (WRITE_CMDS.has(k)) return first;
  if (k === 'aggregate' && Array.isArray(cmd.pipeline) && cmd.pipeline.some(s => s && (s.$out || s.$merge))) return 'aggregate($out/$merge)';
  return null;
}
try {
  const appDir = process.env.GUARD_APP_DIR || process.cwd();
  const connPath = require.resolve('mongodb/lib/cmap/connection.js', { paths: [appDir] });
  const { Connection } = require(connPath);
  const orig = Connection.prototype.command;
  Connection.prototype.command = async function guardedCommand(ns, cmd, options, responseType) {
    const name = Object.keys(cmd || {})[0] || '?';
    if (!/^(hello|ismaster|isMaster|ping|saslStart|saslContinue|endSessions)$/.test(name)) {
      mongoCmds.total++; mongoCmds.by[name] = (mongoCmds.by[name] || 0) + 1;
    }
    const w = isWrite(cmd);
    if (w) {
      const coll = cmd && cmd[Object.keys(cmd)[0]];
      log('mongo_write', { cmd: w, db: ns && (ns.db || String(ns)), coll: typeof coll === 'string' ? coll : undefined });
      throw refusal(`mongo ${w} ${typeof coll === 'string' ? coll : ''}`);
    }
    return orig.call(this, ns, cmd, options, responseType);
  };
  log('armed', { mode: BUILD ? 'build' : 'serve', mongodb: path.dirname(path.dirname(path.dirname(connPath))) });
} catch (e) {
  log('arm_failed', { error: String(e && e.message) });
  // Fail closed: without the Mongo hook the server must not start.
  console.error('[sl-web-guard] could not arm the Mongo hook:', e && e.message);
  process.exit(97);
}
process.on('exit', () => { try { fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), pid: process.pid, kind: 'exit', counts }) + '\n'); } catch {} });
