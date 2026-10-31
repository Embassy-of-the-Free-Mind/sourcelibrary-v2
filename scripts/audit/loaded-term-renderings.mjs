#!/usr/bin/env node
/**
 * PRIOR ART: scripts/lib/loaded-terms.mjs is the predicate (its header lists what was checked);
 * this is the shelf runner, shaped like scripts/audit/detect-modern-intrusion.mjs.
 *
 * loaded-term-renderings — work list of pages whose English renders a watched source term
 * (δαίμων, 鬼, 巫, 術, veneficium, magus, vidyā/māyā) with the loaded English an intermediary
 * language carried in ("demon", "sorcery", "magician", "magic"). #7475; watchlist in
 * scripts/lib/loaded-term-watchlist.json.
 *
 * READ-ONLY. A hit is a candidate for the #7402 recipe (`cli-translate.mjs read
 * --instructions-file` with the class's `sense`), never an automatic rewrite: "demon" is right
 * where the source means an evil spirit. Sample by eye and record precision before acting.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/loaded-term-renderings.mjs                       # default shelves
 *   node scripts/audit/loaded-term-renderings.mjs --collections magic,demonology
 *   node scripts/audit/loaded-term-renderings.mjs --book-id <id>
 *   node scripts/audit/loaded-term-renderings.mjs --json $JOB_SCRATCH/hits.jsonl
 * Exit 0 = clean, 1 = hits, 2 = the positive control did not fire (do not trust the run).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import {
  loadWatchlist, classesForLanguage, screenPage, TRANSLATION_PREFILTER, OCR_PREFILTER,
} from '../lib/loaded-terms.mjs';

const args = process.argv.slice(2);
const getArg = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const BOOK_ID = getArg('--book-id');
const JSON_OUT = getArg('--json');
const WINDOW = parseFloat(getArg('--window', '0.2'));
// The shelves #7475's definition of done names: magic, demonology, Greek philosophy, Chinese religion.
const DEFAULT_COLLECTIONS = [
  'magic', 'ritual-ceremonial-magic', 'natural-magic-sympathies', 'spirit-conjuration', 'indic-magic',
  'demonology', 'theological-demonology', 'witch-trial-literature', 'global-demonology',
  'classical-philosophy', 'neoplatonism', 'ancient-greek-religion', 'platonic-tradition',
  'daoist-classics', 'chinese-daoist-magic', 'chinese-buddhist-texts', 'chinese-divination-cosmology',
  'chinese-fiction',
];
const COLLECTIONS = (getArg('--collections') || DEFAULT_COLLECTIONS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

// Positive controls: two of #7475's evidence pages, by their pre-fix English (the stored pages
// were repaired by #7402, so the stored text no longer fires). Also pinned in the unit test.
const CONTROLS = [
  { lang: 'German', ocr: 'Und so sagt denn Heraklit: ἦθος ἀνθρώπῳ δαίμων, der Charakter ist dem Menschen sein Dämon.', tr: 'And so Heraclitus says: ἦθος ἀνθρώπῳ δαίμων, Character is to man a demon.', cls: 'daimon-greek' },
  { lang: 'Chinese', ocr: '古者巫咸作筮', tr: 'In antiquity Wu Xian practised sorcery and invented divination.', cls: 'wu-chinese' },
];

const classes = loadWatchlist();
for (const c of CONTROLS) {
  const hit = screenPage({ ocr: c.ocr, translation: c.tr }, classesForLanguage(classes, c.lang), { window: 1 });
  if (!hit.some((h) => h.class === c.cls)) {
    console.error(`CONTROL FAILED (${c.cls}) — the predicate no longer sees the case it was built for.`);
    process.exit(2);
  }
}
console.log(`controls: ${CONTROLS.length}/${CONTROLS.length} fire ✓`);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const bookMatch = BOOK_ID
  ? { id: BOOK_ID }
  : { visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 }, collections: { $in: COLLECTIONS } };
const books = await db.collection('books')
  .find(bookMatch, { projection: { id: 1, title: 1, language: 1, collections: 1, published: 1 } })
  .toArray();
console.log(`books: ${books.length} (${BOOK_ID ? 'one book' : COLLECTIONS.length + ' collections'})`);

const out = JSON_OUT ? fs.createWriteStream(JSON_OUT) : null;
const byClass = {};
let pagesScanned = 0, pagesHit = 0, booksDone = 0, skippedEnglish = 0;
for (const b of books) {
  booksDone++;
  const cls = classesForLanguage(classes, b.language, b.collections);
  if (!cls.length) { skippedEnglish++; continue; }
  const cursor = db.collection('pages').find(
    { book_id: b.id, 'translation.data': TRANSLATION_PREFILTER, 'ocr.data': OCR_PREFILTER },
    { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'word_alignment.pairs': 1 } },
  );
  for await (const p of cursor) {
    pagesScanned++;
    const hits = screenPage(
      { ocr: p.ocr?.data, translation: p.translation?.data, alignment: p.word_alignment?.pairs },
      cls, { window: WINDOW },
    );
    if (!hits.length) continue;
    pagesHit++;
    for (const h of hits) {
      byClass[h.class] = (byClass[h.class] || 0) + 1;
      out?.write(JSON.stringify({
        page_id: p.id, book_id: b.id, page_number: p.page_number, title: (b.title || '').slice(0, 80),
        language: b.language, collections: b.collections, ...h,
      }) + '\n');
    }
  }
  if (booksDone % 100 === 0) console.log(`  …${booksDone}/${books.length} books, ${pagesHit} pages hit`);
}
out?.end();
await client.close();

console.log(`\nprefiltered pages screened: ${pagesScanned}; pages with a hit: ${pagesHit}; English-language books skipped: ${skippedEnglish}`);
for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`);
if (JSON_OUT) console.log(`\nwrote ${JSON_OUT}`);
process.exit(pagesHit ? 1 : 0);
