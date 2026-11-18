#!/usr/bin/env node
// Replay the oplog a `mongodump --oplog` captured (a .bson file written by archive-tee.py) onto a restored
// copy, with INITIAL-SYNC rules, so that the fuzzy dump plus the replay reaches the state at the dump's end.
//   node oplog-replay.mjs <oplog.bson> <uri-file> [skip-ns,...]
// prints one JSON summary line; exit 1 on an error it will not tolerate.
// Env AFTER_TS / UNTIL_TS ("<seconds>:<ordinal>"): replay only entries with AFTER_TS < ts <= UNTIL_TS. A point-in-time
// restore (pitr-restore.sh) replays the dump's own oplog whole, then PBM's oplog slices from the dump's last entry
// up to the chosen time; an entry past UNTIL_TS ends the replay.
//
// Why (#346, 2026-11-16): `mongorestore --oplogReplay` uses applyOps, which on 9.0 stops at the first update of
// a document the dump does not hold; any document updated and then deleted while the dump ran is one. Initial
// sync (and this script) tolerates exactly that: the delete comes later in the same oplog. Inserts of a
// document the dump already holds become replacements (applyOps already does that); deletes of a missing
// document are no-ops. A batch goes through applyOps; a batch that fails is applied one op at a time, and an op
// that fails is TOLERATED only if it is an update of a document that is not there (counted as `missing`).
// Duplicate-key failures (a unique key that moved between _ids during the dump) are counted as `conflicts`
// with their namespaces, and the count check after the restore decides whether they mattered.
// PRIOR ART: infrastructure/mongo-selfhost/follower/apply.mjs applies a change stream by re-reading Atlas;
// here there is no source to re-read, only the captured oplog. mongorestore's own replay is the thing that fails.
import fs from 'node:fs';
import { createRequire } from 'node:module';
// the driver lives with the follower on the box (/opt/sl-follower/node_modules); loaded in main() so the pure
// functions below can be tested without it
let MongoClient, BSON;

const [file, uriFile, skipArg = ''] = process.argv.slice(2);
const skip = new Set(skipArg.split(',').filter(Boolean));
// namespaces the replay leaves alone: the ones named (EPHEMERAL), and admin/local/config and system collections
export const skipNs = (ns, names = skip) => !ns || names.has(ns) || /^(admin|local|config)\./.test(ns) || ns.startsWith('.') || ns.includes('.system.');
// what to do with a command entry: 'skip' (two-phase index build markers), 'createIndexes' (a commit carries the
// specs, as mongorestore does), or 'applyOps'
export function commandAction(op) {
  const verb = Object.keys(op.o || {})[0];
  if (verb === 'startIndexBuild' || verb === 'abortIndexBuild') return 'skip';
  if (verb === 'commitIndexBuild') return 'createIndexes';
  return 'applyOps';
}
const BATCH = 500;
// "<t>:<i>" -> [t, i]; a Timestamp -> [t, i]
export const parseTs = (x) => { if (!x) return null; const [t, i = '0'] = String(x).split(':'); const r = [Number(t), Number(i)]; if (!(r[0] > 0) || !(r[1] >= 0)) throw new Error(`bad timestamp ${x} (want <seconds>:<ordinal>)`); return r; };
const tsPair = (ts) => [ts.t ?? ts.getHighBits() >>> 0, ts.i ?? ts.getLowBits() >>> 0];
const cmpTs = (a, b) => (a[0] - b[0]) || (a[1] - b[1]);
// 'before' (at or before AFTER_TS: skip), 'in', or 'past' (after UNTIL_TS: stop)
export function tsWindow(ts, after, until) {
  const p = Array.isArray(ts) ? ts : tsPair(ts);
  if (after && cmpTs(p, after) <= 0) return 'before';
  if (until && cmpTs(p, until) > 0) return 'past';
  return 'in';
}

// one oplog entry may be a transaction (applyOps inside a command): flatten it, keeping order
export function flatten(e) {
  if (e.op === 'c' && e.o && Array.isArray(e.o.applyOps)) return e.o.applyOps.flatMap(flatten);
  return [e];
}
// the fields applyOps accepts; session and transaction fields must go
export function clean(e) {
  const o = { op: e.op, ns: e.ns, o: e.o };
  if (e.o2 !== undefined) o.o2 = e.o2;
  // no `ui`: mongorestore gives the restored collections new UUIDs, and an op naming the old one fails
  return o;
}
// stream the file: it can be several GB
function* entries(path) {
  const fd = fs.openSync(path, 'r');
  let buf = Buffer.alloc(0), pos = 0;
  const chunk = Buffer.alloc(16 << 20);
  for (;;) {
    while (buf.length - pos >= 4 && buf.length - pos >= buf.readInt32LE(pos)) {
      const n = buf.readInt32LE(pos);
      if (n < 5) throw new Error(`corrupt oplog file (length ${n})`);
      yield BSON.deserialize(buf.subarray(pos, pos + n), { promoteValues: false, promoteBuffers: false });
      pos += n;
    }
    const got = fs.readSync(fd, chunk, 0, chunk.length, null);
    if (!got) break;
    buf = Buffer.concat([buf.subarray(pos), chunk.subarray(0, got)]); pos = 0;
  }
  fs.closeSync(fd);
  if (buf.length - pos) throw new Error(`oplog file ends inside an entry (${buf.length - pos} bytes left)`);
}

async function main() {
  if (!file || !uriFile) { console.error('usage: oplog-replay.mjs <oplog.bson> <uri-file> [skip-ns,...]'); process.exit(2); }
  ({ MongoClient, BSON } = createRequire((process.env.SL_FOLLOWER_DIR || '/opt/sl-follower') + '/package.json')('mongodb'));
  const client = new MongoClient(fs.readFileSync(uriFile, 'utf8').trim(), { retryWrites: false });
  await client.connect();
  const admin = client.db('admin');
  const after = parseTs(process.env.AFTER_TS), until = parseTs(process.env.UNTIL_TS);
  const s = { entries: 0, applied: 0, skipped: 0, missing: 0, conflicts: 0, conflict_ns: {}, commands: 0, first: null, last: null, before_window: 0, stopped_at_until: false };
  const one = async (op) => {
    try { await admin.command({ applyOps: [op] }); s.applied++; return; } catch (err) {
      const i = op.ns.indexOf('.');
      const coll = client.db(op.ns.slice(0, i)).collection(op.ns.slice(i + 1));
      const id = op.op === 'u' ? op.o2 && op.o2._id : op.o && op.o._id;
      if (op.op === 'u' && id !== undefined && !(await coll.findOne({ _id: id }, { projection: { _id: 1 } }))) { s.missing++; return; }
      if (/E11000|duplicate key/i.test(String(err.message) + JSON.stringify(err.errorResponse || {}))
          || ((op.op === 'i' || op.op === 'u') && id !== undefined)) {
        // applyOps reports a duplicate key only as "one or more errors"; an i/u on a present document that
        // still fails is a constraint failure: count it, and let the count check judge
        s.conflicts++; s.conflict_ns[op.ns] = (s.conflict_ns[op.ns] || 0) + 1; return;
      }
      throw new Error(`${op.op} on ${op.ns} failed: ${err.message}`);
    }
  };
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    try { const r = await admin.command({ applyOps: batch }); s.applied += r.applied ?? batch.length; }
    catch { for (const op of batch) await one(op); }
    batch = [];
  };
  for (const e of entries(file)) {
    const w = tsWindow(e.ts, after, until);
    if (w === 'before') { s.before_window++; continue; }
    if (w === 'past') { s.stopped_at_until = true; break; }
    s.entries++;
    s.first ??= e.ts; s.last = e.ts;
    for (const op of flatten(e)) {
      if (op.op === 'n' || skipNs(op.ns)) { s.skipped++; continue; }
      if (op.op === 'c') {
        // a DDL command (create, drop, createIndexes, collMod, rename...): apply alone, in order
        await flush(); s.commands++;
        const action = commandAction(op);
        if (action === 'skip') { s.skipped++; continue; }
        try {
          if (action === 'createIndexes') await client.db(op.ns.split('.')[0]).command({ createIndexes: op.o.commitIndexBuild, indexes: op.o.indexes });
          else await admin.command({ applyOps: [clean(op)] });
          s.applied++;
        }
        catch (err) { if (!/NamespaceExists|NamespaceNotFound|already exists|ns not found|IndexNotFound/i.test(err.message)) throw new Error(`command on ${op.ns} failed: ${err.message} ${JSON.stringify(op.o).slice(0, 200)}`); s.skipped++; }
        continue;
      }
      batch.push(clean(op));
      if (batch.length >= BATCH) await flush();
    }
  }
  await flush();
  await client.close();
  // "<t>:<i>", the form AFTER_TS/UNTIL_TS take (a bson Timestamp's toString is one 64-bit number)
  s.first = s.first && tsPair(s.first).join(':'); s.last = s.last && tsPair(s.last).join(':');
  console.log(JSON.stringify(s));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
