/**
 * Scan/record mismatch audit — "is the scanned book the book the record claims?"
 *
 * Motivated by `parliamentaryspe00byrouoft` (2026-08-01): the Internet Archive
 * item is catalogued as Byron's *Parliamentary Speeches* (1824) and its 378
 * scanned leaves are Charles Kingsley's *Hypatia* (Macmillan 1889). Our metadata
 * mirrored IA's correctly and our archiver copied IA's images correctly — the
 * pairing broke upstream, so neither artifact is wrong on its own. Same shape as
 * the paired-artifact incidents in CLAUDE.md, one level further out.
 *
 * DETECTOR: does any distinctive token of the catalogue title — or the author's
 * surname — appear anywhere in the book's own OCR text?
 *
 * ELIGIBILITY (stated before the analysis, per CLAUDE.md; a book failing any of
 * these is reported as SKIPPED with a reason, never as a suspect):
 *   - visible: true, pages_count > 0
 *   - >= MIN_TEXT_CHARS of OCR text across the sampled pages. Below that,
 *     "the title is absent" is a statement about missing OCR, not about identity.
 *   - the title yields >= 1 distinctive token (alphabetic, >= 5 chars, not a stopword)
 *   - LATIN-SCRIPT TITLE *AND* LATIN-SCRIPT TEXT. A Chinese book with an English
 *     catalogue title legitimately never contains that title; running the
 *     detector across a script boundary manufactures false positives by the
 *     thousand. Cross-script books are skipped, not judged.
 *   - not degenerate OCR: entity padding stripped, and type/token ratio >= 0.15
 *     on texts over 120 words (the repetition-loop screen from CLAUDE.md).
 *   - PRINTED, per the OCR envelope's own `<script>printed</script>` tag on a
 *     plurality of sampled pages. This gate is load-bearing: on a 400-book pilot
 *     WITHOUT it, 9 of 9 suspects were false — Vatican/MDZ manuscripts and
 *     incunabula whose catalogue title is a modern scholarly description
 *     ("Corpus Hermeticum (Pimander & Asclepius)", "Alchimia sive Speculum
 *     Secretorum"). A codex has no printed title page, so the detector has
 *     nothing to match and absence means nothing. The detector is only
 *     meaningful where a printed title page exists to disagree with.
 *
 * WHAT IT CANNOT SEE: a book whose title is a modern editorial description
 * rather than the printed title, and a mismatch between two *editions of the
 * same work*. It finds wholly-wrong-volume cases like Byron/Hypatia.
 *
 * Two-stage so the corpus pass is affordable: a cheap screen over the first
 * SCREEN_PAGES OCR'd pages, then a deeper CONFIRM_PAGES read for anything that
 * fails the screen. Most books pass stage 1 and are never read again.
 *
 * READ-ONLY. Writes nothing. Usage:
 *   node --env-file=.env.production.local scripts/audit/scan-title-mismatch.mjs [--limit N] [--ids a,b] [--concurrency 8] [--out FILE]
 * A full run that misses the positive control exits 2.
 *
 * Last full run 2026-10-22 (#7146): 24,427 of 42,292 judged, 13 live suspects, 8 real
 * by eye; result and what it cannot see → scripts/eval/experiments/2026-10-22-how-many-live-books-hold-a-scan-of-a-different.md
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argVal = (flag, dflt) => { const i = args.indexOf(flag); return i === -1 ? dflt : args[i + 1]; };
const LIMIT = parseInt(argVal('--limit', '0')) || 0;
const OUT = argVal('--out', 'scripts/output/scan-title-mismatch.json');

const SCREEN_PAGES = 12;
const CONFIRM_PAGES = 60;
const MIN_TEXT_CHARS = 2000;
const MIN_TOKEN_LEN = 5;

// Words too common in early-modern titles to distinguish one book from another.
const STOP = new Set([
  'being', 'volume', 'their', 'about', 'which', 'other', 'these', 'those', 'first',
  'second', 'third', 'fourth', 'wherein', 'whereof', 'together', 'containing',
  'contained', 'according', 'concerning', 'translated', 'printed', 'edition',
  'london', 'paris', 'wherewith', 'thereof', 'himself', 'unknown', 'anonymous',
  'selected', 'collected', 'complete', 'general', 'several', 'various', 'sundry',
  'newly', 'lately', 'divers', 'certain', 'brief', 'short', 'great', 'grand',
].map(w => fold(w)));

const LATIN_RE = /[a-z]/i;
/** Share of LETTERS that are not Latin-script. Unicode script property, not a
 *  hand-listed range set: the old ranges missed Tibetan, Syriac, Ethiopic,
 *  Armenian, Georgian… so a Derge Tengyur volume (title "… (Derge Tengyur,
 *  vol. 1)") passed as Latin text and fell through to the printed gate (#7146). */
function nonLatinShare(s) {
  const sample = s.slice(0, 4000);
  const letters = sample.match(/\p{L}/gu) || [];
  if (!letters.length) return 0;
  const latin = letters.filter(ch => /\p{Script=Latin}/u.test(ch)).length;
  return (letters.length - latin) / letters.length;
}

/** Fold a string to a matching key, applied identically to the catalogue
 *  title and the page text: strip diacritics, expand ligatures, long s, and
 *  merge the early-modern u/v and i/j alternations. Without it "Théâtre"
 *  tokenised to "th"+"tre", "Philosophiæ" lost its ending, and a 1650 page
 *  printing "VNIVERSALL" never matched a record saying "universal" (#7146). */
function fold(s) {
  return String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ſ/g, 's').replace(/ß/g, 'ss')
    .replace(/v/g, 'u').replace(/j/g, 'i');
}

/** Strip HTML entities before tokenising — `&nbsp;` padding inflates every
 *  word-count metric (CLAUDE.md, degenerate-output class). */
function normalise(s) {
  return fold(String(s || '').replace(/&[a-z]+;/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

/** The OCR envelope's own COMMENTARY — not text printed on the page. It is
 *  written in English whatever the book's language ("Handwritten Greek
 *  minuscule…", "A woodblock print of a Buddhist sutra…"), so left in, it
 *  passed Chinese, Greek and Arabic books through the cross-script gate as
 *  Latin text: 4 of the 7 false suspects in the 2026-10-22 eye check (#7146).
 *  Stripped ONLY for the script share. Stripping it from the match text too
 *  was tried and was worse: `<vocab>` carries real page words that clear true
 *  books (45 suspects instead of 15), and the control fell under the text
 *  minimum. */
const pageScriptText = raw => String(raw || '').replace(COMMENTARY_RE, ' ').replace(/<[^>]+>/g, ' ');
const COMMENTARY_RE = /<(meta|warning|image-desc|vocab|scan-quality|language|script|page-type)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Repetition-loop screen: a page of `तथा तथा तथा…` is not evidence of anything. */
function isDegenerate(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 120) return false;
  return new Set(words).size / words.length < 0.15;
}

function titleTokens(title) {
  return [...new Set(
    fold(title)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= MIN_TOKEN_LEN && !STOP.has(w) && !/^\d+$/.test(w)),
  )];
}

/**
 * Does the text carry any evidence of this title or author? Matches on a 6-char
 * PREFIX so Latin inflection doesn't read as absence ("hermeticum" in the record
 * vs "hermetica" on the page is the same word for our purposes).
 */
function hits(tokens, surname, text) {
  const prefixes = tokens.map(t => t.slice(0, 6));
  if (prefixes.some(p => text.includes(p))) return true;
  return !!(surname && text.includes(surname.slice(0, 6)));
}

/** "Byron, George Gordon" -> "byron"; "Charles Kingsley" -> "kingsley". */
function authorSurname(author) {
  const a = String(author || '').trim();
  if (!a) return null;
  const surname = a.includes(',') ? a.split(',')[0] : a.split(/\s+/).pop();
  const s = fold(surname).replace(/[^a-z]/g, '');
  return s.length >= 4 ? s : null;
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

/** Is this book PRINTED? Read the OCR envelope's own `<script>` verdict across
 *  the sampled pages. Manuscripts report `handwritten` / `cursive` / a hand
 *  name; printed books report `printed`. Pages with no verdict (blanks, covers)
 *  don't vote.
 *
 *  Measured 2026-10-22 on a 6,000-page sample (#7146): every Gemini OCR model
 *  (3-flash, 3.1-flash-lite) and PaddleOCR-VL still emit the tag. Pages that
 *  do NOT carry it are imported text — `bdrc-yigdzin-v1` (Tibetan e-texts),
 *  `ia-ocr` (IA's own OCR) — and a March 2026 flash cohort. A book with no
 *  verdict at all is skipped as `no_script_tag`, NOT as a manuscript: the two
 *  were one bucket, which is why the first full run read as "228 manuscripts". */
function printedVerdict(rawJoined) {
  const tags = [...rawJoined.matchAll(/<script>([^<]*)<\/script>/gi)].map(m => m[1].toLowerCase().trim());
  let printed = 0, hand = 0;
  for (const t of tags) {
    if (!t || t === 'none' || t === 'null') continue;
    if (t.includes('print')) printed++;
    else if (/hand|cursive|gothic|hybrida|script|minuscule|chancery|italic/.test(t)) hand++;
  }
  return { printed, hand };
}

/**
 * `page_number >= 0` is NOT optional. Archived-spread pages carry NEGATIVE page
 * numbers, so a plain ascending sort returns them FIRST — the sample then reads
 * binding shots and library bookplates instead of the book, and the title
 * legitimately never appears. That bug produced both suspects of the first full
 * run (Sama Veda: 9 pages of Ramakrishna Mission bookplates at p-547…p-539;
 * Ortus sanitatis: 9 leather covers at p-1534…p-1526). Same filter the book page
 * itself uses.
 */
async function ocrRaw(bookId, limit) {
  const pages = await db.collection('pages')
    .find(
      { book_id: bookId, page_number: { $gte: 0 }, 'ocr.data': { $exists: true, $ne: null } },
      { projection: { _id: 0, 'ocr.data': 1 }, maxTimeMS: 20000 },
    )
    .sort({ page_number: 1 })
    .limit(limit)
    .toArray();
  return pages.map(p => p.ocr?.data || '').join(' ');
}

// Positive control: the confirmed Byron/Hypatia mismatch. It is now hidden, so
// it falls outside the `visible: true` population — include it explicitly and
// assert at the end that the detector still catches it. A sweep that finds
// nothing is indistinguishable from a sweep that is broken.
const POSITIVE_CONTROL = '6a58f06fc6cd8f98710692d2';

// --ids a,b,c restricts the run to specific books, for spot-checking a fix
// against known true/false positives without re-sweeping the corpus.
const ONLY_IDS = argVal('--ids', '').split(',').map(s => s.trim()).filter(Boolean);

const query = ONLY_IDS.length
  ? { id: { $in: ONLY_IDS } }
  : {
    pages_count: { $gt: 0 },
    pages_ocr: { $gt: 0 },
    $or: [{ visible: true }, { id: POSITIVE_CONTROL }],
  };
const total = await db.collection('books').countDocuments(query, { maxTimeMS: 120000 });
const CONCURRENCY = parseInt(argVal('--concurrency', '8')) || 8;
console.log(`eligible population (visible, pages>0, some OCR): ${total}`);
console.log(`stage 1 = first ${SCREEN_PAGES} OCR'd pages; stage 2 = first ${CONFIRM_PAGES}\n`);

const suspects = [];
const skipped = {};
let checked = 0, cleared = 0, lastId = null, screenFails = 0;

const bump = k => { skipped[k] = (skipped[k] || 0) + 1; };

// Keyset pagination on the `id` STRING, never on `_id` — a cursor held open
// across a run this long hits CursorNotFound (CLAUDE.md, repair-sweep failure
// modes), and `_id` is mixed-type: 282 live books have a STRING `_id`, which
// BSON orders before every ObjectId. `{_id: {$gt: <string>}}` then matches no
// ObjectId at all, so the first full run ended after the 282 string-`_id`
// books (all BDRC Tibetan) and never reached the other 42,009 — nor the
// positive control (#7146).
const BATCH = 250;
for (;;) {
  const q = lastId ? { $and: [query, { id: { $gt: lastId } }] } : query;
  const batch = await db.collection('books')
    .find(q, { projection: { id: 1, slug: 1, title: 1, author: 1, published: 1, language: 1, ia_identifier: 1, pages_count: 1, pages_ocr: 1, image_source: 1 }, maxTimeMS: 60000 })
    .sort({ id: 1 }).limit(BATCH).toArray();
  if (!batch.length) break;
  lastId = batch[batch.length - 1].id;

  const todo = LIMIT ? batch.slice(0, Math.max(0, LIMIT - checked)) : batch;
  checked += todo.length;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(todo.slice(i, i + CONCURRENCY).map(judge));
  }

  if (LIMIT && checked >= LIMIT) break;
  if (checked % 1000 < BATCH) console.log(`… ${checked}/${total} checked, ${cleared} cleared, ${suspects.length} suspects`);
}

async function judge(b) {
  // Script first, tokens second: a CJK title carrying "(vol 3)" has Latin
  // letters but no Latin title, and used to be counted as "no distinctive
  // token" (12K books) rather than as cross-script (#7146).
  if (!LATIN_RE.test(String(b.title || '')) || nonLatinShare(String(b.title)) > 0.5) { bump('non_latin_title'); return; }
  const tokens = titleTokens(b.title);
  const surname = authorSurname(b.author);
  if (!tokens.length) { bump('no_distinctive_title_token'); return; }

  const screenRaw = await ocrRaw(b.id, SCREEN_PAGES);
  const screen = normalise(screenRaw);
  if (screen.length < MIN_TEXT_CHARS) { bump('too_little_ocr'); return; }
  if (nonLatinShare(pageScriptText(screenRaw)) > 0.15) { bump('non_latin_text'); return; }
  if (isDegenerate(screen)) { bump('degenerate_ocr'); return; }

  if (hits(tokens, surname, screen)) { cleared++; return; }

  // Stage 2: read deeper before calling it a suspect.
  screenFails++;
  const deepRaw = await ocrRaw(b.id, CONFIRM_PAGES);
  const deep = normalise(deepRaw);
  if (hits(tokens, surname, deep)) { cleared++; return; }

  // Only NOW apply the printed gate — it needs the deeper sample to judge,
  // and running it on every book would double the reads for no benefit.
  const { printed, hand } = printedVerdict(deepRaw);
  if (printed + hand === 0) { bump('no_script_tag'); return; }
  if (printed < 3 || hand >= printed) { bump('not_printed_manuscript'); return; }

  suspects.push({
    id: b.id, slug: b.slug, title: b.title, author: b.author, published: b.published,
    language: b.language, ia_identifier: b.ia_identifier,
    pages_count: b.pages_count, pages_ocr: b.pages_ocr,
    provider: b.image_source?.provider || null,
    title_tokens: tokens, surname,
    printed_pages: printed, handwritten_pages: hand,
    chars_examined: deep.length,
    url: `https://sourcelibrary.org/book/${b.slug || b.id}`,
  });
  console.log(`  SUSPECT  ${String(b.title).slice(0, 60)}  | ${String(b.author).slice(0, 25)} | ia=${b.ia_identifier || '-'}`);
}

console.log(`\n===== RESULT =====`);
console.log(`checked        : ${checked}`);
console.log(`cleared        : ${cleared}`);
console.log(`failed screen  : ${screenFails} (re-read deeper)`);
console.log(`SUSPECTS       : ${suspects.length}`);

const caughtControl = suspects.some(s => s.id === POSITIVE_CONTROL);
console.log(`\npositive control (Byron/Hypatia) caught: ${caughtControl ? 'YES' : 'NO — DETECTOR IS BROKEN, do not trust this run'}`);
console.log(`\nskipped (ineligible, NOT judged):`);
console.table(skipped);

writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), checked, cleared, skipped, suspects }, null, 2));
console.log(`\nfull suspect list → ${OUT}`);

await client.close();
// A run that misses its control is void — say so in the exit code, not only in prose.
if (!ONLY_IDS.length && !LIMIT && !caughtControl) process.exit(2);
