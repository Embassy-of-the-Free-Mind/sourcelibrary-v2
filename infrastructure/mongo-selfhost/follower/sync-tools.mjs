#!/usr/bin/env node
// Convergence check and gap repair for the follower (#346). Runs on the database box.
//
// PRIOR ART: scripts/workers/mirror-changelog.mjs (ids of changed pages/books; stopped 2026-10-30, so it
// cannot close a gap today); scripts/audit/* compare Atlas with itself, never with a second server.
//
//   node sync-tools.mjs verify [--colls a,b] [--sample 1000] [--out report.json]
//       For every collection: collection options, counts, index lists (TTL included), an _id-bucket count
//       diff, and a field-for-field comparison of a random sample (every document under 10,000).
//       Differences are re-checked after RECHECK_S seconds; only the ones still there are reported as
//       persistent (lag explains the rest).
//   node sync-tools.mjs gap-repair --since ISO [--dry-run]
//       Queue "resync" events (repair/*.ndjson, read by apply.mjs) for documents that may have changed
//       between a dump's start and the oldest point the follower's journal covers.
//   node sync-tools.mjs hash-diff <coll>... [--dry-run]
//       Every document compared by a server-side hash ($toHashedIndexKey of the whole document); queues the differing ids.
//   node sync-tools.mjs id-diff <coll>
//       Bucketed _id comparison of one collection; queues the differing ids for resync.
//
// Load on Atlas: secondaryPreferred, at most 4 reads at once, every read bounded by an index (_id or the
// collection's own indexed timestamp); counts are COUNT_SCANs on _id.
import { MongoClient, BSON } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const { EJSON, ObjectId } = BSON;
const STATE_DIR = process.env.STATE_DIR || '/var/lib/sl-follower';
const REPAIR_DIR = path.join(STATE_DIR, 'repair');
const BUCKET_MAX = 50_000;
const log = (...a) => console.error(`[${new Date().toISOString()}]`, ...a);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const atlas = new MongoClient(fs.readFileSync(process.env.ATLAS_URI_FILE || '/etc/sl-mongo/atlas.uri', 'utf8').trim(),
  { appName: 'sl-sync-tools', compressors: ['zlib'], readPreference: 'secondaryPreferred', maxPoolSize: 4 });
const pw = fs.readFileSync(process.env.LOCAL_PW_FILE || '/etc/sl-mongo/follower.pw', 'utf8').trim();
const LOCAL_REPLSET = process.env.LOCAL_REPLSET || '';
const local = new MongoClient(`mongodb://follower:${encodeURIComponent(pw)}@${process.env.LOCAL_HOST || '127.0.0.1:27017'}/?authSource=admin&${LOCAL_REPLSET ? `replicaSet=${LOCAL_REPLSET}&readPreference=primary` : 'directConnection=true'}`, { appName: 'sl-sync-tools', maxPoolSize: 8 });
await atlas.connect(); await local.connect();
const A = atlas.db('bookstore'); const L = local.db('bookstore');

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const canon = (d) => EJSON.serialize(d, { relaxed: false });
const idLine = (c, id) => JSON.stringify({ ts: [Math.floor(Date.now() / 1000), 0], op: 'resync', c, k: EJSON.serialize({ v: id }, { relaxed: false }).v });
function queue(c, ids, why) {
  if (!ids.length) return 0;
  fs.mkdirSync(REPAIR_DIR, { recursive: true });
  const f = path.join(REPAIR_DIR, `${new Date().toISOString().replace(/[-:.]/g, '')}-${c}-${why}.ndjson`);
  fs.writeFileSync(f + '.tmp', ids.map((id) => idLine(c, id)).join('\n') + '\n');
  fs.renameSync(f + '.tmp', f); // the applier only reads *.ndjson, so it never sees a half-written file
  log(`queued ${ids.length} ${c} ids (${why})`);
  return ids.length;
}

// ---- _id buckets: ObjectId time slices split until each holds <= BUCKET_MAX local documents
const oidAt = (sec) => ObjectId.createFromTime(Math.max(0, Math.min(0xffffffff, Math.floor(sec))));
async function buckets(c) {
  const first = await L.collection(c).find({ _id: { $type: 'objectId' } }, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(1).next();
  const last = await L.collection(c).find({ _id: { $type: 'objectId' } }, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).next();
  if (!first) return [];
  const out = [];
  const lo0 = first._id.getTimestamp().getTime() / 1000; const hi0 = Math.max(Date.now() / 1000 + 86400, last._id.getTimestamp().getTime() / 1000 + 1);
  const stack = [[0, lo0], [lo0, hi0], [hi0, 0xffffffff]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    const q = { _id: { $gte: oidAt(lo), $lt: hi >= 0xffffffff ? new ObjectId('ffffffffffffffffffffffff') : oidAt(hi) } };
    const n = await L.collection(c).countDocuments(q, { hint: { _id: 1 } });
    if (n > BUCKET_MAX && hi - lo > 2) { const mid = (lo + hi) / 2; stack.push([lo, mid], [mid, hi]); } else out.push({ q, n });
  }
  return out;
}
async function idDiff(c, { queueIt = true } = {}) {
  const bs = await buckets(c);
  // Non-ObjectId _ids, as index-bounded type ranges. Never `$not: {$type}`: its bounds cover the whole _id index and
  // every key is FETCHED (on Atlas that ran 17 min over pages before it was killed, 2026-11-16).
  const typed = [{ q: { _id: { $gte: '' } }, n: null }, { q: { _id: { $gte: -Infinity } }, n: null }];
  let diffIds = [];
  const cmp = await pool([...bs, ...typed], 4, async (b) => {
    const [na, nl] = await Promise.all([A.collection(c).countDocuments(b.q, { hint: { _id: 1 } }), b.n ?? L.collection(c).countDocuments(b.q, { hint: { _id: 1 } })]);
    if (na === nl) return { na, nl, d: 0 };
    const [ia, il] = await Promise.all([A, L].map((db) => db.collection(c).find(b.q, { projection: { _id: 1 } }).hint({ _id: 1 }).toArray()));
    const ka = new Set(ia.map((d) => JSON.stringify(canon(d._id)))); const kl = new Set(il.map((d) => JSON.stringify(canon(d._id))));
    for (const d of ia) if (!kl.has(JSON.stringify(canon(d._id)))) diffIds.push(d._id);
    for (const d of il) if (!ka.has(JSON.stringify(canon(d._id)))) diffIds.push(d._id);
    return { na, nl, d: Math.abs(na - nl) };
  });
  const nDiff = cmp.reduce((s, x) => s + x.d, 0);
  // any _id of another type (binData, object, date...) shows up only as a total that the buckets do not explain
  const [ta, tl] = await Promise.all([A, L].map((db) => db.collection(c).countDocuments({}, { hint: { _id: 1 } })));
  const untyped = { atlas: ta - cmp.reduce((s, x) => s + x.na, 0), local: tl - cmp.reduce((s, x) => s + x.nl, 0) };
  // On a live collection the totals are read after the buckets, so a small Atlas excess is inserts during the scan
  // (page_revisions: 15 on 2026-11-16, and no binData/object/date/bool _id on Atlas). A persistent or local one is not.
  if (untyped.atlas || untyped.local) log(`${c}: totals exceed the typed buckets by ${JSON.stringify(untyped)} (writes during the scan, or an _id that is not an ObjectId, string or number)`);
  log(`${c}: ${bs.length} buckets, ${cmp.filter((x) => x.d).length} differ, ${diffIds.length} ids only on one side`);
  if (queueIt) queue(c, diffIds, 'iddiff');
  return { buckets: bs.length, differing_buckets: cmp.filter((x) => x.d).length, one_side_ids: diffIds.length, count_delta: nDiff, untyped, ids: diffIds };
}

// ---- hash diff: every document compared, with only _id + an 8-byte hash crossing the wire. Atlas still reads each
// document (a FETCH over an _id-bounded bucket on a secondary), so it runs HASH_CONCURRENCY (default 2, max 4) buckets
// at once and stops if a bucket gets slow. Closes what a timestamp filter cannot see: on 2026-11-16, pages changed
// between the 06:00 dump and the oplog window in read_count and image fields, which carry no indexed timestamp.
async function hashDiff(c, { queueIt = true } = {}) {
  const bs = await buckets(c);
  const typed = [{ q: { _id: { $gte: '' } } }, { q: { _id: { $gte: -Infinity } } }];
  const n = Math.min(4, Number(process.env.HASH_CONCURRENCY || 2));
  const slowMs = Number(process.env.HASH_SLOW_MS || 120000);
  const hashes = (db, q) => db.collection(c).aggregate([{ $match: q }, { $project: { _id: 1, h: { $toHashedIndexKey: '$$ROOT' } } }], { hint: { _id: 1 }, allowDiskUse: false }).toArray();
  const diffIds = []; let done = 0; let docs = 0; let slow = 0; const t0 = Date.now();
  await pool([...bs, ...typed], n, async (b) => {
    if (slow >= 3) return;
    const t = Date.now();
    const [ha, hl] = await Promise.all([hashes(A, b.q), hashes(L, b.q)]);
    if (Date.now() - t > slowMs && ++slow >= 3) log(`${c}: 3 buckets over ${slowMs} ms on Atlas; stopping (rerun later; queued ids are kept)`);
    const ma = new Map(ha.map((d) => [JSON.stringify(canon(d._id)), d])); const ml = new Map(hl.map((d) => [JSON.stringify(canon(d._id)), d]));
    for (const [k, d] of ma) { const o = ml.get(k); if (!o || String(o.h) !== String(d.h)) diffIds.push(d._id); }
    for (const [k, d] of ml) if (!ma.has(k)) diffIds.push(d._id);
    docs += ha.length; done++;
    if (done % 50 === 0) log(`${c}: ${done}/${bs.length + typed.length} buckets, ${docs} docs, ${diffIds.length} differ, ${Math.round((Date.now() - t0) / 1000)} s`);
  });
  log(`${c}: hash-diff ${done}/${bs.length + typed.length} buckets, ${docs} Atlas docs, ${diffIds.length} differ`);
  if (queueIt) for (let k = 0; k < diffIds.length; k += 100_000) queue(c, diffIds.slice(k, k + 100_000), 'hash');
  return { buckets: bs.length + typed.length, done, docs, differ: diffIds.length, complete: slow < 3 && done === bs.length + typed.length };
}

// ---- gap repair
// hint = the index Atlas has (descending on both pages timestamps and entities.updated_at); a wrong hint fails, never scans
async function idsWhere(c, filter, hint) {
  const ids = await A.collection(c).find(filter, { projection: { _id: 1 }, hint }).toArray();
  return ids.map((d) => d._id);
}
async function allIds(c) {
  const out = []; let after = null;
  for (;;) {
    const q = after ? { _id: { $gt: after } } : {};
    const page = await A.collection(c).find(q, { projection: { _id: 1 } }).sort({ _id: 1 }).hint({ _id: 1 }).limit(50_000).toArray();
    if (!page.length) break;
    out.push(...page.map((d) => d._id)); after = page[page.length - 1]._id;
  }
  return out;
}
async function gapRepair(since) {
  const G = new Date(since); const Gs = G.toISOString();
  const dateOrString = (f) => [{ [f]: { $gte: G } }, { [f]: { $gte: Gs, $type: 'string' } }];
  const plan = {
    pages: async () => {
      const s = new Set(); const ids = [];
      for (const f of ['ocr.updated_at', 'translation.updated_at']) for (const q of dateOrString(f)) for (const id of await idsWhere('pages', q, { [f]: -1 })) { const k = id.toString(); if (!s.has(k)) { s.add(k); ids.push(id); } }
      return ids;
    },
    entities: async () => { const out = []; for (const q of dateOrString('updated_at')) out.push(...await idsWhere('entities', q, { updated_at: -1 })); return out; },
    page_revisions: async () => idsWhere('page_revisions', { _id: { $gte: ObjectId.createFromTime(Math.floor(G.getTime() / 1000)) } }, { _id: 1 }),
    chapter_texts: () => allIds('chapter_texts'),
    first_translation_attempts: () => allIds('first_translation_attempts'),
    gallery_images: () => allIds('gallery_images'),
  };
  const report = {};
  for (const [c, f] of Object.entries(plan)) {
    const ids = await f();
    report[c] = { changed_since: ids.length };
    if (!has('dry-run')) queue(c, ids, 'gap');
  }
  for (const c of ['pages', 'page_revisions', 'entities']) {
    const d = await idDiff(c, { queueIt: !has('dry-run') });
    report[c].id_diff = { buckets: d.buckets, differing_buckets: d.differing_buckets, one_side_ids: d.one_side_ids };
  }
  return report;
}

// ---- verify
const stripIndex = ({ v, ns, ...r }) => r;
const sortIdx = (a) => a.map(stripIndex).sort((x, y) => (x.name < y.name ? -1 : 1));
async function verifyColl(info, sampleN) {
  const c = info.name; const r = { coll: c, type: info.type };
  const la = (await L.listCollections({ name: c }).toArray())[0];
  if (!la) return { ...r, problem: 'missing locally' };
  const optsA = { ...info.options }; const optsL = { ...la.options };
  if (!isDeepStrictEqual(canon(optsA), canon(optsL))) r.options = { atlas: optsA, local: optsL };
  if (info.type !== 'collection') return r;
  const [ia, il] = await Promise.all([A.collection(c).indexes(), L.collection(c).indexes()]);
  if (!isDeepStrictEqual(canon(sortIdx(ia)), canon(sortIdx(il)))) r.indexes = { atlas: sortIdx(ia).map((x) => x.name), local: sortIdx(il).map((x) => x.name), detail: JSON.stringify(canon(sortIdx(ia))) === JSON.stringify(canon(sortIdx(il))) ? null : 'options differ' };
  r.ttl = ia.some((x) => x.expireAfterSeconds !== undefined);
  const [na, nl] = await Promise.all([A.collection(c).countDocuments({}, { hint: { _id: 1 } }).catch(() => A.collection(c).countDocuments({})), L.collection(c).countDocuments({}, { hint: { _id: 1 } }).catch(() => L.collection(c).countDocuments({}))]);
  r.count = { atlas: na, local: nl };
  // sample: every document under 10,000, else a random sample from the local side
  let ids;
  if (nl < 10_000) ids = (await L.collection(c).find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
  else ids = (await L.collection(c).aggregate([{ $sample: { size: sampleN } }, { $project: { _id: 1 } }]).toArray()).map((d) => d._id);
  if (na < 10_000 && na !== nl) { // small collection: also look from the Atlas side, so a document only Atlas has is seen
    const extra = (await A.collection(c).find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
    const seen = new Set(ids.map((x) => JSON.stringify(canon(x)))); for (const x of extra) if (!seen.has(JSON.stringify(canon(x)))) ids.push(x);
  }
  r.sampled = ids.length;
  r.diff_ids = await compareDocs(c, ids);
  return r;
}
async function compareDocs(c, ids) {
  const bad = [];
  // 100 at a time: four collections are checked at once and both sides' documents are held; 500 large documents
  // (pages, chapter_texts) a side ran the 2 GB heap out on 2026-11-17
  for (let k = 0; k < ids.length; k += 100) {
    const chunk = ids.slice(k, k + 100);
    const [da, dl] = await Promise.all([A, L].map((db) => db.collection(c).find({ _id: { $in: chunk } }).toArray()));
    const ma = new Map(da.map((d) => [JSON.stringify(canon(d._id)), d])); const ml = new Map(dl.map((d) => [JSON.stringify(canon(d._id)), d]));
    for (const id of chunk) { const key = JSON.stringify(canon(id)); const a = ma.get(key); const l = ml.get(key);
      if (!a && !l) continue;
      if (!a || !l || !isDeepStrictEqual(canon(a), canon(l))) bad.push(id); }
  }
  return bad;
}
async function verify() {
  const sampleN = Number(flag('sample', 1000));
  const only = flag('colls', null)?.split(',');
  const infos = (await A.listCollections().toArray()).filter((x) => !x.name.startsWith('system.') && (!only || only.includes(x.name)));
  const localOnly = only ? [] : (await L.listCollections().toArray()).map((x) => x.name).filter((n) => !n.startsWith('system.') && !infos.some((i) => i.name === n));
  log(`verifying ${infos.length} collections (${localOnly.length} exist only locally)`);
  const results = await pool(infos, 4, (i) => verifyColl(i, sampleN).catch((e) => ({ coll: i.name, problem: e.message })));
  const recheckS = Number(process.env.RECHECK_S || 90);
  const flagged = results.filter((r) => r.problem || r.options || r.indexes || r.diff_ids?.length || (r.count && r.count.atlas !== r.count.local));
  log(`${flagged.length} collections differ on the first look; re-checking in ${recheckS}s`);
  await new Promise((res) => setTimeout(res, recheckS * 1000));
  for (const r of flagged) {
    if (r.diff_ids?.length) { const still = await compareDocs(r.coll, r.diff_ids); r.first_look_diff = r.diff_ids.length; r.diff_ids = still; }
    if (r.count && r.count.atlas !== r.count.local) {
      const [na, nl] = await Promise.all([A.collection(r.coll).countDocuments({}, { hint: { _id: 1 } }).catch(() => A.collection(r.coll).countDocuments({})), L.collection(r.coll).countDocuments({}, { hint: { _id: 1 } }).catch(() => L.collection(r.coll).countDocuments({}))]);
      r.count_first_look = r.count; r.count = { atlas: na, local: nl };
      if (na !== nl) { // lag or a loss? Compare only documents whose ObjectId is over SETTLE_S old (index-bounded)
        const q = { _id: { $gte: oidAt(0), $lt: oidAt(Date.now() / 1000 - Number(process.env.SETTLE_S || 120)) } };
        const [sa, sl] = await Promise.all([A, L].map((db) => db.collection(r.coll).countDocuments(q, { hint: { _id: 1 } })));
        r.settled = { atlas: sa, local: sl, older_than_s: Number(process.env.SETTLE_S || 120) };
      }
    }
  }
  // A count gap that vanishes once the newest SETTLE_S of inserts is left out is the follower's lag; TTL collections
  // expire on each side on their own clock (the TTL monitor runs every 60 s), so their counts are reported, not failed.
  const lagOnly = (r) => r.count && r.count.atlas !== r.count.local && ((r.settled && r.settled.atlas === r.settled.local && r.settled.atlas > 0) || r.ttl);
  for (const r of results) if (lagOnly(r)) r.count_explained = r.ttl ? 'ttl' : 'lag';
  const persistent = results.filter((r) => r.problem || r.options || r.indexes || r.diff_ids?.length || (r.count && r.count.atlas !== r.count.local && !r.count_explained));
  const summary = {
    at: new Date().toISOString(), collections: results.length, local_only: localOnly,
    docs_atlas: results.reduce((s, r) => s + (r.count?.atlas || 0), 0), docs_local: results.reduce((s, r) => s + (r.count?.local || 0), 0),
    sampled_docs: results.reduce((s, r) => s + (r.sampled || 0), 0),
    ttl_collections: results.filter((r) => r.ttl).map((r) => r.coll),
    differ_first_look: flagged.length, differ_persistent: persistent.length,
    count_explained: results.filter((r) => r.count_explained).map((r) => ({ coll: r.coll, why: r.count_explained, count: r.count, settled: r.settled })),
    persistent: persistent.map((r) => ({ coll: r.coll, problem: r.problem, count: r.count, indexes: r.indexes, options: r.options ? 'differ' : undefined, diff_ids: r.diff_ids?.slice(0, 20).map((x) => EJSON.serialize({ v: x }).v), n_diff: r.diff_ids?.length })),
  };
  const out = flag('out', null);
  if (out) fs.writeFileSync(out, JSON.stringify({ summary, results: results.map((r) => ({ ...r, diff_ids: r.diff_ids?.length })) }, null, 1));
  return summary;
}

const cmd = args[0];
let res;
if (cmd === 'verify') res = await verify();
else if (cmd === 'gap-repair') res = await gapRepair(flag('since'));
else if (cmd === 'hash-diff') { res = {}; for (const c of args.slice(1).filter((x) => !x.startsWith('--'))) res[c] = await hashDiff(c, { queueIt: !has('dry-run') }); }
else if (cmd === 'id-diff') { const d = await idDiff(args[1]); delete d.ids; res = d; }
else { console.error('usage: sync-tools.mjs verify|gap-repair --since ISO|hash-diff <coll>...|id-diff <coll>'); process.exit(64); }
console.log(JSON.stringify(res, null, 1));
await atlas.close(); await local.close();
