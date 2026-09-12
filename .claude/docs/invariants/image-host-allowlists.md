# Two allowlists decide whether an image appears — and every resolver must consult them

**Read this when:** adding or editing an image-URL resolver; adding a provider host; storing a new `image_*` / `*_photo` / `thumbnail*` field; or triaging "the images are broken" — or "the download button does nothing" — when the URLs return 200 to curl.

*Written 2026-08-21 after #4163: every page thumbnail on 2,506 Florentine Codex pages was refused by every browser for months, while each of those URLs returned a clean `200 image/jpeg` to curl.*

---

## The two lists

| list | file | governs | consequence of a miss |
|---|---|---|---|
| CSP `img-src` | `src/lib/csp-img-hosts.ts` → `CSP_IMG_HOSTS` | what the **browser** will load | broken image, silently — the block fires before React hydrates, so `onError` never runs and no fallback swaps in |
| proxy fetch policy | `src/lib/image-proxy-hosts.ts` → `ALLOWED_IMAGE_HOSTS` | what **`/api/image`** will fetch | 400 from the proxy |

They are **not** the same list and neither is a superset of the other. `images.metmuseum.org` is proxy-fetchable and not CSP-listed; several IIIF hosts are the reverse. Adding a provider usually means editing **both**.

## The failure mode: a resolver that doesn't screen

`getBookThumbnailUrl` (`src/lib/utils.ts`) has screened stored cover URLs with `isBrowserRenderableImageUrl()` since 2026-08-04, when ~1,550 books were found rendering blank cards. The **page**-image resolver (`src/lib/page-image-url.ts`) did not, for another two and a half weeks — and that is the whole of #4163:

- `media.getty.edu` was never added to `CSP_IMG_HOSTS`.
- All 2,506 pages of the three Florentine Codex volumes store `image_thumb` there.
- An R2 thumbnail that would have worked sat one field away in `thumbnail_blob` the entire time.

**Which surfaces broke — the answer is per-TIER, not per-book.** These pages carry `display_photo` on R2 and `image_thumb` on Getty, so the damage tracked the size tier:

| surface | tier | outcome |
|---|---|---|
| page grid (`getPageGridUrl`) | thumb | **broken** — no upgrade path |
| cover picker | thumb | **broken** |
| book cover at `thumb` size | thumb | placeholder instead of a cover |
| adjacent-page prefetch | thumb | silently failed (perf only) |
| **the reader's main image** | display → R2 | **worked** |

The reader deserves the detail, because it looks broken and is not. `ImageWithMagnifier` paints `thumbnail` first and background-decodes the full-size `src`, swapping when ready — so a reader on these books saw a broken placeholder on first paint and then the correct page once the R2 display image decoded. **Degraded, not dead.**

The server-rendered HTML contains only the *thumb* `<img>`; the display image is swapped in by script. So curling the reader page and reading its single `<img>` tag over-reports the severity — which is what this document's first draft did, and what the #4163 PR body still says.

**The general form:** one resolver is called at several size tiers, and a host can be missing for one tier and present for another. Ask which TIER a surface uses before declaring it broken, and check whether anything upgrades away from it.

**A stored URL is only useful if the consumer will load it.** Screen at every resolver, not at one of them. Corpus-wide check at the time: `media.getty.edu` was the *only* blocked host among page thumbnails (3.8M pages on allowlisted hosts, 2,506 on Getty) — so the gap was small, invisible, and total for the books it touched.

## Not every consumer is a browser

`getPageImageUrl` serves the UI **and** `pageExportImageUrl` (PDF/EPUB/ZIP), which hands the result to a server-side fetcher where CSP does not apply. The first fix for #4163 screened unconditionally and broke exports — pushing them onto a proxy whose allowlist is narrower than the CSP's, i.e. a guaranteed 400. Caught by `tests/unit/download-route-parity.test.ts`, not by review.

The resolved order, by how many consumers each satisfies:

1. renderable candidate → return it (browser + server)
2. proxy-fetchable source → `/api/image` (browser + server, our compute)
3. neither → the bounded stored URL, **kept rather than discarded** (server only, but nothing else works at all)

Tier 3 is empty in the corpus today. It exists so that the day a host is not on either list, exports keep working instead of silently losing every image.

## Diagnosing "the images are broken"

The tell that you are here rather than in a data problem: **`curl` gets a 200 and the browser shows nothing.** Check the served header first —

```
curl -sI https://sourcelibrary.org/book/<slug> | grep -o "img-src[^;]*"
```

— and compare the host in the rendered `<img src>` against it. A host missing from that list is this bug, not a bad scan, not a missing page, and not a caching problem.

## Rules

1. A new provider host goes in `CSP_IMG_HOSTS` **and** `ALLOWED_IMAGE_HOSTS` unless you can say why only one applies.
2. A new image-URL resolver screens with `isBrowserRenderableImageUrl()` for browser-facing sizes, and must not discard a URL a server-side consumer could still use.
3. Never assume the two lists agree — read them, as `isProxyableUrl()` in `page-image-url.ts` does.
4. `next.config.ts` `images.remotePatterns` is a third list, already guarded: `tests/unit/csp-image-hosts.test.ts` asserts every remotePatterns host is covered by `img-src`.

## Server-side consumers must sign their /api/image fetches (#4356)

`/api/image` and `/api/crop-image` budget anonymous non-browser traffic (`src/lib/image-gate.ts`). A server-side consumer of the proxy — an export, a pipeline step, anything handing a proxy URL to a worker — is exactly "anonymous non-browser" unless it carries the internal HMAC token (`itk`, `src/lib/image-proxy-auth.ts`). The `images.fetchBuffer/fetchBase64/fetchBufferWithMimeType` helpers sign automatically; a new consumer using bare `fetch()` against the proxy will work in testing (under 500/day) and then starve mid-batch. Fetch through the helpers, or call `signImageProxyUrl()` yourself.

## A DOWNLOAD is not a render — it needs a third and fourth permission (#4630)

*Added 2026-09-03, after both gallery download buttons were found dead for every reader.*

`img-src` governs whether the browser will **paint** an image. Saving one to disk means
reading its **bytes** with `fetch()`, and that crosses two more boundaries our own image
host did not permit:

| permission | where it lives | miss looks like |
|---|---|---|
| CSP `connect-src` | `next.config.ts` (guarded by `tests/unit/csp-image-hosts.test.ts`) | `fetch()` throws; button does nothing |
| CORS `Access-Control-Allow-Origin` | the **R2 bucket's** CORS rules — infrastructure, not this repo | `fetch()` throws; button does nothing |

`images.sourcelibrary.org` is a **different origin** from `sourcelibrary.org`, so both
apply to our own files. Neither was set until 2026-09-03: every click on the gallery's
*Download* / *Download High-Res* threw, and the `window.open` fallback ran after an
`await` — no longer a user gesture, so the popup blocker swallowed it and the page did
nothing at all, with no console error a reader would ever see.

The bucket CORS rule allows `GET`/`HEAD` from `sourcelibrary.org`, `*.sourcelibrary.org`
(tenants), `*.vercel.app` (previews) and `localhost:3000` — deliberately **not** `*`, so
this does not widen #4373 (unmarked `/archived/` originals) to arbitrary websites.
Verified cache-safe: Cloudflare returns `Vary: Origin` and MISSes an Origin request
against a primed no-Origin entry, so an ACAO-less body is never served to the site.

Read it back with `GetBucketCorsCommand` against the R2 S3 endpoint using
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`; the fastest check is the served header:

```
curl -sI -H "Origin: https://sourcelibrary.org" <image-url> | grep -i access-control
```

**Rule:** a browser-side download of one of our own images fetches it directly (clean
bytes) and falls back to the same-origin `/api/image` proxy, which always works but
re-encodes and stamps the visible provenance mark. Keep the fallback — it is what makes
the button survive a CDN or CORS regression instead of dying silently again.

Related: `content-urls-and-libraries.md` (provider prefixes), `image-quality-and-bboxes.md` (crops and bboxes), `text-helpers-and-exports.md` (the export surfaces that consume these URLs), `crawler-access-gate.md` (the image-proxy budget ladder).
