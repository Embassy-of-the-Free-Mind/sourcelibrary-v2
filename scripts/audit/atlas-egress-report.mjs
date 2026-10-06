#!/usr/bin/env node
/**
 * atlas-egress-report.mjs — rank Atlas readers by bytes from an atlas-egress-sample.mjs file.
 *
 * PRIOR ART: none — written alongside scripts/audit/atlas-egress-sample.mjs (#5189), which
 * defines the input format.
 *
 * Two tables:
 *  A. THIS BOX, measured: socket bytes_received deltas per process, grouped by script
 *     (the first *.mjs/*.js/*.ts/*.py/*.sh in the command line), with the collections and
 *     query shapes `$currentOp` saw on that process's ports.
 *  B. EVERY CLIENT, estimated: per client IP, docs returned by cursors seen growing between
 *     samples, grouped by ns + filter shape + projection. --sizes <json> multiplies docs by a
 *     measured avg doc size per "ns|projection" key (write one with --measure-sizes).
 *
 *   node scripts/audit/atlas-egress-report.mjs --in sample.jsonl [--from ISO] [--to ISO] [--json out.json]
 *   node --env-file=.env.production.local scripts/audit/atlas-egress-report.mjs --in sample.jsonl --measure-sizes sizes.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const IN = arg('in');
const FROM = arg('from') ? Date.parse(arg('from')) : 0;
const TO = arg('to') ? Date.parse(arg('to')) : Infinity;
const SIZES = arg('sizes');
const MEASURE = arg('measure-sizes');
const JSON_OUT = arg('json');
const TOP = Number(arg('top', '25'));
if (!IN) { console.error('--in <sample.jsonl> required'); process.exit(2); }

const HOSTS = {
  '46.224.122.120': 'hetzner-main', '46.224.208.175': 'cloudlayer', '167.233.32.250': 'earthai-l7a',
};
const hostLabel = (ip) => HOSTS[ip] || (/^(3|18|35|52|54|63|65|99)\./.test(ip) ? `aws:${ip}` : ip);

function jobOf(cmd) {
  if (!cmd) return '?';
  const m = cmd.match(/(\S*?(?:scripts|code|tools)\/\S+\.(?:mjs|cjs|js|ts|py|sh))/) || cmd.match(/(\S+\.(?:mjs|cjs|js|ts|py|sh))/);
  if (!m) return cmd.slice(0, 80);
  return m[1].replace(/^.*?\/(scripts\/)/, '$1').replace(/^\/root\//, '~/');
}

// ---- pass over the file ------------------------------------------------------
const sockets = new Map();   // key lport|rip|pid → { first, last, firstT, lastT, newSocket }
const pidInfo = new Map();   // pid → { cmd, unit, ppidCmd }
const portPid = new Map();   // lport → pid (latest)
const cursors = new Map();   // node|cid → { min, max, firstT, lastT, created, ns, orig, lsid, client }
const lsidClient = new Map(); // lsid → client ip:port
const opShapes = new Map();  // client ip:port → Map(shapeKey → count)
let firstSsT = null, lastSsT = null, ssSamples = 0, opSamples = 0, firstOpT = null, lastOpT = null;
let prevSsKeys = null;

const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  let r; try { r = JSON.parse(line); } catch { continue; }
  const t = Date.parse(r.t);
  if (t < FROM || t > TO) continue;
  if (r.kind === 'ss') {
    ssSamples++;
    if (firstSsT === null) firstSsT = t;
    lastSsT = t;
    for (const [pid, info] of Object.entries(r.pids)) pidInfo.set(Number(pid), info);
    const keys = new Set();
    for (const [lport, rip, pid, br] of r.socks) {
      const k = `${lport}|${rip}|${pid}`;
      keys.add(k);
      portPid.set(lport, pid);
      const s = sockets.get(k);
      if (!s) {
        // A socket absent from the previous sample opened since then: all its bytes are in-window.
        const isNew = prevSsKeys !== null;
        sockets.set(k, { pid, first: isNew ? 0 : br, last: br, firstT: t, lastT: t });
      } else { s.last = br; s.lastT = t; }
    }
    prevSsKeys = keys;
  } else if (r.kind === 'ops') {
    opSamples++;
    if (firstOpT === null) firstOpT = t;
    lastOpT = t;
    for (const o of r.recs) {
      if (o.client && o.lsid) lsidClient.set(o.lsid, o.client);
      const shapeKey = `${o.ns}|${o.orig?.op || o.op}|${o.orig?.filter || o.orig?.pipeline || ''}|proj=${o.orig?.projection || '-'}|${o.plan || ''}`.slice(0, 700);
      if (o.client) {
        if (!opShapes.has(o.client)) opShapes.set(o.client, new Map());
        const m = opShapes.get(o.client); m.set(shapeKey, (m.get(shapeKey) || 0) + 1);
      }
      if (o.cid && o.nret != null) {
        const k = `${r.node}|${o.cid}`;
        const c = cursors.get(k);
        const created = o.created ? Date.parse(o.created) : null;
        if (!c) {
          // Created after the first op sample → count from zero.
          const fromZero = created && firstOpT !== null && created >= firstOpT;
          cursors.set(k, { min: fromZero ? 0 : o.nret, max: o.nret, firstT: t, lastT: t, ns: o.ns, orig: o.orig, lsid: o.lsid, client: o.client, plan: o.plan });
        } else {
          c.max = Math.max(c.max, o.nret); c.lastT = t;
          if (!c.client && o.client) c.client = o.client;
          if (!c.orig && o.orig) c.orig = o.orig;
        }
      }
    }
  }
}

const ssHours = (lastSsT - firstSsT) / 3.6e6;
const opHours = (lastOpT - firstOpT) / 3.6e6;
const fmt = (b) => b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(0)} KB`;

// ---- A: measured, this box -------------------------------------------------
const byJob = new Map();
for (const s of sockets.values()) {
  const d = Math.max(0, s.last - s.first);
  const info = pidInfo.get(s.pid) || {};
  let job = jobOf(info.cmd);
  if (job === '?' || /^node$|^node \S*$/.test(job)) job = `${jobOf(info.ppidCmd)} (child)`;
  const j = byJob.get(job) || { bytes: 0, pids: new Set(), unit: info.unit };
  j.bytes += d; j.pids.add(s.pid);
  byJob.set(job, j);
}
// ports per job for shape join
const jobPorts = new Map();
const portBytes = new Map();
for (const [k, s] of sockets) {
  portBytes.set(Number(k.split('|')[0]), (portBytes.get(Number(k.split('|')[0])) || 0) + Math.max(0, s.last - s.first));
  const lport = Number(k.split('|')[0]);
  const info = pidInfo.get(s.pid) || {};
  let job = jobOf(info.cmd);
  if (job === '?' || /^node$|^node \S*$/.test(job)) job = `${jobOf(info.ppidCmd)} (child)`;
  if (!jobPorts.has(job)) jobPorts.set(job, new Set());
  jobPorts.get(job).add(lport);
}
const totalA = [...byJob.values()].reduce((a, j) => a + j.bytes, 0);
const rowsA = [...byJob.entries()].sort((a, b) => b[1].bytes - a[1].bytes).map(([job, j]) => {
  // Split each socket's measured bytes across the query shapes $currentOp caught on that
  // port, in proportion to sightings. Long-running ops are over-sighted, so this ranks
  // shapes within a job; it is not a per-query meter.
  const shapes = new Map();
  for (const p of jobPorts.get(job) || []) {
    const m = opShapes.get(`46.224.122.120:${p}`);
    const sockBytes = portBytes.get(p) || 0;
    if (!m) { shapes.set('(no op sighted)', (shapes.get('(no op sighted)') || 0) + sockBytes); continue; }
    const tot = [...m.values()].reduce((x, y) => x + y, 0);
    for (const [k, n] of m) shapes.set(k, (shapes.get(k) || 0) + sockBytes * n / tot);
  }
  return {
    job, bytes: j.bytes, bytesPerDay: ssHours > 0 ? j.bytes / ssHours * 24 : 0, pids: j.pids.size, unit: j.unit,
    shapes: [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${fmt(ssHours > 0 ? n / ssHours * 24 : 0)}/day  ${k}`),
  };
});

// ---- B: estimated, every client ----------------------------------------------
const sizes = SIZES && existsSync(SIZES) ? JSON.parse(readFileSync(SIZES, 'utf8')) : {};
const sizeKey = (c) => `${c.ns}|${c.orig?.projection || '-'}`;
const byClientShape = new Map();
for (const c of cursors.values()) {
  const docs = c.max - c.min;
  if (docs <= 0) continue;
  const client = c.client || (c.lsid && lsidClient.get(c.lsid)) || '?';
  const ip = client.split(':')[0];
  const k = `${hostLabel(ip)}|${c.ns}|${c.orig?.op}|${c.orig?.filter || c.orig?.pipeline || ''}|proj=${c.orig?.projection || '-'}`.slice(0, 600);
  const e = byClientShape.get(k) || { docs: 0, cursors: 0, sizeKey: sizeKey(c), host: hostLabel(ip), ports: new Set() };
  e.docs += docs; e.cursors++; if (ip === '46.224.122.120') e.ports.add(Number(client.split(':')[1]));
  byClientShape.set(k, e);
}
const rowsB = [...byClientShape.entries()].map(([k, e]) => {
  const avg = sizes[e.sizeKey];
  const bytes = avg != null ? e.docs * avg : null;
  const jobs = [...e.ports].map((p) => { const pid = portPid.get(p); return pid ? jobOf(pidInfo.get(pid)?.cmd) : null; }).filter(Boolean);
  return { key: k, host: e.host, docs: e.docs, docsPerDay: opHours > 0 ? e.docs / opHours * 24 : 0, cursors: e.cursors, avgDocBytes: avg ?? null, bytes, bytesPerDay: bytes != null && opHours > 0 ? bytes / opHours * 24 : null, sizeKey: e.sizeKey, jobs: [...new Set(jobs)] };
}).sort((a, b) => (b.bytesPerDay ?? b.docsPerDay) - (a.bytesPerDay ?? a.docsPerDay));

// ---- measure avg doc sizes for the top shapes ----------------------------------
if (MEASURE) {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI, { appName: 'atlas-egress-report', readPreference: 'secondaryPreferred', compressors: ['zlib'] });
  await c.connect();
  const out = existsSync(MEASURE) ? JSON.parse(readFileSync(MEASURE, 'utf8')) : {};
  const keys = [...new Set(rowsB.slice(0, 60).map((r) => r.sizeKey))].filter((k) => out[k] == null);
  for (const k of keys) {
    const [ns, ...rest] = k.split('|');
    const projStr = rest.join('|');
    const [dbName, ...collParts] = ns.split('.');
    const coll = collParts.join('.');
    let proj = null;
    try { proj = projStr === '-' ? null : JSON.parse(projStr); } catch { out[k] = null; continue; }
    // $bsonSize of the projected doc, over a random 300: the server does the sizing,
    // only numbers cross the wire.
    const pipe = [{ $sample: { size: 300 } }];
    if (proj && Object.keys(proj).length) pipe.push({ $project: proj });
    pipe.push({ $group: { _id: null, avg: { $avg: { $bsonSize: '$$ROOT' } }, n: { $sum: 1 } } });
    try {
      const [r] = await c.db(dbName).collection(coll).aggregate(pipe, { maxTimeMS: 60000 }).toArray();
      out[k] = r ? Math.round(r.avg) : null;
      console.error(`size ${k.slice(0, 120)} → ${out[k]}`);
    } catch (e) { console.error(`size ${k.slice(0, 120)} ERR ${e.message.slice(0, 100)}`); out[k] = null; }
  }
  writeFileSync(MEASURE, JSON.stringify(out, null, 1));
  await c.close();
  console.error(`wrote ${MEASURE}; re-run with --sizes ${MEASURE}`);
}

// ---- print -------------------------------------------------------------------
console.log(`window: ss ${new Date(firstSsT).toISOString()} → ${new Date(lastSsT).toISOString()} (${ssHours.toFixed(2)} h, ${ssSamples} samples); ops ${opHours.toFixed(2)} h, ${opSamples} node-samples`);
console.log(`\nA. hetzner-main, MEASURED wire bytes from Atlas: ${fmt(totalA)} in window ≈ ${fmt(totalA / ssHours * 24)}/day`);
for (const r of rowsA.slice(0, TOP)) {
  console.log(`  ${fmt(r.bytesPerDay).padStart(10)}/day  ${fmt(r.bytes).padStart(9)}  pids=${r.pids}  ${r.job}`);
  for (const s of r.shapes.slice(0, Number(arg('shapes', '3')))) console.log(`        ${s.slice(0, 260)}`);
}
console.log(`\nB. all clients, cursor docs (estimated bytes where --sizes known):`);
for (const r of rowsB.slice(0, TOP)) {
  console.log(`  ${(r.bytesPerDay != null ? fmt(r.bytesPerDay) + '/day' : '?').padStart(13)}  ${Math.round(r.docsPerDay).toLocaleString().padStart(11)} docs/day  avg=${r.avgDocBytes ?? '?'}B  ${r.jobs.join(',') || ''}  ${r.key.slice(0, 260)}`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ window: { firstSsT, lastSsT, ssHours, opHours }, measured: rowsA, estimated: rowsB }, null, 1));
