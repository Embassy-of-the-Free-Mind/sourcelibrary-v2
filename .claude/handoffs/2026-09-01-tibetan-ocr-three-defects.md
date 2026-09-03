# Tibetan OCR: three disjoint defects, one of them ours — 2026-09-01

Session picked up `scripts/eval/results/r4523-handoff-prompt.md`, which asked for a
literature and tooling review on manuscript OCR. The review is done and posted to
#4523. It also turned up a live image-integrity defect that the issue's own premise
ruled out, and that turned out to be the largest single cause.

## The finding in one line

#4523 opened as "our OCR invented Devanagari Hindu scripture on a Tibetan Buddhist
folio." It is **three separate defects**, and fixing any one leaves the other two.

### A. The images had holes in them — ours

`fetchIiifNativeRes` composited IIIF region tiles onto a **white** canvas at
`left = col*chunk` and never checked what came back. `rearchive-iiif-fullres.mjs`
sized the stride from `pageInfo.maxWidth || 2000`; EAP advertises *nothing*, so the
fallback invented 2000 while EAP serves 1200. 0.6 linear, 0.36 area.

```
3888x2592  white=0.635  x[1200,2000)              y[1200,2000)
3504x2336  white=0.623  x[1200,2000)              y[1200,2000)
4752x3168  white=0.603  x[1200,2000) x[3200,4000) y[1200,2000)
```

**80,981 pages / 167 books. 79,410 with OCR, 74,344 with a published translation.**
An exact count, not an estimate: 90 marked Tibetan pages were sampled and 90 were
guttered, and 0 of 210 clean pages carried the marker.

Scope closed at **EAP only**, and by mechanism rather than by absence. Three other
`SILENT_CAP_HOSTS` are in the cohort (e-rara 134,419 pages, Manchester 47,218,
Kyoto 286), so a null result needed an explanation. Probing each with the exact
request the stitcher made:

```
e-rara       asked 2000x2000 -> served 2000x2639   FITS
Manchester   asked 2000x2000 -> served 2000x2000   FITS
Kyoto        asked 2000x2000 -> served 2000x2000   FITS
EAP          asked 2000x2000 -> served 1200x1200   SHORT -> GUTTER
```

Consistent with the sampling: 1,501 non-Tibetan cohort pages, zero guttered.

Fixed in PR #4531 (merged): probe-and-shrink stride, `tileFits()` refusal with a
unit test and negative control, the rearchiver no longer sizes its stride from an
advertised cap, and `scripts/audit/tile-stitch-gutters.mjs` as a standing detector.
**The repair of the 80,981 pages is NOT done** — tracked in #4534.

### B. The model cannot read the script — not ours, not fixable by prompting

[GlotOCR Bench](https://arxiv.org/html/2604.12978v1) measures `gemini-3.1-flash-lite`
— our production OCR model — at **19% Acc@5 on Tibetan clean printed text**, with
100% script accuracy. It reliably emits Tibetan script and unreliably emits the
right Tibetan. Low-resource tier overall: 7.7% vs 95.3% on Latin.

### C. Cross-script hallucination — the Devanagari

Same benchmark: **68.4% mean cross-script hallucination rate** on unfamiliar
scripts, Devanagari a dominant substitute. Disjoint from A — 0 of 4,000
Devanagari-bearing Tibetan pages carry the rearchiver's marker.

## Two corrections to the issue's own framing

1. **The material is not cursive dbu-med.** The EAP Bhutanese Kanjur folios are a
   neat handwritten **dbu-can (uchen)** hand — the *best*-supported case in every
   specialist system, not the worst. The "cannot read cursive dbu-med, therefore
   withdraw" conclusion over-generalised from one page.
2. **The exposure is not 12,187 pages** (scoped by script substitution) but
   **293,490 OCR'd / 277,680 translated**.

## The instrument, for whoever does the re-OCR

`buda-base/tibetan-ocr-app` — free, open source, ONNX/CPU, batch, PageXML out,
style-specific models on HuggingFace (BDRC + openpecha), plus a script classifier
and `TiBLA` layout models. The PechaBridge lineage reports **0.80% mean line-level
CER**. Transkribus/TibSchol is 1.40% val CER for cursive but outputs Wylie and is
per-script-style. Do not reach for a general VLM here; that is defect B.

Pipeline order matters: repair images → split 2-up/3-up spreads to one folio →
binarise (Sauvola/SBB beats magnification; super-resolution *hurts* images that
aren't genuinely low-res) → recognise → translate.

**Ground truth is free and available.** Most of the OCR'd corpus is Kanjur, a fixed
canonical text; `Esukhia/derge-kangyur` publishes it in Unicode. Align our page text
against it and fabrication falls out at chance. That retires the cross-run-agreement
proxy, which detects *instability* and is blind to a consistently-wrong model.

## Applied to production

**402 Tibetan first-translation claims withdrawn** (PR #4545), on Derek's explicit
go-ahead. Verdict `needs_review`, not `not_first` — we are not claiming a prior
exists. Prior verdicts preserved as `book_events{type:'ft_withdrawn'}` rows, one per
book, so each is individually reversible. Verified: Atlas first-family Tibetan
402 → 0; `books_catalog.ft_verdict` first_no_prior 0; API
`first_translation=true&language=Tibetan` returns 0 with a Latin control returning 5.

## Measurement mistakes made and corrected — the useful part

Four, and three are the same shape: reading absence from an instrument never shown
capable of producing a presence.

1. **A detector's artifact was its biggest cluster.** Screening on "lots of pure
   white" reported 63.6% of Tibetan pages broken; most were BDRC pecha scans, long
   thin folios on a white ground that are legitimately 75–96% white. Whiteness is a
   property of the photography. The gutter is a property of the **geometry**.
2. **A grep found a string and I called it a positive control.** I confirmed
   "First Translation" appeared on a book page and reported the badge was live.
   Calibrating against a *known-badged* Latin book showed it has zero occurrences
   above the "Related books" rail too — the detail page does not render that badge
   server-side at all. The hit was a card in the rail, for a Chinese book.
3. **A wrong query parameter read as a clean result.** `firstTranslation=true` is
   not the param; the route reads `first_translation`. The unfiltered response
   looked reassuring in one direction and alarming in the other.
4. **187 of 200 fetch failures were plane wifi**, not a finding. Moving the audits
   to Hetzner turned the same runs into 0 errors. `tile-stitch-gutters.mjs` now
   prints error kinds and shouts when failures outnumber measurements, because
   "7/13 guttered" with 187 unfetched reads like a rate and is not one.

Also worth carrying: the revalidation endpoint sits behind the proxy's bot limiter
(10 req/60s). A bare curl UA at 5 req/s took 339 HTTP 429s out of 402.

## State at handoff

- PR #4531 **merged**. PR #4545 (FT withdrawal) and the invariant-doc PR open.
- #4534 tracks the image repair. **Do not re-OCR before it lands** — any model
  reading those masters reads the same holes.
- The existing `rearchive-iiif-fullres.mjs` **cannot** be reused for that repair:
  `--min-upgrade-ratio` (default 1.5) skips pages already at native size, and the
  #3186 phash alignment guard reads a guttered archive as a misalignment, skips the
  book, and writes `rearchive_blocked`. The repair needs pixel-verified selection
  *and* pixel-verified success.
- ISR/CDN revalidation of the 402 withdrawn books running on Hetzner.
- Planning detail, including GPU rent-vs-buy arithmetic, is in the private ops repo:
  `handoffs/2026-09-01-tibetan-ocr-repair-and-gpu.md`.
