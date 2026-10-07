// PRIOR ART: scripts/lib/translate-core.mjs isTranslatablePage — the PAGE filter (blank, no-body,
// loop, ocr.unreadable, illegible #5305); it reads one page's text and cannot see a FLUENT wrong
// transcription. scripts/lib/pipeline-hold.mjs — a hold names ONE book someone remembered; this
// is a rule over a stratum, so a book imported tomorrow is covered. scripts/lib/ocr-routing.mjs
// and #5737 route which engine READS a script; nothing there decides what may be TRANSLATED.
// scripts/lib/ia-ocr-gate.mjs gates a free Archive text at ingest, per page, by similarity.
// None of them answers "is this book's transcription good enough to pay for English?".
//
// ocr-trust-gate — translate only where the OCR is trusted (#5700, Derek 2026-10-04: "need to
// make sure we don't translate things with bad transcription").
//
// WHY. #5695 scored served English against published human translations and opened the image
// for every low page. Outside the vernaculars the transcription, not the translator, was the
// primary cause, and a stronger translator does not repair it (Opus scored 1 on invented Greek
// OCR). Each row of OCR_TRUST_TABLE is one measured stratum. A book in a gated row is refused at
// every translation enrol, with the row's id in the reason, until its OCR has been re-read.
//
// WHAT THIS IS NOT. It never removes or withholds English already served (that is the A rows of
// #5700), and it does not change OCR routing (#5737).
//
// EDITING THE TABLE (job reocr-lift-5700 and whoever ranks re-OCR next): a row is plain data.
//   gated      false = measured, listed, not enforced (say why in `evidence`).
//   hand       'manuscript' = most typed pages are handwritten; 'not-manuscript' = print OR
//              unknown (a dated book whose pages carry no <script> tag is taken by its year row
//              rather than escaping). Rows are tried in order; the first match wins.
//   readers    regexes over `ocr.model` / `ocr.source` / `ocr.pipeline` naming the readers
//              measured BETTER on this stratum. A page counts as re-read when it matches one and
//              its `ocr.updated_at` is on or after `since`.
//   since      the date the row was gated; an older read is the read that was measured bad.
// Add a reader when a re-OCR eval shows it lifts the stratum; flip `gated` when the stratum is
// re-measured. tests/unit/ocr-trust-gate.test.ts pins the shape and the negative controls.

const GREEK = /^\s*(ancient\s+)?greek\b/i;
const PERSIAN = /^\s*(persian|farsi)\b/i;
const LATIN = /^\s*latin\b/i;

/** The day the first rows were gated. A read older than a row's `since` is the measured one. */
export const OCR_TRUST_GATE_SINCE = '2026-10-04T00:00:00Z';

/** Share of a book's OCR'd pages that must be re-read by a listed reader before it is released. */
export const RELEASE_SHARE = 0.9;

/** A book is a manuscript when at least this share of its typed pages are handwritten. */
export const MANUSCRIPT_SHARE = 0.5;
/** Fewer typed pages than this and the hand is unknown (never guessed). */
export const MIN_TYPED_PAGES = 3;

/**
 * Readers accepted as a re-read when a row names none of its own. PROVISIONAL: every page in the
 * gated strata was read by Gemini flash-lite or flash-preview (census.json, `ocr_readers`), so
 * "better" starts as the readers that are neither. None of these is yet MEASURED to lift a
 * stratum — job reocr-lift-5700 replaces this list, per row, with the readers its pilot shows do.
 */
export const DEFAULT_BETTER_READERS = Object.freeze([
  /gemini-[\d.]+-pro/i,          // a Pro read
  /\bkraken\b/i,                 // specialist HTR
  /^manual$/i,                   // a human transcription
]);

export const OCR_TRUST_TABLE = Object.freeze([
  {
    id: 'greek-manuscript',
    gated: true,
    language: GREEK,
    hand: 'manuscript',
    evidence: '#5695 T2 (xlref-t2-2026-10): served fidelity 2.54 of 5 (n = 12), 75% of pages ≤ 3; the image check named the OCR as primary cause on 9 of 9 low manuscript pages; flash − lite translation gain 0.00.',
    since: OCR_TRUST_GATE_SINCE,
    readers: DEFAULT_BETTER_READERS,
  },
  {
    id: 'greek-print-1450-1599',
    gated: true,
    language: GREEK,
    hand: 'not-manuscript',
    yearFrom: 1450,
    yearTo: 1599,
    evidence: '#5695 T2: served fidelity 3.40 (n = 15), 40% ≤ 3; OCR primary cause on 6 of 6 low pages in the stratum (16 of 22 low Greek pages overall). Greek print 1600–1799 (3.93) and 1800+ (4.02) are not gated: their low pages were translation or seam.',
    since: OCR_TRUST_GATE_SINCE,
    readers: DEFAULT_BETTER_READERS,
  },
  {
    id: 'persian',
    gated: true,
    language: PERSIAN,
    evidence: '#5695 T4 (xlref-t4-2026-10): served fidelity 2.96, 17% of pages ≥ 4; OCR primary cause on 14 of 23 low Hebrew/Arabic/Persian pages, concentrated in Persian nastaʿlīq (#5559). Hebrew and Arabic print are not gated.',
    since: OCR_TRUST_GATE_SINCE,
    readers: DEFAULT_BETTER_READERS,
  },
  {
    id: 'latin-incunabula',
    gated: true,
    language: LATIN,
    hand: 'not-manuscript',
    yearFrom: 1450,
    yearTo: 1500,
    evidence: '#5695 T1 (xlref-t1-2026-10): served fidelity 3.55, n = 10 only — DIRECTIONAL. Gated because the pending volume is small (4,786 pages in 493 books, census 2026-10-03), so waiting costs little; set gated: false if Derek prefers to translate on ten pages of evidence (scripts/eval/DECISIONS.md).',
    since: OCR_TRUST_GATE_SINCE,
    readers: DEFAULT_BETTER_READERS,
  },
]);

/**
 * The edition year. `books.published` is free text ("Venice, 1499", "c. 1550", "[1617?]"), so
 * this is the census rule (yearOf in scripts/eval/quality-census-score.mjs: the first run of 3–4
 * digits of `year`, else of `published`), never a parseInt. null when neither carries one.
 */
export function editionYear(book) {
  const m = /\d{3,4}/.exec(String(book?.year ?? book?.published ?? ''));
  return m ? Number(m[0]) : null;
}

/**
 * 'manuscript' | 'print' | 'unknown' from the book's page profile — counts of `pages.script_type`
 * (`printed` / `handwritten` / `mixed`, lifted from the OCR's own <script> tag, #4195). There is
 * no book-level manuscript field. Unknown is never treated as either.
 */
export function bookHand(profile) {
  const hand = profile?.handwritten || 0;
  const typed = hand + (profile?.printed || 0) + (profile?.mixed || 0);
  if (typed < MIN_TYPED_PAGES) return 'unknown';
  return hand / typed >= MANUSCRIPT_SHARE ? 'manuscript' : 'print';
}

/** The table row this book falls in (gated or not), or null. */
export function ocrTrustStratum(book, profile, table = OCR_TRUST_TABLE) {
  const language = String(book?.language ?? '');
  const year = editionYear(book);
  let hand;
  for (const row of table) {
    if (!row.language.test(language)) continue;
    if (row.hand) {
      hand ??= bookHand(profile);
      if (row.hand === 'not-manuscript' ? hand === 'manuscript' : hand !== row.hand) continue;
    }
    if (row.yearFrom != null || row.yearTo != null) {
      if (year == null) continue;
      if (row.yearFrom != null && year < row.yearFrom) continue;
      if (row.yearTo != null && year > row.yearTo) continue;
    }
    return row;
  }
  return null;
}

/** Does this page's OCR come from one of the row's better readers, read on or after `since`? */
export function isReread(page, row) {
  const at = page?.ocr?.updated_at ? new Date(page.ocr.updated_at) : null;
  if (!at || Number.isNaN(+at) || at < new Date(row.since)) return false;
  const stamps = [page.ocr.model, page.ocr.source, page.ocr.pipeline].filter((s) => typeof s === 'string' && s);
  return stamps.some((s) => (row.readers || []).some((rx) => rx.test(s)));
}

/**
 * May this book be translated?  → { ok, reason?, stratum?, released? }
 *
 * `profile` is the book's page profile (loadOcrProfile): { handwritten, printed, mixed, ocr,
 * reread: { [rowId]: n } }. A book in a gated row is refused unless RELEASE_SHARE of its OCR'd
 * pages were re-read by one of the row's readers since the row was gated.
 */
export function ocrTrustVerdict(book, profile = null, table = OCR_TRUST_TABLE) {
  const row = ocrTrustStratum(book, profile, table);
  if (!row || !row.gated) return { ok: true, ...(row ? { stratum: row.id } : {}) };
  const ocr = profile?.ocr || 0;
  const reread = profile?.reread?.[row.id] || 0;
  if (ocr > 0 && reread / ocr >= RELEASE_SHARE) return { ok: true, stratum: row.id, released: true };
  return { ok: false, stratum: row.id, reason: `ocr-untrusted (${row.id}; re-read ${reread}/${ocr} pages, #5700)` };
}

/** True when a refusal reason came from this gate (selectors and routers match on it). */
export const isOcrTrustRefusal = (reason) => /^ocr-untrusted\b/.test(String(reason ?? ''));

/** Does the row's year window admit this book? (A row with no window admits every year.) */
function yearAdmits(row, year) {
  if (row.yearFrom == null && row.yearTo == null) return true;
  if (year == null) return false;
  return (row.yearFrom == null || year >= row.yearFrom) && (row.yearTo == null || year <= row.yearTo);
}

/**
 * Could a GATED row take this book, whatever its pages say? Language and year only, so the page
 * read is skipped for everything else (15.9K live Latin books, ~1K of them 1450–1500).
 */
export function ocrTrustCandidate(book, table = OCR_TRUST_TABLE) {
  const language = String(book?.language ?? '');
  const year = editionYear(book);
  return table.some((row) => row.gated && row.language.test(language) && yearAdmits(row, year));
}

/**
 * The page profile ocrTrustVerdict needs, from one read of the book's pages (book_id index;
 * no text fetched): script_type counts, OCR'd page count, and re-read counts per row.
 */
export async function loadOcrProfile(db, bookId, table = OCR_TRUST_TABLE) {
  const profile = { handwritten: 0, printed: 0, mixed: 0, ocr: 0, reread: {} };
  const pages = await db.collection('pages').find(
    { book_id: bookId, page_number: { $gt: 0 } },
    { projection: { _id: 0, script_type: 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.pipeline': 1, 'ocr.updated_at': 1, 'ocr.unreadable': 1 } },
  ).toArray();
  for (const p of pages) {
    if (p.script_type === 'handwritten' || p.script_type === 'printed' || p.script_type === 'mixed') profile[p.script_type] += 1;
    if (!p.ocr || p.ocr.unreadable === true) continue;
    profile.ocr += 1;
    for (const row of table) if (isReread(p, row)) profile.reread[row.id] = (profile.reread[row.id] || 0) + 1;
  }
  return profile;
}

/**
 * The verdict for a book doc, reading its pages only when a gated row could apply. Callers hold
 * books under many projections; one that carries neither `year` nor `published` is re-read here
 * rather than classified as undated (an undated book escapes every year row).
 */
export async function ocrTrustVerdictForBook(db, book, table = OCR_TRUST_TABLE) {
  let b = book;
  if (b && !('year' in b) && !('published' in b) && table.some((row) => row.gated && row.language.test(String(b.language ?? '')))) {
    const dated = await db.collection('books').findOne({ id: b.id }, { projection: { _id: 0, language: 1, year: 1, published: 1 } });
    b = { ...b, year: dated?.year ?? null, published: dated?.published ?? null };
  }
  if (!ocrTrustCandidate(b, table)) return { ok: true };
  return ocrTrustVerdict(b, await loadOcrProfile(db, b.id, table), table);
}

// ── The record (#5700 working rule 3: a shipped gate ships with a counter) ───────────────────

export const REFUSAL_EVENT = 'ocr_trust_refusal';

/**
 * Record a refusal: ONE `book_events` row per (book, stratum), with the lanes that asked and how
 * often, so the hourly selector does not write a row an hour. Nothing automated reads this type;
 * it is the counter (`scripts/audit/ocr-trust-gate-status.mjs`) and the list for the by-eye check.
 * Never throws: a failed record must not turn a refusal into a translation.
 */
export async function recordOcrTrustRefusal(db, book, verdict, { lane = 'unknown', now = new Date() } = {}) {
  if (!verdict || verdict.ok || !book?.id) return;
  try {
    await db.collection('book_events').updateOne(
      { book_id: book.id, type: REFUSAL_EVENT, 'details.stratum': verdict.stratum },
      {
        $setOnInsert: { book_id: book.id, type: REFUSAL_EVENT, at: now, source: 'ocr-trust-gate', 'details.stratum': verdict.stratum, 'details.issue': 5700, 'details.language': book.language ?? null, 'details.year': editionYear(book) },
        $set: { 'details.reason': verdict.reason, 'details.last_at': now, 'details.last_lane': lane },
        $addToSet: { 'details.lanes': lane },
        $inc: { 'details.refusals': 1 },
      },
      { upsert: true },
    );
  } catch (e) {
    console.warn(`[ocr-trust-gate] could not record refusal for ${book.id}: ${e.message}`);
  }
}

/**
 * The gate as one call for an enrol path: the verdict, recorded when it refuses.
 * `allow` is the operator's explicit override (a pilot re-translating a re-read page); it is
 * never a default.
 */
export async function ocrTrustGate(db, book, { lane = 'unknown', allow = false, record = true, table = OCR_TRUST_TABLE } = {}) {
  const verdict = await ocrTrustVerdictForBook(db, book, table);
  if (verdict.ok) return verdict;
  if (allow) return { ...verdict, ok: true, overridden: true };
  if (record) await recordOcrTrustRefusal(db, book, verdict, { lane });
  return verdict;
}
