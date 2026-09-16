#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/ia-ocr-leaf-drift.mjs (checks leaf ALIGNMENT of written IA pages, not
 * their content); scripts/import/ia-ocr-ingest.mjs (applies the guards at WRITE time only — pages
 * filled before 2026-09-14 were never screened by its garbage-leaf guard, and none were screened
 * by the trigram test). Nothing re-judges pages already written by the free OCR lane.
 *
 * ia-ocr-page-plausibility — which pages written by the free OCR lane look like junk?
 *
 * Read-only. Walks every `ia_ocr_ingest` book (from `book_events`, never a corpus scan), builds the
 * book's reference from its model-read text pages, and scores each `ocr.source: 'ia_djvu'` page by
 * the two page-level tests the ingester now applies:
 *
 *   - word share  — share of the page's tokens in the book's model-read vocabulary, cut at 0.4× the
 *                   book's own median over its IA pages (the ingester's 2026-09-14 guard);
 *   - trigram share — share of the page's in-word letter trigrams in the reference (#4784, cut 0.4).
 *
 * Writes one JSONL line per flagged page (`--out`) and prints a summary. The removal of a flagged
 * page's text is a separate, human-approved step: these pages had NO text before the fill, so the
 * repair is to clear `ocr` again (and the revision row from the fill, if any, says what was there).
 *
 * Usage (Hetzner, no model calls):
 *   node --env-file=.env.production.local scripts/audit/ia-ocr-page-plausibility.mjs [--limit N] [--out file.jsonl] [--ids file]
 */
import fs from 'node:fs';
import { withMongo } from '../lib/mongo.mjs';
import { referenceTrigramSet, pagePlausibility, DEFAULT_MIN_PLAUSIBILITY } from '../lib/ocr-plausibility.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const LIMIT = +arg('--limit', 0);
const OUT = arg('--out', `scripts/output/ia-ocr-page-plausibility-${new Date().toISOString().slice(0, 10)}.jsonl`);
const IDS = arg('--ids', null);
const SOURCE = 'ia_djvu';

// Same tokenizer and plate test as the ingester, so the word share here is the guard's number.
const tokens = (s) => (s || '').replace(/<[^>]+>/g, ' ').normalize('NFC').replace(/[’‘ʼ]/g, "'").toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
const isPlatePage = (t) => /<image-desc\b|\[Image:|<page-type>\s*(plate|illustration|image|photograph|figure|map)\b/i.test(t);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

fs.mkdirSync('scripts/output', { recursive: true });
const out = fs.createWriteStream(OUT, { flags: 'w' });

await withMongo(async (db) => {
  const P = db.collection('pages');
  let bookIds = IDS
    ? fs.readFileSync(IDS, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
    : (await db.collection('book_events').distinct('book_id', { type: 'ia_ocr_ingest' }));
  if (LIMIT) bookIds = bookIds.slice(0, LIMIT);
  console.log(`${bookIds.length} ingested books to audit → ${OUT}`);
  const t = { books: 0, books_no_ref: 0, ia_pages: 0, scored: 0, word_flag: 0, trigram_flag: 0, either: 0, both: 0 };
  const started = Date.now();
  for (const [i, bid] of bookIds.entries()) {
    const pages = await P.find({ book_id: bid, 'ocr.data': { $type: 'string' } }, { projection: { id: 1, page_number: 1, 'ocr.source': 1, 'ocr.data': 1 } }).toArray();
    const refTexts = pages.filter((p) => p.ocr.source !== SOURCE && !isPlatePage(p.ocr.data)).map((p) => p.ocr.data);
    const ia = pages.filter((p) => p.ocr.source === SOURCE);
    t.books++; t.ia_pages += ia.length;
    if (refTexts.length < 5 || !ia.length) { t.books_no_ref++; continue; }
    const vocab = new Set(); for (const r of refTexts) for (const w of tokens(r)) vocab.add(w);
    const refSet = referenceTrigramSet(refTexts);
    const wordShare = (s) => { const tt = tokens(s); return tt.length >= 20 ? tt.filter((w) => vocab.has(w)).length / tt.length : null; };
    const shares = ia.map((p) => wordShare(p.ocr.data));
    const cut = 0.4 * median(shares.filter((x) => x !== null));
    for (const [j, p] of ia.entries()) {
      const ws = shares[j]; const { share: ts } = pagePlausibility(p.ocr.data, refSet);
      if (ws === null && ts === null) continue;
      t.scored++;
      const wordFlag = ws !== null && ws < cut; const triFlag = ts !== null && ts < DEFAULT_MIN_PLAUSIBILITY;
      if (wordFlag) t.word_flag++; if (triFlag) t.trigram_flag++; if (wordFlag && triFlag) t.both++;
      if (wordFlag || triFlag) {
        t.either++;
        out.write(JSON.stringify({ book_id: bid, page_id: p.id, page_number: p.page_number, word_share: ws === null ? null : +ws.toFixed(3), word_cut: +cut.toFixed(3), trigram_share: ts === null ? null : +ts.toFixed(3), flags: [wordFlag && 'word', triFlag && 'trigram'].filter(Boolean), sample: p.ocr.data.replace(/\s+/g, ' ').slice(0, 160) }) + '\n');
      }
    }
    if (i % 50 === 0) console.log(`  ${i}/${bookIds.length} · ${((Date.now() - started) / 60000).toFixed(1)} min · ${JSON.stringify(t)}`);
  }
  out.end();
  console.log(JSON.stringify(t));
}, { timeoutMs: 4 * 3600 * 1000 });
