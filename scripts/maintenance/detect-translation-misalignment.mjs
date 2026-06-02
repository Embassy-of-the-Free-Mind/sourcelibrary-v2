#!/usr/bin/env node
/**
 * Detect pages whose stored English TRANSLATION belongs to a different leaf than
 * the one actually scanned/OCR'd — i.e. the translation layer is misaligned with
 * the page image.
 *
 * Why this exists
 * ---------------
 * Found 2026-05-31 on "Utriusque Cosmi Historia Vol. 1" (book 6952dac677f38f6761bc683a,
 * IA `utriusquecosmima01flud`, the Getty Research Institute copy, DOI
 * 10.5281/zenodo.19055951). The page images and the OCR are a single, correct copy
 * — every page_number maps to its own Internet-Archive leaf (pn N -> IA leaf n(N-1))
 * and the OCR's printed-page number matches the scan. But a large block of the
 * ENGLISH translations was written onto the wrong leaves: e.g. the machines leaf
 * (OCR printed 452) carries the alchemy translation (printed 42); astrology leaves
 * (OCR printed 634/636) carry geometry translations (printed 104/106). ~70% of that
 * volume's comparable pages were affected. Readers see a correct Latin scan with an
 * unrelated English translation, and the misaligned text is baked into the DOI'd
 * edition.
 *
 * Detection signal (image-free, fast)
 * -----------------------------------
 * The OCR is the ground truth here — it is produced from, and matches, the scan.
 * Each page's text carries a <page-num>N</page-num> marker (the PRINTED folio
 * number) in both ocr.data and translation.data. On a correctly-aligned page the
 * two agree. When they disagree by more than a small tolerance, the translation is
 * on the wrong leaf. We also compare the <header> as a secondary signal.
 *
 * This is READ-ONLY. It never writes. It reports books and the affected pages so a
 * targeted re-translation (from the already-correct OCR) can be planned and the
 * DOI edition re-minted.
 *
 * Usage
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/detect-translation-misalignment.mjs [options]
 *
 * Options
 *   --book <id>       Scan a single book by Mongo _id (string form).
 *   --min-pages N     Only scan books with pages_count >= N in corpus sweep (default 80).
 *   --pct N           Flag a book when >= N% of comparable pages are misaligned (default 5).
 *   --min-flagged N   ...and at least N pages are misaligned (default 5).
 *   --tolerance N     Allowed |ocrPrinted - trPrinted| difference (default 3).
 *   --limit N         Stop after reporting N flagged books.
 *   --json            Emit a JSON array instead of the human report.
 *   --list-pages      For --book, list every flagged page_number (ocr/tr pair).
 */

import { MongoClient } from 'mongodb';

const argv = process.argv;
const has = name => argv.includes(name);
const getArg = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};

const BOOK = getArg('--book');
const MIN_PAGES = parseInt(getArg('--min-pages', '80'), 10);
const PCT = parseFloat(getArg('--pct', '5'));
const MIN_FLAGGED = parseInt(getArg('--min-flagged', '5'), 10);
const TOLERANCE = parseInt(getArg('--tolerance', '3'), 10);
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit'), 10) : Infinity;
const JSON_OUT = has('--json');
const LIST_PAGES = has('--list-pages');

const env = process.env;
if (!env.MONGODB_URI) {
  console.error('MONGODB_URI not set. Run: set -a; source .env.production.local; set +a; node <script>');
  process.exit(1);
}

const printedNum = data => {
  const m = (data || '').match(/<page-num>\s*([0-9]+)\s*<\/page-num>/i);
  return m ? parseInt(m[1], 10) : null;
};
const headerKey = data => {
  const m = (data || '').match(/<header>([^<]{0,40})<\/header>/i);
  return m ? m[1].replace(/\s+/g, '').toUpperCase() : '';
};

async function scanBook(db, bookId) {
  const pages = await db
    .collection('pages')
    .find({ book_id: bookId }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } })
    .toArray();

  let comparable = 0;
  let flagged = 0;
  const flaggedPages = [];
  for (const p of pages) {
    const ocrData = p.ocr && p.ocr.data;
    const trData = p.translation && p.translation.data;
    const o = printedNum(ocrData);
    const t = printedNum(trData);
    if (o == null || t == null) continue; // plates, blanks, untranslated — not comparable
    comparable++;
    if (Math.abs(o - t) > TOLERANCE) {
      flagged++;
      flaggedPages.push({ page_number: p.page_number, ocrPrinted: o, trPrinted: t, ocrHeader: headerKey(ocrData), trHeader: headerKey(trData) });
    }
  }
  const pct = comparable ? Math.round((1000 * flagged) / comparable) / 10 : 0;
  return { totalPages: pages.length, comparable, flagged, pct, flaggedPages };
}

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const db = client.db(env.MONGODB_DB || 'bookstore');

try {
  if (BOOK) {
    const meta = await db
      .collection('books')
      .findOne({ _id: new (await import('mongodb')).ObjectId(BOOK) }, { projection: { title: 1, doi: 1, ia_identifier: 1, pages_count: 1 } });
    const r = await scanBook(db, BOOK);
    if (JSON_OUT) {
      console.log(JSON.stringify({ book: BOOK, ...meta, ...r, flaggedPages: LIST_PAGES ? r.flaggedPages : undefined }, null, 2));
    } else {
      console.log(`\n${meta?.title || BOOK}`);
      console.log(`  IA: ${meta?.ia_identifier || '-'}   DOI: ${meta?.doi || '-'}`);
      console.log(`  pages: ${r.totalPages}   comparable (ocr+tr printed-num): ${r.comparable}`);
      console.log(`  MISALIGNED translations: ${r.flagged}  (${r.pct}% of comparable)`);
      const show = LIST_PAGES ? r.flaggedPages : r.flaggedPages.slice(0, 12);
      for (const f of show) {
        console.log(`    pn${f.page_number}: scan/ocr printed ${f.ocrPrinted} (${f.ocrHeader})  vs  translation printed ${f.trPrinted} (${f.trHeader})`);
      }
      if (!LIST_PAGES && r.flaggedPages.length > 12) console.log(`    …and ${r.flaggedPages.length - 12} more (use --list-pages)`);
    }
    process.exit(0);
  }

  // corpus sweep
  const books = await db
    .collection('books')
    .find({ pages_count: { $gte: MIN_PAGES } }, { projection: { title: 1, doi: 1, ia_identifier: 1, pages_count: 1 } })
    .toArray();

  const hits = [];
  for (const b of books) {
    const r = await scanBook(db, b._id.toString());
    if (r.flagged >= MIN_FLAGGED && r.pct >= PCT) {
      hits.push({ book: b._id.toString(), title: b.title, doi: b.doi || null, ia_identifier: b.ia_identifier || null, ...r, flaggedPages: undefined });
    }
  }
  hits.sort((a, b) => b.flagged - a.flagged);
  const limited = hits.slice(0, LIMIT);

  if (JSON_OUT) {
    console.log(JSON.stringify({ scanned: books.length, flaggedBooks: hits.length, results: limited }, null, 2));
  } else {
    console.log(`\nScanned ${books.length} books (pages_count >= ${MIN_PAGES}). Flagged ${hits.length} with >= ${PCT}% misaligned translations.\n`);
    console.log('flagged%  pages   DOI?   book / IA identifier');
    for (const h of limited) {
      console.log(
        `${String(h.flagged).padStart(5)} ${String(h.pct + '%').padStart(6)}  ${h.doi ? '[DOI]' : '     '}  ${(h.title || '').slice(0, 44)}  (${h.ia_identifier || h.book})`,
      );
    }
    if (!hits.length) console.log('  none — corpus clean by this signal.');
  }
} finally {
  await client.close();
}
