#!/usr/bin/env node
// PRIOR ART: scripts/audit/es-edition-quality.mjs (compares DIGIT numerals between two texts) — a Maya page writes its
// numbers as vigesimal words, so a digit match never sees them; the parser is scripts/lib/maya-numerals.mjs.
/**
 * Find Yucatec Maya number phrases in each page's OCR and check that the page's English states the same value (#6559:
 * Coleccion de sermones p.200 *lahu oxkal catac oxpel* = 53 came out "thirty-three"). READ-ONLY: it lists, it fixes nothing.
 *
 *   node --env-file=.env.production.local scripts/audit/maya-numeral-scan.mjs [--book=<id> ...] [--out=FILE.jsonl]
 *
 * Default scope: every book with language 'Yucatec Maya', every page with OCR and a translation. A phrase is a
 * MISMATCH when its value is not among the numbers the English states (digits, number words, ordinals); value 1 is
 * never judged (hun = "a"), and a phrase with digits within 60 characters of it in the OCR is `glossed` (a numeral
 * table or a printed gloss: the source states the value itself) and not judged. `compound` phrases (a score, 400, 1000 or a catac sum) are the reliable class; `small`
 * ones (a unit with a counting particle) are noisier, because English often says "both", "a pair" or nothing.
 * A mismatch is a lead, not a verdict: check it against Beltrán's table (6a9f3fa483c3b522416e48fa pp. 217–225).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { findMayaNumbers, englishNumbers, englishBody, cleanMayaOcr } from '../lib/maya-numerals.mjs';

const args = process.argv.slice(2);
const books = args.filter((a) => a.startsWith('--book=')).map((a) => a.slice(7));
const OUT = args.find((a) => a.startsWith('--out='))?.slice(6);

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');
const bookRows = await db.collection('books').find(books.length ? { id: { $in: books } } : { language: 'Yucatec Maya' }, { projection: { id: 1, title: 1 } }).toArray();
const out = OUT ? fs.createWriteStream(OUT) : null;
const tally = { books: bookRows.length, pages: 0, pagesWithPhrases: 0, phrases: 0, glossed: 0, judged: 0, compound: 0, compoundMismatch: 0, small: 0, smallMismatch: 0 };
for (const b of bookRows) {
  const cur = db.collection('pages').find({ book_id: b.id, 'ocr.data': { $exists: true, $ne: '' }, 'translation.data': { $exists: true, $ne: '' } },
    { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1 } }).batchSize(1000).sort({ page_number: 1 });
  for await (const p of cur) {
    tally.pages++;
    const ocr = cleanMayaOcr(p.ocr.data);
    const found = findMayaNumbers(ocr);
    if (!found.length) continue;
    tally.pagesWithPhrases++; tally.phrases += found.length;
    const en = englishNumbers(englishBody(p.translation.data));
    for (const f of found) {
      if (f.value <= 1) continue;
      const context = ocr.slice(Math.max(0, f.index - 60), f.index + f.text.length + 60);
      if (/\d/.test(context)) { tally.glossed++; continue; }
      tally.judged++;
      const cls = f.kind === 'classifier' ? 'small' : 'compound';
      const ok = en.has(f.value) || en.has(f.alt);
      tally[cls]++; if (!ok) tally[`${cls}Mismatch`]++;
      out?.write(JSON.stringify({ book_id: b.id, title: b.title?.slice(0, 60), page_id: p.id, page: p.page_number, model: p.translation.model, phrase: f.text, value: f.value, alt: f.alt, ordinal: f.ordinal, kind: f.kind, class: cls, ok,
        context: context.replace(/\s+/g, ' '), english_numbers: [...en].sort((x, y) => x - y).slice(0, 40),
        url: `https://sourcelibrary.org/book/${b.id}?page=${p.page_number}` }) + '\n');
    }
  }
}
out?.end();
console.log(JSON.stringify(tally));
await client.close();
