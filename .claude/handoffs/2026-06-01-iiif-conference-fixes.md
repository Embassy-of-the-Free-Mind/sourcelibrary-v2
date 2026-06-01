# IIIF conference fixes — 2026-06-01

Derek was at the IIIF conference and asked what critiques Source Library might
get. We audited our IIIF surface, fixed the real issues, shipped, verified live,
and documented it.

## Shipped (all merged + deployed to prod + verified live)
- **#2323** — IIIF integrity: route OCR/translation annotation + content-search
  through `stripEditorialWrappers`; add Web-Annotation `generator` provenance
  (`src/lib/iiif-provenance.ts`); real canvas dims from `pages.image_width/height`;
  generic upstream Image-Service detection (not a 4-host hardcode); `resolveRights`.
- **#2324** — provider attribution: holding institution is the **primary**
  `manifest.provider` (resolved via `LIBRARY_PARTNERS` from `image_source.provider`,
  alias-normalized, with `provider_name`/`source_url` fallback); Source Library
  second; `requiredStatement` always present.
- **#2327** — OCR metadata-envelope strip: extend `stripEditorialWrappers` to the
  OCR-side wrappers `language|scan-quality|script|page-type|columns|warning`.
  **Found by verifying #2323 live** — the OCR annotation still leaked
  `<scan-quality>good</scan-quality>` etc. Translation-only fix wasn't enough.
- **(this PR)** — docs: `.claude/docs/iiif-api.md` (the surface we expose),
  CLAUDE.md "Quote & snippet integrity" updated for both wrapper families + IIIF
  surfaces, system-map pointer.

## Live verification (book `6a19bfd19b13f9ea2b272e34`, IA-sourced Kabbalah)
provider = Internet Archive first / Source Library second ✓ · requiredStatement
present ✓ · canvas 1256×2053 (real, not 1500×2160) ✓ · annotation `generator`
with model + "not human-verified" ✓ · OCR value envelope gone (just the real
`<insert>` library stamp) ✓.

## Strategic decisions captured
- **Images on R2:** site already serves R2-first (`page-image-url.ts`); sampled
  **~99.8%** of page images on R2. The manifest uses R2 (`archived_photo`) for
  those. Not a bug to fix — a backfill-completeness tail (~0.2%).
- **"Pass IIIF to the provider?":** yes for *pixels / deep-zoom service* where the
  provider has a IIIF endpoint; **no** for the *manifest itself* (our OCR/translation
  annotations are the value — don't redirect them away).
- **#2323 keep/drop:** kept the upstream deep-zoom service for the ~0.2% tail
  (harmless, gives zoom). No change needed.

## Open / follow-ups
- **GitHub issue: "IIIF Image API over R2"** — the real way to give deep zoom to
  our *own* hosted pages (extend `/api/image` sharp proxy to IIIF Image API syntax
  + `info.json`, then attach our service in `extractImageService()`). NOT yet
  filed if the conference network blocked `gh` — check repo issues; file if absent.
- **Re-run the non-R2 tail census** — `pages` aggregate for books whose images
  aren't on `images.sourcelibrary.org`, to feed re-archiving. The query kept
  failing on the conference DNS (Atlas ENOTFOUND); retry on a stable network.
- **Attribution polish:** `LIBRARY_PARTNERS` has no logo field — add one to put
  institution logos in the provider Agent.

## Gotchas learned
- IIIF is a **fourth** independent snippet-builder family (web/MCP/eval are the
  other three) — wrapper-strip fixes do NOT propagate. **Verify live after deploy**;
  the #2327 gap was invisible to code review and only showed up curling prod.
- See `.claude/docs/iiif-api.md` for the full surface + invariants.
