// PRIOR ART: scripts/lib/syriac-kraken-lane.mjs (#4883) — the same lane shape (per-book routing,
// per-page policy, provenance on the page, revisions first, staleness stamp, hold/release) for a
// different engine and script. Its script-agnostic helpers (isHumanEdited, hasRealTranslation,
// markTranslationsStale, STALE_OCR_FIELDS, reenrolDecision) are imported, not copied; what differs
// is the ROUTER (a page-image classifier census, not a code-point share of the stored text — a
// kuzushiji loop and a kuzushiji invention are both "Japanese" by code points) and the ENGINE.
//
// The NDL classical-OCR lane (#4925, #5100; benchmark #4745): re-transcribe the CURSIVE share of
// pre-1868 Japanese with the National Diet Library's 古典籍OCR ver.3 on a leased GPU.
//
// WHY THIS LANE EXISTS
// On 45 cursive pages (20 series) the two Gemini arms disagreed with each other on 28 and looped
// on 4 each; read against the page, NDL was coherent Japanese that fits the book on 10/10, and on
// the Ise monogatari page it reproduced dan 4 where both Gemini arms invented a different story
// (#4745). On regular woodblock, regular manuscript hands and typeset pages the Gemini arms agree
// and NDL adds nothing — so the lane is for cursive books only.
//
// ROUTING IS PER BOOK (the census), POLICY IS PER PAGE
// A series is one hand or one block-cutter, so a book is routed when ≥ 2 of its 3 census pages
// were classified woodblock-cursive or manuscript-cursive (scripts/eval/cursive-census-classify.mjs,
// flash-preview, the #4745 six-class prompt). The router was validated by eye on 60 fresh census
// pages, one per book: 57/60 on the cursive axis, 28/28 cursive pages caught, 2 regular pages
// called cursive (scripts/eval/results/cursive-census/eyecheck/). Every page of a routed book is
// read — including picture pages, where NDL returns little and the textless rule below applies.
// A page a person edited is never touched (#3749).
//
// PROVENANCE ON THE PAGE (the #4613 specialist-engine standard, as the Syriac lane writes it)
// `ocr.source` = 'ndl-koten', `ocr.model` = 'ndl-koten/v3', `ocr.pipeline` = LANE, `ocr.content_hash`,
// and `ocr.engine` = { name, version, repo, commit, licence, conventions, run, issue, host,
// input.image_url }. NDL's transcription CONVENTION differs from the Gemini readings it replaces:
// kunten (kaeriten, okurigana, furigana) are written inline and characters are shinjitai. That is
// recorded on the page, because a reader or a translator seeing レ or small kana inline should know
// it is the engine's convention and not noise.
//
// NOTHING IS HIDDEN, NOTHING IS PAID. No Gemini call is made anywhere in this lane. Every book it
// touches is HELD (scripts/lib/pipeline-hold.mjs) before the first page is read, so the pipeline's
// gap-fill does not quietly queue paid re-translation of the new text
// (lesson_ocr_apply_triggers_gapfill_retranslation). Re-translation is a separate, priced go.

import { contentHash } from './write-provenance.mjs';

export { isHumanEdited, hasRealTranslation, STALE_OCR_FIELDS, reenrolDecision, markTranslationsStale } from './syriac-kraken-lane.mjs';

/** `ocr.pipeline` value, `sweep_log.sweep` name and `translation_stale.lane` — one id for the lane. */
export const LANE = 'ndl-koten-2026-09';
export const LANE_ISSUE = 4925;
/** `page_revisions.reason` for the reading this lane supersedes. */
export const REVISION_REASON = 'reocr_ndl_koten_4925';
/** `book_events.type` — one row per book, advanced in place. */
export const BOOK_EVENT = 'ndl_koten_reocr';
/** `pipeline_auto.hold.reason` for every book the lane touches. */
export const HOLD_REASON = 'ndl-koten-lane-4925';
export const HOLD_RELEASE = 'the NDL re-transcription of this book is read by eye (#4745 pilot or the full-run check) and a re-translation of its rewritten pages is approved as a separate, priced go';

export const CURSIVE_CLASSES = new Set(['woodblock-cursive', 'manuscript-cursive']);

/**
 * The engine, in ONE place. `commit` is filled by the box run (`git rev-parse` of the checkout it
 * built the image from) and carried into `ocr.engine`; a run that cannot say records not_recorded.
 */
export const NDL = {
  name: 'ndlkotenocr',
  label: 'NDL古典籍OCR ver.3 (National Diet Library)',
  version: '3',
  repo: 'https://github.com/ndl-lab/ndlkotenocr_cli',
  licence: 'CC BY 4.0',
  conventions: 'kunten (kaeriten, okurigana, furigana) written inline; shinjitai character forms',
  measured: '#4745: 10/10 cursive pages coherent and on-topic vs 1/10 flash-preview, 0/10 lite; 0 loops on 45 cursive pages',
};

/**
 * Route one book from its census record ({ classes: [...], medium }). Returns
 * `{ route: 'woodblock'|'manuscript'|null, why }`; null means the lane does not take the book.
 */
export function routeBook(censusRec) {
  const classes = censusRec?.classes || [];
  const cursive = classes.filter((c) => CURSIVE_CLASSES.has(c));
  if (cursive.length < 2) return { route: null, why: `${cursive.length}/${classes.length} census pages cursive` };
  const ms = cursive.filter((c) => c === 'manuscript-cursive').length;
  return { route: ms * 2 > cursive.length ? 'manuscript' : 'woodblock', why: `${cursive.length}/${classes.length} census pages cursive` };
}

/**
 * The pilot draw: ONE book per series (a series is one hand, so a second volume teaches nothing
 * new), the shortest book of 15–150 pages in each, series taken largest-first so the heavy series
 * (utaibon, Nōgyō zensho) are in. Deterministic — no randomness to re-seed.
 */
export function seriesKey(title) {
  return String(title || '').normalize('NFKC').replace(/[\s\d,.\-()（）:：、。巻第上中下之冊]+$/u, '').replace(/[\s\d]+/g, ' ').slice(0, 18).trim();
}
export function pilotDraw(censusBooks, n = 20, { minPages = 15, maxPages = 150 } = {}) {
  const bySeries = new Map();
  for (const b of censusBooks) {
    if (!routeBook(b).route) continue;
    const k = seriesKey(b.title);
    if (!bySeries.has(k)) bySeries.set(k, []);
    bySeries.get(k).push(b);
  }
  const out = [];
  for (const [k, books] of [...bySeries.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    const fit = books.filter((b) => b.pages >= minPages && b.pages <= maxPages).sort((a, b) => a.pages - b.pages || a.book_id.localeCompare(b.book_id));
    if (fit.length) out.push({ ...fit[0], series: k, series_books: books.length });
    if (out.length >= n) break;
  }
  return out;
}

/** Page policy: `{ action: 'reocr'|'keep', why }`. A human edit is kept; everything else is read. */
export function pagePolicy(page, isHumanEditedFn) {
  if (isHumanEditedFn(page?.ocr)) return { action: 'keep', why: 'human_edited' };
  if (!page?.ocr?.data) return { action: 'reocr', why: 'first_write' };
  return { action: 'reocr', why: 'cursive_book' };
}

/**
 * NDL writes one line per detected text line, in reading order. The stored form carries the same
 * in-text envelope the model readings do (`<language>`, `<script>`), because consumers trust the
 * in-text language tag; no `<page-type>` — NDL does not classify pages. NFC, trailing space trimmed.
 */
export function envelope(rawText, route) {
  const lines = String(rawText || '').normalize('NFC').split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  const script = route === 'manuscript' ? 'handwritten' : 'printed';
  return `<language>Japanese</language>\n<script>${script}</script>\n\n${lines.join('\n')}`;
}

/**
 * The reading without its metadata envelope: the model readings carry `<language>Japanese</language>`,
 * `<scan-quality>`, `<warning>`, `<vocab>` … whose CONTENT is not page text (counting "Japanese" as eight
 * letters of reading made every page look read — caught 2026-09-30). Header/footer tags wrap real text
 * and are kept (tags stripped, content kept).
 */
const META_TAGS = /<(language|script|scan-quality|warning|vocab|page-type|columns|confidence|notes?)>[\s\S]*?<\/\1>/g;
export function bodyText(text) {
  return String(text || '').replace(META_TAGS, '').replace(/<[^>]{1,40}>/g, '');
}

/** Characters of text (letters and digits in any script) in the body — "did the engine read anything?" */
export function charCount(text) {
  const body = bodyText(text);
  let n = 0;
  for (const ch of body) if (/[\p{L}\p{N}]/u.test(ch)) n++;
  return n;
}

/** The `$set` half of a page write. `text` is the ENVELOPED reading. */
export function ocrSetFields(text, route, { run, now = new Date(), secs = null, imageUrl = null, commit = null, host = null } = {}) {
  return {
    'ocr.data': text,
    'ocr.content_hash': contentHash(text),
    'ocr.language': 'Japanese',
    'ocr.model': `ndl-koten/v${NDL.version}`,
    'ocr.source': 'ndl-koten',
    'ocr.pipeline': LANE,
    'ocr.updated_at': now,
    'ocr.engine': {
      name: NDL.name, label: NDL.label, version: NDL.version, repo: NDL.repo,
      commit: commit || { status: 'not_recorded', reason: 'box run did not report a commit' },
      licence: NDL.licence, conventions: NDL.conventions, route,
      run: run || LANE, issue: LANE_ISSUE, secs, host: host || null,
      input: imageUrl ? { image_url: imageUrl } : { status: 'not_recorded', reason: 'caller passed no image url' },
    },
    updated_at: now,
  };
}
