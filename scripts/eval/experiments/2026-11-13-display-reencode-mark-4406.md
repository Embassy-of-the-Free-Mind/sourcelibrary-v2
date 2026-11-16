---
stage: image
measure: none
languages: []
scripts: [Latn, Hani, Tibt, Syrc, Grek, Cyrl, Arab]
canons: []
n_books: 40
n_pages: 40
verdict: "Regenerating the reader display from the master as WebP q75 at 1600px cuts its bytes to 0.49x of today's (95% CI 0.43-0.57) with the same watermark detection (37/39 pages, median z 11.6); n=40 pages, run 2026-11-12. Widths below 1200px were not tested, and one very short page (a Tibetan pecha) cannot carry the mark at 1600px or 1200px wide."
status: undecided
feeds: [cost]
supersedes: []
superseded_by: null
issue: [4406]
---
PRIOR ART: scripts/audit/image-provenance-coverage.mjs (copier re-encode robustness row; does not regenerate from the master or record bytes); scripts/eval/recovery-matrix-8150/images.mjs (same row plus crops). Script: `scripts/eval/display-reencode-4406/run.mjs`.

## 2026-11-13 · Can the reader's display image be much smaller and still carry the provenance mark?

**Why.** Visible books' display images cost more R2 than their masters (issue figure: ~798 KB/page vs ~619 KB, ~11.8 TB over 14.75M visible archived pages, ~$177/month at $15/TB-month), because the provenance bake writes the display at min(2000px, native) JPEG q85. If the watermark survives a smaller file, most of that is avoidable.

**Design.** Local only: read Mongo and R2, wrote nothing to either. Run on the `main` Hetzner box on 2026-11-12 against `scripts/lib/provenance-mark.mjs`, `reader-display.mjs` and `provenance-logo.mjs` byte-identical to `origin/main` (md5 checked). The mark and the detector are the repo's own `markImage()` / `detectWatermark()`; nothing re-implemented.

- **Sample.** n=40 pages, one per visible book (`visible:true, pages_count>0`, 71,312 books), seed 4406. Half uniform over books, half one book per new (provider x script) cell, so 27 cells appear: internet_archive, e-rara, mdz, harvard, met, heidelberg, bl, bdrc, gallica, bsb, sbb, goettingen, slub, bph, umedia, iiif; Latin, CJK, Tibetan, Syriac, Greek, Cyrillic, Arabic, Egyptian. Interior pages only (15-95% of the book). A page qualified only if the reader actually loads its `display_photo` (`readerServesDisplay`), the display is on R2 under `pages/`, and a separate master exists; skipped on the way: 52 display not on R2, 26 no separate master, 17 display not served, 1 no page doc.
- **Variants per page.** (a) the current display **as served** by images.sourcelibrary.org with a browser Accept header (40/40 served byte-identical to the R2 object; no Polish, always `image/jpeg`); (b) the writer as it is today (1200px, markImage at q82); (c) **regen**: master -> resize to 2000/1600/1200px -> mark -> encode as JPEG q85/q80/q75, WebP q80/q75, AVIF q50. markImage only emits JPEG, so each rung of its nudge ladder (delta 2,3,4,5,8, +12 on narrow images) was rendered at q100, encoded in the target format, read back, and the rung chosen by markImage's own rule (first rung at z>=10, else strongest that detects). That is what a writer taught to emit WebP/AVIF would store. (d) **transcode**: the served display re-encoded at the same width, no re-mark (the cheap backfill).
- **Measures.** Bytes; detection z on the stored bytes (repo threshold z>5); z after a JPEG q70 recompress (what a copier does); PSNR on green vs the unmarked raster at the same width; negative controls per page.
- **Controls.** Unmarked copies: max z 3.04 over all pages and widths. Wrong key: max z 3.2. Both under the z>5 threshold.

**Result.** "x current" is total bytes over total current bytes on the same pages, with a 2,000-draw bootstrap 95% interval. Projection = 11.8 TB x ratio, at $15/TB-month. Detection columns count pages that can carry a mark at all (>=16 textured block pairs).

| variant | n carry | median KB | mean KB | x current (95% CI) | median z | min z | detected z>5 | detected after q70 | PSNR dB | projected TB | $/month |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current display (as served) | 39 | 430 | 472 | 1.00 | 12.9 | 1.1 | 36/39 | 34/39 | – | 11.8 | $177 |
| writer today: 1200px JPEG q82 | 39 | 349 | 331 | 0.70 (0.61–0.82) | 12.0 | 0.8 | 37/39 | 37/39 | – | 8.3 | $124 |
| regen 2000px jpeg q85 (bake recipe) | 40 | 532 | 580 | 1.23 (1.09–1.41) | 12.4 | 0.6 | 38/40 | 38/40 | 39.0 | 14.5 | $218 |
| regen 2000px jpeg q80 | 40 | 470 | 510 | 1.08 (0.96–1.24) | 12.0 | 0.7 | 38/40 | 37/40 | 38.5 | 12.8 | $192 |
| regen 2000px jpeg q75 | 40 | 414 | 457 | 0.97 (0.86–1.10) | 12.1 | 0.4 | 38/40 | 37/40 | 37.5 | 11.4 | $171 |
| regen 2000px webp q80 | 40 | 316 | 351 | 0.74 (0.65–0.85) | 12.3 | 0.2 | 38/40 | 37/40 | 37.1 | 8.8 | $132 |
| regen 2000px webp q75 | 40 | 255 | 284 | 0.60 (0.53–0.69) | 11.8 | 0.3 | 38/40 | 37/40 | 36.0 | 7.1 | $107 |
| regen 2000px avif q50 | 40 | 171 | 199 | 0.42 (0.36–0.49) | 11.8 | 0.3 | 38/40 | 38/40 | 35.7 | 5.0 | $75 |
| regen 1600px jpeg q85 | 39 | 473 | 466 | 0.99 (0.87–1.14) | 12.0 | 0.6 | 37/39 | 37/39 | 38.1 | 11.7 | $175 |
| regen 1600px jpeg q80 | 39 | 401 | 404 | 0.86 (0.75–0.98) | 12.1 | 0.7 | 37/39 | 36/39 | 37.1 | 10.1 | $151 |
| regen 1600px jpeg q75 | 39 | 344 | 356 | 0.76 (0.66–0.87) | 11.9 | 0.4 | 37/39 | 36/39 | 36.6 | 8.9 | $134 |
| regen 1600px webp q80 | 39 | 257 | 286 | 0.61 (0.53–0.70) | 12.2 | 0.2 | 37/39 | 36/39 | 36.9 | 7.2 | $107 |
| **regen 1600px webp q75** | 39 | 218 | 231 | **0.49 (0.43–0.57)** | 11.6 | 0.3 | 37/39 | 36/39 | 35.8 | **5.8** | **$87** |
| regen 1600px avif q50 | 39 | 150 | 163 | 0.34 (0.30–0.40) | 11.5 | 0.3 | 37/39 | 37/39 | 35.5 | 4.1 | $61 |
| regen 1200px jpeg q75 | 39 | 260 | 250 | 0.53 (0.46–0.62) | 12.0 | 0.4 | 37/39 | 36/39 | 35.8 | 6.3 | $94 |
| regen 1200px webp q75 | 39 | 157 | 172 | 0.36 (0.31–0.43) | 11.5 | 0.3 | 37/39 | 36/39 | 35.6 | 4.3 | $64 |
| regen 1200px avif q50 | 39 | 102 | 122 | 0.26 (0.22–0.30) | 11.1 | 0.3 | 37/39 | 37/39 | 35.3 | 3.0 | $46 |
| transcode webp q80 (marked displays only) | 36 | 297 | 336 | 0.66 (0.63–0.70) | 12.6 | 4.7 | 35/36 | 33/36 | – | 7.8 | $117 |
| transcode webp q75 (marked displays only) | 36 | 236 | 272 | 0.54 (0.50–0.57) | 12.0 | 4.7 | 34/36 | 33/36 | – | 6.3 | $95 |
| transcode avif q50 (marked displays only) | 36 | 177 | 200 | 0.39 (0.36–0.43) | 11.9 | 4.5 | 33/36 | 33/36 | – | 4.7 | $70 |

(1200px q85/q80 and WebP q80, and JPEG transcodes, are in `summary.json`; they sit on the same line.)

What the numbers say:

1. **The mark is not what keeps the display big.** Median z sits at 11.1–12.4 in every regen variant and detection is the same count in every format at a given width (38/40 at 2000px, 37/39 below). markImage holds z near its target of 10 by choosing its nudge, so a lossier encoder costs nudge, not detection.
2. **The price is a slightly stronger nudge.** At a fixed nudge (delta 3), median z falls from 9.7 (JPEG q85, 2000px) to 8.4 (WebP q75) and 8.5 (AVIF q50): the encoders smooth about 13% of the signal away. The chosen-delta histogram shifts by about three pages from delta 2 to 3–5; the count needing delta>=8 is 11 of 40 in JPEG and 12 in WebP/AVIF. Whether a delta-8 mark is visible was not tested here (decision default on #4406: no strength-5 redo until a visibility sample).
3. **Robustness to a copier's q70 recompress is unchanged**: 36–38 of 39–40 detected afterwards in every regen variant.
4. **2000px buys nothing for the mark** (consistent with the n=33 width test earlier on #4406). Its one real effect in this sample is a Tibetan pecha (2094x324): at 1600 or 1200px wide it is under 256px tall, the 128px grid has fewer than two rows, and the page cannot carry a mark at all (today's 1200px display: z 0).
5. **Transcoding the current display without the master** is the cheap path but loses detections: WebP q75 0.54x with 34/36 still detected (min z 4.7). Regen from the master keeps its 37/39.
6. **The two pages that fail everywhere** are an Internet Archive Cyrillic page (master only 900px) and a near-blank IIIF page (87 textured pairs). No width or format rescues them.
7. **Legibility, by eye on 2 of 40 pages** (native-resolution crops from the saved images, Latin roman and italic, unmarked / JPEG q85 / WebP q75 / AVIF q50 side by side): text equally legible in all four; WebP and AVIF smooth the paper grain slightly. PSNR medians 35.5–39 dB. This is not a reader-quality judgement over the sample.

**Sample vs the issue's baseline.** This sample's current displays average **472 KB**, not 798 KB: 29 of 40 are 1200px or narrower (the forward writer since #8155) and only 11 are 2000px. The pages skipped for "no separate master" (26) and "display not on R2" (52) are where displays equal masters, which are the large ones. The projection therefore applies the sample's *ratio* to the 11.8 TB total; for pages whose display is a master today, regen would save more, so the dollar figures are if anything conservative. Re-measure the TB baseline from the R2 inventory before quoting a saving.

**Code that assumes `.jpg` (would need changing for WebP/AVIF).**
- `src/lib/page-image-url.ts:172-177` `deriveVariant()` matches `pages/...(\d{4,}|sp...)(-full)?\.jpg$` and builds `.jpg` / `-thumb.jpg`; a `.webp` display would fall through to the `/api/image` proxy (sharp compute per view).
- `src/app/api/iiif/[id]/manifest/route.ts:438,493,506` declares `format: 'image/jpeg'` for the painted (marked) body.
- `src/components/pipeline/TranslationEditor.tsx:812-853,1932` derives `-full.jpg` and names downloads `.jpg`.
- `src/app/api/books/[id]/download/route.ts` (and the tenant copy) packs EPUB images as `images/*.jpg`, `media-type="image/jpeg"`.
- Several OCR/judge routes send fetched page bytes to the model as `mimeType: 'image/jpeg'` (`batch-ocr-*`, `bulk-ocr-new`, `bulk-reocr`, `experiments/ocr-quality/*`); check which URL each fetches before changing the display format.
- `markImage()` itself emits JPEG only; a WebP writer needs an output-format option that runs the strength ladder in the target encoding (this script shows the pattern).

**Recommendation.** Do not pick a width for the mark's sake. If the display shrinks, **regenerate from the master as WebP q75 at 1600px, with a floor so the short edge never drops below 256px** (pechas), via a markImage that selects its nudge in WebP. Projected ~5.8 TB, ~$87/month, ~$90/month less than today and ~$130 less than finishing the bake at 2000px JPEG q85. AVIF q50 is a further ~30% smaller ($61) but slow to encode at effort 4 and was not timed; test encode CPU before choosing it. JPEG q75 at 1600px (0.76x, $134) is the no-format-change fallback.

**Risks.** n=40, one page per book; the byte ratio CI is about +/-15%. Legibility checked by eye on 2 pages only, mark visibility at delta>=8 not checked. The baseline TB is the issue's figure, not re-measured. The format change touches the five code sites above, the IIIF contract and EPUB export, and every R2 key consumer that parses `.jpg`. A re-bake is a full rewrite of every display (one-time CPU and Class A writes) and must use the regen path, not transcode, or it drops ~2 of every 36 marks. This writes nothing; the bake on cloudlayer is unaffected.

*Replicated?* No. Artifacts: `scripts/eval/display-reencode-4406/run.mjs`; raw rows and `summary.json` on the `main` box under `/root/jobs/display-reencode-4406/out/` (not committed: per-page evidence stays private).
