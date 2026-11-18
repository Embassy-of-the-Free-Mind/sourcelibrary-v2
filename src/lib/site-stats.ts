import { getReadDb } from '@/lib/mongodb';
import { homepageStatsAgeDays, isHomepageStatsStale, HOMEPAGE_STATS_MAX_AGE_DAYS } from '@/lib/library-stats';

export type SiteStats = {
  totalBooks: number;
  /** Named view `readable_in_english` (translation-state.md). */
  readableInEnglish: number;
  firstTranslationCount: number;
  authorCount: number;
  languageCount: number;
  artworkCount: number;
  illustrationCount: number;
  /**
   * When the cache was written (ISO), absent on the hardcoded fallback. The
   * values are still returned when `stale` is set: the fallback below is older
   * than any stale cache, so swapping to it would make the page more wrong. A
   * surface that must not quote an old figure checks `stale` (v2#3647).
   */
  asOf?: string;
  /** Cache older than HOMEPAGE_STATS_MAX_AGE_DAYS (library-stats.ts). */
  stale?: boolean;
};

/**
 * The ONE hardcoded copy of the headline stats, shown only when Mongo is
 * unreachable (here and in home-data.ts's getBookCounts). It is a dated
 * snapshot, not a live number: if you refresh it, refresh every field from the
 * same day and change the date.
 *
 * As of 2026-11-18: every field from system_config.homepage_stats as written
 * at 05:15 UTC that day. `scripts/audit/corpus-number-consistency.mjs --live`
 * fails when a field drifts more than 20% from the live value (the 2026-10-01
 * copy said 42,192 books against 71,313; v2#3647).
 */
export const SITE_STATS_FALLBACK: Readonly<SiteStats> = Object.freeze({
  totalBooks: 71337,
  readableInEnglish: 25449,
  firstTranslationCount: 14245,
  authorCount: 12459,
  languageCount: 136,
  artworkCount: 18606,
  illustrationCount: 237359,
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
      const age = homepageStatsAgeDays(s.updatedAt);
      const stale = isHomepageStatsStale(s.updatedAt);
      if (stale) console.error(`[site-stats] system_config.homepage_stats is ${age?.toFixed(1)} days old (limit ${HOMEPAGE_STATS_MAX_AGE_DAYS}); still served, marked stale. Check the 05:15 prewarm-browse job.`);
      return {
        ...(age !== null ? { asOf: new Date(s.updatedAt).toISOString() } : {}),
        stale,
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
