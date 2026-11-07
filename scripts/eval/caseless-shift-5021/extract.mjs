#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-leaf-shift.mjs (number vote + absorption over stored English; it cannot see Han or
// Tibetan, where 91% and 99% of pages cast no number vote) and scripts/eval/caseless-drift-7503/ (a CLAUSE moved across
// one Han boundary, read from column layout; a whole-leaf slide is out of its reach). This draws the pages for a
// cross-lingual embedding test of the slide itself: EN(n) against SRC(n-1), SRC(n), SRC(n+1). Read-only (#5021 Part B).
/**
 *   node --env-file=.env.production.local scripts/eval/caseless-shift-5021/extract.mjs --out=FILE.jsonl.gz [--per-book=80]
 * Frame: visible Chinese (incl. Classical) and Tibetan books with 6+ translated pages. Each book's translated pages in
 * runs of consecutive page numbers; one row per page with its source, its English, the sources either side, and
 * `block`: whether it was written in one block with a neighbour (translation.updated_at within 2 s), else written alone.
 * Single-page-written pages are the noise floor; block-written ones are the frame.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { sourceProse, translationProse } from '../../lib/block-drift.mjs';
import { ABSORB_SAME_BLOCK_MS } from '../../lib/leaf-shift.mjs';
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const OUT = arg('out'); const PER = Number(arg('per-book', 80));
const FAM = { han: /^(classical )?chinese\b/i, tibetan: /^tibetan\b/i };
const c = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = c.db('bookstore');
const gz = zlib.createGzip(); const ws = fs.createWriteStream(OUT); gz.pipe(ws);
const counts = {};
for (const [fam, re] of Object.entries(FAM)) {
  const books = (await db.collection('books').find({ visible: true, pages_translated: { $gte: 6 } }, { projection: { id: 1, language: 1 } }).toArray()).filter((b) => re.test(b.language || ''));
  counts[fam] = { books: books.length, pages: 0, block: 0 };
  for (const b of books) {
    const ps = await db.collection('pages').find({ book_id: b.id, page_number: { $gt: 0 } }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.updated_at': 1, 'translation.model': 1, translation_withheld: 1 } }).sort({ page_number: 1 }).toArray();
    const by = new Map(ps.map((p) => [p.page_number, p]));
    const tr = ps.filter((p) => p.translation?.data && p.ocr?.data && !p.translation_withheld);
    // An evenly spaced take of up to PER translated pages per book, so a long canon does not dominate.
    const step = Math.max(1, Math.floor(tr.length / PER));
    for (let i = 0; i < tr.length; i += step) {
      const p = tr[i], P = by.get(p.page_number - 1), N = by.get(p.page_number + 1);
      if (!P?.ocr?.data || !N?.ocr?.data) continue;
      const t = (q) => (q?.translation?.updated_at ? new Date(q.translation.updated_at).getTime() : null);
      const near = (q) => q && t(q) != null && Math.abs(t(q) - t(p)) <= ABSORB_SAME_BLOCK_MS;
      const block = near(P) || near(N);
      gz.write(JSON.stringify({ fam, book_id: b.id, page_id: p.id, n: p.page_number, page_type: p.page_type ?? null, model: p.translation.model ?? null, block, en: translationProse(p.translation.data).slice(0, 3000), src: sourceProse(p.ocr.data).slice(0, 2000), srcPrev: sourceProse(P.ocr.data).slice(0, 2000), srcNext: sourceProse(N.ocr.data).slice(0, 2000), enLen: p.translation.data.length, srcLen: p.ocr.data.length, prevLen: P.ocr.data.length, nextLen: N.ocr.data.length }) + '\n');
      counts[fam].pages++; if (block) counts[fam].block++;
    }
  }
  console.log(fam, counts[fam]);
}
gz.end(); await new Promise((r) => ws.on('close', r));
await c.close();
