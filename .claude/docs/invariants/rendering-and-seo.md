# Rendering invariants — prerender, browser translation, social cards

**Read this when:** Touching a client component on an ISR route, the reader panels, the root layout, a page’s `metadata` export, or adding a route-level `redirect()` / `notFound()`.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

## Static-prerender Suspense invariant (SEO-critical)
Any client component that calls `useSearchParams()` (or another prerender-bailout hook) must wrap the consumer in its **own** `<Suspense fallback={null}>` inside the component — never rely on a page-level boundary catching it. On statically prerendered routes (the ISR book page is the canonical case: `revalidate = 86400`, never reads `headers()`), an unwrapped call throws a CSR bailout that the *nearest* Suspense boundary catches; when that's the page's main content boundary, the served HTML becomes the loading skeleton. Users never notice (the client re-renders from flight data), but crawlers get a content-free page — this silently blanked every `/book/<slug>` page for search engines from ~2026-05-27 to 2026-07-19 and was the real root cause of the "99% of pages orphaned" finding (#2266, fixed in PR #3231 via `EmbedNavigationReporter`). **Tell:** a `BAILOUT_TO_CLIENT_SIDE_RENDERING` template in served HTML above the content, and 0 content anchors while the flight-data scripts contain them. **Verify with `curl` + grep for real `<a href>` anchors** — a browser always looks fine, so eyeballing proves nothing. Dynamic routes (anything reading `headers()`, like collections and the reader) don't hit this, which makes the regression easy to miss in spot checks.

## A `redirect()` or `notFound()` below a `loading.tsx` is a soft 200

A segment with a `loading.tsx` gets an **automatic `<Suspense>` around its
`page.tsx`**. Next flushes the 200 shell the moment the page's data fetch
suspends — so by the time the page's own code runs, the status is committed and
neither `redirect()` nor `notFound()` can change it. What you get instead:

- `notFound()` → a soft-404: the not-found body served with status **200**.
  Fixed on sibling routes in #3277 / #3376; `tests/unit/soft-404-loading-guard.test.ts`
  pins that certain `loading.tsx` files stay absent.
- `redirect()` → a **client-side meta-refresh**: status **200** with
  `NEXT_REDIRECT` and a `<meta http-equiv="refresh">` in the body. A browser
  follows it, so it looks fine; a crawler indexes the page you meant to redirect
  away from. Measured on 2026-08-21 while gating `/es/book/<slug>/page/<id>`
  for books with no Spanish edition (#4104): the page-level version returned 200,
  the layout-level version a real 307.

**The fix is always the same: move the decision UP into `layout.tsx`.** A layout
sits above that boundary, so awaiting there still sets a real status and the
skeleton is untouched. `src/app/book/[id]/page/[pageId]/layout.tsx` now carries
both the existence gate and the localized-URL gate for exactly this reason.

**Verify with `curl -o /dev/null -w '%{http_code} %{redirect_url}'`**, never in a
browser: `%{redirect_url}` is populated only by a real HTTP redirect, and the
meta-refresh case is indistinguishable by eye. Same discipline as the
static-prerender invariant above — the browser always looks fine.

## Browser-translation invariant (don't remove the guard or the key)
Chrome/Edge's built-in translator replaces every text node with a nested `<font style="vertical-align: inherit">` pair. React keeps a reference to the ORIGINAL node, so its next commit calls `removeChild`/`insertBefore` on a node that is no longer a child of the parent React recorded — the DOM throws `NotFoundError`, React re-throws out of the commit phase, and the nearest error boundary blanks the page. For a reader with auto-translate on this was: open a book, turn two or three pages, get an error screen, on every book and device (reported in Italian, fixed in #3314; see `.claude/handoffs/2026-07-22-browser-translation-reader-crash.md`). Two pieces keep it working, and each looks deletable on its own:
- **`TRANSLATION_DOM_GUARD_SCRIPT` in `src/app/layout.tsx`** is a deliberate monkey-patch of two DOM primitives, not a leftover. It must stay an inline `<head>` script — the translator can rewrite the DOM before the React bundle parses, so a client component is too late for the hydration commit. Pinned by `tests/unit/translation-dom-guard.test.ts`.
- **The `key` on `data-reader-panels-container`** (`TranslationEditor`, driven by `useBrowserTranslation`) is not a perf mistake. The guard stops the *throw*; only a remount makes the update *arrive* — without it React's writes land on departed nodes and the reader shows the previous page's words. Key is `undefined` when no translator is detected, so untranslated readers are untouched. Never key the whole reader: panel toggles/font size/trace mode live above the key and would reset on every page turn.

**Route-level `error.tsx` bypasses the global `ErrorReporter` boundary** (Next.js handles it first), so any route error page must call `reportError` itself or its failures are invisible in `application_errors` — that is why this bug ran for months unmeasured.

**Verifying:** Chrome's built-in translator can't be driven from CDP and the Google Translate *widget* is blocked by our CSP (`translate-pa.googleapis.com` absent from `script-src`; the built-in translator is browser-level and unaffected, so real users are fine). Model it with a MutationObserver that wraps text nodes in `<font><font>` — but **apply the batches asynchronously**, never synchronously inside the observer callback: sync surgery lands inside React's commit, which no real translator does, and it manufactures staleness on correct builds. Always run the unfixed build through the same harness as a negative control; if the old code passes too, the harness proves nothing.

## Shallow-metadata-merge invariant (social cards, feed links)
**Next.js merges page `metadata` shallowly per top-level key: a page that declares a key replaces the root layout's ENTIRE object for that key.** This has now bitten two different keys, so treat it as a property of every key you set, not a fact about `openGraph`. The failure is always silent — the page renders, nothing errors, the tag is simply gone.

### `alternates` — feed autodiscovery (2026-08-13, PR #3965)
`src/app/page.tsx` and `src/app/es/page.tsx` declare `alternates` for `canonical` + hreflang `languages`, which dropped the layout's `alternates.types` — so the homepage, the most-linked page on the site, advertised **no feed `<link>` tags at all**, including the three Atom feeds declared months earlier. Found only because a newly-added podcast RSS feed appeared on `/podcast` (which declares no `alternates` and inherits correctly) but not on `/`.

The feed list is now `FEED_TYPES` in `src/lib/feed-links.ts`, spread into the layout and both homepages. **Any route that sets `alternates` must spread `FEED_TYPES` into its own `types`.** Scope of the remaining exposure: **174 files** under `src/app` declare `alternates` and still drop the links — issue #3968 tracks the sweep and proposes a `buildMetadata()` helper so the key can't be declared bare. Verify with `curl -s <url> | grep -o '<link rel="alternate" type="application/[^>]*>'` — expect five (3 Atom + 2 RSS); a browser tells you nothing.

### `openGraph` / `twitter` — social cards
Two consequences that bit three surfaces in one day (2026-07-15, PRs #3149/#3151/#3152):
- A page that defines `openGraph` **replaces the root layout's entire openGraph object, images included** — title/description-only blocks ship NO `og:image` at all (blank share cards on FB/LinkedIn/Slack/iMessage).
- The root layout's `twitter.images` (generic logo) **wins over per-page `openGraph.images` on X** — a correct og image still cards as the logo unless the page sets its own `twitter.images`.

Rule: **any page that defines `openGraph` must set `images` explicitly and mirror them in a `twitter` block.** Exempt: routes with a file-convention `opengraph-image.tsx` (book, author, category detail, reader pages, gallery images) — the convention feeds the twitter card automatically.

**The exemption is per ROUTE SEGMENT, and a locale twin is a different segment.** `opengraph-image.tsx` under `/book/[id]` does nothing for `/es/book/[id]`: the twin needs its own file, or it falls back to the site card. And the card ART is language-bearing — the headline is baked into the JPEG — so a Spanish page under the English card announces itself in English at the only moment a reader is deciding whether to click. Both halves shipped that way for months (#4162) even though the rule above was already written down, because `/es/collections` set `openGraph` without `images` and nobody looked at what WhatsApp actually rendered. Per-locale cards: `siteOgImage(lang)` in `src/lib/og-locale.ts`, renderers in `src/lib/og-book-card.tsx` / `og-page-card.tsx`, full rules in `.claude/docs/i18n.md` ("The share card is part of the page"). **Verifying means fetching the page and reading the two meta tags** — `curl … | grep 'og:image\|twitter:image'` — not reading the metadata object. Tenant/embed routes are deliberately image-less pending tenant-scoped cards. New blog notes copy the openGraph+twitter pattern from any existing post; their "Last revised" footer dates come from `src/generated/blog-revisions.json` (regenerated from git history by `deploy-prod.sh` — see `scripts/maintenance/generate-blog-revisions.mjs`).
