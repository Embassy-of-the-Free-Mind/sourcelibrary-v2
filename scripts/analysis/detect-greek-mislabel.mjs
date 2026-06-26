#!/usr/bin/env node
/**
 * detect-greek-mislabel.mjs — READ-ONLY detector for issue #2761.
 *
 * Greek (and Greek/Latin) facing-page editions stored with books.language === 'English'
 * never got a real Greek->English translation: performTranslation() / getTranslationPrompt()
 * swap to the ENGLISH_MODERNIZATION_PROMPT passthrough whenever
 *   sourceLanguage.toLowerCase() === 'english'   (src/lib/ai.ts:206, src/lib/prompts.ts:182)
 * and sourceLanguage is fed from book.language. So an English-labeled Greek book is
 * "modernized" (passed through), not translated.
 *
 * This script scores each candidate by the fraction of its pages whose wrapper-stripped
 * OCR text is "Greek-heavy" (>GREEK_CHARS_THRESHOLD Greek chars). A book is a suspect
 * when >= GREEK_PAGE_FRACTION of EVENLY-SAMPLED pages are Greek-heavy.
 *
 * CRITICAL sampling note: facing-page editions open with English front matter
 * (title, intro, preface). Sampling the FIRST N pages undercounts badly
 * (Galen Loeb measured 12.8% front-loaded vs 78.6% evenly-sampled). This script
 * samples EVENLY across the whole page range — keep it that way.
 *
 * It does NOT write to the database. With --plan it emits a relabel plan to stdout/JSON
 * (FREE, reversible) for a human to review; applying it is a separate step.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/analysis/detect-greek-mislabel.mjs                 # scan prime pre-filter, report
 *   node scripts/analysis/detect-greek-mislabel.mjs --all           # scan ALL English+pages>20 (slow)
 *   node scripts/analysis/detect-greek-mislabel.mjs --sample 80     # pages sampled per book
 *   node scripts/analysis/detect-greek-mislabel.mjs --plan out.json # also write relabel plan JSON
 *   node scripts/analysis/detect-greek-mislabel.mjs --ids a,b,c     # validate specific _id hexes
 */
import { MongoClient, ObjectId } from 'mongodb';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const SAMPLE = parseInt(val('--sample', '60'), 10);   // pages sampled per book (evenly)
const GREEK_CHARS_THRESHOLD = 120;                     // page is Greek-heavy if > this many Greek chars
const GREEK_PAGE_FRACTION = 0.40;                      // book is suspect if >= this fraction Greek-heavy
const COPYRIGHT_CUTOFF_YEAR = new Date().getFullYear() - 95; // < 95 yrs => legal caution

// Greek & Coptic U+0370-U+03FF  +  Greek Extended U+1F00-U+1FFF
const GREEK = /[Ͱ-Ͽἀ-῿]/g;
// Roman-script letters (Latin/English — NOT distinguishable by codepoint alone)
const ROMAN = /[A-Za-zÀ-ɏ]/g;

// Mirror of src/lib/strip-editorial-wrappers.ts EDITORIAL_WRAPPERS (page-describing blocks).
const EDITORIAL = 'meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning';
const stripWrappers = (t) => !t ? '' :
  t.replace(new RegExp(`<(${EDITORIAL})>[\\s\\S]*?<\\/\\1>`, 'gi'), ' ')
   .replace(new RegExp(`<\\/?(?:${EDITORIAL})>`, 'gi'), ' ');

function legalFlag(book) {
  const y = parseInt(book.published, 10) || book.year || null;
  const loeb = /loeb/i.test(book.title || '') || /loeb/i.test(book.publisher || '');
  if (loeb || /harvard university press|HUP/i.test(book.publisher || '')) {
    return `CAUTION: Loeb/HUP imprint${y ? ` (ed. ${y})` : ''} — verify scan is the PD original, not a post-1930 revised reprint`;
  }
  if (y && y > COPYRIGHT_CUTOFF_YEAR) return `CAUTION: ${y} is < 95 yrs old — possibly in copyright`;
  return y ? `ok (${y}, PD)` : 'unknown year — verify';
}

async function analyze(db, book) {
  const q = { $or: [{ book_id: book.id }, { book_id: String(book._id) }] };
  const all = await db.collection('pages')
    .find({ ...q, 'ocr.data': { $exists: true, $ne: '' } }, { projection: { page_number: 1, 'ocr.data': 1 } })
    .sort({ page_number: 1 }).toArray();
  const N = all.length;
  if (!N) return null;
  const step = Math.max(1, Math.floor(N / Math.min(SAMPLE, N)));
  let greekHeavy = 0, withText = 0, romanHeavy = 0, totalGreek = 0;
  for (let i = 0; i < N; i += step) {
    const txt = stripWrappers(all[i].ocr?.data || '');
    if (!txt.trim()) continue;
    withText++;
    const g = (txt.match(GREEK) || []).length;
    const r = (txt.match(ROMAN) || []).length;
    totalGreek += g;
    if (g > GREEK_CHARS_THRESHOLD) greekHeavy++;
    if (r > 200 && g < 40) romanHeavy++;          // predominantly roman-script (English/Latin facing page)
  }
  const frac = withText ? greekHeavy / withText : 0;
  return {
    _id: String(book._id), title: book.title, language: book.language,
    original_language: book.original_language ?? null, text_role: book.text_role ?? null,
    year: parseInt(book.published, 10) || book.year || null, pages_count: book.pages_count,
    ocrPages: N, sampled: withText, greekHeavy, greekFrac: +(frac * 100).toFixed(1),
    romanHeavyPages: romanHeavy, avgGreekPerPage: withText ? Math.round(totalGreek / withText) : 0,
    suspect: frac >= GREEK_PAGE_FRACTION,
    // proposed language: Greek if facing roman pages present, else "Greek". Refine to
    // "Greek, Latin" only after a per-page Latin-vs-English check (codepoints can't tell them apart).
    proposedLanguage: 'Greek',
    estGreekPages: Math.round(frac * (book.pages_count || N)),
    legal: legalFlag(book),
  };
}

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const B = db.collection('books');

let cursor;
if (val('--ids', null)) {
  const ids = val('--ids', '').split(',').map((s) => ObjectId.createFromHexString(s.trim()));
  cursor = B.find({ _id: { $in: ids } });
} else if (flag('--all')) {
  // Authoritative full scan (slow): every English-labeled book with real pagination.
  cursor = B.find({ language: 'English', pages_count: { $gt: 20 } });
} else {
  // Cheap high-signal pre-filter: English-labeled but flagged as a Greek original/translation.
  cursor = B.find({ language: 'English', pages_count: { $gt: 20 }, original_language: 'Greek' });
}

const results = [];
for await (const book of cursor) {
  const r = await analyze(db, book);
  if (r) results.push(r);
}
results.sort((a, b) => b.greekFrac - a.greekFrac);

const suspects = results.filter((r) => r.suspect);
console.log(`Scanned ${results.length} candidate books; ${suspects.length} suspects (>=${GREEK_PAGE_FRACTION * 100}% Greek-heavy pages).\n`);
console.log('id                        | yr   | pp   | grk% | avgGrk | proposed | legal');
for (const r of suspects) {
  console.log(`${r._id} | ${String(r.year ?? '?').padEnd(4)} | ${String(r.pages_count).padEnd(4)} | ${String(r.greekFrac).padEnd(4)} | ${String(r.avgGreekPerPage).padEnd(6)} | ${r.proposedLanguage.padEnd(8)} | ${r.legal}`);
  console.log(`    ${(r.title || '').slice(0, 90)}`);
}
const totalGreekPages = suspects.reduce((s, r) => s + r.estGreekPages, 0);
console.log(`\nEstimated Greek pages needing real translation across suspects: ~${totalGreekPages}`);

if (val('--plan', null)) {
  const fs = await import('node:fs');
  const plan = suspects.map((r) => ({
    _id: r._id, title: r.title,
    from: { language: r.language }, to: { language: r.proposedLanguage },
    greekFrac: r.greekFrac, estGreekPages: r.estGreekPages, legal: r.legal,
  }));
  fs.writeFileSync(val('--plan'), JSON.stringify(plan, null, 2));
  console.log(`\nRelabel plan written to ${val('--plan')} (review before applying; applying is a separate FREE/reversible step).`);
}

await mc.close();
