#!/usr/bin/env node
// #5813 — does what the collector STORED match what Gemini RETURNED? For every page in raw-parts.jsonl
// whose answer finished (STOP) and that still carries that job's write, compares the stored
// ocr.data length with the joined length of all text parts. A stored text shorter than the joined
// answer by more than a few characters is a cut-off write (the parts[0] bug, fixed in #5930).
// Read-only.   node --env-file=… scripts/batch/greek-reocr-5813/audit-stored.mjs --raw=raw-parts.jsonl [--jobs-reason=REGEX]
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const raw = fs.readFileSync(arg('raw'), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.page_id && r.finish === 'STOP');
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const db = c.db('bookstore');
let jobIds = null;
if (arg('jobs-reason')) jobIds = new Set((await db.collection('batch_jobs').find({ submitted_by: 'scripts/batch/bulk-reocr-local.mjs', initiated_reason: new RegExp(arg('jobs-reason')) }, { projection: { _id: 0, id: 1 } }).toArray()).map((j) => j.id));
const rows = jobIds ? raw.filter((r) => jobIds.has(r.job_id)) : raw;
const t = { answers: rows.length, multipart: 0, still_this_write: 0, complete: 0, cut_off: 0, multipart_complete: 0, multipart_cut_off: 0 };
const cut = [];
for (let i = 0; i < rows.length; i += 1000) {
  const slice = rows.slice(i, i + 1000);
  const pages = new Map((await db.collection('pages').find({ id: { $in: slice.map((r) => r.page_id) } }, { projection: { _id: 0, id: 1, 'ocr.batch_job_id': 1, len: { $strLenCP: { $ifNull: ['$ocr.data', ''] } } } }).toArray()).map((p) => [p.id, p]));
  for (const r of slice) {
    if (r.text_parts > 1) t.multipart++;
    const p = pages.get(r.page_id);
    if (!p || p.ocr?.batch_job_id !== r.job_id) continue;
    t.still_this_write++;
    // joined_len counts UTF-16 units and the stored length code points; Greek is in the BMP, so they agree to a few characters (trim, long-s folding).
    const ok = p.len >= r.joined_len * 0.97 - 5;
    ok ? t.complete++ : (t.cut_off++, cut.push(r.page_id));
    if (r.text_parts > 1) ok ? t.multipart_complete++ : t.multipart_cut_off++;
  }
}
console.log(JSON.stringify(t));
if (cut.length) console.log('cut off:', cut.slice(0, 20).join(' '));
await c.close();
