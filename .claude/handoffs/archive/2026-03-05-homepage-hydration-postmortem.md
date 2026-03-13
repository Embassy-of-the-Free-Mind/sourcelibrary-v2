# Post-Mortem: Homepage Hydration Failure (React Error #418)

**Date:** March 5, 2026
**Duration:** ~6+ hours of user-facing breakage
**Severity:** Critical — homepage completely broken, showing "No books found in library"
**Impact:** All visitors to sourcelibrary.org saw empty library with no books or collections

## What Happened

The Source Library homepage displayed "No books found in library / Books will appear here once added to the library" instead of 2,193 books and 22 collections. The browser console showed React Error #418 (hydration mismatch). The issue was not intermittent — it affected all users, including incognito mode.

## Root Cause

**Three factors combined to create a fragile HTML structure:**

### 1. Root `loading.tsx` created a streaming Suspense boundary

`src/app/loading.tsx` rendered a `<BookLoader>` animation (complex SVG with computed CSS keyframes) as the fallback for a root-level Suspense boundary. This wrapped ALL page content in a streaming HTML structure:

```
Server HTML:
  <div hidden><!--$--><!--/$--></div>     ← React streaming infrastructure
  <!--$?-->                                ← Suspense boundary start
  <template id="B:0"></template>           ← Fallback slot
  <div>...BookLoader SVG...</div>          ← Visible loading animation
  <!--/$-->
  ... later in the stream ...
  <script>$RC("B:0","S:0")</script>        ← Resolution: swap fallback for real content
```

### 2. `useSearchParams()` in BookLibrary triggered `BAILOUT_TO_CLIENT_SIDE_RENDERING`

`BookLibrary.tsx` (line 48) calls `useSearchParams()`. In Next.js, this causes the framework to inject `<template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING">` — meaning the library content is NEVER server-rendered. Only the `BookLibrarySkeleton` fallback appears in the initial HTML. The real collections and books only render on the client after hydration.

### 3. Rapid deployments created version mismatches

20+ commits were pushed on the same day (March 5, 2026). Vercel serves ISR-cached HTML from one deploy while the browser loads JS bundles from the latest deploy. When the HTML structure (deploy A) doesn't match the JS expectations (deploy B), hydration fails.

### The Catastrophic Chain

1. User loads homepage
2. Server sends streaming HTML with BookLoader SVG + Suspense markers
3. Stream resolves: `$RC("B:0","S:0")` swaps BookLoader for page content
4. Page content includes `BAILOUT_TO_CLIENT_SIDE_RENDERING` for BookLibrary
5. Client JS (possibly from different deploy) attempts hydration
6. **Hydration fails** (React Error #418) due to structural mismatch
7. React discards ALL server DOM and re-renders from scratch
8. Server component data (collections, books, counts) is lost — these were RSC payloads, not client-fetchable
9. BookLibrary renders with empty/default props: `collections=[]`, `initialBooks=[]`
10. User sees "No books found in library"

### Contributing Factors

- **BookLoader floating-point imprecision:** `opacity="0.5700000000000001"` (from `0.75 - 3 * 0.06`) appeared 10 times in server HTML. Floating-point differences between server and client could contribute to hydration mismatches.
- **`reactCompiler: true`** in next.config.ts: The React compiler can produce different optimizations server-side vs client-side, though this wasn't confirmed as a direct cause.
- **`suppressHydrationWarning`** on `<html>` and `<body>`: This masks some hydration warnings but doesn't prevent the error when the mismatch is structural.

## Why It Wasn't Caught Earlier

1. **Server rendering worked fine** — `curl https://sourcelibrary.org` returned all 2,193 books
2. **The bug only manifested client-side** when hydration occurred
3. **No error monitoring** for React #418 specifically (ErrorReporter catches rendering errors, not hydration mismatches)
4. **ISR caching** made it inconsistent — some users got cached HTML that happened to match their JS bundle

## Fix

### Immediate (March 5, 2026)

1. **Deleted `src/app/loading.tsx`** — Eliminated the root streaming Suspense boundary. Individual routes (book, gallery, collections) have their own loading states. The homepage has its own inner `<Suspense fallback={<BookLibrarySkeleton />}>` that properly boundaries the `useSearchParams()` bailout.

2. **Added explicit Suspense boundaries** to routes that relied on the root loading.tsx for their `useSearchParams()`:
   - `src/app/search/layout.tsx` — wraps children in `<Suspense>`
   - `src/app/timeline/page.tsx` — wraps `<TimelineClient>` in `<Suspense>`
   - `src/app/experiments/layout.tsx` — wraps children in `<Suspense>`

3. **Fixed search result links** — Search results used hex IDs (`/book/69906325ef12272ffdc8f968`) which trigger a proxy rewrite→redirect chain that breaks Next.js client-side navigation. Changed to use slug-based URLs (`/book/the-book-of-nativities`).

### Parallel Fix (Mayank)

Mayank independently fixed a data-level issue where `collection.languages` had an unexpected shape, causing a crash in the `getCollections()` function. This was a separate but contributing problem.

## Commits

- `dda4e86` — Fix homepage hydration error #418: remove root loading.tsx
- `b57fd10` — Add Suspense boundaries for useSearchParams after root loading.tsx removal
- `0c498ea` — Fix search result links using hex IDs instead of slugs
- `6c796d2` — Fix home page not loading books and categories (Mayank)

## Remaining Issues

1. **`useSearchParams()` bailout in BookLibrary** — The homepage library content is still never server-rendered. Moving `useSearchParams()` into a child component with its own Suspense boundary would allow collections to be server-rendered. Low priority since the fix prevents the catastrophic failure.

2. **BookLoader floating-point imprecision** — The SVG still has `opacity="0.5700000000000001"`. Should be fixed with `Math.round(opacity * 10000) / 10000` to produce clean values. Low priority since the root loading.tsx is deleted.

3. **UnifiedSearch dropdown** uses hex IDs for index results. Lower priority since it doesn't involve `<Link>` navigation.

## Lessons Learned

1. **Root `loading.tsx` is dangerous in Next.js App Router** — It creates a streaming boundary around ALL content, making the entire site's HTML structure depend on complex streaming resolution. Individual route loading states are safer.

2. **`useSearchParams()` has hidden costs** — It triggers `BAILOUT_TO_CLIENT_SIDE_RENDERING`, meaning any component using it won't be server-rendered. Always wrap in a dedicated Suspense boundary.

3. **Rapid deployments amplify hydration risk** — ISR-cached HTML from deploy A served with JS from deploy B creates structural mismatches. Consider deployment strategies that invalidate ISR cache on deploy.

4. **Server rendering success != client rendering success** — `curl` showing correct output gives false confidence. Client hydration is a completely separate code path.

5. **Hex ID URLs break client navigation** — The proxy rewrite→redirect chain for hex IDs doesn't work with Next.js `<Link>` component. Always use slug-based URLs for internal links.
