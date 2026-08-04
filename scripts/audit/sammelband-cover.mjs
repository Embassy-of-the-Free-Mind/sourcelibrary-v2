/**
 * Sammelband cover audit — "is the cover the title page of a DIFFERENT work
 * bound into the same volume?"
 *
 * Motivated by `magiaadamicaoran00vaug` (2026-08-03): the Getty copy of Thomas
 * Vaughan's *Magia Adamica* (1650) is bound AFTER a fragment of his *Man-Mouse
 * Taken in a Trap*, and this copy's own title leaf (A1) is wanting. The cover
 * selector looked for the first page classified `title-page`, found the
 * Man-Mouse one at scan p.7, and shipped it. Readers saw a book called *Magia
 * Adamica* wearing another book's title page; the enrichment pass, reading the
 * same opening leaves, then wrote a description of the Man-Mouse into
 * `dc_description`. Neither artifact is wrong on its own — the scan really does
 * open with that title page — so this is the paired-artifact class from
 * CLAUDE.md at the level of "which work within the volume".
 *
 * Sibling of `scan-title-mismatch.mjs`, which asks whether the SCAN is the
 * right book. This asks whether the COVER is the right work inside a scan that
 * is otherwise correct. Neither subsumes the other.
 *
 * DETECTOR — a conjunction, and the second half is what makes it a claim:
 *   (a) the cover IS a title page, and its text matches NO distinctive token of
 *       the book's title or its author's surname; AND
 *   (b) ANOTHER title page in the same volume DOES match.
 *
 * (a) alone is the failure I already walked into: it fires on every Tibetan,
 * Chinese, Japanese, Arabic, Korean and Tamil book whose romanised catalogue
 * title legitimately shares no characters with its own cover, and on books whose
 * title is a modern editorial description. Requiring (b) says the right title
 * page EXISTS IN THIS VOLUME and we picked a different one — which is the
 * defect, and which no script boundary can manufacture.
 *
 * ELIGIBILITY (stated before the analysis, per CLAUDE.md; a book failing any of
 * these is reported as SKIPPED with a reason, never as a suspect):
 *   - visible: true, pages_count > 0, cover_page set
 *   - thumbnail_source !== 'manual' — a human or vision pick is a DECISION.
 *     Overriding it is not this script's business.
 *   - >= 2 pages classified `page_type: 'title-page'`. With one, there is no
 *     "wrong one of several" to find; that book is scan-title-mismatch's job.
 *   - the cover page is itself one of those title pages. If the cover is a
 *     plate, a bookplate or a text page, this detector has no opinion on it.
 *   - LATIN-SCRIPT title AND Latin-script title-page text. 18,759 books carry
 *     >= 2 title pages, and a cross-script comparison judges the alphabet
 *     rather than the binding.
 *   - the title yields >= 1 distinctive token, and the cover text is not
 *     degenerate OCR (repetition loop / entity padding — CLAUDE.md).
 *
 * WHAT IT CANNOT SEE: a bound-with whose second work was never OCR-classified
 * as a title page; a volume where BOTH works' title leaves are missing (the
 * Vaughan copy is one step from this — its Magia Adamica title leaf is gone, so
 * the fix was a section head at p.55, which this detector would never propose);
 * and a wrong cover inside a single-work volume.
 *
 * READ-ONLY. Writes nothing but its report. Usage:
 *   node --env-file=.env.production.local scripts/audit/sammelband-cover.mjs [--limit N] [--out FILE]
 *   node --env-file=.env.production.local scripts/audit/sammelband-cover.mjs --control
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argVal = (flag, dflt) => { const i = args.indexOf(flag); return i === -1 ? dflt : args[i + 1]; };
const LIMIT = parseInt(argVal('--limit', '0')) || 0;
const OUT = argVal('--out', 'scripts/output/sammelband-cover.json');
const CONTROL_ONLY = args.includes('--control');

const MIN_TOKEN_LEN = 5;
const MIN_COVER_CHARS = 60;   // below this the cover carries no text to disagree with
const MAX_NONLATIN_SHARE = 0.15;

// Words too common in early-modern titles to distinguish one work from another.
// Shared vocabulary with scan-title-mismatch.mjs — keep the two lists aligned.
const STOP = new Set([
  'being', 'volume', 'their', 'about', 'which', 'other', 'these', 'those', 'first',
  'second', 'third', 'fourth', 'wherein', 'whereof', 'together', 'containing',
  'contained', 'according', 'concerning', 'translated', 'printed', 'edition',
  'london', 'paris', 'wherewith', 'thereof', 'himself', 'unknown', 'anonymous',
  'selected', 'collected', 'complete', 'general', 'several', 'various', 'sundry',
  'newly', 'lately', 'divers', 'certain', 'brief', 'short', 'great', 'grand',
]);

/** Share of CJK / Arabic / Devanagari / Hebrew / Greek / Cyrillic characters. */
function nonLatinShare(s) {
  const sample = String(s || '').slice(0, 4000);
  if (!sample.length) return 1;
  const nonLatin = (sample.match(/[Ͱ-ϿЀ-ӿ֐-׿؀-ۿऀ-ॿ฀-๿ༀ-࿿　-鿿가-힯]/g) || []).length;
  return nonLatin / sample.length;
}

/**
 * Strip HTML entities before tokenising — `&nbsp;` padding inflates every
 * word-count metric (CLAUDE.md, degenerate-output class) — then FOLD
 * DIACRITICS.
 *
 * The folding is not cosmetic. Without it the corpus run produced a false
 * positive on *Ikhwan al-Safa*: the printed title page reads "Ikhwánu-s safá"
 * and our record reads "Ikhwan al-Safa", so a byte-wise prefix match saw no
 * hit and the detector proposed replacing a perfectly correct cover.
 * Transliterated titles disagree with their own title pages about accents as a
 * matter of course, so an unfolded comparison is measuring the transliteration
 * convention rather than the binding.
 */
function normalise(s) {
  return String(s || '')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Repetition-loop screen: a page of `तथा तथा तथा…` is not evidence of anything. */
function isDegenerate(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 120) return false;
  return new Set(words).size / words.length < 0.15;
}

/** Diacritics folded here too, or "Ikhwán" tokenises to the sub-floor "ikhw"
 *  and the record can never match its own title page. Same reason as normalise(). */
function titleTokens(title) {
  return [...new Set(
    String(title || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= MIN_TOKEN_LEN && !STOP.has(w) && !/^\d+$/.test(w)),
  )];
}

/** "Vaughan, Thomas" -> "vaughan"; "Thomas Vaughan" -> "vaughan". */
function authorSurname(author) {
  const a = String(author || '').trim();
  if (!a) return null;
  const surname = a.includes(',') ? a.split(',')[0] : a.split(/\s+/).pop();
  const s = String(surname || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return s.length >= 4 ? s : null;
}

/**
 * How many distinct signals (title tokens + author surname) does this text
 * carry? Matched on a 6-char PREFIX so Latin inflection doesn't read as absence
 * ("adamica" on the page vs "adamicam" in the record is the same word here).
 *
 * A COUNT rather than a boolean because the two sides of the detector need
 * different bars. Clearing the cover needs only one hit — any evidence that the
 * cover names this work is enough to leave it alone. PROPOSING a replacement
 * needs two, because a single weak token is how the pilot produced its one
 * confirmed false positive: *Book Four — Magick* yields exactly one usable
 * token (`magick`, since `book` and `four` are under the length floor), and a
 * degraded p.1 that happened to carry it was proposed over the sound decorated
 * title page already in use.
 */
function matchStrength(tokens, surname, text) {
  let n = 0;
  for (const t of tokens) if (text.includes(t.slice(0, 6))) n++;
  if (surname && text.includes(surname.slice(0, 6))) n++;
  return n;
}
const MIN_REPLACEMENT_SIGNALS = 2;

/**
 * The judgment, isolated from all I/O so `--control` can exercise it directly.
 * Returns { verdict: 'SUSPECT'|'CLEAR'|'SKIP', reason, suggestedCoverPage }.
 */
export function judge({ title, author, coverPage, titlePages }) {
  const tokens = titleTokens(title);
  if (!tokens.length) return { verdict: 'SKIP', reason: 'title has no distinctive token' };
  if (titlePages.length < 2) return { verdict: 'SKIP', reason: 'fewer than 2 title pages' };

  const cover = titlePages.find(p => p.page_number === coverPage);
  if (!cover) return { verdict: 'SKIP', reason: 'cover page is not a title page' };

  const coverText = normalise(cover.text);
  if (coverText.length < MIN_COVER_CHARS) return { verdict: 'SKIP', reason: 'cover title page carries too little text' };
  if (isDegenerate(coverText)) return { verdict: 'SKIP', reason: 'degenerate OCR on cover page' };
  if (nonLatinShare(cover.text) > MAX_NONLATIN_SHARE) return { verdict: 'SKIP', reason: 'non-Latin cover text' };
  if (nonLatinShare(title) > MAX_NONLATIN_SHARE) return { verdict: 'SKIP', reason: 'non-Latin title' };

  const surname = authorSurname(author);
  if (matchStrength(tokens, surname, coverText) > 0) return { verdict: 'CLEAR', reason: 'cover names this work' };

  // (b) — does the RIGHT title page exist elsewhere in this volume, named
  // strongly enough to be worth proposing?
  const better = titlePages
    .filter(p => p.page_number !== coverPage)
    .filter(p => nonLatinShare(p.text) <= MAX_NONLATIN_SHARE)
    .map(p => ({ p, strength: matchStrength(tokens, surname, normalise(p.text)) }))
    .filter(x => x.strength >= MIN_REPLACEMENT_SIGNALS)
    .sort((a, b) => b.strength - a.strength || a.p.page_number - b.p.page_number)[0];

  if (!better) {
    return { verdict: 'SKIP', reason: 'no title page in the volume names this work strongly enough to propose — scan-title-mismatch territory, not a cover pick' };
  }
  return {
    verdict: 'SUSPECT',
    reason: `cover p.${coverPage} names another work; p.${better.p.page_number} names this one (${better.strength} signals)`,
    suggestedCoverPage: better.p.page_number,
  };
}

// ── Control ─────────────────────────────────────────────────────────
// A detector that finds nothing is indistinguishable from a broken one, and a
// guard that cannot fail is documentation with a green checkmark (CLAUDE.md).
// The motivating book is already FIXED, so it can no longer fire in a live
// sweep — it is replayed here in BOTH directions instead: the pre-fix cover
// must be flagged, the post-fix cover must not.
const CONTROL_TITLE = 'Magia Adamica, or The Antiquitie of Magic';
const CONTROL_AUTHOR = 'Thomas Vaughan';
const CONTROL_TITLE_PAGES = [
  { page_number: 7, text: 'THE MAN-MOUSE Taken in a Trap, and tortur\'d to death for gnawing the Margins of EUGENIUS PHILALETHES. Printed in LONDON, and Sold at the Castle in Corn-hill. 1650.' },
  { page_number: 55, text: 'Magia Adamica: Or, The Antiquitie of Magic, &c. Coelum Terrae, &c. That I should professe Magic in this Discourse, and Justifie the Professors of it withall.' },
];

// Regression control for the diacritic fold, from the real corpus run. This
// cover is CORRECT — p.5 is a title page reading "IKHWÁNU-S SAFÁ" against a
// record reading "Ikhwan al-Safa" — and the unfolded detector called it a
// suspect, because it matched neither `ikhwan` (accents) nor `brethren` (the
// page says "BROTHERS") while p.7 carried `purity` + `dowson`.
//
// The page text below is COPIED FROM THE DATABASE, not written by hand. The
// first draft of this control was hand-written and silently included the word
// "Translated" on p.5 — which matched the title's own `translation` token and
// made the control pass with the fold deliberately removed. A control whose
// text you invent is a control you have tuned to pass.
const DIACRITIC_TITLE = 'Ikhwan al-Safa (Brethren of Purity) - Dowson Translation';
const DIACRITIC_AUTHOR = 'Ikhwan al-Safa; tr. John Dowson';
const DIACRITIC_TITLE_PAGES = [
  { page_number: 5, text: '<lang>Hindustani</lang>\n<page-type>title-page</page-type>\n<warning>Minor foxing and staining throughout the page.</warning>\n\n# IKHWÁNU-S SAFÁ.\n\n<vocab>Ikhwánu-s Safá</vocab>' },
  { page_number: 7, text: '<lang>English</lang>\n<page-type>title-page</page-type>\n\n# IKHWÁNU-S SAFÁ;\n\n->OR,<-\n\n# BROTHERS OF PURITY.\n\n->*TRANSLATED FROM THE HINDUSTÁNÍ,*<-\n\n->BY<-\n\n->PROFESSOR JOHN DOWSON, M.R.A.S.,<-' },
];

function runControl() {
  const bad = judge({ title: CONTROL_TITLE, author: CONTROL_AUTHOR, coverPage: 7, titlePages: CONTROL_TITLE_PAGES });
  const good = judge({ title: CONTROL_TITLE, author: CONTROL_AUTHOR, coverPage: 55, titlePages: CONTROL_TITLE_PAGES });
  const dia = judge({ title: DIACRITIC_TITLE, author: DIACRITIC_AUTHOR, coverPage: 5, titlePages: DIACRITIC_TITLE_PAGES });
  const okBad = bad.verdict === 'SUSPECT' && bad.suggestedCoverPage === 55;
  const okGood = good.verdict === 'CLEAR';
  const okDia = dia.verdict === 'CLEAR';
  console.log(`control: pre-fix cover p.7  -> ${bad.verdict} ${bad.suggestedCoverPage ? `(suggests p.${bad.suggestedCoverPage})` : ''}  ${okBad ? 'PASS' : 'FAIL — expected SUSPECT suggesting p.55'}`);
  console.log(`control: post-fix cover p.55 -> ${good.verdict}  ${okGood ? 'PASS' : 'FAIL — expected CLEAR'}`);
  console.log(`control: diacritic cover p.5 -> ${dia.verdict}  ${okDia ? 'PASS' : 'FAIL — expected CLEAR (diacritic fold regressed)'}`);
  return okBad && okGood && okDia;
}

if (CONTROL_ONLY) {
  process.exit(runControl() ? 0 : 1);
}

// ── Sweep ───────────────────────────────────────────────────────────
if (!runControl()) {
  console.error('\ncontrol FAILED — refusing to sweep with a detector that cannot reproduce its own motivating case');
  process.exit(1);
}
console.log('');

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

const query = {
  visible: true,
  pages_count: { $gt: 0 },
  cover_page: { $exists: true, $ne: null },
  thumbnail_source: { $ne: 'manual' },
};
const total = await db.collection('books').countDocuments(query, { maxTimeMS: 120000 });
console.log(`eligible population (visible, auto-covered, pages>0): ${total}`);

const suspects = [];
const skipped = {};
let checked = 0, cleared = 0, lastId = null;

// Keyset pagination on _id — a cursor held open across a run this long hits
// CursorNotFound (CLAUDE.md, repair-sweep failure modes).
const BATCH = 250;
outer: for (;;) {
  const q = lastId ? { ...query, _id: { $gt: lastId } } : query;
  const batch = await db.collection('books')
    .find(q, { projection: { id: 1, slug: 1, title: 1, author: 1, cover_page: 1, ia_identifier: 1 }, maxTimeMS: 60000 })
    .sort({ _id: 1 }).limit(BATCH).toArray();
  if (!batch.length) break;
  lastId = batch[batch.length - 1]._id;

  for (const b of batch) {
    if (LIMIT && checked >= LIMIT) break outer;
    checked++;

    // Indexed on {page_type, book_id, page_number} — this is why the sweep is
    // affordable at all. A `$group` over the whole 19.1M-doc collection times
    // out; this touches only the ~89K title-page rows.
    const tps = await db.collection('pages')
      .find({ page_type: 'title-page', book_id: b._id.toString() },
        { projection: { _id: 0, page_number: 1, 'ocr.data': 1 }, maxTimeMS: 20000 })
      .sort({ page_number: 1 }).toArray();

    const titlePages = tps
      .filter(p => p.page_number >= 0)   // negative page numbers are binding shots
      .map(p => ({ page_number: p.page_number, text: p.ocr?.data || '' }));

    const r = judge({ title: b.title, author: b.author, coverPage: b.cover_page, titlePages });
    if (r.verdict === 'SKIP') { skipped[r.reason] = (skipped[r.reason] || 0) + 1; continue; }
    if (r.verdict === 'CLEAR') { cleared++; continue; }

    const coverText = normalise(titlePages.find(p => p.page_number === b.cover_page).text).slice(0, 160);
    const betterText = normalise(titlePages.find(p => p.page_number === r.suggestedCoverPage).text).slice(0, 160);
    suspects.push({
      id: b.id, slug: b.slug, title: b.title, author: b.author, ia_identifier: b.ia_identifier,
      cover_page: b.cover_page, suggested_cover_page: r.suggestedCoverPage,
      cover_reads: coverText, suggested_reads: betterText,
      url: `https://sourcelibrary.org/book/${b.slug}`,
    });
    console.log(`SUSPECT  ${b.title?.slice(0, 55)}`);
    console.log(`         cover p.${b.cover_page}: ${coverText.slice(0, 90)}`);
    console.log(`         better p.${r.suggestedCoverPage}: ${betterText.slice(0, 90)}`);
    console.log(`         https://sourcelibrary.org/book/${b.slug}`);
  }
}

console.log(`\nchecked ${checked} | judged clear ${cleared} | SUSPECTS ${suspects.length}`);
console.log('skipped (not judged):');
for (const [reason, n] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${reason}`);

writeFileSync(OUT, JSON.stringify({
  generated_at: new Date().toISOString(),
  checked, cleared, skipped, suspects,
}, null, 2));
console.log(`\nreport -> ${OUT}`);

await client.close();
