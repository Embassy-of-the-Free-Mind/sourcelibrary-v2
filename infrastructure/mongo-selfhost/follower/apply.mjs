#!/usr/bin/env node
// Follower, half 2: read the journal the recorder writes and make the local `bookstore` match Atlas.
//
// PRIOR ART: scripts/workers/mirror-changelog.mjs (resume/gap pattern; it records, never applies);
// none applies change events to a second database — `git grep -n "replaceOne(.*upsert" scripts/`
// finds only single-document fixes.
//
// For each batch of journal lines (see lib.mjs, planSteps): every data event folds into "sync these
// _ids" per collection; every DDL event is a barrier applied in order. A sync reads the current
// documents from Atlas by _id (secondaryPreferred, causally after the newest event in the batch, at
// most FETCH_CONCURRENCY reads at once) and replaces the local copies or deletes the ones Atlas no
// longer has. Position is saved only after a batch is fully applied: a crash replays, never skips.
//
// Env: ATLAS_URI_FILE (/etc/sl-mongo/atlas.uri), LOCAL_PW_FILE (/etc/sl-mongo/follower.pw), LOCAL_HOST (127.0.0.1:27017), LOCAL_USER (follower),
//      LOCAL_REPLSET (rs0 once the set has several members; LOCAL_HOST is then the seed list),
//      JOURNAL_DIR (/var/lib/sl-follower/journal), STATE_DIR (/var/lib/sl-follower)
// Exit 2 = stopped on an event it must not guess at (state.stopped_reason says which). The unit does
// not restart on 2; the alarm pages.
import { MongoClient, BSON } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { decodeLine, planSteps, syncDecision, keyOf, lagSummary, completeLines, duplicateKeyFilter } from './lib.mjs';

const { EJSON } = BSON;
const JOURNAL_DIR = process.env.JOURNAL_DIR || '/var/lib/sl-follower/journal';
const STATE_DIR = process.env.STATE_DIR || '/var/lib/sl-follower';
const REPAIR_DIR = path.join(STATE_DIR, 'repair');
const STATE = path.join(STATE_DIR, 'apply-state.json');
const ALERTS = path.join(STATE_DIR, 'alerts.ndjson');
const MAX_EVENTS = Number(process.env.MAX_EVENTS || 20000);
const CHUNK = 500;
const FETCH_CONCURRENCY = Math.min(4, Number(process.env.FETCH_CONCURRENCY || 4));
const PRUNE_DAYS = Number(process.env.JOURNAL_KEEP_DAYS || 3);
for (const d of [STATE_DIR, REPAIR_DIR]) fs.mkdirSync(d, { recursive: true });

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const readJson = (f, dflt) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : dflt);
const writeJson = (f, s) => { fs.writeFileSync(f + '.tmp', JSON.stringify(s)); fs.renameSync(f + '.tmp', f); };
const alert = (level, reason, extra = {}) => { fs.appendFileSync(ALERTS, JSON.stringify({ at: new Date().toISOString(), level, reason, ...extra }) + '\n'); log(level.toUpperCase(), reason); };

const atlasUri = fs.readFileSync(process.env.ATLAS_URI_FILE || '/etc/sl-mongo/atlas.uri', 'utf8').trim();
const localPw = fs.readFileSync(process.env.LOCAL_PW_FILE || '/etc/sl-mongo/follower.pw', 'utf8').trim();
const atlas = new MongoClient(atlasUri, { appName: 'sl-follower-apply', compressors: ['zlib'], readPreference: 'secondaryPreferred', maxPoolSize: FETCH_CONCURRENCY });
const LOCAL_HOST = process.env.LOCAL_HOST || '127.0.0.1:27017';
const LOCAL_USER = process.env.LOCAL_USER || 'follower';
// LOCAL_REPLSET set (a multi-member set): connect to the set, so writes follow the primary wherever it is;
// LOCAL_HOST is then a seed list. Unset: this box's member directly (a one-member set).
const LOCAL_REPLSET = process.env.LOCAL_REPLSET || '';
const local = new MongoClient(`mongodb://${LOCAL_USER}:${encodeURIComponent(localPw)}@${LOCAL_HOST}/?authSource=admin&${LOCAL_REPLSET ? `replicaSet=${LOCAL_REPLSET}` : 'directConnection=true'}`, { appName: 'sl-follower-apply', maxPoolSize: 8 });
await atlas.connect();
await local.connect();
const adb = atlas.db('bookstore');
const ldb = local.db('bookstore');

let state = readJson(STATE, { file: null, offset: 0, events: 0, batches: 0, deferred: {} });
if (state.stopped_reason) { log('stopped earlier:', state.stopped_reason, '— clear stopped_reason in', STATE, 'after fixing'); process.exit(2); }
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const collExistsCache = new Map();
async function atlasHasCollection(coll) {
  if (collExistsCache.has(coll)) return collExistsCache.get(coll);
  const r = (await adb.listCollections({ name: coll }, { nameOnly: true }).toArray()).length > 0;
  collExistsCache.set(coll, r);
  return r;
}

/** Read current docs from Atlas, causally after (t,i), so a lagging secondary cannot hand back an older version. */
async function fetchCurrent(coll, ids, t, i) {
  const chunks = [];
  for (let k = 0; k < ids.length; k += CHUNK) chunks.push(ids.slice(k, k + CHUNK));
  const parts = await pool(chunks, FETCH_CONCURRENCY, async (chunk) => {
    const session = atlas.startSession({ causalConsistency: true });
    try {
      session.advanceOperationTime(new BSON.Timestamp({ t, i }));
      // 175 QueryPlanKilled: Atlas renamed or dropped the collection while we read it (2026-11-17 03:46Z, a
      // `_next` -> live rename). Read again: the ids are then simply missing and wait for the DDL event.
      for (let attempt = 0; ; attempt++) {
        try {
          return await adb.collection(coll).find({ _id: { $in: chunk } }, { session, readConcern: { level: 'majority' }, readPreference: 'secondaryPreferred', batchSize: CHUNK }).toArray();
        } catch (err) {
          if (err.code !== 175 || attempt >= 2) throw err;
          log(`${coll}: read killed by a concurrent rename/drop on Atlas; reading again`);
        }
      }
    } finally { await session.endSession(); }
  });
  return parts.flat();
}

/** Apply replaces/deletes; resolve unique-key conflicts by re-syncing the local document that holds the key. */
async function writeLocal(coll, decision, t, i, round = 0) {
  const ops = [
    ...decision.replace.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
    ...decision.delete.map((id) => ({ deleteOne: { filter: { _id: id } } })),
  ];
  if (!ops.length) return;
  try {
    await ldb.collection(coll).bulkWrite(ops, { ordered: false });
  } catch (err) {
    const errs = err.writeErrors ? (Array.isArray(err.writeErrors) ? err.writeErrors : Object.values(err.writeErrors)) : null;
    if (!errs) throw err;
    const dup = errs.filter((w) => w.code === 11000);
    if (dup.length !== errs.length) throw err;
    if (round >= 4) throw new Error(`${coll}: unique-key conflicts did not settle after ${round} rounds (${dup.length} left)`);
    const failed = dup.map((w) => ops[w.index].replaceOne.replacement);
    const holders = [];
    const specs = await ldb.collection(coll).indexes();
    for (const w of dup) {
      const doc = ops[w.index].replaceOne.replacement;
      const filter = duplicateKeyFilter(w.errmsg || w.err?.errmsg || '', specs, doc);
      if (!filter) throw err;
      const h = await ldb.collection(coll).find({ ...filter, _id: { $ne: doc._id } }, { projection: { _id: 1 } }).toArray();
      holders.push(...h.map((x) => x._id));
    }
    // The local holders are stale (Atlas allows the key on `doc`, so the holder has moved on or gone).
    // Two documents can swap a key, so re-syncing the holders first would collide forever: take the
    // holders out, write the failed documents, then write the holders back from Atlas's current copy.
    const holderDocs = holders.length ? await fetchCurrent(coll, holders, t, i) : [];
    log(`${coll}: ${dup.length} unique-key conflicts; rewriting ${holders.length} local holders (round ${round + 1})`);
    if (holders.length) await ldb.collection(coll).deleteMany({ _id: { $in: holders } });
    const byId = new Map();
    for (const d of [...failed, ...holderDocs]) byId.set(keyOf(d._id), d);
    await writeLocal(coll, { replace: [...byId.values()], delete: [] }, t, i, round + 1);
  }
}

// Fetch and write in slices, so memory holds at most SLICE documents (a 20,000-id batch of chapter_texts ran a
// 2 GB heap out on 2026-11-16).
const SLICE = CHUNK * FETCH_CONCURRENCY;
async function syncIds(coll, ids, t, i, round = 0) {
  for (let k = 0; k < ids.length; k += SLICE) await syncSlice(coll, ids.slice(k, k + SLICE), t, i, round);
}
async function syncSlice(coll, ids, t, i, round) {
  if (!ids.length) return;
  const docs = await fetchCurrent(coll, ids, t, i);
  const has = docs.length === ids.length ? true : await atlasHasCollection(coll);
  const d = syncDecision(ids, docs, has);
  if (d.deferred.length) {
    const cur = state.deferred[coll] || [];
    state.deferred[coll] = [...cur, ...d.deferred.map((x) => EJSON.serialize({ v: x }, { relaxed: false }).v)];
    log(`${coll}: collection missing on Atlas; ${d.deferred.length} ids wait for the DDL event that explains it`);
  }
  await writeLocal(coll, d, t, i, round);
}

async function runDdl(step) {
  const { action, event } = step;
  if (action.type === 'skip') return;
  if (action.type === 'alarm') { alert('warn', action.reason, { op: event.op, c: event.c }); return; }
  if (action.type === 'stop') { alert('stop', action.reason, { op: event.op, c: event.c }); state.stopped_reason = action.reason; return 'stop'; }
  const target = action.admin ? local.db('admin') : ldb;
  try {
    await target.command(action.command);
    log('ddl', event.op, event.c, JSON.stringify(action.command).slice(0, 200));
  } catch (err) {
    if (action.ignore?.includes(err.code)) { log('ddl already so', event.op, event.c, err.codeName); }
    else if (event.op === 'createIndexes' && (err.code === 85 || err.code === 86)) {
      alert('warn', `createIndexes on ${event.c} conflicts with a local index: ${err.message.slice(0, 200)}`, { op: event.op, c: event.c });
    } else {
      alert('stop', `DDL ${event.op} on ${event.c} failed: ${err.codeName || ''} ${err.message.slice(0, 200)}`, { op: event.op, c: event.c });
      state.stopped_reason = `DDL ${event.op} on ${event.c} failed`;
      return 'stop';
    }
  }
  collExistsCache.clear();
  if (action.retarget) {
    const moved = state.deferred[action.retarget.from];
    if (moved?.length) { state.deferred[action.retarget.to] = [...(state.deferred[action.retarget.to] || []), ...moved]; }
    delete state.deferred[action.retarget.from];
  }
  if (event.op === 'drop') delete state.deferred[event.c];
}

async function flushDeferred(t, i) {
  for (const coll of Object.keys(state.deferred)) {
    if (!(await atlasHasCollection(coll))) continue;
    const ids = state.deferred[coll].map((v) => EJSON.deserialize({ v }, { relaxed: false }).v);
    delete state.deferred[coll];
    await syncIds(coll, ids, t, i);
  }
}

async function applyEvents(events, source) {
  const steps = planSteps(events);
  const lags = [];
  let last = null;
  for (const step of steps) {
    if (step.kind === 'sync') {
      await syncIds(step.coll, step.ids, step.maxT, step.maxI);
      const now = Date.now() / 1000;
      for (const tt of step.times) lags.push(now - tt);
      last = [step.maxT, step.maxI];
    } else {
      if ((await runDdl(step)) === 'stop') return 'stop';
      last = [step.event.t, step.event.i];
    }
  }
  if (Object.keys(state.deferred).length && last) await flushDeferred(last[0], last[1]);
  const lag = lagSummary(lags);
  if (lag && source === 'journal') {
    const day = new Date().toISOString().slice(0, 10);
    // a sample of per-event lags, so a day's p50/p95 can be computed later without storing every event
    const sample = lags.length > 200 ? Array.from({ length: 200 }, (_, k) => lags[Math.floor((k * lags.length) / 200)]) : lags;
    fs.appendFileSync(path.join(STATE_DIR, `lag-${day}.ndjson`), JSON.stringify({ at: new Date().toISOString(), ...lag, sample: sample.map((x) => Math.round(x * 10) / 10) }) + '\n');
    state.last_batch_lag = lag;
  }
  return last;
}

function journalFiles() {
  return fs.readdirSync(JOURNAL_DIR).filter((f) => /^journal-\d{10}\.ndjson$/.test(f)).sort();
}

function prune() {
  const cutoff = Date.now() - PRUNE_DAYS * 86400_000;
  for (const f of journalFiles()) {
    if (f >= (state.file || '')) break;
    const full = path.join(JOURNAL_DIR, f);
    if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full);
  }
}

async function processRepairs() {
  for (const f of fs.readdirSync(REPAIR_DIR).filter((x) => x.endsWith('.ndjson')).sort()) {
    const full = path.join(REPAIR_DIR, f);
    const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
    log(`repair file ${f}: ${lines.length} ids`);
    for (let k = 0; k < lines.length; k += MAX_EVENTS) {
      const r = await applyEvents(lines.slice(k, k + MAX_EVENTS).map(decodeLine), 'repair');
      if (r === 'stop') return 'stop';
    }
    fs.renameSync(full, full + '.done');
  }
}

let lastPrune = 0;
while (!stopping) {
  if ((await processRepairs()) === 'stop') break;
  const files = journalFiles();
  if (!files.length) { await new Promise((r) => setTimeout(r, 2000)); continue; }
  if (!state.file || !files.includes(state.file)) {
    if (state.file && state.file > files[files.length - 1]) throw new Error(`journal position ${state.file} is past every journal file`);
    const next = files.find((f) => !state.file || f > state.file);
    state.file = next; state.offset = 0;
  }
  const full = path.join(JOURNAL_DIR, state.file);
  const size = fs.statSync(full).size;
  let events = [];
  let consumed = 0;
  if (size > state.offset) {
    const fd = fs.openSync(full, 'r');
    const len = Math.min(size - state.offset, 16 * 1024 * 1024);
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, state.offset);
    fs.closeSync(fd);
    const { lines } = completeLines(b.toString('utf8'));
    const take = lines.slice(0, MAX_EVENTS);
    consumed = take.reduce((s, l) => s + Buffer.byteLength(l) + 1, 0);
    events = take.map(decodeLine);
  }
  if (!events.length) {
    const later = files.find((f) => f > state.file);
    if (later && size <= state.offset) { state.file = later; state.offset = 0; writeJson(STATE, state); continue; }
    state.behind_s = 0;
    state.heartbeat = new Date().toISOString();
    writeJson(STATE, state);
    if (Date.now() - lastPrune > 3600_000) { prune(); lastPrune = Date.now(); }
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }
  state.behind_s = Math.round(Date.now() / 1000 - events[0].t);
  const r = await applyEvents(events, 'journal');
  if (r === 'stop') { writeJson(STATE, state); break; }
  state.offset += consumed;
  state.events += events.length;
  state.batches += 1;
  if (r) { state.applied_t = r[0]; state.applied_i = r[1]; state.applied_through = new Date(r[0] * 1000).toISOString(); }
  state.heartbeat = new Date().toISOString();
  writeJson(STATE, state);
  if (state.batches % 50 === 0) log(`applied ${state.events} events; through ${state.applied_through}; behind ${state.behind_s}s; lag p50 ${state.last_batch_lag?.p50?.toFixed(1)}s`);
}
await atlas.close();
await local.close();
process.exit(state.stopped_reason ? 2 : 0);
