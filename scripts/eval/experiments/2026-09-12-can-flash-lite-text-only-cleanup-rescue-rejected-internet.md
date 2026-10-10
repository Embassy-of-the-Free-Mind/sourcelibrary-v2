---
stage: ocr
measure: agreement
languages: [en]
scripts: [Latn]
canons: []
n_books: 10
n_pages: 60
verdict: "Text-only lite cleanup raises agreement a little (48/60 improved) but lifts no rejected book over the 0.85 gate, costs 86% of image OCR, and invents on unreadable input."
status: rejected
decision: "Not a lane for rejected IA OCR (#4727, #4763)"
superseded_by: null
issue: [4727, 4763]
---
## 2026-09-12 — Can flash-lite text-only cleanup rescue rejected Internet Archive OCR?

**Headline: no lane. It raises agreement a little everywhere, lifts no rejected book over
the 0.85 gate, costs 86% of re-reading the image, and invents where the input is unreadable.**

- **Question.** `ia-ocr-ingest.mjs` (#4727, #4763) takes the Archive's free ABBYY text where it
  agrees ≥ 0.85 with our Gemini pages; 741 English books (136K pages) fail. Their errors look
  systematic (long s → f, broken words). Can `gemini-3.1-flash-lite`, text in / text out, no
  image, thinking off, push them over the gate cheaper than image OCR?
- **Design.** 10 books × 6 interior reference pages (pages with both IA text and Gemini OCR),
  two per agreement band from the dry run plus the two long-s probes at leaf offset −1. Word-
  sequence agreement with the Gemini reading before and after cleanup; length ratio to catch
  additions/deletions; three pages adjudicated by eye against the scan.
- **Result.** Median agreement before → after: ≥0.90 band 0.916 → 0.939; 0.85–0.90 band
  0.895 → 0.935; magazine title/index pages 0.612 → 0.617; Van Helmont 1662 0.669 → 0.755;
  1801–1803 long-s 0.700 → 0.775. 48/60 pages improved, 1 worse. Cost $0.076 = $0.00127/page
  (615 output tokens/page) vs $0.00148 measured lite-batch image OCR. Two of 60 pages changed
  length by more than 25%: an index page came back 1.98× longer with 7 of 8 author names
  fabricated (page says R. D. Mussey, H. W. Compton, Thomas L. Greene; model wrote John G.
  Nicolay, M. G. van Rensselaer, William L. Greene); on the Oriatrike title page the ink-blotted
  "Toparch or Governor" became "Lord of". Where the cleanup was right (Cabiri p.286: Areas →
  Arcas, Fejla → Vesta) the image reader had already been right.
- **Replicated?** No — single run, 60 pages. The cost figure is the load-bearing one and is
  arithmetic on token counts, not a sample.
- **Artifact.** `ia-ocr-cleanup-exp.mjs`; `results/ia-ocr-cleanup-2026-09-12.{jsonl,log}`
  (page triplets IA / cleaned / Gemini with scores and image URLs). Blog: `/blog/free-reading`.
