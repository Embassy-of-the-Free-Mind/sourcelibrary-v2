// The `field_provenance.language` entry an enrichment script writes when it read the pages,
// formed an opinion of the language, and did NOT overwrite the catalogued value (#4766).
//
// PRIOR ART: src/lib/metadata-enrichment.ts builds the same conflict shape inline for the
// API path, but it is TS and these .mjs scripts cannot import it; scripts/lib/field-provenance.mjs
// is the generic stamp writer and deliberately leaves the typed language shape to its callers;
// scripts/maintenance/backfill-language-provenance.mjs records claims retroactively, not at write time.
//
// Why: enrich-metadata-text.mjs and enrich-metadata-vision.mjs wrote
//   { source: 'import', note: 'AI confirmed as "Syriac" (high)' }
// whenever the catalogue already had a value — including when the AI DISAGREED with it. Six
// Syriac manuscripts catalogued Hebrew carried a note "confirming" the language that contradicts
// the value beside it, and nothing querying `.conflict` could find them.

import { normalizeLanguageToken, parseLanguageField, sameLanguageFamily } from './language-normalize.mjs';

/**
 * @param {string|null|undefined} catalogued  the book's current `language`
 * @param {string} aiLanguage                  what the model read on the pages
 * @param {string|undefined} confidence        the model's own confidence
 * @param {Date} now
 * @param {string} aiSource                    claim source label, e.g. 'gemini_text'
 * @returns {object|null} the entry to store, or null when there is nothing honest to record
 */
export function aiLanguageAssessment(catalogued, aiLanguage, confidence, now, aiSource) {
  const ai = normalizeLanguageToken(aiLanguage);
  // A model answer with no language in it ("null", "unknown") is not a claim about the book.
  if (!ai) return null;
  // "Hebrew and Aramaic" is confirmed by a reading of Hebrew: compare against each part.
  if (parseLanguageField(catalogued).some((lang) => sameLanguageFamily(ai, lang))) {
    return { source: 'import', note: `AI confirmed as "${aiLanguage}" (${confidence})`, ai_confirmed_at: now };
  }
  // Below 'high' a disagreement records nothing, as in metadata-enrichment.ts and the orchestrator:
  // honest silence, not a stamp. Never a "confirmed" note.
  if (confidence !== 'high') return null;
  // Same shape as the API path's conflict entry: the catalogue keeps the value (many mismatches
  // are edition-vs-work, .claude/docs/invariants/language-fields.md), both claims are recorded.
  return {
    source: 'enrichment', value: catalogued ?? null, chosen_from: 'catalogue', confidence, conflict: true,
    claims: [
      { source: 'catalogue', value: catalogued ?? null },
      { source: aiSource, value: aiLanguage },
    ],
    date: now.toISOString(),
  };
}
