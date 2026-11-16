#!/usr/bin/env node
// PRIOR ART: scripts/batch/ocr-convergence/driver.mjs audit-packets (the set layout it reads, unchanged).
// Audit set: 24 of the re-read writes typed blank over 300+ chars of prior text. stored = the prior text
// (page_revisions under the write's run), read = the page's text now (only pages still holding the blank read).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
const { pageImageUrl } = await import('../../spot-check/lib.mjs');
const rows = JSON.parse(fs.readFileSync('/root/jobs/repair-8632/blank-over-text.json', 'utf8'))
  .sort((a, b) => crypto.createHash('sha256').update('b8632' + a.page_id).digest('hex').localeCompare(crypto.createHash('sha256').update('b8632' + b.page_id).digest('hex')));
const SET = '/root/jobs/repair-8632/audit-run/blank24';
fs.mkdirSync(`${SET}/stored`, { recursive: true }); fs.mkdirSync(`${SET}/reads`, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const dec = []; const seenBooks = new Set();
for (const r of rows) {
  if (dec.length >= 24) break;
  if (seenBooks.has(r.book_id)) continue;   // one page per book
  const p = await db.collection('pages').findOne({ id: r.page_id });
  if (!p || !/<page-type>\s*blank/i.test(p.ocr?.data || '')) continue;   // since rewritten
  const rev = await db.collection('page_revisions').findOne({ page_id: r.page_id, field: 'ocr', run_id: r.run }, { projection: { data: 1 } });
  const res = await fetch(pageImageUrl(p), { signal: AbortSignal.timeout(60000) }); if (!res.ok) continue;
  const bk = await db.collection('books').findOne({ id: r.book_id }, { projection: { language: 1 } });
  fs.mkdirSync(`${SET}/reads/ws-${r.page_id}`, { recursive: true });
  fs.writeFileSync(`${SET}/reads/ws-${r.page_id}/${r.page_id}.jpg`, Buffer.from(await res.arrayBuffer()));
  fs.writeFileSync(`${SET}/stored/${r.page_id}.txt`, rev.data);
  fs.writeFileSync(`${SET}/reads/${r.page_id}.txt`, p.ocr.data);
  dec.push({ page_id: r.page_id, book_id: r.book_id, page_number: p.page_number, language: bk?.language, action: 'write', prior_body_chars: r.prior_body_chars, run: r.run });
  seenBooks.add(r.book_id);
}
await c.close();
fs.writeFileSync(`${SET}/decisions.jsonl`, dec.map((d) => JSON.stringify(d)).join('\n') + '\n');
console.log(`${dec.length} pages in ${SET}`);
