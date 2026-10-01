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

/**
 * The ONE hardcoded copy of the headline stats, shown only when Mongo is
 * unreachable (here and in home-data.ts's getBookCounts). It is a dated
 * snapshot, not a live number: if you refresh it, refresh every field from the
 * same day and change the date.
 *
 * As of 2026-10-01: system_config.homepage_stats (written 05:15 UTC) for every
 * field except `readableInEnglish`, which is the ladder's `readable_in_english`
 * view over live books that day (15,101 — system_config.library_dashboard
 * totals.readableLive; the pre-#5286 homepage rule said 16,599).
 */
export const SITE_STATS_FALLBACK: Readonly<SiteStats> = Object.freeze({
  totalBooks: 42192,
  readableInEnglish: 15101,
  firstTranslationCount: 5034,
  authorCount: 7862,
  languageCount: 117,
  artworkCount: 15840,
  illustrationCount: 224964,
});
const FALLBACK = SITE_STATS_FALLBACK;

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
  return { ...FALLBACK };
}
