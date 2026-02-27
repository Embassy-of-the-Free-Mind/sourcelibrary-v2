# 2026-02-27: Hydration & Link Navigation Fixes

## Problem

Users reported links silently failing — clicking navigated nowhere. Intermittent, worse on slow connections (0.63 Mbps upload observed). React error #418 (hydration mismatch) found in `application_errors` collection.

## Root Cause

Multiple hydration hazards combined to break Next.js client-side router:

1. **PageTracker + BookAnalytics** used axios POST (30s timeout) for analytics tracking. On slow upload connections, these hung as unresolved Promises during hydration, blocking the main thread and contributing to hydration failures.

2. **SiteModeProvider** called `setState(getClientSiteMode())` in a `useEffect` on every page load. For sourcelibrary.org (library mode, 99.9% of traffic), the result was identical to the default — but React still re-rendered the entire tree during hydration. This unnecessary re-render widened the window for hydration mismatches.

3. **Ahrefs analytics** loaded as `<script async>` in `<head>`. Could execute mid-hydration, competing for main thread time.

4. **Collection description links** (separate bug, fixed earlier same day) used hex ID URLs (`/book/{objectId}`) which triggered the proxy middleware rewrite→redirect chain. This broke client-side navigation because Next.js soft nav can't follow middleware redirects.

When hydration fails, Next.js Link click handlers don't attach properly, so clicks do nothing — the `<a>` tags exist in HTML but the SPA router isn't functional.

## Fixes Applied

### Commit `1d02e4c` — Collection link fix
- `src/app/collections/[id]/page.tsx`: Changed `linkBookTitles()` to use `bookUrl(book)` (slug-based URLs) instead of `/book/${m.id}` (hex IDs). Slug URLs bypass the proxy rewrite entirely.

### Commit `ddaf1b7` — Hydration fixes
- `src/components/reader/PageTracker.tsx`: Replaced axios POST with `navigator.sendBeacon()`. Fire-and-forget, no hanging Promises, no timeout errors.
- `src/components/book/BookAnalytics.tsx`: Same — replaced `analytics.track()` with `sendBeacon('/api/analytics/track', ...)`.
- `src/components/providers/SiteModeProvider.tsx`: Added guard `if (clientMode.mode !== config.mode)` before calling `setConfig()`. Library mode users no longer trigger a full-tree re-render during hydration.
- `src/app/layout.tsx`: Replaced `<script async>` with `<Script strategy="lazyOnload">` for Ahrefs. Defers until after hydration.

## Remaining Risk: SessionProvider

`next-auth@5.0.0-beta.30`'s `SessionProvider` wraps the entire app and fetches `/api/auth/session` on mount. For anonymous users (99%+ of traffic), this is wasted work that can contribute to hydration issues. Consider:
- Moving `SessionProvider` to only wrap authenticated routes (`/analytics`, `/admin/*`)
- Or wrapping it in a client-only boundary that skips SSR

Lower priority since most users are anonymous and the session fetch is a GET (fast download), but worth doing if hydration issues persist.

## Also: `reactCompiler: true`

Has been enabled since the initial commit. React Compiler with `next-auth@5.0.0-beta.30` (beta) is a risk multiplier — the compiler may incorrectly memoize context values from the beta package. If hydration issues persist after these fixes, try disabling it temporarily as a diagnostic step.

## Testing

- Verify links work on first click after page load (don't wait for full hydration)
- Check browser console — should no longer see `timeout of 30000ms exceeded` from `Object.track`
- Monitor `application_errors` collection for React error #418 frequency

## Leonardo Collection

Also investigated duplicates in the Leonardo da Vinci collection: **no true duplicates exist**. The curation script already cleaned things up. Multiple editions of the same work (5 Trattato della Pittura editions, 7 Ravaisson-Mollien volumes) are intentional variants. 12 visible Leonardo books are not yet in the collection (Literary Works vols, secondary scholarship).
