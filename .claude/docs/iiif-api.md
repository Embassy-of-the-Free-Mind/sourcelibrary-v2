# The IIIF API surface we *expose* (not import)

Most `iiif-*.md` docs here are about *ingesting* from other institutions' IIIF
endpoints. This one is the opposite: the IIIF Presentation/Image/Search APIs
**Source Library serves to the outside world**, so any compliant viewer
(Mirador, Universal Viewer, Clover, Theseus) can load our books and overlay our
OCR/translation on the original page images.

Anyone can point a viewer at:

```
https://sourcelibrary.org/api/iiif/{bookId}/manifest
```

## Routes

| Route | What it returns | Spec |
|---|---|---|
| `/api/iiif/{id}/manifest` | Presentation 3.0 Manifest — canvases, provider, rights, TOC ranges, navDate, references to per-page annotation pages | Presentation 3.0 |
| `/api/iiif/{id}/canvas/{n}/ocr` | AnnotationPage — page OCR as a `supplementing` TextualBody | Presentation 3.0 + Web Annotation |
| `/api/iiif/{id}/canvas/{n}/translation` | AnnotationPage — page English translation, same shape | " |
| `/api/iiif/{id}/search?q=` | Content Search 2.0 — hits across OCR+translation as annotations with `TextQuoteSelector` highlights | Content Search 2.0 |
| `/api/iiif/{id}/autocomplete?q=` | Search autocomplete terms | Content Search 2.0 |

Source: `src/app/api/iiif/[id]/**`. All routes set permissive CORS so external
viewers can fetch them cross-origin.

## Design decisions (the parts an IIIF audience scrutinizes)

These were hardened June 2026 after the IIIF conference. PRs: **#2323**
(integrity + image services + dims + rights), **#2324** (provider attribution),
**#2327** (OCR metadata-envelope strip). The four invariants below are the ones
that broke and must not regress.

### 1. Annotations must never serve AI editorial text as transcription
The single most important invariant, and the easiest to silently reopen.
`pages.{ocr,translation}.data` is wrapped in AI-written blocks that *describe*
the page (and routinely name content from **adjacent** pages). Serving them as a
`supplementing` body fabricates a transcription of words that aren't on the
folio — the IIIF version of the "mercury on page 89" misquote (#2232).

- Every route that emits page text runs it through
  `stripEditorialWrappers()` (`src/lib/strip-editorial-wrappers.ts`) **before**
  building the body. There are **two** wrapper families and both are stripped:
  - translation-side page descriptions: `meta | summary | keywords | vocab`
  - OCR-side metadata envelope: `language | scan-quality | script | page-type | columns | warning`
- **Kept** (real text, not AI description): inline glosses
  `note | term | margin | gloss | unclear | insert` and real page marks
  `header | catchword | sig | page-num`.
- See CLAUDE.md → "Quote & snippet integrity — CRITICAL" and the lesson memory.

### 2. AI text carries provenance
Every `supplementing` annotation includes a W3C Web-Annotation `generator`
(`src/lib/iiif-provenance.ts`) — `type: Software`, labeled
"machine-generated, not human-verified", with the concrete model name from
`pages.{ocr,translation}.model` when stored. AI output is never presented as a
faithful human transcript.

### 3. Attribution credits the digitizing institution FIRST
- `manifest.provider` is an array, **holding institution first** (resolved from
  `LIBRARY_PARTNERS` via `image_source.provider`, with alias normalization;
  falls back to `image_source.provider_name`/`source_url`), **Source Library
  second** as the re-hosting/enriching aggregator.
- `manifest.requiredStatement` is **always present** and credits the institution
  ("Digitized by {institution}. Re-hosted with AI-generated OCR and translation
  by Source Library."), preferring an explicit `image_source.attribution`.
- Helper: `buildProviders()` in the manifest route.

### 4. Geometry & rights are real, not placeholder
- Canvas `width`/`height` use the real digitized pixel size
  (`pages.image_width/height`) when archiving recorded it, so `xywh` region
  citation lands. A nominal 1500×2160 is used only when unknown.
- `rights` resolves via `resolveRights()` — passes through CC /
  rightsstatements.org URIs and maps SPDX-ish IDs case-insensitively; emits
  nothing rather than an invalid value.

## Images: R2 vs. provider, and the deep-zoom gap

The principle (Derek, June 2026): **every image shown on the site should be
served from our R2** (`images.sourcelibrary.org`) whenever possible — for speed,
reliability, and to avoid hot-linking endpoints that 403 or disappear. The site
resolver (`src/lib/page-image-url.ts`) already enforces this: R2 variant →
upstream IIIF resize → `/api/image` proxy → raw. Sampled June 2026: **~99.8% of
page images already resolve from R2**; the ~0.2% tail is un-archived books.

What that means for the IIIF manifest:

- The canvas painting body uses `archived_photo` (R2) when present — so for the
  ~99.8%, the manifest image is **ours**, consistent with the R2 principle.
- **Deep zoom (IIIF Image Service):** `extractImageService()` attaches an Image
  API `service` **only when the stored URL is itself a IIIF endpoint** (parsed
  generically from the canonical `{region}/{size}/{rotation}/{quality}.{format}`
  shape; known hosts get their exact version/profile, unknown IIIF-shaped URLs
  get a safe `ImageService2/level1`). In practice that's just the upstream
  ~0.2% tail. Flat R2 JPEGs correctly get **no** service — we don't run an Image
  API server over them, so our own hosted pages are **not deep-zoomable**.

### Open item: run a IIIF Image API over R2
The clean convergence of "everything on R2" + "deep zoom": serve a IIIF Image
API (Level 1/2) over the R2 derivatives so R2 images are simultaneously ours,
reliable, **and** zoomable, and we depend on no upstream endpoint. Most
promising path: extend the existing `/api/image` sharp proxy to honor IIIF Image
API URL syntax + emit `info.json`, then have `extractImageService()` attach
**our** service for R2 pages. Tracked as a GitHub issue (see repo issues:
"IIIF Image API over R2"). Until then, deep zoom in external viewers is limited
to the upstream tail.

## Don't redirect the manifest to the provider
A reasonable-sounding idea — "when someone wants IIIF from us, pass them to the
source institution's manifest" — is **wrong** for the manifest itself. Our
manifest is the only place our OCR + translation annotations, TOC, and metadata
live; bouncing it to the provider's original manifest loses the overlay that is
our entire value-add. Pass *pixels/deep-zoom* to the provider where useful (the
image `service`), keep the *manifest* ours.

## Verifying after any change
IIIF is a fourth family of snippet builders independent of the web/MCP/eval
surfaces — fixes do **not** propagate. After touching anything under
`src/app/api/iiif/**` or `strip-editorial-wrappers.ts`, **verify live** by
curling a real manifest + an annotation page on prod (a code fix that looks done
can still leak — the #2327 OCR-envelope gap was only caught by curling
production). Check: provider order, requiredStatement present, real canvas dims,
`generator` present, and no `<…>` metadata wrappers in any annotation `value`.
