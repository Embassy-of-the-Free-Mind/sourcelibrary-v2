/**
 * Shared holdings resolver — pure functions for "given the editions we hold of a work,
 * which is the best readable one, and what is our holding state?" Extracted from the SHWEP
 * cited-works matcher so the works-catalog / translation-registry (#2453, #2567) imports
 * these rather than reinventing them. No DB, no Gemini — pure over plain edition objects.
 *
 * An "edition meta" is any object with: { title|display_title, pages_count, pages_ocr,
 * pages_blank, pages_translated, visible, year, slug, id }. Missing fields default safely.
 *
 * TWO PREDICATES, KEPT SEPARATE (do not collapse — see #2632/#2567):
 *   - OWNERSHIP + PROCESSED: do we hold a readable (translated) edition? → holdingStatus().
 *     Compute over the FULL catalog (incl. hidden/draft), else you undercount ownership and
 *     "re-acquire" what you already hold.
 *   - PUBLIC READABLE LINK: is there a VISIBLE readable edition to link a reader to? → the
 *     caller adds a visibility filter ON TOP (feed bestEdition only visible editions, or
 *     gate on editionVisible). A hidden readable edition is owned but not linkable.
 */

// Titles that denote a collected / complete-works / omnibus edition. Used both to surface
// such editions as omnibus candidates and to PREFER a dedicated edition of the cited work
// over a big collected dump when both are held.
export const COLLECTED_RX = /opera|omnia|complete works|works of|collected|exegetical|surviving works|dialogues of|tutte le opere|gesammelte|sämtliche/i;
export const isCollected = m => COLLECTED_RX.test(m.title || m.display_title || '');

// Coverage of the WHOLE work: translated pages / total non-blank pages. Denominator is
// pages_count (real length), NOT pages_ocr — an edition with 608 pages but only 26 OCR'd +
// 26 translated is 4% readable, even though 26/26 of what was OCR'd is done.
export function translatedRatio(m) {
  const total = m.pages_count || m.pages_ocr || m.pages_translated || 0;
  const denom = Math.max(1, total - (m.pages_blank || 0));
  return Math.min(1, (m.pages_translated || 0) / denom);
}

// A single edition is "readable" (processed) if it has any translated text.
export const editionReadable = m => (m.pages_translated || 0) > 0;
// Visibility predicate (public link gate) — kept separate from readability on purpose.
export const editionVisible = m => m.visible === true || (m.visible == null && m.hidden === false);

// ── Edition role & authority (#3888) ─────────────────────────────────────────
// Scholarly character of an edition RELATIVE TO the work's composition language.
// Twin of the classifier in src/app/shwep/works-cited.ts (that one feeds a display
// stack, this one feeds ranking) — change the regexes in both places together.
// Shelfmark separators vary by field: titles use dots ("Vat.gr.1319"), slugs use
// hyphens ("ott-gr-86") — accept both, across the common Vatican/Palatine fonds.
const MANUSCRIPT_RX = /\bms\.?\b|\bmss\b|\bcod(ex|\.)|\b(pal|vat|urb|ott|barb|reg)[.\s-]{1,2}gr\b|manuscript|palimpsest|bodmer|houghton library|\bor\.\s?\d|\bfolios?\b/i;
// GCS = Die griechischen christlichen Schriftsteller — a critical series like Teubner.
const CRITICAL_RX = /critical[- ]edition|kritische|teubner|oxford classical text|\bgcs\b/i;
const PRINCEPS_RX = /editio[- ]princeps|aldine|incunabul/i;

// Is this edition in the language the work was composed in? The book record cannot
// say (text_role is 'original' on Latin renderings of Greek works), so the work's
// composition language must come from work-level metadata the CALLER holds (e.g.
// SHWEP_WORK_LANGUAGES). Bilingual editions ("Greek-Latin") count as source-language
// witnesses: the source text is present, facing the translation.
export function isSourceLanguage(editionLanguage, workLanguage) {
  if (!workLanguage || workLanguage === 'Unknown') return false;
  const parts = (editionLanguage || '').split(/[-/,]| and /i).map(s => s.trim().toLowerCase());
  return parts.includes(workLanguage.toLowerCase());
}

// Classify an edition's role for ranking. A form badge (critical/princeps/manuscript)
// only applies to an edition IN THE SOURCE LANGUAGE — the 1497 Aldine De mysteriis is
// the editio princeps of *Ficino's Latin*, not of Iamblichus' Greek; giving a rendering
// the authority of the text is the error this classification exists to avoid.
// Without a workLanguage every edition classifies 'translation' → role is inert and
// bestEdition behaves exactly as before (backward compatible for legacy callers).
export function classifyEditionRole(m, workLanguage) {
  const hay = `${m.title || m.display_title || ''} ${m.slug || ''}`;
  if (!isSourceLanguage(m.language, workLanguage)) return 'translation';
  if (CRITICAL_RX.test(hay)) return 'critical';
  if (PRINCEPS_RX.test(hay)) return 'princeps';
  if (MANUSCRIPT_RX.test(hay)) return 'manuscript';
  return 'edition';
}

// Ranking order per #3888: critical ≥ princeps ≥ original-language edition ≥ manuscript
// ≥ translation-only. (The works-cited DISPLAY stack ranks manuscripts above printings —
// ad fontes for the eye; for a "read here" link a manuscript scan is the harder read,
// so it sits below printed source-language editions here.)
export const EDITION_ROLE_RANK = { critical: 5, princeps: 4, edition: 3, manuscript: 2, translation: 1 };

// Does this edition match a citation's named edition ("Chester Charlton McCown",
// "Saffrey & Westerink 1997", "Wright's Loeb")? citedRef may be one string or an
// array of them (a work cited across episodes accumulates several). Tokens are
// editor-name words (≥3 chars; initials, joiners, and publisher/place boilerplate
// dropped) matched against the edition's title/author/slug; a 4-digit year in the
// citation must agree with the edition's year (±1, reprint slack) when the edition
// has one. Candidates are already confirmed editions OF THIS WORK, so an
// editor-surname hit inside that set is strong evidence, not a title collision.
// Pass workAuthor AND workTitle so the work's own author and title words (which
// citations routinely repeat, and every edition title carries) can't produce a
// spurious "cited edition" hit on the whole edition set.
const CITED_STOP = new Set([
  'the', 'and', 'von', 'van', 'der', 'des', 'ed', 'eds', 'edition', 'editions', 'editor', 'editors',
  'edited', 'trans', 'translation', 'translated', 'tr', 'rev', 'vol', 'volume', 'book', 'books', 'repr',
  // publisher/place boilerplate that would hit place names inside edition titles
  'press', 'university', 'library', 'classical', 'london', 'york', 'paris', 'berlin', 'leipzig',
  'edinburgh', 'boston', 'chicago', 'cambridge', 'oxonii', 'lipsiae',
]);
const wordSet = s => new Set((s || '').toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean));
export function citedEditionMatch(m, citedRef, workAuthor, workTitle) {
  const refs = (Array.isArray(citedRef) ? citedRef : [citedRef]).filter(Boolean);
  if (!refs.length) return false;
  const ownToks = wordSet(`${workAuthor || ''} ${workTitle || ''}`);
  const hay = ` ${(`${m.title || m.display_title || ''} ${m.author || ''} ${m.slug || ''}`)
    .toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ')} `;
  for (const ref of refs) {
    const yearM = ref.match(/\b(1[4-9]\d\d|20\d\d)\b/);
    const toks = ref.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/).filter(t => t.length >= 3 && !/^\d+$/.test(t) && !CITED_STOP.has(t) && !ownToks.has(t));
    if (!toks.length) continue;
    if (!toks.some(t => hay.includes(` ${t} `))) continue;
    if (yearM && m.year && Math.abs(m.year - +yearM[1]) > 1) continue;
    return true;
  }
  return false;
}

// Pick the single representative readable edition for a "read here" link.
// Order (#3888): the CITED edition wins outright when we hold it readable; then
// translation-completeness tier (a link landing on a 26/608 facsimile is a broken
// promise — an edition readable end-to-end beats a barely-started one regardless of
// pedigree); WITHIN a tier, role/authority (critical ≥ princeps ≥ source-language
// edition ≥ manuscript ≥ translation) — so a critical text no longer loses to a loose
// translation with merely MORE translated pages; then a DEDICATED edition over a
// collected dump, most translated text, earliest year.
// opts: { citedEdition?: string | string[], — edition string(s) the citation names;
//         workLanguage?: string, — the work's COMPOSITION language (not the book's);
//         workAuthor?: string,   — the work's author, to de-noise citation matching;
//         workTitle?: string }   — the work's title, same purpose.
// All optional; with none, ranking is exactly the legacy order.
// VISIBILITY-AGNOSTIC: feed it the set you want linked (visible-only for a reader link;
// full-catalog if you only care about ownership). Returns null if nothing readable.
export function bestEdition(heldMeta, opts = {}) {
  const readable = (heldMeta || []).filter(editionReadable);
  if (!readable.length) return null;
  const tier = m => { const r = translatedRatio(m); return r >= 0.6 ? 2 : r >= 0.25 ? 1 : 0; };
  const cited = m => citedEditionMatch(m, opts.citedEdition, opts.workAuthor, opts.workTitle) ? 1 : 0;
  const role = m => EDITION_ROLE_RANK[classifyEditionRole(m, opts.workLanguage)];
  return readable.slice().sort((a, b) =>
    cited(b) - cited(a) ||                                   // the edition the citation names
    tier(b) - tier(a) ||                                     // substantially-translated first
    role(b) - role(a) ||                                     // then scholarly authority
    (isCollected(a) - isCollected(b)) ||                     // a DEDICATED edition beats a collected dump
    (b.pages_translated || 0) - (a.pages_translated || 0) || // then most translated text
    (b.pages_ocr || 0) - (a.pages_ocr || 0) ||
    (a.year || 9999) - (b.year || 9999)
  )[0];
}

// Work-level OWNERSHIP+PROCESSED state over the editions we hold of one work. Pass the FULL
// catalog set (incl. hidden/draft). Visibility is NOT considered here — the public-link
// decision is a separate predicate the consumer applies (editionVisible). Three states:
//   'absent'           — we hold no edition of this work
//   'held_unprocessed' — we own it but no edition is translated yet (publish/process queue)
//   'held_readable'    — we own a translated edition (link-eligible once visible)
export function holdingStatus(heldMeta) {
  const metas = heldMeta || [];
  if (!metas.length) return 'absent';
  return metas.some(editionReadable) ? 'held_readable' : 'held_unprocessed';
}
