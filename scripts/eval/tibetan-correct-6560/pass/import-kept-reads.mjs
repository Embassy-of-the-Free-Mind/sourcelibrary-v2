#!/usr/bin/env node
// PRIOR ART: scripts/lib/candidate-reads.mjs findRead()/reuseInto() — the #7075 reuse, keyed on the image's sha256; it misses
// across boxes because images.sourcelibrary.org serves Cloudflare-Polished or original bytes depending on cache state
// (#6740, 2026-10-26). This matches on the exact prompt sent instead (it carries the draft and the image file name).
/**
 *   node --env-file=... import-kept-reads.mjs READ_DIR IDS.json [CANDS.json]   (CANDS: [{page_id, book_id}] for several books)
 * READ_DIR must already hold <page_id>.prompt.txt (run cli-ocr.mjs read --reuse-only first). Brings in the newest kept
 * Flash-low read of lane tib-correct-6560 whose prompt_sent_hash equals contentHash(<page_id>.prompt.txt).
 */
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs'; import path from 'node:path';
import { contentHash } from '../../../lib/write-provenance.mjs';
import { reuseInto } from '../../../lib/candidate-reads.mjs';
const D = process.argv[2];
const ids = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const bookOf = process.argv[4] ? Object.fromEntries(JSON.parse(fs.readFileSync(process.argv[4], 'utf8')).map((x) => [x.page_id, x.book_id])) : null;
const books = bookOf ? [...new Set(Object.values(bookOf))] : ['69e7abec5f1a22ab19aa0707'];
const c = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const byPage = new Map();
for (const BOOK of books) { let token;
do { const r = await c.send(new ListObjectsV2Command({ Bucket: 'sl-corpus-snapshots', Prefix: `candidate-reads/${BOOK}/`, ContinuationToken: token }));
  for (const o of r.Contents || []) { const [, , pid, f] = o.Key.split('/'); if (f === 'ocr') (byPage.get(pid) ?? byPage.set(pid, []).get(pid)).push(o.Key); }
  token = r.IsTruncated ? r.NextContinuationToken : undefined; } while (token); }
const BOOKOF = (pid) => (bookOf ? bookOf[pid] : books[0]);
const t = { have: 0, imported: 0, none: 0, prompt_mismatch: 0 };
for (const pid of ids) {
  if (fs.existsSync(path.join(D, `${pid}.meta.json`)) && fs.readFileSync(path.join(D, `${pid}.txt`), 'utf8').length > 5) { t.have++; continue; }
  const sent = contentHash(fs.readFileSync(path.join(D, `${pid}.prompt.txt`), 'utf8'));
  let best = null, mism = 0;
  for (const key of byPage.get(pid) || []) {
    const b = JSON.parse(await (await c.send(new GetObjectCommand({ Bucket: 'sl-corpus-snapshots', Key: key }))).Body.transformToString());
    if (b.book_id !== BOOKOF(pid) || b.page_id !== pid || b.model !== 'gemini-3.8-flash-low' || b.meta?.lane !== 'tib-correct-6560' || b.meta?.exit !== 0 || b.meta?.error_class || b.meta?.wrapper) continue;
    if (b.meta.prompt_sent_hash !== sent) { mism++; continue; }
    if (!best || String(b.read_at) > String(best.body.read_at)) best = { key, text: b.text, meta: b.meta, body: b };
  }
  if (best && await reuseInto(D, pid, best, { imported_by: 'tmpjob/import.mjs: prompt-sent match; image bytes differ by box (Cloudflare Polish)' })) t.imported++;
  else if (mism) t.prompt_mismatch++; else t.none++;
}
console.log(JSON.stringify(t));
