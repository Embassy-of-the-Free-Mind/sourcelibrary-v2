#!/usr/bin/env node
/**
 * mirror-changelog.mjs — record WHICH pages/books changed, so the nightly mirror re-reads
 * only those (#5189).
 *
 * PRIOR ART: none — `git grep -n '\.watch('` finds no change stream in scripts/ or src/.
 * scripts/workers/sync-pages-content.mjs polls `ocr.updated_at`/`translation.updated_at`,
 * which misses metadata-only writes (archived_photo, page_type, deletes) that the mirror
 * must carry.
 *
 * Why a change stream: a full `pages` walk for the mirror ships ~400 B/page with zlib —
 * ~11.5 GB of Atlas egress per night for 28.9M pages, and ~5 h of full-document reads on a
 * secondary the Vercel app also reads from. The stream, projected to ids only, measured
 * 0.3 GB/day at ~1.2M changed docs/day (2026-10-06).
 *
 * Writes, under MIRROR_DIR/changelog/:
 *   YYYY-MM-DD.ndjson   {t, c, op, id, it}  (clusterTime ISO, collection, operation, _id, _id type)
 *   state.json          resume token, covered_since, last event time, gaps[]
 * A resume that fails (oplog rolled past the token) records a GAP; export-mirror.mjs then
 * refuses the delta path for any snapshot overlapping it and walks pages in full.
 *
 * Long-running. Cron relaunches it every 5 min under `flock -n` if it has died.
 *   0-59/5 * * * * cd /root/sourcelibrary && flock -n /tmp/sl-mirror-changelog.lock node --max-old-space-size=512 --env-file=.env.production.local scripts/workers/mirror-changelog.mjs >> /var/log/sourcelibrary/mirror-changelog.log 2>&1
 *   node --env-file=.env.production.local scripts/workers/mirror-changelog.mjs
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { MIRROR_DIR } from '../lib/mirror.mjs';

const DIR = path.join(process.env.SL_MIRROR_DIR || MIRROR_DIR, 'changelog');
const STATE = path.join(DIR, 'state.json');
const COLLS = ['pages', 'books'];
const FLUSH_MS = 10_000;
const RETAIN_DAYS = 21;
fs.mkdirSync(DIR, { recursive: true });

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const readState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null);
const writeState = (s) => { fs.writeFileSync(STATE + '.tmp', JSON.stringify(s, null, 1)); fs.renameSync(STATE + '.tmp', STATE); };

const client = new MongoClient(process.env.MONGODB_URI, {
  appName: 'mirror-changelog', compressors: ['zlib'], readPreference: 'secondaryPreferred', maxPoolSize: 2,
});
await client.connect();
const db = client.db('bookstore');

let state = readState();
const pipeline = [
  { $match: { 'ns.coll': { $in: COLLS } } },
  // ids only: never fullDocument, never updateDescription (it carries the changed text).
  { $project: { operationType: 1, 'ns.coll': 1, 'documentKey._id': 1, clusterTime: 1 } },
];

function open() {
  if (state?.resume_token) {
    try { return db.watch(pipeline, { resumeAfter: state.resume_token, batchSize: 5000 }); }
    catch (e) { log(`resume failed at open: ${e.message}`); }
  }
  return null;
}

let cs = open();
// A fresh stream starts at its first getMore, not at watch(): coverage (or the end of the
// gap) is stamped after the first tryNext below.
let fresh = null;
if (!cs) {
  fresh = { hadHistory: Boolean(state?.last_event_t || state?.covered_since), from: state?.last_event_t || state?.covered_since };
  state = { ...(state || {}), resume_token: null, gaps: state?.gaps || [] };
  cs = db.watch(pipeline, { batchSize: 5000 });
}
log(`watching ${COLLS.join(',')}${fresh ? ' (fresh stream)' : ' (resuming)'}`);

let buf = [];
let lastFlush = Date.now();
let stopping = false;
const stop = () => { stopping = true; };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

function flush() {
  if (buf.length) {
    const byDay = new Map();
    for (const e of buf) { const d = e.t.slice(0, 10); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(JSON.stringify(e)); }
    for (const [d, lines] of byDay) fs.appendFileSync(path.join(DIR, `${d}.ndjson`), lines.join('\n') + '\n');
    state.last_event_t = buf[buf.length - 1].t;
    state.events = (state.events || 0) + buf.length;
    buf = [];
  }
  // The token is saved only AFTER its events are on disk: a crash replays, never skips.
  if (cs.resumeToken) state.resume_token = cs.resumeToken;
  state.heartbeat = new Date().toISOString();
  writeState(state);
  lastFlush = Date.now();
}

function prune() {
  const cutoff = new Date(Date.now() - RETAIN_DAYS * 86400_000).toISOString().slice(0, 10);
  for (const f of fs.readdirSync(DIR)) if (/^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f) && f.slice(0, 10) < cutoff) fs.rmSync(path.join(DIR, f));
}
prune();

try {
  while (!stopping) {
    const e = await cs.tryNext();
    if (fresh) {
      const at = new Date().toISOString();
      if (fresh.hadHistory) state.gaps.push({ from: fresh.from, to: at, reason: 'no usable resume token' });
      else state.covered_since = at;
      fresh = null;
      writeState(state);
      log(`stream open; covered_since ${state.covered_since}; gaps ${state.gaps.length}`);
    }
    if (e) {
      const id = e.documentKey?._id;
      const isOid = id?._bsontype === 'ObjectId';
      buf.push({
        t: new Date(e.clusterTime.getHighBitsUnsigned() * 1000).toISOString(),
        c: e.ns?.coll, op: e.operationType,
        id: isOid ? id.toHexString() : String(id), it: isOid ? 'objectId' : typeof id,
      });
      if (e.operationType === 'invalidate' || e.operationType === 'dropDatabase') {
        state.gaps = [...(state.gaps || []), { from: new Date().toISOString(), to: null, reason: e.operationType }];
        break;
      }
    }
    if (Date.now() - lastFlush > FLUSH_MS || buf.length >= 20000) flush();
    if (!e) await new Promise((r) => setTimeout(r, 500));
  }
} catch (err) {
  flush();
  // Only a lost history is a gap: the oplog has rolled past our token, so changes are
  // unrecoverable and the exporter must walk in full. Anything else (a node restarting,
  // a network blip) keeps the token, and the cron relaunch resumes without loss.
  const lost = [286, 280, 260].includes(err.code) || /ChangeStreamHistoryLost|InvalidResumeToken|ChangeStreamFatalError|resume point may no longer be in the oplog/i.test(`${err.codeName} ${err.message}`);
  log(`stream error${lost ? ' (history lost — recording a gap)' : ' (transient — token kept)'}: ${err.codeName || ''} ${err.message}`);
  if (lost) {
    state.gaps = [...(state.gaps || []), { from: state.last_event_t || state.covered_since, to: new Date().toISOString(), reason: err.codeName || err.message.slice(0, 120) }];
    state.resume_token = null;
    writeState(state);
  }
  await client.close().catch(() => {});
  process.exit(1);
}
flush();
await cs.close();
await client.close();
log('stopped');
