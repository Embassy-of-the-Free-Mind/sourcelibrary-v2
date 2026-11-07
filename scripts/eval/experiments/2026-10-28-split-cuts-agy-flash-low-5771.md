---
stage: image
measure: accuracy
languages: [bo, zh, ar, la, de]
scripts: [Tibt, Hani, Arab, Latn]
canons: []
n_books: 32
n_pages: 123
verdict: "Gemini 3.8 Flash low through agy places split cuts as well as the reviewed ones: 33/33 spreads called two pages, gutter a median 3/1000 from the reviewed cut (max 24, none inside text by eye); 80/80 pecha frames given the right leaf count, cuts a median 3/1000 from the stored ones (5 frames 20–53/1000 off: by eye 4 in the inter-leaf gap, 1 through a blank cover leaf, no text lost); 9/10 single pages called single (the tenth has a facing-page sliver)."
status: informational
decision: "split-pecha.mjs leaf boxes and split-book.mjs gutter sample move from gemini-3-flash-preview on the paid API (not allowed since 2026-10-08) to agy gemini-3.8-flash-low"
superseded_by: null
issue: [5771, 6114]
---
## 2026-10-28 · Can Gemini Flash through the agy CLI place page and leaf split cuts? (#5771, #6114)

PRIOR ART: `scripts/lib/gutter-detect.mjs` (the free pixel detector, run on the same images as the baseline); the split-leaves-5771 crop spans on gex45 (`/root/jobs/split-leaves-5771/out/crops/*.json`, 64 ledger cuts and 14 by eye) as the pecha reference; `split_position` on pages with `split_method: reviewed(…)` as the spread reference.

**Decision it changes:** which engine both splitters ask. Both called `gemini-3-flash-preview` on the paid API, which the 2026-10-08 rule no longer allows.

**Set.** 33 spreads from 25 books, one right-half page per spread, `$sample` over pages with a reviewed cut (Chinese woodblock and Arabic manuscript books dominate); 10 single portrait pages from Latin/German/Italian/French books; all 80 frames of the split-leaves-5771 gate (2–6 leaves). One call per image, the image downscaled to ≤2000 px, `--mode plan`, the tool gate, ~16 s a call, 0 failed calls, 0 quota.

**Spreads.** CLI: 33/33 two pages; |cut − reviewed| median 3/1000, ≤10 on 24/33, ≤20 on 31/33, max 24. Pixel detector: median 1 where it answered, but off by more than 20/1000 on 8/32 (max 164), several at `high` confidence, three cuts through woodblock text. Every CLI cut more than 15/1000 off was drawn on the image and lies in the blank strip between the pages. Note the reference is not independent of the pixel detector (reviewers confirmed pixel-seeded cuts), so its median-1 agreement is flattered.

**Pecha.** 80/80 leaf counts right, including the 14 frames whose ledger cut was wrong and was set by eye. Cuts: median 3/1000, p90 13, max 53. The five over 20/1000 were opened: four sit in the gap between leaves (a064's is better than the stored cut); a072 cuts a blank cover leaf above the stored cut, no text lost.

**Singles.** 9/10 called one page; the tenth (a page photographed with a strip of the facing leaf) was called two pages at 42/1000, a cut that would remove that strip.

**End to end.** `split-book.mjs --gutter-only --dry-run` on a 13-spread MDZ German book (6a26ca485ac5aecc53ce5bb1): 8 sample calls, 7 agree with pixel, 1 disagreement snapped to the book median 502.

Raw rows (local, not committed): `scratchpad/splitcli/out-gemini-3.8-flash-low.jsonl`, `leaves-gemini-3.8-flash-low.jsonl`.
