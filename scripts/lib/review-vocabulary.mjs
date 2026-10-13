/**
 * PRIOR ART: .claude/docs/page-error-taxonomy.md — 44 classes by LANE (where a defect arose: I image, O OCR,
 * T translation, D display, E derived); scripts/lib/quality-gate.mjs TAXONOMY_CLASSES pins their codes. A class
 * says where; nothing said what KIND of wrong text the reader meets, so O1, O2, O3, I1, I4, T5, T7 and T10 were all
 * reported as "invented" (.claude/docs/measurement-validity.md, "Invented / fabrication rates": one word for six
 * kinds). scripts/eval/experiments/2026-10-11-invented-text-qualitative-recheck-6420.md (PR #6519) typed 56 pages by
 * kind, by hand, in prose: the kinds below are its list. scripts/eval/lib/agreement-stats.mjs `wilson` is reused.
 *
 * review-vocabulary — ONE typed vocabulary for every review of served text (#6203 repair 2).
 *
 *   KIND      what the wrong text is, as a reader meets it (KINDS). A reviewer names it; where an older record has
 *             only a taxonomy class, kindOfClass() gives that class's default kind.
 *   EXPOSURE  whether a reader could see the text when it was judged (EXPOSURES): served | withheld | no_english |
 *             hidden. A rate quoted without it mixes pages nobody can read with pages everybody can.
 *   REPORT    rates as k of n BOOKS, one page per book, Wilson 95% intervals, served-only as the headline
 *             (kOfNBooks, formatKOfN).
 *
 * Used by recordBookCheck (scripts/lib/book-checks.mjs), the #5826 gate (scripts/lib/quality-gate.mjs), the #6420
 * weekly audit (scripts/audit/convergent-audit-weekly.mjs) and the #5914 spot check (scripts/eval/spot-check/).
 * Old rows are not rewritten: the mapping from their fields is the table in .claude/docs/review-vocabulary.md.
 */
import { createHash } from 'node:crypto';
import { wilson } from '../eval/lib/agreement-stats.mjs';

/** The kinds, in the order a report lists them. `invents` = text with no basis on this leaf reaches the reader. */
export const KIND_DEFS = Object.freeze([
  { id: 'confabulation', label: 'confabulation', invents: true, means: 'free invention: text with no basis on this leaf or any other' },
  { id: 'recitation', label: 'recitation', invents: true, means: 'a known text (a canonical edition, a familiar passage) substituted for what this leaf says' },
  { id: 'wrong_leaf', label: 'wrong leaf', invents: true, means: 'the whole text is of another leaf: image and text are not the same page' },
  { id: 'carry_over', label: 'carry-over', invents: true, means: "a neighbouring page's words on this page: a facing strip, a block shifted across a boundary, a continuity leak" },
  { id: 'show_through', label: 'show-through / blank fill', invents: true, means: 'text made from show-through, an offset or an empty leaf' },
  { id: 'illegible_fill', label: 'illegible fill', invents: true, means: 'a fluent guess where the leaf cannot be read, with no mark of doubt' },
  { id: 'misread', label: 'misread', invents: false, means: 'the right leaf and the right place, wrong words, names or numbers' },
  { id: 'mistranslation', label: 'mistranslation', invents: false, means: 'the transcription is right and the English says something else' },
  { id: 'omission', label: 'omission', invents: false, means: 'text on the leaf that is missing: a dropped line, list entry, note or passage' },
  { id: 'layout', label: 'layout / structure', invents: false, means: 'the words are right and their order, tagging or structure is wrong' },
  { id: 'added_gloss', label: 'added gloss', invents: false, means: 'an explanation the model added; fine when marked and right, a defect only when wrong or unmarked' },
  { id: 'other', label: 'other', invents: false, means: 'none of the above: an empty or refused read, leaked reasoning, a wrong tag, a catalogue fault' },
]);
export const KINDS = Object.freeze(KIND_DEFS.map((k) => k.id));
export const INVENTING_KINDS = Object.freeze(KIND_DEFS.filter((k) => k.invents).map((k) => k.id));
export const kindLabel = (id) => KIND_DEFS.find((k) => k.id === id)?.label ?? id;

export const EXPOSURES = Object.freeze(['served', 'withheld', 'no_english', 'hidden']);
/** A row written from a record that did not keep it (a backfill). Never produced by exposureOf(). */
export const EXPOSURE_UNRECORDED = 'unrecorded';

/**
 * The default kind of each taxonomy class: what a row that names only the class is counted as. A reviewer's own
 * `kind` always wins. tests/unit/review-vocabulary.test.ts pins this table against quality-gate's code list.
 */
export const CLASS_KIND = Object.freeze({
  I1: 'wrong_leaf', I2: 'wrong_leaf', I3: 'layout', I4: 'carry_over', I5: 'layout', I6: 'wrong_leaf', I7: 'other',
  O1: 'confabulation', O2: 'confabulation', O3: 'recitation', O4: 'layout', O5: 'omission', O6: 'misread', O7: 'misread',
  O8: 'misread', O9: 'layout', O10: 'omission', O11: 'layout', O12: 'layout', O13: 'layout', O14: 'layout', O15: 'other',
  O16: 'other', O17: 'layout', O18: 'other',
  T1: 'omission', T2: 'other', T3: 'layout', T4: 'carry_over', T5: 'carry_over', T6: 'layout', T7: 'illegible_fill',
  T8: 'mistranslation', T9: 'omission', T10: 'added_gloss', T11: 'mistranslation', T12: 'mistranslation', T13: 'omission',
  T14: 'wrong_leaf', T15: 'other', T16: 'layout', T17: 'other',
  D1: 'layout', E1: 'other', E2: 'other',
});

/** Kind of a taxonomy class code; a compound or annotated code ("O6/O7", "O1 (blank leaf)") takes its first code. */
export function kindOfClass(code) {
  const m = String(code ?? '').match(/\b([IOTDE]\d{1,2})\b/);
  return m ? CLASS_KIND[m[1]] ?? null : null;
}

/** The kind of one finding { kind?, class? }: the reviewer's kind when valid, else the class default, else null. */
export function kindOfFinding(f) {
  if (f && KINDS.includes(f.kind)) return f.kind;
  return kindOfClass(f?.class ?? f?.code);
}

const ENGLISH = /^(english|middle english|old english|early modern english|scots|en)\b/i;
const hasText = (x) => typeof x === 'string' && x.trim().length > 0;

/**
 * Could a reader see this page's text when it was judged? Pure: pass the book and page as read at check time.
 *   hidden      the book is not live (`visible !== true`, or no pages)
 *   withheld    the page's English was withheld (`translation_withheld`), so the reader sees the original only
 *   served      English is on the page (a translation, or the transcription of an English-language book)
 *   no_english  the book is live, the page has no English: only the transcription is shown
 */
export function exposureOf({ book, page } = {}) {
  if (!book || book.visible !== true || book.pages_count === 0) return 'hidden';
  if (page?.translation_withheld) return 'withheld';
  if (hasText(page?.translation?.data)) return 'served';
  if (ENGLISH.test(String(book.language ?? '').trim()) && hasText(page?.ocr?.data)) return 'served';
  return 'no_english';
}

/** Exposure of pages as they are NOW: one entry per page number. A missing page record is `hidden`. */
export async function pageExposure(db, bookId, pageNumbers) {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { _id: 0, visible: 1, pages_count: 1, language: 1 } });
  const rows = await db.collection('pages').find({ book_id: bookId, page_number: { $in: [...pageNumbers] } },
    { projection: { _id: 0, page_number: 1, 'translation.data': 1, 'ocr.data': 1, translation_withheld: 1 } }).toArray();
  const by = new Map(rows.map((r) => [r.page_number, r]));
  return pageNumbers.map((n) => ({ page_number: n, exposure: by.has(n) ? exposureOf({ book, page: by.get(n) }) : 'hidden' }));
}

/** What is wrong with an `exposure` list for a check of `pagesRead` (empty = valid). */
export function exposureProblems(exposure, pagesRead) {
  if (!Array.isArray(exposure)) return ['exposure must be a list of { page_number, exposure }'];
  const p = [], seen = new Set();
  for (const e of exposure) {
    if (!e || typeof e.page_number !== 'number') { p.push('exposure[].page_number'); continue; }
    seen.add(e.page_number);
    if (!EXPOSURES.includes(e.exposure) && e.exposure !== EXPOSURE_UNRECORDED) p.push(`exposure p.${e.page_number}: ${EXPOSURES.join(' | ')} (or '${EXPOSURE_UNRECORDED}' for a backfill)`);
  }
  for (const n of Array.isArray(pagesRead) ? pagesRead : []) if (!seen.has(n)) p.push(`exposure for page ${n}`);
  return p;
}

/** What is wrong with a finding's `kind` (empty = valid). An absent kind is allowed: the class default applies. */
export const kindProblems = (kind, at = 'kind') => (kind === undefined || KINDS.includes(kind) ? [] : [`${at}: '${kind}' is not a kind (${KINDS.join(' | ')})`]);

// ── the k-of-n-books reporter ────────────────────────────────────────────────

/**
 * One page per book. `rows` are page verdicts { book_id, page_number, … }; where a book has several, ONE is kept,
 * chosen by a hash of (seed, book, page), so the choice does not depend on what the page was found to be and a rate
 * over the result is still a per-page rate with the book as its unit. Three pages of one book are not three
 * observations (the #5914 spot check counted them so).
 */
export function onePagePerBook(rows, seed = 0) {
  const h = (r) => createHash('sha1').update(`${seed}|${r.book_id}|${r.page_number}`).digest('hex');
  const by = new Map();
  for (const r of rows) { const cur = by.get(r.book_id); if (!cur || h(r) < h(cur)) by.set(r.book_id, r); }
  return [...by.values()];
}

const cell = (k, n) => ({ k, n, rate: n ? k / n : null, ci: n ? wilson(k, n) : null });

/**
 * Rates as k of n books. `rows`: page verdicts { book_id, page_number, exposure, serious: boolean, kinds: [kind…] }
 * (`kinds` = the kinds of the SERIOUS findings on the page). Returns
 *   { headline, by_exposure: { served, withheld, no_english, hidden, unrecorded? }, all, books, pages, dropped_pages }
 * where each group is { n, any_serious: {k, n, rate, ci}, inventing: {…}, by_kind: { kind: {…} } }. `headline` is the
 * SERVED group: what a reader can actually meet. `inventing` = any kind in INVENTING_KINDS.
 */
export function kOfNBooks(rows, { seed = 0 } = {}) {
  const picked = onePagePerBook(rows, seed);
  const group = (rs) => ({
    n: rs.length,
    any_serious: cell(rs.filter((r) => r.serious).length, rs.length),
    inventing: cell(rs.filter((r) => (r.kinds || []).some((k) => INVENTING_KINDS.includes(k))).length, rs.length),
    by_kind: Object.fromEntries(KINDS.map((k) => [k, cell(rs.filter((r) => (r.kinds || []).includes(k)).length, rs.length)])),
  });
  const exposures = [...EXPOSURES, ...(picked.some((r) => !EXPOSURES.includes(r.exposure)) ? [EXPOSURE_UNRECORDED] : [])];
  const by_exposure = Object.fromEntries(exposures.map((e) => [e, group(picked.filter((r) => (EXPOSURES.includes(r.exposure) ? r.exposure : EXPOSURE_UNRECORDED) === e))]));
  return { headline: by_exposure.served, by_exposure, all: group(picked), books: picked.length, pages: rows.length, dropped_pages: rows.length - picked.length };
}

const pct = (x) => `${(100 * x).toFixed(0)}%`;
/** "3 of 40 books (8%, 95% CI 3–20%)"; "0 books read" when n = 0. Never a bare percentage. */
export function formatKOfN(c, unit = 'books') {
  if (!c || !c.n) return `no ${unit} read`;
  return `${c.k} of ${c.n} ${unit} (${pct(c.rate)}, 95% CI ${(100 * c.ci[0]).toFixed(0)}–${pct(c.ci[1])})`;
}

/**
 * The report as markdown lines: the served headline first, then the kinds seen among served books, then the other
 * exposures in one line each. `what` names the population ("random visible non-English books").
 */
export function kOfNMarkdown(report, { what = 'books', reader = null } = {}) {
  const h = report.headline, who = reader ? `${reader}: ` : '';
  const kinds = (g) => KINDS.filter((k) => g.by_kind[k].k > 0).map((k) => `${kindLabel(k)} ${g.by_kind[k].k}`).join(', ') || 'none';
  const lines = h.n ? [
    `${who}**Served text, ${what}: a serious error on ${formatKOfN(h.any_serious)}; text not on the leaf on ${formatKOfN(h.inventing)}.**`,
    `Kinds among served books (a book can carry more than one): ${kinds(h)}.`,
  ] : [`${who}**Served text, ${what}: no served book was read, so there is no headline rate.**`];
  for (const [e, g] of Object.entries(report.by_exposure)) if (e !== 'served' && g.n) lines.push(`Not in the headline, ${e.replace('_', ' ')}: serious on ${formatKOfN(g.any_serious)}; kinds ${kinds(g)}.`);
  if (report.dropped_pages) lines.push(`One page per book: ${report.pages} pages read in ${report.books} books, ${report.dropped_pages} extra pages not counted.`);
  return lines;
}
