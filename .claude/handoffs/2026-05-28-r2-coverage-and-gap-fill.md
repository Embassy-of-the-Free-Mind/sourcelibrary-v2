# R2 coverage measurement + gap-fill scope (2026-05-28)

## Trigger

Started from "look at the 404 and broken image errors we have" + "do we log broken images when it shows the icon for the image instead of the cover". Followed the question through:
- `broken_image_reports` (logged via `src/components/BrokenImageReporter.tsx`, fired into `/api/analytics/broken-image`) showed real broken-icon hits.
- The existing `/admin/r2-coverage` dashboard claimed 93.5% coverage. The dashboard was lying — it only measured "is `archived_photo` an R2 URL" (record-level), not "does the file actually serve content at the URL we expect" (variant-level).

## Work shipped

### PR #2068 — bare-path redirects (merged-ready)
- `/book`, `/author`, `/q` → `/search` or `/`
- `/libraries/<slug>/gallery/<...>` → `/gallery/<...>` (per URL doctrine)
- Branch: `worktree-fix-404s-broken-images`

### PR #2080 — variant-level HEAD probing in coverage snapshot
- Worker (`scripts/workers/r2-coverage-snapshot.mjs`) now HEAD-samples 3 pages × 3 variants per book, aggregates per-book/per-provider/library, writes into `system_config._id='r2_coverage_snapshot'`.
- Probes both `pages/<id>/<NNNN>-full.jpg` AND legacy `archived/<id>/<N>.jpg` for the full variant (dual-path fix landed in second commit on the branch).
- Library denominator uses **resolved** probes per variant, not attempted — so network noise can't drag the % toward zero.
- Concurrency 20 (fit undici's 10-conn-per-origin pool with headroom), 15s timeout, retry-once on 5xx/timeout.
- Gap-book ranking weights display 3×, thumb 2×, full 1× so reader-visible gaps surface first.
- Skips `etcsl`/`tu_darmstadt` (text-only by design).
- Branch: `worktree-r2-variant-coverage`. Run on 2026-05-28 took 56 min (25 min Atlas agg + 42 min probe).

### This PR — doc reconciliation
- Updated `.claude/docs/r2-storage.md` to reflect the actual six URL conventions in production R2.
- Updated `.claude/docs/image-architecture.md` to note that `utils.ts` URL rewrites are aspirational (target file may not exist) and to add the missing `books/` and split paths.
- Added this handoff.

## Snapshot results (2026-05-28 00:06 CEST)

- **Record-level coverage:** 94.0%
- **Variant-level coverage (file actually exists on R2):**
  - Display `.jpg`: 80.3%
  - Thumb `-thumb.jpg`: 80.3%
  - Full (either `-full.jpg` or legacy `/archived/<N>.jpg`): 79.7%
- **Books with at least one variant gap:** 7,070 (down from 20,054 before the dual-path fix)
- **Unresolved probes:** 329 / 179,502 = 0.18%

By provider — biggest absolute gaps:

| Provider | Books | Pages | Unarchived (record-level) | R2 % |
|---|---|---|---|---|
| mdz | 1,426 | 530K | 162K | 69% |
| harvard | 821 | 174K | 108K | 38% |
| internet_archive | 8,257 | 3.29M | 42K | 99% |
| gallica | 251 | 77K | 32K | 58% |
| bl | 1,463 | 284K | 19K | 93% |
| etcsl | 373 | 5,759 | 5,759 | 0% (intentional, text-only) |
| tu_darmstadt | 12 | 3,428 | 3,428 | 0% (intentional) |
| sat_daizokyo | 41 | 5,435 | 3,108 | 43% |

**Total library gap:** 385,679 unarchived pages + 1,367 explicitly failed.

## Six URL conventions in production R2

Sampled 100K `pages.archived_photo` values:

| Pattern | Share | Notes |
|---|---|---|
| `archived/{bookId}/{N}.jpg` (unpadded) | 77.4% | Pre-`pagePaths()` archiver. Reader rewrites to `pages/.../{NNNN}.jpg` for display — but the rewritten URL only works if the canonical file was actually generated. For ~20% of pages it wasn't. |
| `pages/{bookId}/{NNNN}-full.jpg` | 6.8% | Canonical `pagePaths(...).full`. New writes go here. |
| `books/{bookId}/pages/{NNNN}.jpg` | 1.8% | Kloss, IDP, CCAG, PDF imports. Single file per page — no display/thumb variants. |
| `cropped/{bookId}/{objectId}.jpg` | ~5% | Split-page crops, objectId filenames. |
| `uploads/{bookId}/{objectId}.jpg` | ~3% | Raw user uploads. |
| `thumbnails/{bookId}/{N}.jpg` | <0.1% | Oldest. Reader rewrites. |
| BPH `pages/{bookId}/sp{NNNN}.jpg`, `spdm{N}-{NNNN}.jpg` | (subset of `pages/`) | Split-page variants inside the canonical prefix. |

## Decision: pragmatic over architectural

Two cleanup paths considered:
1. **Architectural** — migrate all 5M+ legacy `/archived/` files to `pages/<id>/<NNNN>-full.jpg`, regenerate variants, delete legacy. Months of work. No user-visible benefit since readers don't request `/pages/-full.jpg` directly.
2. **Pragmatic** — make the dashboard tell the truth (DONE in PR #2080), then fill the ~20% gap where the URL rewrite produces a 404. Weeks of work. Direct user impact.

Chose pragmatic. Architectural cleanup is on the back-burner — only worth doing if we ever want to delete legacy paths.

## Next steps (gap-fill scope)

1. **Backfill mdz** — 162K unarchived pages, 1,426 books. Source is api.digitale-sammlungen.de IIIF. `scripts/maintenance/archive-images-fast.ts` exists; needs a "find unarchived mdz pages" feeder and runs at scale.
2. **Backfill harvard** — 108K unarchived pages, 821 books. Source is mps.lib.harvard.edu IIIF. Same pattern as mdz.
3. **Backfill gallica** — 32K pages, 251 books. Source is gallica.bnf.fr IIIF.
4. **Backfill internet_archive stragglers** — 42K pages. Worth investigating WHY they're still on source URLs after IA's main pipeline ran.
5. **Extend the variant-probe worker** to also check `books/<id>/pages/...` and BPH `sp*` prefixes so kloss/BPH books stop showing as false-positive variant gaps. Worker already handles dual-path full-res; this would add two more recognized paths.
6. **Decide on the `books/<id>/pages/` writers** — kloss/IDP/CCAG/PDF currently emit a different URL convention. If we touch those importers, convert to `pagePaths()`.

## Files modified

PR #2068:
- `next.config.ts` — bare-path redirects

PR #2080:
- `scripts/workers/r2-coverage-snapshot.mjs` — variant probe phase + dual-path full-res
- `src/app/api/admin/r2-coverage/route.ts` — pass `variant_coverage` through
- `src/app/[tenant]/admin/r2-coverage/page.tsx` — cards + variant gap tab

This PR (docs):
- `.claude/docs/r2-storage.md` — reflect actual conventions
- `.claude/docs/image-architecture.md` — note aspirational rewrites
- `.claude/handoffs/2026-05-28-r2-coverage-and-gap-fill.md` — this file

## CLAUDE.md update?

The current CLAUDE.md doesn't have a Storage/R2 section. Worth adding a brief one pointing at `r2-storage.md` and the dashboard, so future contributors don't make the same wrong-assumption mistakes we hit twice today (assuming `pagePaths()` was the only convention; assuming `-full.jpg` was missing when it was just at a different path). NOT added in this PR — left for a separate doctrine review.
