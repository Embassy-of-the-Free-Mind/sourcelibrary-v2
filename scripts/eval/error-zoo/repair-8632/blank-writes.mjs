#!/usr/bin/env node
// PRIOR ART: blank-scan.py (step 1, disk only) and scripts/maintenance/revert-run.mjs (reads the same page_revisions
// rows). Step 2 of the #8632 blank-write measurement: for each written re-read typed blank, how much text did the prior
// OCR hold (page_revisions.data under the write's run)? Read-only.
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const rows = JSON.parse(fs.readFileSync('/root/jobs/repair-8632/blank-written.json', 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const pr = c.db('bookstore').collection('page_revisions');
const body = (s) => String(s || '').replace(/<[^>]+>[^<]*<\/[^>]+>/g, '').replace(/<[^>]+>/g, '').trim().length;
const out = []; const bins = { none: 0, '1-299': 0, '300-999': 0, '1000+': 0, 'no revision': 0 };
for (const r of rows) {
  const rev = await pr.findOne({ page_id: r.page_id, field: 'ocr', run_id: r.run }, { projection: { data: 1, prior_hash: 1 } });
  if (!rev) { bins['no revision']++; continue; }
  const n = body(rev.data);
  bins[n === 0 ? 'none' : n < 300 ? '1-299' : n < 1000 ? '300-999' : '1000+']++;
  if (n >= 300) out.push({ ...r, prior_body_chars: n });
}
await c.close();
fs.writeFileSync('/root/jobs/repair-8632/blank-over-text.json', JSON.stringify(out, null, 1));
console.log(rows.length, 'blank writes; prior text body:', JSON.stringify(bins), `; over 300+ chars: ${out.length} pages in ${new Set(out.map((r) => r.book_id)).size} books`);
