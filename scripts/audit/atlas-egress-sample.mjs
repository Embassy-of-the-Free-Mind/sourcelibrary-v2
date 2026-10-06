#!/usr/bin/env node
/**
 * atlas-egress-sample.mjs — who is reading how many bytes out of Atlas (#5189, #5184).
 *
 * PRIOR ART: scripts/maintenance/check-indexes.mjs — runs `currentOp` once to list index
 * builds; no sampling, no byte attribution. Searched `git grep -i 'currentOp|bytes_received|
 * NETWORK_BYTES_OUT'` and scripts/audit/: nothing samples Atlas traffic.
 *
 * Two instruments, sampled side by side:
 *
 *  1. SOCKETS (this box only): `ss -tnpi` to the Atlas nodes every --ss-every seconds.
 *     `bytes_received` is the real wire count from Atlas to this socket, and the socket's
 *     pid names the process, so a Hetzner script's egress is MEASURED, not estimated.
 *  2. CURSORS (every client): `$currentOp` with idleCursors on each replica-set member
 *     every --op-every seconds. The app credential has no `inprog` privilege, but
 *     `allUsers: false` still lists every op run by the SAME user, and every client
 *     (Vercel, Hetzner, cloudlayer, laptops) shares it. Gives client ip:port, ns,
 *     filter shape, projection and the cursor's running nDocsReturned. Docs ×
 *     avg doc size (per ns + projection, measured by the analyzer) estimates bytes for
 *     clients we cannot run `ss` on. Single-batch finds that finish between samples are
 *     invisible here: this instrument sees long cursors (scans), which is the point.
 *
 * Read-only. Writes JSONL to --out. Analyze with scripts/audit/atlas-egress-report.mjs.
 *
 *   node --env-file=.env.production.local scripts/audit/atlas-egress-sample.mjs \
 *     --out /root/scan-cut-5189/sample-before.jsonl --minutes 150
 */
import { MongoClient } from 'mongodb';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve4 } from 'node:dns/promises';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out');
const MINUTES = Number(arg('minutes', '120'));
const SS_EVERY = Number(arg('ss-every', '15'));
const OP_EVERY = Number(arg('op-every', '30'));
if (!OUT) { console.error('--out <file.jsonl> required'); process.exit(2); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI unset'); process.exit(2); }

const write = (rec) => appendFileSync(OUT, JSON.stringify(rec) + '\n');

// ---- topology -------------------------------------------------------------
const base = new MongoClient(process.env.MONGODB_URI, { appName: 'atlas-egress-sample' });
await base.connect();
const hello = await base.db('admin').command({ hello: 1 });
await base.close();
const u = new URL(process.env.MONGODB_URI.replace(/^mongodb(\+srv)?:/, 'http:'));
const nodes = [];
for (const h of hello.hosts) {
  const [host] = h.split(':');
  const ips = await resolve4(host).catch(() => []);
  const c = new MongoClient(
    `mongodb://${u.username}:${u.password}@${h}/?tls=true&authSource=admin&directConnection=true&readPreference=secondaryPreferred`,
    { appName: 'atlas-egress-sample', serverSelectionTimeoutMS: 15000 },
  );
  await c.connect();
  nodes.push({ host: h, ips, client: c });
}
const atlasIps = new Set(nodes.flatMap((n) => n.ips));
write({ t: new Date().toISOString(), kind: 'topology', primary: hello.primary, nodes: nodes.map((n) => ({ host: n.host, ips: n.ips })) });

// ---- sockets ---------------------------------------------------------------
const cmdCache = new Map();
function procInfo(pid) {
  if (cmdCache.has(pid)) return cmdCache.get(pid);
  let cmd = '?', unit = '', ppidCmd = '';
  try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ').slice(0, 300); } catch {}
  try {
    const cg = readFileSync(`/proc/${pid}/cgroup`, 'utf8');
    unit = (cg.match(/\/([^/\n]+\.(service|scope))/) || [])[1] || '';
  } catch {}
  try {
    const ppid = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1];
    ppidCmd = readFileSync(`/proc/${ppid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ').slice(0, 200);
  } catch {}
  const info = { cmd, unit, ppidCmd };
  cmdCache.set(pid, info);
  return info;
}

function sampleSockets() {
  let out = '';
  try { out = execFileSync('ss', ['-tnpiH', 'state', 'established', 'dport', '=', ':27017'], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { return; }
  const lines = out.split('\n');
  const socks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(\S+):(\d+)\s+(\S+):27017\s+users:\(\("([^"]+)",pid=(\d+)/);
    if (!m) continue;
    const [, , lport, rip, , pid] = m;
    if (atlasIps.size && !atlasIps.has(rip)) continue;
    const info = lines[i + 1] || '';
    const br = Number((info.match(/bytes_received:(\d+)/) || [])[1] || 0);
    const bs = Number((info.match(/bytes_sent:(\d+)/) || [])[1] || 0);
    socks.push([Number(lport), rip, Number(pid), br, bs]);
  }
  const pids = {};
  for (const s of socks) if (!pids[s[2]]) pids[s[2]] = procInfo(s[2]);
  write({ t: new Date().toISOString(), kind: 'ss', socks, pids });
}

// ---- currentOp -------------------------------------------------------------
const shape = (o, depth = 0) => {
  if (!o || typeof o !== 'object' || depth > 3) return typeof o;
  if (Array.isArray(o)) return [`arr${o.length}`, o.length ? shape(o[0], depth + 1) : null];
  const r = {};
  for (const [k, v] of Object.entries(o)) r[k] = (k.startsWith('$') || (v && typeof v === 'object')) ? shape(v, depth + 1) : (typeof v === 'number' ? v : typeof v);
  return r;
};
function cmdSummary(c) {
  if (!c) return null;
  const op = ['find', 'aggregate', 'getMore', 'count', 'distinct', 'countDocuments', 'update', 'insert', 'delete', 'findAndModify'].find((k) => k in c) || Object.keys(c)[0];
  return {
    op,
    coll: typeof c[op] === 'string' ? c[op] : c.collection,
    filter: c.filter ? JSON.stringify(shape(c.filter)).slice(0, 400) : undefined,
    projection: c.projection ? JSON.stringify(c.projection).slice(0, 400) : undefined,
    pipeline: c.pipeline ? JSON.stringify(shape(c.pipeline)).slice(0, 600) : undefined,
    sort: c.sort ? JSON.stringify(c.sort).slice(0, 100) : undefined,
    batchSize: c.batchSize ?? c.cursor?.batchSize,
    limit: c.limit,
    comment: c.comment ? String(c.comment).slice(0, 100) : undefined,
  };
}
async function sampleOps() {
  for (const n of nodes) {
    let ops;
    try {
      ops = await n.client.db('admin').aggregate([{ $currentOp: { allUsers: false, idleCursors: true, idleConnections: false } }]).toArray();
    } catch (e) { write({ t: new Date().toISOString(), kind: 'op_err', node: n.host, err: e.message.slice(0, 200) }); continue; }
    const recs = [];
    for (const o of ops) {
      if (o.appName === 'atlas-egress-sample') continue;
      const cur = o.cursor;
      const orig = cur?.originatingCommand || (o.command?.getMore ? null : o.command);
      recs.push({
        // idleCursor rows carry no client: lsid joins them to that session's active ops.
        type: o.type, client: o.client, lsid: o.lsid?.id ? String(o.lsid.id) : undefined, app: o.appName || o.clientMetadata?.application?.name,
        drv: o.clientMetadata ? `${o.clientMetadata.driver?.name}/${o.clientMetadata.driver?.version}|${o.clientMetadata.platform || ''}`.slice(0, 120) : undefined,
        ns: o.ns, op: o.op, plan: o.planSummary, secs: o.secs_running,
        cid: cur?.cursorId ? String(cur.cursorId) : (o.command?.getMore ? String(o.command.getMore) : undefined),
        nret: cur?.nDocsReturned, nbat: cur?.nBatchesReturned, created: cur?.createdDate,
        dex: o.docsExamined, kex: o.keysExamined,
        orig: cmdSummary(orig),
      });
    }
    write({ t: new Date().toISOString(), kind: 'ops', node: n.host, n: recs.length, recs });
  }
}

// ---- loop ------------------------------------------------------------------
const end = Date.now() + MINUTES * 60_000;
let lastOp = 0;
console.log(`sampling ${MINUTES} min → ${OUT} (ss every ${SS_EVERY}s, $currentOp every ${OP_EVERY}s, ${nodes.length} nodes)`);
while (Date.now() < end) {
  const t0 = Date.now();
  sampleSockets();
  if (t0 - lastOp >= OP_EVERY * 1000) { lastOp = t0; await sampleOps(); }
  await new Promise((r) => setTimeout(r, Math.max(1000, SS_EVERY * 1000 - (Date.now() - t0))));
}
for (const n of nodes) await n.client.close();
write({ t: new Date().toISOString(), kind: 'done' });
console.log('done');
