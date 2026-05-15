# Postmortem — BPH Homepage Slowness (2026-05-15)

**Severity:** High (partner-facing latency degradation, no outage)
**Surface:** `https://bph.sourcelibrary.org/` and `/embed/bph` SSR
**Resolution PR:** [#1768](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/pull/1768)
**Diagnosed by:** prior session (branch `worktree-bph-perf-cache-dominant-provider`, commits `7f8cba45` + DIAG `dcaf0446`)
**Shipped by:** session `bph-home-cache` after user reported slowness

## Impact

- BPH embed homepage: 3.5–10s wall-clock per request (worse under concurrency — every parallel hit got its own cold Lambda).
- Other tenants on the **identical code path** (Ficino, Bhutan): <300ms.
- EFM's `/digital-collection-search` iframe — the primary partner surface — was effectively unusable without long spinner waits.

## Symptoms

- TTFB fast (~180–280ms): the RSC shell streamed promptly.
- Total transfer slow (~4s warm, ~8s cold): the SSR body streamed slowly because data fetches blocked the response.
- `x-vercel-cache: MISS` on every hit (route is dynamic; edge cannot cache).
- 12 parallel curl requests → 12 distinct Vercel Lambda IDs, each ~9–10s cold.

## Root Cause

Two Mongo calls in `src/app/embed/[tenant]/page.tsx` ran **uncached on every render**:

1. **`getTenantDominantProvider(tenantId)`** — `$group` aggregation over all books in the tenant. BPH has ~17K books; Ficino/Bhutan have hundreds. The aggregation cost scaled linearly with tenant size and dominated the warm-Lambda budget.
2. **`resolveTenantId(slug)`** — slug → UUID lookup. The docstring already promised a "5-min KV cache" — implementation never matched.

PR #1757 had hardened the main library loader (`fetchTenantLibraryData`) with a 5-min TTL cache, but these two remaining hot calls were missed. The slowness was not a *change* — it scaled with BPH growth and crossed a perceptible threshold as recent dedup/import work pushed the catalogue to ~17K books.

## Why This Wasn't Caught Earlier

- **Per-tenant variance hides BPH-only regressions.** Local dev and staging traffic skew toward smaller tenants; the linear scaling with book count only bites in production on BPH.
- **Edge cache headers were never honored.** `next.config.ts` declares `Cache-Control: public, max-age=300, stale-while-revalidate=3600` for `/embed/:path*`, but Next.js overrides this with `private, no-cache, no-store` because the route is dynamic (`searchParams`, conditional `redirect()`). We had no edge-level safety net to mask SSR cost.
- **Cold-start cost was masked by Vercel keeping `fra1` Lambdas warm** during interactive testing, but real partner traffic patterns (intermittent iframe loads from EFM site visitors) hit cold Lambdas constantly.

## Fix (PR #1768)

Two surgical changes to the existing TTL-cache pattern already used by `fetchTenantLibraryData`:

- `src/lib/tenant-context.ts` — 5-min in-memory cache around `resolveTenantId` (positive AND negative results).
- `src/lib/tenant-library-loaders.ts` — 5-min in-memory cache around `getTenantDominantProvider`, with stale-on-error fallback.

Per-Lambda only — no shared cache infrastructure. Vercel keeps `fra1` instances warm for several minutes which covers the bulk of EFM iframe traffic. Cold Lambdas still pay one rebuild on first request.

## What Still Hurts (Future Work)

The fix addresses the warm-Lambda case. Two structural issues remain:

1. **Cold Lambda cost.** First request to a fresh instance still rebuilds all caches (~8s for BPH). Mitigations:
   - Parallelize the two batch waves in `page.tsx` (currently sequential when `isBph`).
   - Move long-lived caches (dominant provider, slug→id) to Vercel Edge Config or KV so they're shared across instances.
2. **No edge HTML cache.** Every visitor invokes a Lambda. Options:
   - Lift the orphan-param `redirect()` into middleware so the page becomes statically renderable; then `export const revalidate = 60` and let Vercel cache the HTML.
   - Or: explicitly emit `Cache-Control: public, s-maxage=60, stale-while-revalidate=3600` in the route response (Next 16 supports per-route headers).

Either would let most BPH visitors see <300ms TTFB and zero Lambda invocations.

## Lessons / Rules

1. **Per-tenant aggregations need TTL caches before they ship.** Any `$group`, `$facet`, or full-collection scan keyed by tenant must assume the largest tenant could be 100× the smallest — and cache accordingly. Add to PR-review checklist for `src/app/embed/**` and `src/app/[tenant]/**`.
2. **If a docstring promises a cache, implement it or delete the promise.** `resolveTenantId` carried a "5-min KV cache" claim for months without one. False docstrings rot trust and hide regressions.
3. **Embed routes need edge caching.** The `next.config.ts` rule for `/embed/:path*` is silently overridden by route-level dynamism. Either make the route cacheable (lift dynamic logic to middleware) or override the response headers explicitly. Don't ship a partner-facing iframe with `cache-control: private, no-cache, no-store`.
4. **Tenant-scoped queries that aren't tenant-scoped are bugs.** During this investigation we noticed `fetchTenantLibraryData` runs an unscoped `books_catalog` query for "contributing libraries" (no tenant filter, returns everything). Both a perf risk and a potential tenant-leak (CLAUDE.md invariant #2). Filed as follow-up.

## Timeline (UTC+2, 2026-05-15)

- ~13:39 — Other session diagnoses the two uncached calls (commit `7f8cba45` on branch `worktree-bph-perf-cache-dominant-provider`).
- ~14:20 — Same session adds DIAG instrumentation to verify (commit `dcaf0446`). Branch not merged.
- ~14:15 — User reports BPH slowness in this session. Investigation rediscovers the prior diagnosis on the unmerged branch.
- ~14:30 — Cherry-pick `7f8cba45` (drop DIAG), open PR #1768, auto-merge, deploy.
- ~14:32 — Post-deploy cache warm completes; warm Lambdas show ~4s (down from ~5s, more after cold-Lambda churn settles).

## References

- PR #1768 — fix
- PR #1757 — earlier loader hardening (the prior round)
- PR #1761 — BPH stats consolidation (related caching pattern)
- Branch `worktree-bph-perf-cache-dominant-provider` — original diagnosis + DIAG instrumentation
- `.claude/docs/database-incidents.md` — broader Atlas/Mongo incident log
