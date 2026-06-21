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

// Pick the single representative readable edition for a "read here" link. Prefer translation
// COMPLETENESS over raw page count (a link landing on a 26/608 facsimile is a broken promise),
// then a DEDICATED edition over a collected dump, then most translated text, then earliest.
// VISIBILITY-AGNOSTIC: feed it the set you want linked (visible-only for a reader link;
// full-catalog if you only care about ownership). Returns null if nothing readable.
export function bestEdition(heldMeta) {
  const readable = (heldMeta || []).filter(editionReadable);
  if (!readable.length) return null;
  const tier = m => { const r = translatedRatio(m); return r >= 0.6 ? 2 : r >= 0.25 ? 1 : 0; };
  return readable.slice().sort((a, b) =>
    tier(b) - tier(a) ||                                     // substantially-translated first
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
