// Follower event handling, pure functions only (tested in tests/mongo-selfhost-follower.test.ts).
//
// PRIOR ART: scripts/workers/mirror-changelog.mjs — the resume-token / gap / relaunch pattern this
// follower reuses. It records ids for two collections into a changelog; it does not apply anything,
// handle DDL, or cover the whole database, so it cannot be the follower itself.
//
// Model. The recorder writes one journal line per change event: the event's cluster time, operation,
// collection and document _id (never the document or the update description). The applier reads the
// journal in order and, for every run of data events between two DDL events, syncs each touched _id to
// Atlas's CURRENT state: it reads the document from Atlas by _id and replaces the local copy, or deletes
// the local copy when Atlas no longer has it. That makes replay idempotent and order-free inside a run,
// so replaying a journal twice, or from a point before a dump was taken, converges on Atlas's state.
import { BSON } from 'mongodb';

const { EJSON } = BSON;

export const DATA_OPS = new Set(['insert', 'update', 'replace', 'delete', 'resync']);

/** Parse one journal line. `resync` is a synthetic event written by a gap repair (same shape). */
export function decodeLine(line) {
  const r = JSON.parse(line);
  return {
    t: r.ts[0], i: r.ts[1], op: r.op, c: r.c ?? null,
    id: r.k === undefined ? undefined : EJSON.deserialize({ v: r.k }, { relaxed: false }).v,
    key: r.k === undefined ? undefined : JSON.stringify(r.k),
    to: r.to ?? null,
    od: r.od === undefined ? undefined : EJSON.deserialize(r.od, { relaxed: true }),
    tok: r.tok,
  };
}

/** Collections the follower never writes. */
export function ignoredCollection(c) {
  return !c || c.startsWith('system.');
}

/**
 * What to do with a non-data event. Returns one of:
 *  { type: 'command', command }                 run on the local bookstore db; `ignore` lists error codes that mean "already so"
 *  { type: 'skip', reason }                     nothing to do
 *  { type: 'alarm', reason }                    page, keep going (we cannot mirror it, but the data stays right)
 *  { type: 'stop', reason }                     page and stop the applier: going on could be wrong
 */
export function ddlAction(e, db = 'bookstore') {
  const od = e.od || {};
  switch (e.op) {
    case 'create': {
      if (ignoredCollection(e.c)) return { type: 'skip', reason: 'system collection' };
      const { idIndex, ...opts } = od;
      const command = { create: e.c, ...opts };
      if (idIndex && !opts.viewOn) command.idIndex = idIndex;
      return { type: 'command', command, ignore: [48] }; // NamespaceExists
    }
    case 'createIndexes':
      if (!Array.isArray(od.indexes) || !od.indexes.length) return { type: 'alarm', reason: `createIndexes on ${e.c} without index specs` };
      return { type: 'command', command: { createIndexes: e.c, indexes: od.indexes.map(stripIndexSpec) }, ignore: [] };
    case 'dropIndexes':
      if (!Array.isArray(od.indexes) || !od.indexes.length) return { type: 'alarm', reason: `dropIndexes on ${e.c} without index specs` };
      return { type: 'command', command: { dropIndexes: e.c, index: od.indexes.map((x) => x.name) }, ignore: [26, 27] };
    case 'drop':
      return { type: 'command', command: { drop: e.c }, ignore: [26] }; // NamespaceNotFound
    case 'rename': {
      const to = od.to || e.to;
      if (!to?.coll) return { type: 'stop', reason: `rename of ${e.c} without a target` };
      if (to.db !== db) return { type: 'stop', reason: `rename of ${e.c} out of ${db} to ${to.db}.${to.coll}` };
      return { type: 'command', admin: true, command: { renameCollection: `${db}.${e.c}`, to: `${db}.${to.coll}`, dropTarget: Boolean(od.dropTarget) }, ignore: [], retarget: { from: e.c, to: to.coll } };
    }
    case 'modify': {
      const { stateBeforeChange, ...change } = od;
      if (!Object.keys(change).length) return { type: 'skip', reason: 'modify without a change' };
      return { type: 'command', command: { collMod: e.c, ...change }, ignore: [] };
    }
    case 'createSearchIndexes':
    case 'updateSearchIndex':
    case 'dropSearchIndex':
      return { type: 'alarm', reason: `${e.op} on ${e.c} in Atlas: mirror it on mongot by hand (infrastructure/mongo-selfhost/README.md, Search)` };
    case 'shardCollection':
    case 'reshardCollection':
    case 'refineCollectionShardKey':
      return { type: 'alarm', reason: `${e.op} on ${e.c}: sharding is not mirrored (one replica set here)` };
    case 'dropDatabase':
    case 'invalidate':
      return { type: 'stop', reason: `${e.op}: the follower will not drop the local database by itself` };
    default:
      return { type: 'stop', reason: `unknown change event ${e.op} on ${e.c}` };
  }
}

/** Index specs from a createIndexes event, minus `v` and `ns`, which the server sets itself. */
export function stripIndexSpec(spec) {
  const { v, ns, ...rest } = spec;
  return rest;
}

/**
 * Turn a run of decoded events into ordered steps. Data events between two DDL events fold into one
 * `sync` step per collection (deduped by _id, tracking the latest cluster time); every DDL event is its
 * own step and a barrier, so a sync never crosses a drop, rename or index change.
 */
export function planSteps(events) {
  const steps = [];
  let pending = new Map(); // coll -> { ids: Map(key -> id), maxT, maxI, n }
  const flushPending = () => {
    for (const [coll, p] of pending) steps.push({ kind: 'sync', coll, ids: [...p.ids.values()], maxT: p.maxT, maxI: p.maxI, events: p.n, times: p.times });
    pending = new Map();
  };
  for (const e of events) {
    if (DATA_OPS.has(e.op)) {
      if (ignoredCollection(e.c) || e.id === undefined) continue;
      let p = pending.get(e.c);
      if (!p) { p = { ids: new Map(), maxT: 0, maxI: 0, n: 0, times: [] }; pending.set(e.c, p); }
      p.ids.set(e.key, e.id);
      if (e.t > p.maxT || (e.t === p.maxT && e.i > p.maxI)) { p.maxT = e.t; p.maxI = e.i; }
      p.n += 1;
      p.times.push(e.t);
    } else {
      flushPending();
      steps.push({ kind: 'ddl', event: e, action: ddlAction(e) });
    }
  }
  flushPending();
  return steps;
}

/**
 * Given the ids a sync step asked for and what Atlas returned, decide the local writes.
 * `atlasHasCollection` false means the collection is gone on Atlas (dropped or renamed later in the
 * journal): then a missing document is NOT a delete; it waits for the DDL event that explains it.
 */
export function syncDecision(ids, foundDocs, atlasHasCollection) {
  const found = new Map(foundDocs.map((d) => [keyOf(d._id), d]));
  const replace = [];
  const del = [];
  const deferred = [];
  for (const id of ids) {
    const d = found.get(keyOf(id));
    if (d) replace.push(d);
    else if (atlasHasCollection) del.push(id);
    else deferred.push(id);
  }
  return { replace, delete: del, deferred };
}

export function keyOf(id) {
  return JSON.stringify(EJSON.serialize({ v: id }, { relaxed: false }).v);
}

/** Lag summary over a list of seconds (p50, p95, max), for the lag log and the report. */
export function lagSummary(seconds) {
  if (!seconds.length) return null;
  const s = [...seconds].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return { n: s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] };
}

/** Split a journal buffer into complete lines plus the unconsumed tail (a line still being written). */
export function completeLines(text) {
  const end = text.lastIndexOf('\n');
  if (end < 0) return { lines: [], consumed: 0 };
  return { lines: text.slice(0, end).split('\n').filter(Boolean), consumed: Buffer.byteLength(text.slice(0, end + 1)) };
}

/**
 * A replace failed with E11000: build the filter that finds the LOCAL document holding the same key,
 * from the index named in the error message and the values in the document we tried to write.
 * Returns null when the index cannot be identified (the caller then fails loudly).
 */
export function duplicateKeyFilter(errmsg, indexSpecs, doc) {
  const m = /index: (\S+) dup key/.exec(errmsg || '');
  if (!m) return null;
  const spec = indexSpecs.find((s) => s.name === m[1]);
  if (!spec) return null;
  const filter = {};
  for (const field of Object.keys(spec.key)) {
    const v = field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
    filter[field] = v === undefined ? null : v;
  }
  return filter;
}
