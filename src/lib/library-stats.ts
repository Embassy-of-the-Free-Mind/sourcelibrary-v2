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
export interface LibraryStats {
  books: number;
  languages: number;
  illustrations: number;
  translatedToEnglish: number;
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
          translatedToEnglish: 1,
          firstTranslationCount: 1,
        },
        maxTimeMS: 2000,
      }
    );
    if (!cached?.totalBooks) return null;
    return {
      books: Number(cached.totalBooks) || 0,
      languages: Number(cached.languageCount) || 0,
      illustrations: Number(cached.illustrationCount) || 0,
      translatedToEnglish: Number(cached.translatedToEnglish) || 0,
      firstTranslations: Number(cached.firstTranslationCount) || 0,
    };
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
