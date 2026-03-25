/**
 * Extract metadata tags (<summary> and <keywords>) from translation output.
 *
 * Every translation prompt instructs the model to end with:
 *   <summary>1-2 sentence summary</summary>
 *   <keywords>key concepts, names, themes</keywords>
 *
 * This function parses those tags and returns structured data for persistence
 * as page-level fields (translation_summary, translation_keywords).
 */

export function extractTranslationMetadata(translationText: string): {
  translation_summary?: string;
  translation_keywords?: string[];
} {
  const result: { translation_summary?: string; translation_keywords?: string[] } = {};

  // Extract <summary> tag
  const summaryMatch = translationText.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryMatch) {
    const summary = summaryMatch[1].trim();
    if (summary.length > 0) {
      result.translation_summary = summary;
    }
  }

  // Extract <keywords> tag
  const keywordsMatch = translationText.match(/<keywords>([\s\S]*?)<\/keywords>/i);
  if (keywordsMatch) {
    const raw = keywordsMatch[1].trim();
    if (raw.length > 0) {
      // Split on commas, semicolons, or " - " separators; trim and deduplicate
      const keywords = raw
        .split(/[,;]\s*|\s+-\s+/)
        .map(k => k.trim())
        .filter(k => k.length > 0);
      if (keywords.length > 0) {
        result.translation_keywords = [...new Set(keywords)];
      }
    }
  }

  return result;
}

/**
 * Propagate <warning> tags from OCR data to translation text.
 *
 * OCR warns about quality issues (fading, damage, manuscript difficulty).
 * Translation readers need the same warnings — many users only see the
 * translation panel. This prepends any OCR warnings to the translation
 * so the UI renders them identically on both sides.
 *
 * Idempotent: skips warnings already present in the translation text.
 */
export function propagateOcrWarnings(ocrData: string, translationText: string): string {
  const warningMatches = ocrData.match(/<warning>[\s\S]*?<\/warning>/g);
  if (!warningMatches || warningMatches.length === 0) return translationText;

  // Only prepend warnings not already in the translation
  const newWarnings = warningMatches.filter(w => !translationText.includes(w));
  if (newWarnings.length === 0) return translationText;

  return newWarnings.join('\n') + '\n' + translationText;
}
