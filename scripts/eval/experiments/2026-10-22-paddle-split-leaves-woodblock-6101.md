---
stage: ocr
measure: accuracy
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 54
n_pages: 198
verdict: "PaddleOCR-VL 1.6 on split leaves (NDL label strip cropped, right leaf then left, layout off) passes the preregistered bar for Chinese/Japanese print: median Han CER 0.061 vs Flash-Lite 0.067 (paired Δ −0.014 [−0.020, −0.003]), catastrophic 3/198 = lite's 3; still behind Flash (Δ +0.006 [+0.002, +0.010]). All 3 failures are blank leaves (2 loops, 1 invented from show-through)."
status: informational
issue: [6101, 6871]
---
## 2026-10-22 · Does PaddleOCR-VL read woodblock print as well as Gemini once its page-level failures are removed? (#6101 follow-up)

**Question.** In #6101 (PR #6139) PaddleOCR-VL 1.6 lost to Flash-Lite and Flash on Chinese print. With NDL's label strip removed it tied lite on characters, and its losses were page-level. The 285 failures on the every-page pass were:
- 134 left leaf read first;
- 64 label only or empty;
- 52 timeouts;
- 32 one leaf dropped.

The fix named there was to read split leaves. The run was at $0, because GEX45 is flat-rate.
- Prereg: `scripts/eval/PREREGISTRATION-paddle-split-6101.md`, commit 68be1bba5, made before any GPU read.
- Asked by Derek on 2026-10-22: "are you sure it is not better on woodblock?"

**Design.**
- **Pages:** the 198 shared pages of #6101, from 54 print books (172 woodblock, 26 movable type), with the same JPEGs at most 2,400 px wide.
- **Stored arms:** P0, Paddle on the whole spread as #6101 ran it (default pipeline, layout on); L, Flash-Lite; F, Gemini 3 Flash. No new Gemini calls.
- **New arms on gex45** (RTX PRO 4000 Blackwell; paddleocr 3.7.0 / paddlepaddle-gpu 3.2.1; `scripts/gpu/paddle-zh-run.py` unchanged; native backend with 2 workers as in P0; 90 s timeout per leaf):
  - **P1** = split leaves with `use_layout_detection=False`;
  - **P2** = split leaves with layout on.
- **Image preparation** (`scripts/eval/paddle-split-6101.mjs prep`, on CPU):
  - **Label strip:** cropped above NDL's ruler. The ruler is detected per image from the two outer 3 % edge strips: the share of pixels at least 20 grey levels above the background.
    - The first, mean-based version missed 4 of 198 rulers, because tick marks pull the row mean down. The per-pixel version finds all of them, and all 1,940 spreads in this run.
    - It removes 10–12.8 % of the height.
  - **Split:** `scripts/lib/gutter-detect.mjs` with `split-book.mjs`'s 3 % overlap.
    - 194 of 198 gutters are found at high confidence. The 4 fallbacks go to the image centre: all are title or end spreads with one blank leaf.
    - One fallback first landed on a blank page's margin at 25 % of the width. Fixed before any read: a fallback outside 35–65 % now goes to the centre.
  - **By eye, before reading:** 10 random pairs (seed 6101) plus every fallback and abstention, 16 pairs in all. No text column was cut anywhere.
    - In tight-gutter books (62ec23, 2904bf, 290525, be006b) the innermost column falls inside the 3 % overlap and appears in both leaves.
    - In P1's output this happened on 6 of 198 pages, 4–20 characters each.
- **Scoring:** #6139's own `benchmark-score.mjs` (Han only, which is still on branch `eval/cbeta-ref-6101`), run from a scratch extract of that branch.
  - Every arm goes through #6101's `nolabel` filter.
  - The extract reproduces #6139's label-stripped per-page CER exactly: 0 mismatches over 600 page×engine cells.
  - Intervals: book-cluster bootstrap (2,000 resamples, seed 6101) for medians and Δ; Wilson for rates.

**Result 1: the 198 shared pages (preregistered).**

| arm | median CER [95 % CI] | catastrophic (CER > 0.5) | Δ vs L [CI] (W/L/T) | Δ vs F [CI] | invention_ref | loops |
|---|---|---|---|---|---|---|
| P0 Paddle, whole spread | 0.067 [0.062, 0.078] | 28 = 14.1 % [10.0, 19.7] | +0.006 [−0.002, +0.013] (86/107/5) | +0.016 [+0.013, +0.021] | 0.151 | 0 |
| L Flash-Lite | 0.067 [0.060, 0.085] | 3 = 1.5 % [0.5, 4.4] | — | +0.017 [+0.013, +0.024] | 0.152 | 2 |
| F Flash | **0.052 [0.045, 0.060]** | **0 = 0 % [0, 1.9]** | −0.017 [−0.024, −0.013] (160/31/7) | — | 0.120 | 0 |
| **P1 split, layout off** | 0.061 [0.054, 0.068] | 3 = 1.5 % [0.5, 4.4] | **−0.014 [−0.020, −0.003]** (121/73/4) | +0.006 [+0.002, +0.010] | 0.149 | 2 |
| P2 split, layout on | 0.076 [0.068, 0.088] | 4 = 2.0 % [0.8, 5.1] | +0.005 [−0.009, +0.017] (89/106/3) | +0.021 [+0.010, +0.030] | 0.157 | 0 |

- **By class:**
  - Woodblock (n = 172, 47 books): P1 0.060 [0.053, 0.069], 3 catastrophic; Δ vs L −0.015 [−0.024, −0.003]; Δ vs F +0.005 [+0.001, +0.010]. Lite 0.067, Flash 0.050.
  - Movable type (n = 26): P1 0.062, lite 0.069, Flash 0.057, P0 0.091. No arm has a catastrophic page.
- **Join de-duplication** (sensitivity, not preregistered): dropping L's first line when it repeats R's last line (similarity ≥ 0.7) gives P1 0.059. The Δs are unchanged.

**Decision (preregistered bar).**
- **P1 is adopt-grade for print.**
  - Its catastrophic rate is 1.5 %, within lite's 1.5 % + 2 points.
  - The upper bound of Δ vs L is −0.003, below the +0.010 limit. It also excludes 0: P1 reads characters *better* than lite.
- **P1 is not a better reader than Flash.** The upper bound of Δ vs F is +0.010, not below 0, and Flash wins on the median.
- **P2 fails:** its Δ vs L upper bound is +0.017. This matches #6871 row 3, where layout-on Paddle was worse.
- The verdict is the same on woodblock alone.

**P1's three failures are all blank leaves.** Two are title spreads with an empty right leaf: 1de6cf-p3 and 25f3a6-p2, both split at the image centre. On each, P1 loops for 57–70 s and returns 5,226 characters. The third is 1de682-p45, whose right leaf is blank except for show-through from the other side; P1 *invents* 95 characters of plausible classical Chinese from it. Lite and Flash read all three (CER 0.012–0.057). P0 read the two title spreads (0.041 and 0.148) and failed 1de682-p45 (0.994). A Paddle split-leaf lane therefore needs a blank-leaf guard before it can be used: skip a leaf with no ink, and reject loops. This is the same "loops on a blank leaf" mode #6871 row 3 found.

**Result 2: #6101's 285 Paddle failures re-read with P1.** This result is descriptive and was not preregistered as a test. With one engine on these pages, a P1 failure could also be a misfitted reference. Failure kinds come from P0's length ratio, and the boundaries differ slightly from #6101's hand count.

| P0 failure kind | pages | P1 reads it (CER ≤ 0.5, ≥ 30 characters) |
|---|---|---|
| spread order (left leaf first) | 135 | 135 |
| label only / empty | 64 | 63 (the miss is the 1de682-p45 show-through invention) |
| timeout (90 s) | 52 | 51 (the miss is a loop) |
| one leaf dropped | 29 | 29 |
| other | 5 | 5 |
| **all** | **285** | **283 = 99.3 % [97.5, 99.8]** |

- P1's median CER over the 283 referenced pages is 0.056 (scorer).
- 169 pages that #6101 had to count as "CER > 0.5 *or* reference misfit", because only one engine read them, now resolve to real references. Paddle's whole-spread read was at fault there, not CBETA's fit.

**Result 3: the woodblock frame** (prereg "if P1 passes"; one engine, P0 vs P1 on the same pages).
- **Pages:** every woodblock page #6101's Paddle pass read: 1,883 pages from 47 books. P1 here is read through the **genai vLLM-server backend** (`paddle-zh-run.py --backend server`, 4 clients, layout off, the same leaves).
- **Why the backend changed:** at about 23:45Z the native backend wedged on gex45. Every *freshly started* native PaddleOCR-VL process then hung in its first decode step, with GPU at 0 % and one core spinning in `_C_ops.embedding`. This included leaves that had read in 5 s at 22:10Z, and a process alone on the card.
  - The card itself was healthy (29 TFLOPS matmul, no Xid) and the venv was unchanged. Root cause unknown.
  - The one long-lived native worker read all 1,457 left leaves; no right leaf could be read natively.
- **Backend check on the shared 198:** server P1 against native P1 gives median 0.060 vs 0.061 and Δ vs L −0.010 [−0.019, −0.003] vs −0.014. It has 4 catastrophic pages vs 3 (one extra loop, on a movable-type page), so it would pass the same bar.
- **Failure,** with #6101's definition (CER > 0.5 or misfit, or < 30 characters on a text page):

  | arm | pages | failure | median CER, scored pages [CI] |
  |---|---|---|---|
  | P0 whole spread (#6101) | 1,883 | 282 = **15.0 % [13.4, 16.7]** | 0.059 (label-stripped, #6101) |
  | P1 split leaves (server) | 1,883 | 13 = **0.7 % [0.4, 1.2]** | 0.058 [0.054, 0.062] |

- **The 13 P1 failures:**
  - **10 are blank leaves.** On 9 of them P1 loops (≈ 4,000 characters) on the empty leaf of a title or end-of-juan spread; the other leaf is read correctly. The tenth is the 1de682-p45 show-through invention.
  - 2 are a text-bearing right leaf returned empty (2904bf-p76, be00f4-p6).
  - 1 is an over-read (559462-p63: 1,412 characters on a leaf whose page holds 617).
  - 3 of the 13 pages also failed for P0.
- **With a blank-leaf / loop guard**, which skips a leaf with no ink or rejects a read several times a leaf's capacity, about 3 pages in 1,883 (≈ 0.2 %) would remain. This is an estimate, not measured.
- Server P1 on the 285 failures: 282 fixed (native: 283).

**Throughput** on the RTX PRO 4000 Blackwell, with an unrelated `dupe-screen` job sharing the card:
- **Native backend, 2 workers** (P1 as preregistered):
  - recognition: median 6.1 s per leaf per worker (p90 8.4 s);
  - wall time: **3.4 s per leaf** (shared: 396 leaves in 1,343 s; failure set: 570 in 1,914 s).
- **genai vLLM server, 4 clients:**
  - **0.54 s per leaf** wall (frame: 2,914 leaves in 1,579 s; failure set: 570 in 333 s; shared: 396 in about 200 s);
  - 1.1 s per two-leaf page, 6× faster than native at the same accuracy.
- P2 (layout on): 4.0 s per leaf per worker, but a layout-on worker wedged and then hit a MemoryError reloading beside the other worker. It had to be finished alone.
- **Projection** for the non-Siku Chinese/Japanese frame (recount 2026-10-22, all books with pages, `四庫|·卷` title regex as the Siku proxy):
  - Chinese 1,390 books (259,000 pp) and Japanese 398 books (50,693 pp), ≈ 310K pp in all.
  - At 1.1 s per page with the server: **≈ 4 GPU-days**. Native would take ≈ 24.
  - Visible books only (1,189 books, 169K pp): ≈ 2 GPU-days.
  - Both are upper bounds, assuming every page is a two-leaf spread; a single-leaf scan needs no split.

**What this changes (evidence for Derek; routing is unchanged, #6688).**
- Paddle loses on woodblock because of how it handles the spread, not because it misreads characters.
- With the spread cropped and split, it reads Chinese/Japanese print at lite's failure rate and better than lite on characters, at $0 on GEX45. It is still about 0.006 CER behind Flash.
- With the server backend it reads ≈ 3,300 pages per hour on this card.
- It is a credible $0 lane for print that would otherwise spend agy Flash quota (#7075), provided two conditions are met:
  1. a blank-leaf / loop guard is in place;
  2. the page's split is checked. The detector here abstained on 4 of 198 pages, all of them blank-leaf spreads.
- Nothing was written to `pages` or `books`.

**Replicated?** Partly:
- P1's per-character parity with lite repeats #6101's label-stripped P0 tie (0.067 vs 0.067), now with the page-level failures removed.
- The fix rate on the 285 failures (99.3 %) and the shared-set catastrophic count (3/198) agree.

**Cost.** $0: the flat-rate GEX45 and stored Gemini outputs. GPU time was about 22 min (P1) + 33 min (P2) + 32 min (failure set) + 4 h of the wedged native frame attempt (left leaves only) + 27 min + 6 min (server frame and failure set). The Tibetan read (#6871 row 4) was stopped between pages at 917/5,132 and re-queued as `80-tib-gutter-full-c2`; `full/` still had 917.

**Artifacts.**
- Prereg: `scripts/eval/PREREGISTRATION-paddle-split-6101.md`.
- Code: `scripts/eval/paddle-split-6101.mjs` (`prep | assemble | report | failreport | framereport`).
- Results, scores and slugs only, in `scripts/eval/results/paddle-split-6101/`:
  - `shared-198.json` (all arms, including P1s = server and P1d = join de-duplication);
  - `failures-285.json` (native) and `failures-285-server.json`;
  - `frame-woodblock.json` (server).
- Leaf images, engine outputs and CBETA text stay on Hetzner in `/root/cbeta-ref-6101/split/` and `bench-split/` (CC BY-NC-SA, #5488). The GPU tasks are in `gex45:/root/jobs/paddle-split-6101/`.
