import { getReadDb } from '@/lib/mongodb';

export type SiteStats = {
  totalBooks: number;
  translatedToEnglish: number;
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
  translatedToEnglish: 15506,
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
        translatedToEnglish: s.translatedToEnglish ?? FALLBACK.translatedToEnglish,
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
