#!/usr/bin/env node
// PRIOR ART: scripts/eval/tib-translator-6948/frame.mjs — the #6948 frame of Tibetan pages with NO English. This is the
// other half: public Tibetan pages that SERVE stored English written in the last 14 days by the two Flash cohorts.
/**
 * frame.mjs — read-only, $0. Pages on public Tibetan books (`language` starts with "Tibetan", `visible: true`,
 * `pages_count > 0`) whose `translation.data` is non-empty, `translation.model` is gemini-3.8-flash-low or
 * gemini-3-flash-preview, and `translation.updated_at` ≥ 2026-10-05. Out: `ocr.unreadable`, page_type cover/blank,
 * and `translation_withheld.reason` in {ocr_unreadable, source_loop, invented_by_eye}. (A page with English AND a
 * withheld marker serves the English: src/app/book/[id]/read/page.tsx, `withheld = !translationHtml && …`.)
 * Writes $JOB_SCRATCH/frame.jsonl (one row per page, no text; `syl` = tib-translator-6948/sample.py's syls(), ported)
 * and prints the counts.
 *   node --env-file=<main>/.env.production.local scripts/eval/tib-stored-6948/frame.mjs
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const S = process.env.JOB_SCRATCH;
const SINCE = new Date('2026-10-05T00:00:00Z');
const OUT_REASONS = new Set(['ocr_unreadable', 'source_loop', 'invented_by_eye']);
const syls = (s) => s.replace(/[#{}\[\]()0-9a-zA-Z,.]/g, ' ').split(/[་།\s༄༅༔༑]+/).filter(Boolean);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = await db.collection('books').find(
  { language: /^\s*tibetan\b/i, visible: true, pages_count: { $gt: 0 } },
  { projection: { _id: 0, id: 1, title: 1, display_title: 1 } },
).toArray();
const out = fs.createWriteStream(`${S}/frame.jsonl`);
const counts = {};
const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
for (const b of books) {
  const cur = db.collection('pages').find(
    { book_id: b.id, 'translation.model': { $in: ['gemini-3.8-flash-low', 'gemini-3-flash-preview'] }, 'translation.updated_at': { $gte: SINCE } },
    { projection: { _id: 0, id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.unreadable': 1,
      'ocr.updated_at': 1, 'translation.model': 1, 'translation.updated_at': 1, 'translation.data': 1,
      'translation.engine.input.source_updated_at': 1, 'translation_withheld.reason': 1 } }).batchSize(1000);
  for await (const p of cur) {
    if (!(p.translation?.data || '').trim()) continue;
    const m = p.translation.model; const wr = p.translation_withheld?.reason || null;
    if (p.ocr?.unreadable) { bump(`${m}|out:ocr.unreadable`); continue; }
    if (['cover', 'blank'].includes(p.page_type)) { bump(`${m}|out:${p.page_type}`); continue; }
    if (OUT_REASONS.has(wr)) { bump(`${m}|out:${wr}`); continue; }
    const kind = p.ocr?.pipeline === 'derge-tengyur-import-5497' ? 'derge-tengyur' : p.ocr?.model || p.ocr?.pipeline || 'other';
    bump(`${m}|in:${kind}`);
    const ocrAfter = p.ocr?.updated_at && p.translation.updated_at && new Date(p.ocr.updated_at) > new Date(p.translation.updated_at);
    out.write(JSON.stringify({ cohort: m, kind, book_id: b.id, title: b.display_title || b.title, page_id: p.id, page_number: p.page_number,
      wr, syl: syls(p.ocr?.data || '').length, en_chars: p.translation.data.length, tr_at: p.translation.updated_at, ocr_after_tr: !!ocrAfter }) + '\n');
  }
}
out.end();
console.log(JSON.stringify({ books: books.length, counts, at: new Date().toISOString() }));
await c.close();
