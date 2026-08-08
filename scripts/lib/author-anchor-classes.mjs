/**
 * Shared rule for "can this Wikidata item be an author anchor?"
 *
 * Used by scripts/audit/author-anchor-validity.mjs (the standing sweep) and
 * scripts/analysis/resolve-work-ids-wikidata.mjs (the pre-flight check), so the
 * two can never drift apart.
 *
 * THE RULE IS A DENYLIST, NOT `P31 = Q5`. Demanding "human" flags 38 anchors in
 * this corpus, and the great majority are correct: Homer (Q21070568, "human
 * whose existence is disputed"), Hermes Trismegistus (Q61002 pseudonym /
 * Q16685255 epithet), Orpheus (mythological Greek character), Enoch, Vyāsa,
 * the Sibyl, Chiron. Attributed and legendary authorship is what a library of
 * Hermetica, Orphica and Vedic texts is largely made of — gating on Q5 would
 * silently skip the collection's core.
 *
 * So deny only what cannot be an author under any reading: a work, a reference
 * book, or a disambiguation page. Everything person-like passes.
 */
export const NEVER_AN_AUTHOR = new Map([
  // Disambiguation pages — a list of people, never one person.
  ['Q4167410',  'Wikimedia disambiguation page'],
  ['Q22808320', 'Wikimedia human name disambiguation page'],
  // A WORK standing in for its author. The most damaging kind, because such an
  // anchor often still returns plausible P50 results instead of failing loudly.
  ['Q7725634',  'literary work'],
  ['Q47461344', 'written work'],
  ['Q12765855', 'philosophical work'],
  ['Q2271441',  'sententiae'],
  ['Q13136',    'reference work'],
  ['Q521983',   'etymological dictionary'],
  ['Q913554',   'grimoire'],
  ['Q693',      'fable'],
  ['Q571',      'book'],
  ['Q3331189',  'version, edition, or translation'],
  ['Q234460',   'text'],
  // Plainly a mis-link.
  ['Q1569167',  'video game character'],
]);

/** @returns {string|null} reason the anchor is invalid, or null if it is usable. */
export function anchorProblem(p31Set) {
  if (!p31Set || !p31Set.size) return 'no P31 (deleted, redirected, or bad QID)';
  const hit = [...p31Set].filter(x => NEVER_AN_AUTHOR.has(x));
  if (hit.length) return `${hit.map(h => `${h} (${NEVER_AN_AUTHOR.get(h)})`).join(', ')} — a thing, not a person`;
  return null;
}
