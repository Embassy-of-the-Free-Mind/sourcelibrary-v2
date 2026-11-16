import { getReadDb } from '@/lib/mongodb';

/**
 * Headline library counts, read from the daily-refreshed
 * `system_config.homepage_stats` cache (written by
 * `scripts/maintenance/prewarm-browse.mjs` at 05:15 and on demand by
 * `update-homepage-stats.mjs`). This is the single source for "how many books /
 * languages / illustrations" numbers shown across the site — render these
 * instead of hardcoding strings, so the numbers never drift out of sync again.
 *
 * Cost: one indexed `_id` lookup on a tiny collection. Every caller is an
 * ISR/edge-cached page, so this runs at most ~once/day, never per visit.
 */
/**
 * Freshness guard (v2#3647). The cache is rewritten every day; a pipeline pause
 * once froze it for seven weeks while every page went on quoting it. Past this
 * age a count is no longer "today's": getLibraryStats() returns null, so each
 * caller shows its own wording without a number (or the dated floor in
 * public-stats.ts), and getSiteStats() marks the value `stale`.
 * scripts/audit/corpus-number-consistency.mjs --live reports the same age sooner.
 */
export const HOMEPAGE_STATS_MAX_AGE_DAYS = 7;

/** Age of the cache in days, or null when `updatedAt` cannot be read as a date. */
export function homepageStatsAgeDays(updatedAt: unknown, now: number = Date.now()): number | null {
  if (updatedAt == null || typeof updatedAt === 'boolean') return null;
  const t = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt as string | number).getTime();
  if (!Number.isFinite(t)) return null;
  return (now - t) / 86_400_000;
}

/**
 * True when the cache is older than the limit. A missing or unreadable date is
 * NOT stale: the document predates the timestamp or was hand-edited, and the
 * audit script reports that case; blanking every count for it would be worse.
 */
export function isHomepageStatsStale(updatedAt: unknown, now: number = Date.now(), maxAgeDays: number = HOMEPAGE_STATS_MAX_AGE_DAYS): boolean {
  const age = homepageStatsAgeDays(updatedAt, now);
  return age !== null && age > maxAgeDays;
}

/** Narrow a cached `system_config.homepage_stats` document to LibraryStats; null when empty or stale. */
export function libraryStatsFromCache(cached: Record<string, unknown> | null | undefined, now: number = Date.now()): LibraryStats | null {
  if (!cached?.totalBooks) return null;
  if (isHomepageStatsStale(cached.updatedAt, now)) {
    console.error(`[library-stats] system_config.homepage_stats is ${homepageStatsAgeDays(cached.updatedAt, now)?.toFixed(1)} days old (limit ${HOMEPAGE_STATS_MAX_AGE_DAYS}); counts withheld. Check the 05:15 prewarm-browse job.`);
    return null;
  }
  return {
    books: Number(cached.totalBooks) || 0,
    languages: Number(cached.languageCount) || 0,
    illustrations: Number(cached.illustrationCount) || 0,
    // `translatedToEnglish` is the pre-#5286 key, kept as an alias for one release.
    readableInEnglish: Number(cached.readableInEnglish ?? cached.translatedToEnglish) || 0,
    firstTranslations: Number(cached.firstTranslationCount) || 0,
  };
}

export interface LibraryStats {
  books: number;
  languages: number;
  illustrations: number;
  /** Named view `readable_in_english` (translation-state.md). */
  readableInEnglish: number;
  firstTranslations: number;
}

export async function getLibraryStats(): Promise<LibraryStats | null> {
  try {
    const db = await getReadDb();
    const cached = await db.collection('system_config').findOne(
      { _id: 'homepage_stats' } as never,
      {
        projection: {
          totalBooks: 1,
          languageCount: 1,
          illustrationCount: 1,
          readableInEnglish: 1,
          translatedToEnglish: 1,
          firstTranslationCount: 1,
          updatedAt: 1,
        },
        maxTimeMS: 2000,
      }
    );
    return libraryStatsFromCache(cached as Record<string, unknown> | null);
  } catch {
    return null;
  }
}

/**
 * Format a count as a rounded "16,000+" label. Rounds DOWN to the given
 * granularity (default 1,000) so the value — and therefore the cached HTML —
 * only changes at each milestone, not on every import. Always truthful (never
 * rounds up past the real count).
 */
export function roundedCountLabel(n: number, granularity = 1000): string {
  if (n < granularity) return n.toLocaleString('en-US');
  return `${(Math.floor(n / granularity) * granularity).toLocaleString('en-US')}+`;
}
