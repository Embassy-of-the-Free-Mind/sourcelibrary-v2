# BPH gutter-clip: gutter-aware audit + targeted re-crop sweep (#3088)

Follow-up to #2898 (which fixed one book — *Artis auriferae*, `69751588a88d83c830d99e16` — and
shipped the first tooling in PR #3082). This is the **cohort remediation** that was
deferred: find the BPH books that *actually* clip text at the gutter, and re-crop only
those, per-page, to the detected gutter.

## The defect
Old-era BPH splits stored each half as a per-mille crop against the full spread with
**zero overlap** — `left = {0, c}`, `right = {c, 1000}`, the two facing pages sharing
the cut line `c`. Where the old splitter put `c` short of the true binding gutter
(classically it snapped to an **inter-column valley** — the gap between the body text
and a right-aligned numeral/catchword column — instead of the binding), left-page
content between the cut and the gutter is shaved off.

These pages carry a **materialized `cropped_photo`**, so the reader serves the pre-cut
file (`getPageSource()` returns `cropped_photo`, `cropRegion()` returns undefined —
`src/lib/page-image-url.ts`). Editing `crop` coords alone changes nothing; the half
image must be regenerated from the immutable full spread and written to a new R2 key.

**Cohort:** ~**1,208 BPH books / ~410k crop pages** (`held_by:'bph'` ∩ pages with
`crop.xStart` + materialized `cropped_photo` + not `split_from_spread`), all but *Artis*
still zero-overlap.

## Why the first-pass audit was untrustworthy (and how this fixes it)
The v1 audit measured raw ink (`min(R,G,B)<120`) in a fixed band just past the cut and
flagged anything dark. It **over-flagged ~97%** because raw ink can't tell clipped text
from (a) the **binding shadow** of a tight book (saturates ~1.0; text tops ~0.6 because
line leading leaves white rows) or (b) **facing-page bleed** past the gutter.

The v2 audit is **gutter-aware** (`scripts/lib/gutter-clip.mjs`, shared with the recrop):

1. Resize the full spread to width 1000 (column x === per-mille); compute per-column ink
   and luminance over the central band (y 25–75%).
2. **Locate the true gutter** in a window around the cut: the **widest** bright ink-free
   run (picking the widest is what beats the ToC case — the inter-column valley is
   narrower than the binding), or, on a tight binding with no bright gap, the saturated
   dark shadow column.
3. Count recoverable content **only between the cut and the gutter, on the correct side**
   (sign of `gutter − cut` distinguishes a real clip from a cut that's already at/past the
   gutter, i.e. harmless over-inclusion of facing page).
4. Count only **text-like** columns (`TEXT_LO ≤ ink ≤ TEXT_HI`), and drop any column
   within `SAT_ADJ‰` of a **saturation peak** (`ink ≥ SAT_PEAK`) — that kills the
   binding-shadow *ramp*, which climbs through text-like values before it saturates (the
   p197 false positive).

Result on a 21-book sample: **~10% flagged** (vs 97%), every flag text-driven
(`shadowFrac 0`), spot-checked against overlaid spreads. Real clips are **modest** —
trailing line-end punctuation (`/`, `:`, `&`), marginal numerals, catchwords — which is
consistent with #2898's finding that the harm is localized, not wholesale.

## Acceptance-criteria status
- [x] Gutter-aware audit, eye-checked (see PR: overlay renders of true clip p50, shadow
      FP p197 now excluded, flagged books *Eine kurtze…* / *L'Elixir…* confirmed).
- [ ] Dry-run counts reviewed before any write — **do this on Hetzner** (below).
- [ ] Targeted sweep of confirmed-clipping books only, on Hetzner, batched with logs.
- [ ] Revalidate affected pages (tenant + non-tenant) after each batch.
- [ ] Re-OCR decision recorded (below).

## Run plan (on Hetzner — image-heavy, multi-hour; belongs on the pipeline box)

```bash
set -a; source .env.production.local; set +a

# 1. Full gutter-aware audit → ranked JSON + eye-check gallery.
node scripts/maintenance/audit-bph-gutter-clip.mjs \
  --out /tmp/gutter-clip.json --html /tmp/gutter-clip.html --concurrency 6
#    Open /tmp/gutter-clip.html: red=cut, green=detected gutter, yellow band=recover.
#    Spot-check flagged vs not-flagged. A flag is real when the band covers page text,
#    not binding shadow or the facing page. Tune --clip-frac / --min-recover if needed.

# 2. Extract the flagged ids and DRY-RUN the recrop (per-page gutter-relative widen).
node -e 'console.log(JSON.stringify(require("/tmp/gutter-clip.json").flaggedBookIds))' > /tmp/clip-ids.json
node scripts/maintenance/recrop-bph-gutter.mjs --ids-file /tmp/clip-ids.json --to-gutter --dry-run
#    Review the "would re-crop N/total" lines. In --to-gutter, pages whose cut is already
#    at/past the gutter are SKIPPED (healthy) — only clipping pages are touched.

# 3. Real sweep, in batches with per-batch logs (idempotent + reversible).
node scripts/maintenance/recrop-bph-gutter.mjs --ids-file /tmp/clip-ids.json --to-gutter \
  --limit 25 2>&1 | tee /tmp/recrop-batch1.log
#    Repeat with growing offsets (split clip-ids.json into batches), watching the logs.

# 4. Revalidate a few affected books, tenant + non-tenant:
#    https://sourcelibrary.org/book/<slug>  and  https://bph.sourcelibrary.org/... (embed)
#    Confirm the re-cropped half shows the recovered edge and no facing-page bleed.
```

**Why `--to-gutter`, not blind `--overlap 35`:** the blind widen is safe only for
wide-gutter books (*Artis*); on tight bindings it drags in the shadow + facing page.
`--to-gutter` moves the cut to the *detected* gutter centre per page — recovering exactly
the clipped content — and self-limits (a non-clipping page is left untouched).

**Safety:** non-destructive, idempotent, reversible. Each page is re-cropped from the
immutable spread to a **new** R2 key (fresh `/api/image` cache, no CDN purge); the
original crop + cropped_photo are stashed in `recrop_2898.{prev_crop, prev_cropped_photo}`
so re-runs never double-widen and the change is one-command reversible.

## Re-OCR decision (was #2898 Task 4)
Re-cropping fixes **pixels, not stored text**. OCR/translation ran on the clipped crop,
so gutter-side content is missing from `pages.{ocr,translation}`. To re-OCR a swept book,
clear its `ocr` and let the orchestrator re-run at `pipeline_auto.status='archive_complete'`.

This is **separate, paid (Gemini), and the pipeline is currently paused** — decide *after*
the sweep, and only for books where the recovered content is substantive (the audit's
`meanRecoverInk` / `maxReach` per book are the signal). For the sample cohort the recovered
content is mostly line-end punctuation and marginal marks, so re-OCR is **low-yield** there;
prioritize any book whose flagged pages show a full recovered text column (e.g. a clipped
numeral/marginal-gloss column), not just trailing glyphs. Record the final call here when made.

## Files
- `scripts/lib/gutter-clip.mjs` — shared gutter-aware primitive (profile, findGutter, measureClip).
- `scripts/maintenance/audit-bph-gutter-clip.mjs` — audit; `--profile <id>` dumps per-page geometry; `--html` writes the eye-check gallery.
- `scripts/maintenance/recrop-bph-gutter.mjs` — `--to-gutter` (per-page, recommended) or blind `--overlap`.
