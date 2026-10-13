#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-bl-evidence/english_state.mjs reads stored English per stratum for a judge packet,
// not a whole run's page list; page_revisions keeps the before-text only once a writer runs. Stage 2 needs the stored
// OCR and English of every in-scope page BEFORE it writes, as one file, for the gates and the closing measure.
//
// #6361 stage 2: read-only snapshot of the in-scope pages as stored now (OCR, English and their provenance).
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/tengyur-cli-6361/snapshot-stored.mjs \
//     --run=/root/tengyur-cli-6361 --out=$JOB_SCRATCH/stored-before.jsonl.gz
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const W = arg('run', '/root/tengyur-cli-6361');
const OUT = arg('out');
if (!OUT) throw new Error('--out is required');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const pages = fs.readFileSync(path.join(W, 'pages.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const gz = zlib.createGzip();
gz.pipe(fs.createWriteStream(OUT));
let n = 0, ocrChanged = 0;
for (let i = 0; i < pages.length; i += 500) {
  const chunk = pages.slice(i, i + 500);
  const rows = await db.collection('pages').find({ id: { $in: chunk.map((p) => p.page_id) } }, {
    projection: { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, translation: 1 },
  }).toArray();
  const by = new Map(rows.map((r) => [r.id, r]));
  for (const p of chunk) {
    const r = by.get(p.page_id);
    const ocr = r?.ocr?.data ?? null;
    const same = ocr != null && sha(ocr) === p.ocr_sha256;
    if (!same) ocrChanged++;
    const { engine, ...tr } = r?.translation || {};
    gz.write(JSON.stringify({ page_id: p.page_id, book_id: p.book_id, vol: p.vol, page_number: p.page_number, page_type: r?.page_type ?? null,
      found: !!r, ocr_matches_manifest: same, ocr, ocr_model: r?.ocr?.model ?? null, translation: tr, translation_engine_job: engine?.run?.job_id ?? null }) + '\n');
    n++;
  }
}
gz.end();
await new Promise((r) => gz.on('end', r));
await client.close();
console.log(JSON.stringify({ pages: n, ocr_changed_since_staging: ocrChanged, out: OUT }));
