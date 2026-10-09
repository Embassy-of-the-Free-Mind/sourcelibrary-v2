#!/usr/bin/env node
// #5813 — the before/after sample for the issue: N retranslated pages from distinct books (seeded),
// each with its reader URL, the old and new transcription head and the old and new English head.
// "Before" is the job's own pre-run snapshot (snapshot.mjs); "after" is what the page serves now.
// Read-only.  node --env-file=… scripts/batch/greek-reocr-5813/before-after.mjs --compare=F --before=F [--n=10] [--seed=S] [--max=0.9]
import fs from 'node:fs';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { stripWrappers } from '../../eval/lib/metrics.mjs';
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const N = Number(arg('n', '10')), MAX = Number(arg('max', '0.9'));
const h = (s) => createHash('sha256').update(arg('seed', 'ba-5813') + s).digest('hex');
const rows = fs.readFileSync(arg('compare'), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.outcome === 'reread' && r.tr && r.agreement < MAX && r.old_chars >= 600);
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const db = c.db('bookstore');
const picks = []; const seen = new Set();
for (const r of rows.sort((a, b) => h(a.page_id).localeCompare(h(b.page_id)))) {
  if (seen.has(r.book_id)) continue;
  const p = await db.collection('pages').findOne({ id: r.page_id }, { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.updated_at': 1, 'translation.data': 1, 'translation.updated_at': 1, 'translation.model': 1 } });
  if (!p?.translation?.data || !(p.translation.updated_at > p.ocr.updated_at)) continue; // retranslated after the re-read only
  seen.add(r.book_id); picks.push({ r, p });
  if (picks.length >= N) break;
}
const want = new Set(picks.map((x) => x.r.page_id)); const before = new Map();
for await (const l of readline.createInterface({ input: fs.createReadStream(arg('before')) })) { const m = /"id":"([^"]+)"/.exec(l); if (m && want.has(m[1])) before.set(m[1], JSON.parse(l)); }
const body = (t) => stripWrappers(t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
for (const { r, p } of picks) {
  const b = before.get(r.page_id);
  const book = await db.collection('books').findOne({ id: r.book_id }, { projection: { _id: 0, title: 1, slug: 1, id: 1 } });
  console.log(`\n### ${(book.title || '').slice(0, 60)} — https://sourcelibrary.org/book/${book.slug || book.id}/page/${p.page_number}  (agreement ${r.agreement.toFixed(2)})`);
  console.log(`OCR before: ${body(b.ocr.data).slice(0, 260)}`);
  console.log(`OCR after:  ${body(p.ocr.data).slice(0, 260)}`);
  console.log(`EN before:  ${body(b.translation?.data).slice(0, 300)}`);
  console.log(`EN after:   ${body(p.translation.data).slice(0, 300)}`);
}
await c.close();
