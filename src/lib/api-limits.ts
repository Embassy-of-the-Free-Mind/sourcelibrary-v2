/**
 * THE limit matrix — single source of truth for every public-API number (#4366).
 *
 * Every surface that states OR enforces a limit reads this module:
 *   - enforcement: src/lib/api-auth.ts (request rates), src/lib/api-budget.ts
 *     (/text daily pages), src/lib/image-gate.ts (image daily budget),
 *     src/lib/dataset/api-keys.ts (per-key rpm)
 *   - docs: /developers limits table, and the numbers quoted in
 *     public/llms.txt + the MCP tool prose (pinned by
 *     tests/unit/api-limits-docs.test.ts — if you change a number here, that
 *     test walks you to every prose copy that must move with it)
 *
 * A limit that appears in prose but not here is a bug. Env vars still override
 * at the enforcement site (API_ANON_PAGES_PER_DAY etc. — instant rollback);
 * this module holds the DEFAULTS the docs promise.
 *
 * The ordering invariant (field research, #4366): identity is an upgrade at
 * every step — anon < session < free key < paid. A test pins it.
 */
import { DATASET_TIERS } from '@/lib/dataset/types';

export const API_LIMITS = {
  /** Anonymous callers, per IP. */
  anon: {
    requestsPerHour: 60,
    pagesPerDay: 500,
    imagesPerDay: 500,
  },
  /** Signed-in users (free account). */
  session: {
    requestsPerHour: 1000,
    pagesPerDay: 1000,
    imagesPerDay: 1000,
  },
  /** Free self-serve Explorer key — derived from the tier table. */
  explorerKey: {
    requestsPerMinute: DATASET_TIERS.explorer.requestsPerMinute,
    pagesPerDay: DATASET_TIERS.explorer.pagesPerDay,
    imagesPerDay: DATASET_TIERS.explorer.pagesPerDay,
  },
  /** Paid tiers: pagesPerDay 0 = unlimited BY DESIGN (attribution, not quota). */
  paidKey: {
    unlimitedPages: true,
    requestsPerMinute: {
      language: DATASET_TIERS.language.requestsPerMinute,
      domain: DATASET_TIERS.domain.requestsPerMinute,
      full: DATASET_TIERS.full.requestsPerMinute,
      enterprise: DATASET_TIERS.enterprise.requestsPerMinute,
    },
  },
  /** Ungated-but-rate-limited public read routes, per IP per minute. */
  publicReads: {
    ngramsPerMinute: 60,
    dtsPerMinute: 120,
    iiifPerMinute: 300,
    datasetStatsPerMinute: 30,
  },
} as const;

/**
 * Effective requests/minute for a key doc: the stored value when present
 * (admin can hand-tune a key), else the tier default. Old keys minted before a
 * tier raise keep working at least at the tier default.
 */
export function keyRequestsPerMinute(doc: {
  tier?: string;
  rate_limit?: { requests_per_minute?: number };
}): number {
  const tierDefault =
    DATASET_TIERS[(doc.tier || 'explorer') as keyof typeof DATASET_TIERS]?.requestsPerMinute ??
    DATASET_TIERS.explorer.requestsPerMinute;
  const stored = doc.rate_limit?.requests_per_minute;
  return Math.max(stored || 0, tierDefault);
}
