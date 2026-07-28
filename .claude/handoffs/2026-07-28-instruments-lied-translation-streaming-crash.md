# When every instrument lied — a usage review, and the crash it uncovered (2026-07-28)

**Status:** five PRs open, one closed as superseded, eight issues filed. Nothing merged
or deployed yet.

A routine "what's our usage?" question turned into a measurement audit. Of six initial
findings, **three were instrument failures rather than product facts** — and chasing the
last one down produced the real prize: the root cause of a live user-facing crash that
had been misdiagnosed twice.

## The pattern, stated once

Every failure below has the same shape: **an instrument produced a plausible number, and
the number was wrong in the direction that invited a confident conclusion.** None of them
errored. None looked broken.

| what it said | what was true |
|---|---|
| PostHog: traffic tripled (11K → 35K/day) | Human traffic *fell* 4×; the growth was a headless fleet |
| "81% of readers read a single page" | `page_read` is unfiltered; that was a crawler walking the corpus |
| "share = 37/month, readers don't share" | The book page had no share control at all |
| "exceptions have null type and message" | Wrong field names — plural, not singular |
| "crashes are on collections, not the reader" | True, but my grouping buried the reader by accident |
| "Googlebot only hit us 16 times" | Bucketing artifact; Google-Read-Aloud sits inside `unknown-bot` |

## What was actually wrong

### 1. PostHog counted a headless fleet as users (PR #3411)

204,270 distinct IDs made *exactly one* pageview in 7 days; ~3,150 made two or more.
Chrome-on-Windows 102,497 users vs Chrome-on-Mac 99,373 — a 50/50 split no real audience
produces. ~100% `$direct`.

These loads never reach `/api/track`, so `analytics_traffic_class` never sees them to
classify; PostHog's JS fires from its own CDN regardless. Gated on `navigator.webdriver`
(set by every automation driver, never by an ordinary browser). **Skips `posthog.init`
outright rather than passing a config option** — an unsupported option would be ignored
silently and ship as a no-op, which is the failure class the fix exists to correct.

Reassuring detail: strip the one-hit tail and the two systems agree (PostHog ~3,200
multi-pageview users vs Mongo's 4,108 multi-pageview sessions). Only the tail was
contaminated.

### 2. `page_read` has no bot filter and cannot get one (issue #3405)

839,701 `page_read` events in 7 days against 24,577 human book-page views — 34×. The
document is `{_id, page_id, ip, book_id, event, created_at, timestamp}`: **no
user-agent**, so it cannot be classified even retroactively. Reading depth is currently
unmeasurable, which matters because "do people who open a book actually read it" is the
most important product question we have.

### 3. Sharing was unmeasurable *and* partly unavailable (PR #3410)

`src/app/book/[id]/page.tsx` rendered `CiteButton` three times and never rendered a share
control. Book pages are 72% of pageviews. Two other surfaces (gallery image page,
`MycoAnchorBar`) had working share handlers emitting no event. `cite` was correctly
instrumented throughout — so 24 cites/month is a real number and the one worth acting on.

Note the trap inside the fix: `/api/analytics/event` drops unknown prop keys **silently**.
Adding a `surface` prop without adding it to `ALLOWED_PROPS` would have reproduced the
original bug inside its own fix.

### 4. The crash: React's streaming-SSR helpers vs. browser translators (PR #3421)

This is the substantive find.

**All 120 sampled** `Cannot read properties of null (reading 'parentNode')` exceptions
carry `$RS` in their frames, with `filename` pointing at the **HTML document**, not a JS
bundle. `$RS` is React's *replace suspense segment* helper, injected inline as each
streamed boundary flushes:

```js
$RS = function (a, b) {
  a = document.getElementById(a);
  b = document.getElementById(b);
  for (a.parentNode.removeChild(a); a.firstChild;) b.parentNode.insertBefore(a.firstChild, b);
  ...
}
```

Chrome/Edge's translator rewrites the DOM **while the response is still streaming**. The
placeholder is gone, `getElementById` returns null, `a.parentNode` throws, and the nearest
error boundary blanks the page.

Distribution follows Suspense boundaries exactly:

| surface | crashes | pageviews | rate |
|---|---|---|---|
| collection | 2,575 | 2,693 | ~0.96 / pageview |
| search | 147 | 447 | 0.33 |
| reader-page | 333 | 502,053 | 0.0007 |

`collections/[id]/page.tsx` renders several `Suspense` boundaries — one `$RS` call each,
per pageview. Locale confirms cause: es-ES **11.4%** of that audience affected vs en-US
**0.7%**, ~16×.

**Why the #3314 guard could never catch it:** that guard patches
`Node.prototype.removeChild` / `insertBefore`, so it only fires when something is called
*on* a Node. Here a property is *read off null* before any Node method is reached.
Different failure, separate mechanism — an accessor on `window` wrapping
`$RS`/`$RC`/`$RM`/`$RX`/`$RB`/`$RT` in try/catch as React assigns them.

**Trade-off:** swallowing a failed segment placement can leave one Suspense boundary
unresolved. The status quo blanks the whole page.

### 5. Two wrong turns, recorded deliberately

- **PR #3418 (closed).** I shipped a `TranslationSafe` remount for collections and search
  *before* finding the cause. It addresses client-side reconciliation — real (that's the
  #3314 staleness half) but a different failure, occurring after the point where this
  crash happens. Closed rather than merged: a plausible-looking non-fix in the tree is
  worse than no fix.
- **Issue #3409 as originally filed** claimed exception properties were null. They were
  not; I queried `$exception_type`/`$exception_message` when the data lives in
  `$exception_types`/`$exception_values`. The issue was rewritten and retitled.

### 6. Why nobody had read those stacks (issue #3422)

`resolve_failure: HTTP 403 while fetching` on **1,312 of 1,482 frames** — PostHog's
symbolicator is blocked by our own bot gate. That is why the stacks read as empty. Note
that `productionBrowserSourceMaps` would *not* have helped: the frames point at the HTML
document, so there is no bundle to map.

## Non-obvious methods worth reusing

- **Group by path *shape*, never exact `$pathname`.** Reader URLs are unique per page
  (`/book/<slug>/page/<id>`), so exact grouping scatters reader traffic across thousands
  of rows and buries it, while `/collections/psychology` aggregates into one. My first
  pass concluded "the reader is unaffected" for this reason alone.
- **Rate, not count.** Collections looked minor by raw volume and turned out to be ~1
  crash per pageview.
- **Locale is the translator tell.** Comparing affected users to *that locale's* total
  audience is what turns a hunch into evidence.
- **Exclude the bot fleet from every denominator.** zh-CN shows 200K "users" that are one
  actor.
- **Run the negative control on every guard test.** Each test added here was verified to
  fail when the guarded line is removed (2/3, 2/4, 2/8, 3/4).

## State

**Open PRs:** #3410 share/cite instrumentation · #3411 PostHog bot gate · #3415 provenance
canary + attribution on bulk text egress · #3421 streaming-SSR guard (the crash fix).
`test` and DCO green on the earlier ones; Vercel previews were still building.

**Open issues:** #3405 `page_read` unfiltered · #3406 404 triage · #3407 feedback queue
untriaged · #3408 `gemini_usage_daily` rollup dead since 2026-06-08 · #3409 the crash
(now correctly titled) · #3422 symbolicator 403.

Operational items (bot mitigation, outreach, email cohort) are in the private ops repo.

**Verification still owed:** #3421 by locale split (es-ES falling toward en-US) plus
`window.__slStreamGuardHits`; #3410 by re-running `engagement-metrics.mjs` a week after
deploy and reading `share` by `surface`.
