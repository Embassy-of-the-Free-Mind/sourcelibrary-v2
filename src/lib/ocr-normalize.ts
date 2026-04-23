/**
 * Post-OCR text normalization for cross-edition consistency.
 *
 * The same Latin text OCR'd from different scans produces variant renderings
 * of abbreviations, v/u, punctuation, and superscripts. This normalizer
 * produces a canonical form for search and comparison, while the original
 * OCR is preserved in the page record.
 *
 * Issue #1323 — OCR consistency eval showed 20-26% word-level agreement
 * across editions of identical texts, mostly due to abbreviation variance.
 */

/**
 * Normalize Latin OCR text to a canonical form for search/comparison.
 * Does NOT modify the original — this is for derived fields only.
 *
 * Strategy: strip diacritics and normalize variant glyphs to ASCII equivalents.
 * This makes "nō" and "non" both become "no" — imperfect Latin, but consistent
 * across OCR variants. For search, "no" matching "no" is better than "nō" not
 * matching "non".
 */
export function normalizeLatinOcr(text: string): string {
  if (!text) return '';

  let result = text;

  // 1. Replace common abbreviation glyphs with their Latin equivalents
  result = result.replace(/[ꝑ]/g, 'per');
  result = result.replace(/[ꝓ]/g, 'pro');
  result = result.replace(/[ꝯɔ]/g, 'con');
  result = result.replace(/⁊/g, 'et');
  result = result.replace(/[ꝫ]/g, 'us');
  result = result.replace(/[ꝙ]/g, 'quod');
  result = result.replace(/ꝝ/g, 'rum');

  // 2. Normalize long s → s
  result = result.replace(/ſ/g, 's');

  // 3. Normalize ligatures
  result = result.replace(/æ/g, 'ae');
  result = result.replace(/œ/g, 'oe');
  result = result.replace(/ﬁ/g, 'fi');
  result = result.replace(/ﬂ/g, 'fl');
  result = result.replace(/ﬀ/g, 'ff');
  result = result.replace(/ﬃ/g, 'ffi');
  result = result.replace(/ﬄ/g, 'ffl');

  // 4. Superscript numerals → regular
  result = result.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => {
    return '0123456789'['⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)] || c;
  });

  // 5. Strip ALL combining diacritical marks (macrons, tildes, acute, etc.)
  // This is the key normalization: ā→a, ẽ→e, q̃→q, ō→o, etc.
  // NFD decomposes characters, then we strip the combining marks
  result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 6. Normalize punctuation
  result = result.replace(/·/g, '.');
  result = result.replace(/•/g, '.');
  result = result.replace(/¶/g, '');
  result = result.replace(/[""„]/g, '"');
  result = result.replace(/[''‚]/g, "'");

  // 7. Collapse whitespace
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Quick check if OCR output is in "description mode" (English page description)
 * rather than actual text transcription.
 */
export function isDescriptionMode(ocrData: string): boolean {
  if (!ocrData || ocrData.length < 100) return false;

  // Strip XML tags to get raw text
  const stripped = ocrData.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = stripped.split(/\s+/);
  if (words.length < 15) return false;

  // Count English description words that don't appear in Latin/German manuscript OCR
  const descMarkers = /^(the|this|page|image|shows|contains|appears|features|depicts|displaying|visible|leather|binding|cover|manuscript|photograph|parchment|foxing|damage|depicting|illustration|decorative|ornamental|woodcut|endpaper|flyleaf|watermark|stamped)$/i;
  const markerCount = words.filter(w => descMarkers.test(w)).length;

  // 5% threshold — even short descriptions have high marker density
  return markerCount / words.length > 0.05;
}
