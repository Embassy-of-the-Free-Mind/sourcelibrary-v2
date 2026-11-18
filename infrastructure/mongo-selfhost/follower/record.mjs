#!/usr/bin/env node
// Follower, half 1: hold ONE change stream on Atlas's `bookstore` database and append each event to
// the on-disk journal (ids and DDL only; never documents, never update descriptions).
//
// PRIOR ART: scripts/workers/mirror-changelog.mjs — same resume-token-after-write and gap rule; that
// script covers two collections and records no DDL, so it cannot feed a full mirror.
//
// Env (systemd unit sl-follower-record.service):
//   ATLAS_URI_FILE   file holding the Atlas connection string (mode 600)          default /etc/sl-mongo/atlas.uri
//   JOURNAL_DIR      journal directory                                            default /var/lib/sl-follower/journal
//   START_AT         ISO time to start a FRESH stream from (only when no state exists; must be inside the oplog window)
// Exit 3 = history lost (the oplog rolled past our resume token). The unit does not restart on 3: a gap
// needs a human (README, "Gap"). Any other exit restarts and resumes from the saved token.
import { MongoClient, Timestamp, BSON } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const { EJSON } = BSON;
const DIR = process.env.JOURNAL_DIR || '/var/lib/sl-follower/journal';
const STATE = path.join(DIR, 'recorder-state.json');
fs.mkdirSync(DIR, { recursive: true });
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
const readState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null);
const writeState = (s) => { fs.writeFileSync(STATE + '.tmp', JSON.stringify(s)); fs.renameSync(STATE + '.tmp', STATE); };

const uri = fs.readFileSync(process.env.ATLAS_URI_FILE || '/etc/sl-mongo/atlas.uri', 'utf8').trim();
const client = new MongoClient(uri, { appName: 'sl-follower-record', compressors: ['zlib'], readPreference: 'secondaryPreferred', maxPoolSize: 1 });
await client.connect();
const db = client.db('bookstore');
const pipeline = [{ $project: { operationType: 1, ns: 1, to: 1, documentKey: 1, clusterTime: 1, operationDescription: 1 } }];

let state = readState() || { events: 0, gaps: [] };
if (state.gap_open) { log('a gap is recorded and not yet repaired; refusing to start (README, "Gap")'); process.exit(3); }
let cs;
if (state.resume_token) {
  cs = db.watch(pipeline, { resumeAfter: EJSON.deserialize(state.resume_token), showExpandedEvents: true, batchSize: 5000 });
  log('resuming after saved token; last event', state.last_event_t);
} else {
  if (!process.env.START_AT) { log('no saved token and no START_AT: refusing to start a stream from "now" silently'); process.exit(3); }
  const t = Math.floor(new Date(process.env.START_AT).getTime() / 1000);
  state.started_at_op_time = new Date(t * 1000).toISOString();
  cs = db.watch(pipeline, { startAtOperationTime: new Timestamp({ t, i: 0 }), showExpandedEvents: true, batchSize: 5000 });
  log('fresh stream from', state.started_at_op_time);
}

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
let buf = [];
let lastFlush = Date.now();
const out = () => path.join(DIR, `journal-${new Date().toISOString().slice(0, 13).replace(/[-T:]/g, '')}.ndjson`);
function flush() {
  if (buf.length) { fs.appendFileSync(out(), buf.join('\n') + '\n'); state.events += buf.length; buf = []; }
  // Saved only AFTER its events are on disk: a crash replays, never skips.
  if (cs.resumeToken) state.resume_token = EJSON.serialize(cs.resumeToken);
  state.heartbeat = new Date().toISOString();
  writeState(state);
  lastFlush = Date.now();
}

try {
  while (!stopping) {
    const e = await cs.tryNext();
    if (e) {
      const rec = { ts: [e.clusterTime.getHighBitsUnsigned(), e.clusterTime.getLowBitsUnsigned()], op: e.operationType, c: e.ns?.coll };
      if (e.documentKey) rec.k = EJSON.serialize({ v: e.documentKey._id ?? null }, { relaxed: false }).v;
      if (e.to) rec.to = e.to;
      if (e.operationDescription) rec.od = EJSON.serialize(e.operationDescription, { relaxed: false });
      rec.tok = e._id?._data;
      buf.push(JSON.stringify(rec));
      state.last_event_t = new Date(rec.ts[0] * 1000).toISOString();
    }
    if (Date.now() - lastFlush > 2000 || buf.length >= 5000) flush();
    if (!e) await new Promise((r) => setTimeout(r, 300));
  }
} catch (err) {
  flush();
  const lost = [286, 280, 260].includes(err.code) || /ChangeStreamHistoryLost|InvalidResumeToken|ChangeStreamFatalError|resume point may no longer be in the oplog/i.test(`${err.codeName} ${err.message}`);
  log(`stream error${lost ? ' (HISTORY LOST: recording a gap)' : ' (transient: token kept)'}: ${err.codeName || ''} ${err.message}`);
  if (lost) {
    state.gaps = [...(state.gaps || []), { from: state.last_event_t, at: new Date().toISOString(), reason: err.codeName || err.message.slice(0, 120) }];
    state.gap_open = true;
    writeState(state);
  }
  await client.close().catch(() => {});
  process.exit(lost ? 3 : 1);
}
flush();
await cs.close();
await client.close();
log('stopped');
