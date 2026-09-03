/**
 * Daily page-equivalent budget for bulk read endpoints (currently /text).
 *
 * Defends the paid-tier business model: the public API is open enough for
 * casual research, single-book deep reads, and the website's own compare/parallel
 * view — but not for whole-corpus extraction. The dataset endpoints (/dataset/v1)
 * remain the supported path for bulk JSONL export.
 *
 * Budgets are per identity per rolling 24h. Same-origin browser callers (the
 * website itself) get the signed-in budget; this is enough for any human reader
 * and stops Origin-spoofing scrapers from getting unlimited access.
 *
 * Key holders pass through; their tier-specific limits are enforced inside the
 * dataset routes, and on /text we treat any valid key as "trusted" so partners
 * can build research tools without bumping into a daily wall.
 */
import type { ApiIdentity } from '@/lib/api-auth';
import type { NextRequest } from 'next/server';
import { getPagesServedLast24h } from '@/lib/api-usage';
import { DATASET_TIERS, type DatasetTier } from '@/lib/dataset/types';
import { API_LIMITS } from '@/lib/api-limits';

export interface BudgetCheck {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  /** Why we picked this limit, for the error body and logs. */
  tier: 'apikey' | 'session' | 'anon';
}

// Raised 2026-07-05 as part of the open-access + reserved-training posture
// (#2963 follow-on): the caps exist to price BULK extraction, not to stop an
// agentic research session — one assistant reading a 400-page book cold hits
// the old 100 in minutes, while IP-rotating scrapers never feel a per-IP cap.
// 500/1,000 keeps roughly a book-a-day of headroom per caller; the real
// anti-bulk levers are the bot gate (20%/book for declared AI crawlers) and
// the training license (/licensing). Previous tuning (2026-05-11, log-only
// data): 100/200 with heaviest observed legit caller at 65 pages/day.
const ANON_DAILY_PAGES = Number(process.env.API_ANON_PAGES_PER_DAY || API_LIMITS.anon.pagesPerDay);
const SESSION_DAILY_PAGES = Number(process.env.API_SESSION_PAGES_PER_DAY || API_LIMITS.session.pagesPerDay);

/**
 * Map a caller identity to its daily /text page limit. Exported for unit tests
 * that pin the business-model invariant (free Explorer keys are capped; paid
 * tiers are not). `Number.POSITIVE_INFINITY` means uncapped.
 */
export function pickLimit(identity: ApiIdentity): { limit: number; tier: BudgetCheck['tier'] } {
  // Verified bots (Googlebot etc.) stay unlimited — SEO indexing must never wall.
  if (identity.kind === 'bot') {
    return { limit: Number.POSITIVE_INFINITY, tier: 'apikey' };
  }
  // API keys honour their TIER's published daily page cap on /text — not a blanket
  // pass. Paid tiers (language/domain/full/enterprise) carry pagesPerDay: 0 =
  // unlimited, so they're unaffected. The free Explorer tier keeps its published
  // 100 pages/day here too; without this a free key was an uncapped bulk-extraction
  // token (the /text budget treated every valid key as unlimited), letting explorer
  // keys pull ~2M pages for free — exactly the bulk use the paid tiers exist to price.
  // An unknown/absent tier is treated as Explorer (the safe floor), never unlimited.
  if (identity.kind === 'apikey') {
    const cfg = identity.apiKeyTier
      ? DATASET_TIERS[identity.apiKeyTier as DatasetTier]
      : undefined;
    const perDay = (cfg ? cfg.pagesPerDay : DATASET_TIERS.explorer.pagesPerDay);
    return perDay > 0
      ? { limit: perDay, tier: 'apikey' }
      : { limit: Number.POSITIVE_INFINITY, tier: 'apikey' };
  }
  if (identity.kind === 'session') {
    return { limit: SESSION_DAILY_PAGES, tier: 'session' };
  }
  // 'anon' includes same-origin browser fetches. The api-auth gate already lets
  // them through the rate limiter; here we still apply the (more generous than
  // pure-anon) session-level page budget so the website's compare feature works
  // for any logged-in reader and is gently capped for logged-out browsers.
  return { limit: ANON_DAILY_PAGES, tier: 'anon' };
}

/** Non-mutating check — returns the budget state for this identity right now. */
export async function checkPageBudget(input: {
  identity: ApiIdentity;
  request: NextRequest;
}): Promise<BudgetCheck> {
  const { limit, tier } = pickLimit(input.identity);
  if (!Number.isFinite(limit)) {
    return { allowed: true, used: 0, limit: -1, remaining: -1, tier };
  }
  const used = await getPagesServedLast24h(input);
  const remaining = Math.max(0, limit - used);
  return { allowed: used < limit, used, limit, remaining, tier };
}

/** Friendly 429 body explaining what to do next. */
export function bulkBudgetExceededBody(check: BudgetCheck) {
  const next = check.tier === 'apikey'
    ? `Your free Explorer key is capped at ${check.limit} pages/day on /text. Upgrade for uncapped access — see https://sourcelibrary.org/licensing — or bulk-export at https://sourcelibrary.org/api/dataset/v1/pages.`
    : check.tier === 'session'
    ? 'Generate a free API key at https://sourcelibrary.org/developers (no daily cap on /text).'
    : 'Sign in (free) at https://sourcelibrary.org/auth/signin for a higher limit, or grab an API key at https://sourcelibrary.org/developers.';
  return {
    error: `Daily page budget reached (${check.used}/${check.limit} pages in the last 24h). ${next}`,
    used: check.used,
    limit: check.limit,
    tier: check.tier,
    next_steps: {
      get_api_key: 'https://sourcelibrary.org/developers',
      upgrade: 'https://sourcelibrary.org/licensing',
      sign_in: 'https://sourcelibrary.org/auth/signin',
      bulk_export: 'https://sourcelibrary.org/api/dataset/v1/pages',
    },
    retry_after_seconds: 3600, // suggest hourly retry; budget is rolling
  };
}
