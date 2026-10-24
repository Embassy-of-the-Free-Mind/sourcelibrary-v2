#!/usr/bin/env node
// Upsert the full TWKM sign-catalog snapshot into `maya_twkm`, one doc per entity row (#6980).
// PRIOR ART: ../load-maya-signs.mjs loads the per-drawing maya_signs docs; this keeps the relational rest
// (decipherments, concordances, bibliography, artefact zones, places …) that those docs only summarise.
// The tabular data has no stated licence, so it lives in Mongo only — never the public bucket or the repo.
// Input: raw.jsonl from build.py. Dry run by default; --apply writes. Idempotent (upsert by _id).
//   node --env-file=.env.production.local scripts/learn/maya-signs/twkm/load-twkm-raw.mjs <out-dir> [--apply]
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const [dir, flag] = process.argv.slice(2);
if (!dir) { console.error('usage: load-twkm-raw.mjs <out-dir> [--apply]'); process.exit(2); }
const rows = readFileSync(`${dir}/raw.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const byEnt = rows.reduce((m, r) => ((m[r.entity] = (m[r.entity] || 0) + 1), m), {});
console.log(JSON.stringify(byEnt));
if (flag !== '--apply') { console.log(`dry run: ${rows.length} rows; pass --apply to write`); process.exit(0); }

const client = await MongoClient.connect(process.env.MONGODB_URI);
const col = client.db('bookstore').collection('maya_twkm');
const now = new Date();
const snapshot = { source: 'twkm-signcatalog', url: 'https://classicmayan.org/portal/sc/client/data/data.en.json', fetched: '2026-10-18' };
let up = 0, mod = 0;
for (let i = 0; i < rows.length; i += 2000) {
  const res = await col.bulkWrite(rows.slice(i, i + 2000).map(({ _id, ...doc }) => ({
    updateOne: { filter: { _id }, update: { $set: { ...doc, snapshot, updated_at: now }, $setOnInsert: { created_at: now } }, upsert: true },
  })), { ordered: false });
  up += res.upsertedCount; mod += res.modifiedCount;
}
await col.createIndex({ entity: 1 });
await col.createIndex({ 'data.signNo': 1 });
await col.createIndex({ 'data.graphNo': 1 });
console.log(`mongo upserted=${up} modified=${mod}; total docs=${await col.countDocuments()}`);
await client.close();
