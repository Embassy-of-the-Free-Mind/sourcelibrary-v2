// PRIOR ART: scripts/lib/candidate-reads.mjs (keeps and finds reads; never asks whether a kept read was paid for again);
// scripts/maintenance/archive-candidate-reads.mjs (copies job-folder reads into the same prefix; counts objects, not
// waste). Neither measures what the paid lanes spent on pages that already had a usable kept read (#7075).
/**
 * How many pages were PAID FOR AGAIN after a usable read of them was already kept (#7075)?
 *
 * Walks every object under R2 sl-corpus-snapshots/candidate-reads/, keeps the usable reads (textProblem() == null,
 * exit 0), and for each page+field asks the page's CURRENT text: was it written by a paid lane (engine.api 'batch' or
 * 'realtime') AFTER the earliest usable kept read, with text that is not one of the kept reads? That page was paid for
 * twice. The cost is priced with scripts/lib/pipeline-unit-prices.mjs (low–high per page).
 *
 * It UNDER-counts: a paid write later overwritten by another write is not seen (only the current text is read), and a
 * kept read's `read_at` is the archive time for reads the 2026-10-24 sweep copied after the fact. It does not judge
 * whether the kept read was as good as the paid one: a failed eval arm kept on purpose still counts as "usable".
 * The by-reason table says which reads those were (job name), so the number can be read for what it is.
 *
 *   node --env-file=.env.production.local scripts/audit/kept-read-repaid.mjs [--out=FILE.json]
 */
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import { withMongo } from '../lib/mongo.mjs';
import { BUCKET, PREFIX, textProblem } from '../lib/candidate-reads.mjs';
import { UNIT_PRICES } from '../lib/pipeline-unit-prices.mjs';

const OUT = (process.argv.find(a => a.startsWith('--out=')) || '').slice(6) || null;
const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });

async function listKeys() {
  const keys = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${PREFIX}/`, ContinuationToken: token }));
    for (const o of r.Contents || []) if (o.Key.endsWith('.json')) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function getBody(key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return JSON.parse(await r.Body.transformToString());
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = items[i++]; await fn(k); } }));
}

const keys = await listKeys();
console.error(`objects: ${keys.length}`);

// page_id|field → { book_id, field, earliest usable read_at, hashes, jobs, models }
const kept = new Map();
let unusable = 0, failed = 0;
await pool(keys, 32, async key => {
  let b;
  try { b = await getBody(key); } catch { failed++; return; }
  const m = b.meta || {};
  if (textProblem(b.text, b.field) || (m.exit !== undefined && m.exit !== 0) || m.error_class || m.wrapper) { unusable++; return; }
  const id = `${b.page_id}|${b.field}`;
  const e = kept.get(id) || { page_id: b.page_id, book_id: b.book_id, field: b.field, first: null, hashes: new Set(), jobs: new Set(), models: new Set() };
  const at = b.read_at || b.archived_at || null;
  if (at && (!e.first || at < e.first)) e.first = at;
  e.hashes.add(b.content_hash); if (b.job) e.jobs.add(b.job); if (b.model) e.models.add(b.model);
  kept.set(id, e);
});
console.error(`usable kept page-fields: ${kept.size} (unusable ${unusable}, unreadable ${failed})`);

const rows = [];
const PAID = new Set(['batch', 'realtime']);
await withMongo(async db => {
  const all = [...kept.values()];
  for (let i = 0; i < all.length; i += 1000) {
    const chunk = all.slice(i, i + 1000);
    const docs = await db.collection('pages').find({ id: { $in: chunk.map(e => e.page_id) } },
      { projection: { id: 1, 'ocr.engine': 1, 'ocr.content_hash': 1, 'ocr.updated_at': 1, 'translation.engine': 1, 'translation.content_hash': 1, 'translation.updated_at': 1 } }).toArray();
    const byId = new Map(docs.map(d => [d.id, d]));
    for (const e of chunk) {
      const f = byId.get(e.page_id)?.[e.field];
      const api = f?.engine?.api ?? null;
      const at = f?.engine?.run?.at ?? (f?.updated_at ? new Date(f.updated_at).toISOString() : null);
      const repaid = !!(f && PAID.has(api) && e.first && at && at > e.first && !e.hashes.has(f.content_hash));
      rows.push({ page_id: e.page_id, book_id: e.book_id, field: e.field, kept_first: e.first, current_api: api,
        current_model: f?.engine?.model ?? null, current_at: at, repaid, applied: !!(f && e.hashes.has(f.content_hash)),
        jobs: [...e.jobs], kept_models: [...e.models] });
    }
  }
}, { timeoutMs: 3_600_000 });

const sum = (field, pred) => rows.filter(r => r.field === field && pred(r)).length;
const report = {};
for (const field of ['ocr', 'translation']) {
  const price = field === 'ocr' ? UNIT_PRICES.ocr : UNIT_PRICES.translate;
  const repaid = sum(field, r => r.repaid);
  report[field] = {
    kept_pages: sum(field, () => true),
    applied: sum(field, r => r.applied),
    repaid_after_kept: repaid,
    repaid_usd: [+(repaid * price.low).toFixed(2), +(repaid * price.high).toFixed(2)],
    kept_not_applied_not_repaid: sum(field, r => !r.applied && !r.repaid),
  };
}
const byJob = {};
for (const r of rows.filter(r => r.repaid)) for (const j of (r.jobs.length ? r.jobs : ['(none)'])) byJob[j] = (byJob[j] || 0) + 1;
report.repaid_by_job = Object.fromEntries(Object.entries(byJob).sort((a, b) => b[1] - a[1]).slice(0, 25));
report.repaid_by_current_model = rows.filter(r => r.repaid).reduce((a, r) => (a[`${r.field}:${r.current_model}`] = (a[`${r.field}:${r.current_model}`] || 0) + 1, a), {});
console.log(JSON.stringify(report, null, 2));
if (OUT) fs.writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
