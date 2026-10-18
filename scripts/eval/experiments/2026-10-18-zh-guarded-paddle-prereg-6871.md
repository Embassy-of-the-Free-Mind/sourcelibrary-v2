---
stage: ocr
measure: agreement
languages: [zh]
scripts: [Hant]
canons: []
n_books: 50
n_pages: 50
verdict: "Preregistration only: production Paddle (PaddleOCR-VL-1.6, layout off) behind a frozen output guard, against agy Gemini 3.8 Flash, on a fresh draw of 25 table + 25 mixed held Chinese pages from books not in the first reference set. No result here."
status: undecided
decision: null
superseded_by: null
issue: [6871]
---
PRIOR ART: `2026-10-18-zh-residue-bakeoff-6871.md` (the bake-off whose failures the guard is built from: P0 ties agy Flash on table and mixed, but loops, collapses on dense numeric tables and loops on a blank leaf); `scripts/eval/zh-residue-refs-6871/` (the reference recipe and both reader briefs, reused unchanged); `scripts/eval/zh-residue-bakeoff-6871/score.py` (metrics, imported unchanged).

## 2026-10-18 · Preregistration: does guarded Paddle read held Chinese tables and mixed prose as well as agy Flash, on fresh pages? (#6871 row 3)

Written and committed **before the draw was run**. The guard (`scripts/eval/zh-confirm-6871/guard.py`, with `ink.py`)
was designed on the 100 bake-off pages only and is frozen by this commit. Its in-sample record on those pages: 15 of
16 collapsed or looped Paddle outputs flagged (the miss is a 清文鑑 page, which is out of scope), 1 good page flagged
(a 啟蒙意見 diagram page). In-sample numbers are not evidence; this draw is.

**Draw** (`zh-confirm-6871/draw.mjs`, seed 68712, then `draw.json`). The classes and the book lists are those in
`zh-residue-refs-6871/classes.json`, table and mixed only. Excluded:
- every book in the first draw (`zh-residue-refs-6871/draw.json`, spares included);
- 清文鑑 titles, which have no credible reference;
- books no longer held `gpu-backlog-5660`.

From what is left, per class: 25 books uniformly at random plus 5 spares, one page per book. The page is uniform among
the book's unread pages in the body window [10%, 95%] of `pages_count`, with 2 alternates per book. The method is the
first draw's, unchanged. When the readers mark a drawn page `blank` or `non-body`, it is replaced by the book's first
alternate. The replaced page is still kept, in the **blank set**, where the guard is tested on it. A spare is used
only if a book has no readable alternate.

**References.** Made the same way as `zh-residue-refs-6871` (README §3 there):
- `READER-PROMPT.md` and `RESOLVER-PROMPT.md`, unchanged;
- Claude Opus 5.5 subagents on the subscription, with the images open, at most 10 pages per call;
- pass A and pass B on different shuffles, with neither told the class;
- pass C, a blinded X/Y resolver, on every page where A and B differ in Han string or page kind;
- final = C where it ran, else A.

Image: the IIIF full image, long side capped at 2,744 px, plus halves and quarters. The same file goes to every arm.

**Arms.**
| arm | what |
|---|---|
| P0 | PaddleOCR-VL-1.6, layout off, production settings: `paddle-zh-box.sh arm`, `LAYOUT=0 BACKEND=server CLIENTS=8`, one `/root/gpu.lock` hold on gex45 |
| B2 | Gemini 3.8 Flash low through `agy -p` (`run-cli-arm.py --kind ocr`, plan mode, tool gate), the bake-off's prompt (`read.py` PROMPT) |
| B2r | B2 run again: the **noise floor** |
| GP | **guarded Paddle**: `guard.py` routes each page from P0's output and `ink.py`'s features. PADDLE gives P0's text; FLASH gives B2's text; HOLD means unread |

No paid API is used: B2 is $0 on the agy subscription, and gemini-3.1-flash-lite is not run.

**Scoring.** The functions in `zh-residue-bakeoff-6871/score.py`, unchanged: Han string, margin-line drop, table **bag
CER**, mixed **CER**. Scored pages are those whose reference has ≥ 20 Han characters. A HOLD page is left out of the
paired CER comparison and counted in coverage. Medians come with 95% percentile bootstrap CIs (10,000 resamples,
seed 6871).

**Definitions for the guard test.** Over scored P0 outputs, plus the blank set:
- **collapsed**: P0's Han count < 0.5 × the reference's;
- **looped**: P0's Han count > 1.5 × (reference Han + `▣` + `□`) + 20. On a blank-set page, P0 has ≥ 20 Han
  characters beyond the reference's `text` + `margin`;
- **failure** = collapsed or looped;
- **good** = scored, not a failure, and primary metric ≤ 0.25;
- **caught** = a failure the guard routes FLASH or HOLD;
- **passed** = a good page the guard routes PADDLE.

**The bar.** All of these must hold, judged in each class (table, mixed) separately:
1. **CER.** d = primary(GP) − primary(B2) per page. The upper end of the 95% CI of median(d) is ≤ the noise floor.
   The noise floor is the larger of two numbers:
   - the median per-page |B2 − B2r| in that class on this draw;
   - the bake-off's measured instrument floor (B1 vs B1r: table 0.008, mixed 0.018).

   The bake-off floor is the lower bound because a near-deterministic Flash could otherwise demand exact equality.
2. **Catch.** The guard catches ≥ 90% of failures, pooled over table + mixed + the blank set.
3. **Pass.** The guard passes ≥ 80% of good pages, pooled over table + mixed.

If the fresh pages hold fewer than 3 failures, criterion 2 cannot be judged on them alone. It is then judged on the
fresh failures pooled with the bake-off's in-scope failures, and the result is labelled **partly in-sample**. A pass
that rests on that pooling is reported as such and does not count as a clean confirmation.

**Reported, not deciding:**
- the share of pages routed PADDLE, FLASH and HOLD per class, with Wilson 95% CIs;
- P0 alone against B2, paired;
- order CER on table pages;
- per-flag counts.

**If it passes:** the full run is priced on the class page counts from the 2026-10-17 recount:
- table 15,280;
- mixed 17,784 minus the 清文鑑 pages, counted again at run time.

The price has two parts. First, P0's GPU-days at the bake-off's 3,399 pages/h. Second, the routed shares: FLASH as agy
call-days at the measured rate, and HOLD as pages left held. The writer and the apply are **not** part of this job:
they need the provenance standard and a routing row.

**Writes.** None to `pages` or to any production store. Outputs go to gex45 `/root/jobs/zh-confirm-6871/` and to the
job's scratch, plus the committed files under `scripts/eval/zh-confirm-6871/`.
