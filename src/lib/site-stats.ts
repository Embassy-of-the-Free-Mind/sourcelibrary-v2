import { getReadDb } from '@/lib/mongodb';

export type SiteStats = {
  totalBooks: number;
  /** Named view `readable_in_english` (translation-state.md). */
  readableInEnglish: number;
  firstTranslationCount: number;
  authorCount: number;
  languageCount: number;
  artworkCount: number;
  illustrationCount: number;
};

// Fallback if Mongo is unreachable. Snapshot from system_config.homepage_stats
// on 2026-06-21; the live read below keeps the page current day-to-day.
const FALLBACK: SiteStats = {
  totalBooks: 16328,
  readableInEnglish: 15506,
  firstTranslationCount: 5696,
  authorCount: 6199,
  languageCount: 162,
  artworkCount: 14700,
  illustrationCount: 190973,
};

/**
 * Reads the canonical headline stats from `system_config.homepage_stats`
 * (refreshed daily at 05:00 by scripts/maintenance/prewarm-browse.mjs).
 * Returns a hardcoded fallback if the DB read fails so the page never errors.
 */
export async function getSiteStats(): Promise<SiteStats> {
  try {
    const db = await getReadDb();
    const s = await db
      .collection('system_config')
      .findOne({ _id: 'homepage_stats' } as never, { maxTimeMS: 2000 });
    if (s?.totalBooks) {
      return {
        totalBooks: s.totalBooks,
        // `translatedToEnglish` is the pre-#5286 key, kept as an alias for one release.
        readableInEnglish: s.readableInEnglish ?? s.translatedToEnglish ?? FALLBACK.readableInEnglish,
        firstTranslationCount: s.firstTranslationCount ?? FALLBACK.firstTranslationCount,
        authorCount: s.authorCount ?? FALLBACK.authorCount,
        languageCount: s.languageCount ?? FALLBACK.languageCount,
        artworkCount: s.artworkCount ?? FALLBACK.artworkCount,
        illustrationCount: s.illustrationCount ?? FALLBACK.illustrationCount,
      };
    }
  } catch {
    /* DB unreachable — use fallback */
  }
  return FALLBACK;
}
