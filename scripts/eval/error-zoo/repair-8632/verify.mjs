#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/error-zoo/repair-pilot/verify.mjs (the pilot's after-check, which had nothing to verify:
 * STOP wrote nothing). This checks the #8632 repair's writes against the frozen snapshot: each page's text changed,
 * carries the re-read lane's stamp, and has a page_revisions row under one of the run ids, which is the revert path.
 * Writes written.jsonl (the revert list: page, run id, before and after hashes). Read-only.
 *
 *   node --env-file=… verify.mjs --before=before-writes-2026-11-12.jsonl --runs=ID,ID --out=written.jsonl
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const before = fs.readFileSync(arg('before'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const runs = arg('runs').split(',');
const sha = (s) => (typeof s === 'string' ? createHash('sha256').update(s).digest('hex') : null);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const out = [], bad = [];
for (const b of before) {
  const p = await db.collection('pages').findOne({ id: b.page_id }, { projection: { 'ocr.data': 1, 'ocr.pipeline': 1, 'ocr.model': 1, translation_stale: 1 } });
  const rev = await db.collection('page_revisions').findOne({ page_id: b.page_id, run_id: { $in: runs.flatMap((r) => [r, `${r}-ocr`]) } }, { projection: { run_id: 1, source: 1, created_at: 1 } });
  const after = sha(p?.ocr?.data);
  const row = { page_id: b.page_id, book_id: b.book_id, page_number: b.page_number, run_id: rev?.run_id ?? null, before_sha256: b.ocr.sha256, after_sha256: after,
    model: p?.ocr?.model ?? null, pipeline: p?.ocr?.pipeline ?? null, translation_stale: !!p?.translation_stale };
  const why = [];
  if (after === b.ocr.sha256) why.push('text unchanged');
  if (row.pipeline !== 'agy-reread-lite-7853') why.push(`pipeline ${row.pipeline}`);
  if (!rev) why.push('no revision row under the run ids');
  if (why.length) bad.push({ page_id: b.page_id, why });
  out.push(row);
}
await c.close();
fs.writeFileSync(arg('out'), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`${out.length} pages: ${out.length - bad.length} verified (changed, stamped, revision row); ${out.filter((r) => r.translation_stale).length} with English marked stale`);
for (const x of bad) console.log('  PROBLEM', x.page_id, x.why.join('; '));
