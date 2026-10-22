---
stage: ocr
measure: agreement
languages: [la]
scripts: [Latn]
canons: []
n_books: 99
n_pages: 99
verdict: "A text-only long-s pass on flash-lite's Latin (CPU, 8 ms/page, no model calls) passes the preregistered bar in both centuries: view-N median CER 4.2% → 0.66% (1600s) and 5.6% → 1.49% (1500s), within 0.1–0.13 points of Gemini 3.8 Flash (0.56 / 1.36). ſ written as f falls from 4,851 to 84. It over-corrects 37 true f (names like Offa, fine/sine), and Flash still wins more pages head to head (19/34, 12/26)."
status: undecided
decision: "Derek: (1) apply the pass to the 1.07M Latin pages stored as lite (writes to pages: separate PR); (2) read the unread Latin print backlog as lite Batch + pass (1500s+1600s 7.6M pages ≈ $5.4K). Both DECISION on #5924"
superseded_by: null
issue: [5924]
---
PRIOR ART: `2026-10-18-latin-gex45-bakeoff-5924.md` (same 99 pages, same scorer; found that ſ written as f is lite's whole gap and recommended "lite plus a long-s pass"). `2026-10-06-latin-print-r4-by-book-5924.md` (round 4's `lite+longs` took ſ from a Calamari **image** read at 61 CPU-s/page, which needs Kraken segmentation; this pass reads only the text). Preregistration: `scripts/eval/latin-longs-pass-5924/PREREGISTRATION.md`, commit 2840616d9, pushed before the pass existed; the pass and its frozen parameters were committed in 977dc949b before any LP output was scored.

## 2026-10-22 · Can a CPU pass over flash-lite's text put back the long s well enough to read Latin print like Gemini 3.8 Flash? (#5924)

**Yes, by the preregistered bar, in both centuries.** The pass takes lite's median page CER from 4.2% to 0.66% in
the 1600s and from 5.6% to 1.49% in the 1500s. That is within 0.10 and 0.13 points of 3.8 Flash. It needs no image and
no model call, and it runs in 8 ms of CPU per page. It is not quite Flash: page by page, Flash is still ahead on more
pages than not. The pass also turns some true f into ſ, mostly in proper names.

**The pass** (`latin-longs-pass-5924/longs-pass.mjs`).
- **The only edit is f → ſ.** It can change a lower-case f that is not word-final and not before b or k. A word broken
  by a line-end hyphen is looked up whole.
- **How it chooses.** It tries every eligible f both ways and scores each reading by:
  - a word unigram model (a character 5-gram for unseen forms);
  - a bigram with each neighbour, for skeletons where both readings are attested (fit/sit);
  - a channel prior of ln 0.64 per flip, the ſ→f rate the bake-off measured.
- **What it learns from.** Our own Latin: 2,061 Latin books, 130,520 gemini-3-flash-preview pages (`corpus-books.txt`),
  37M tokens.
  - The 99 reference books, and every book of their works, are excluded.
  - Pages that hold lite's tell-tale forms (`eft`, `funt`, `effe` …) are dropped (3,644).
  - There are no 3.8 Flash pages and no typed Latin editions in `pages` to use instead (checked 2026-10-22).
- **How it was tuned.** On held-out flash-preview books with lite's habit simulated (1,000 pages): 56,480 simulated
  s/f errors fell to 1,816. The grid was flat (`dev-grid.json`). The 99 pages played no part.

### Results, view N (preregistered). Median page CER % (95% CI); Δ = arm − lite, paired

| arm | 1600s (n = 59) | Δ vs lite (CI), W/L | 1500s (n = 40) | Δ vs lite (CI), W/L |
|---|---|---|---|---|
| L lite (stored reads) | 4.21 (3.44–4.61) | — | 5.60 (4.77–6.16) | — |
| **LP lite + pass** | **0.66** (0.33–1.00) | **−3.23 (−3.74, −2.37)**, 53/1 | **1.49** (1.01–2.67) | **−3.41 (−3.99, −2.19)**, 36/2 |
| F Gemini 3.8 Flash (agy) | 0.56 (0.16–0.84) | −3.18 (−3.90, −2.59), 52/6 | 1.36 (0.55–2.55) | −4.04 (−4.58, −2.00), 34/5 |
| noise floor (median \|L1a − L1b\|) | 0.22 | | 0.27 | |

**The bar, per century:**

| criterion | 1600s | 1500s |
|---|---|---|
| 1. CI of median(LP − L) wholly below 0 | pass (−3.74, −2.37) | pass (−3.99, −2.19) |
| 2. median N(LP) − median N(F) ≤ 0.3 points | pass, +0.10 | pass, +0.13 |
| 3. on pages whose reference has no ſ, LP raises CER on no more pages than it lowers | **vacuous**: all 99 references hold ſ | **vacuous** |

Criterion 3 is met only because no page qualifies, which is not evidence of anything. What does measure over-correction
is reference f read as ſ (`f_as_long_s` in score.mjs):

| | L | LP | F |
|---|---|---|---|
| 1600s | 1 | 24 | 7 |
| 1500s | 0 | 13 | 3 |

That is 37 over-corrections against 4,767 ſ-as-f put right, out of 1,543 f in the references.

### Other views (reported, not deciding)

| | 1600s L / LP / F | 1500s L / LP / F |
|---|---|---|
| reference ſ read as f | 2,566 / **47** / 119 | 2,285 / **37** / 98 |
| reference ſ read as s (lite's round s; the pass leaves s alone) | 1,060 / 1,060 / 1,563 | 729 / 728 / 1,591 |
| reference ſ kept as ſ | 287 / 2,814 / 2,269 | 125 / 2,388 / 1,387 |
| view D (diplomatic) median | 5.06 / **1.51** / 3.27 | 5.97 / **2.73** / 4.71 |
| post hoc `--fold-f` median | 0.66 / 0.66 / 0.39 | 1.39 / 1.39 / 1.10 |
| pages, LP better / worse than F (view N) | 19 / 34 | 12 / 26 |

- **The fold-f view shows the pass changes nothing but f/ſ.** LP equals L there. Its 2/0 and 1/0 page differences come
  from latin-norm's abbreviation fold seeing ſ and f differently.
- **The ambiguous words.**
  - Of 4,229 tokens changed, 2,001 decisions fell in a skeleton with more than one attested reading.
  - Only 416 had both readings common (≥ 500 in the lexicon): fi/si 120, fe/se 86, fit/sit 75, fiue/siue 26, fine/sine 23,
    fide/side 22, fui/sui 17, and others.
  - The bigram context decides these.
- **By eye** (`read-from-image`, two Opus subagents, `byeye-pages.json`). The 3 largest gains and the only 3 losses
  against lite:
  - **Gains** (1500s p774, 1600s p263, 1500s p162; 350 changes). All 350 were right by the print. Two ſ were missed at
    line-end word halves (`ef-`, `impof-`), where the hyphen join did not fire. On p162 lite wrote `ss` for printed ſſ,
    which the pass does not touch.
  - **p104 (1600s, +0.46 points).** 8 of 11 changes were wrong. All were proper names: Offa ×5, Harpesfildus, Ceuulfo, and
    `Bedæ fi-dem` joined into one word across the line.
  - **p29 (gothic, +0.10).** Three wrong (`ferues` and `fio` are true f in a verb paradigm, plus a gutter scrap of the
    facing page), 1 right, 2 can't tell.
  - **p106 (gothic, +0.09).** Both changes were `finē` (finem) turned into `ſinē`. Lite had already written every ſ on this
    page as s, so the pass could only do harm.

### Reach and cost (if adopted)

From `reach-count.mjs` → `reach-2026-10-22.json`. The frame is Latin books not marked `duplicate_of`; the century comes
from `published`.

| century | Latin pages stored as lite | unread (no `ocr.data`) |
|---|---:|---:|
| 1400s | 246,925 | 404,436 |
| 1500s | 283,215 | 3,322,435 |
| 1600s | 302,626 | 4,323,790 |
| 1700s | 136,920 | 1,585,308 |
| no year in 1400–1799 | 104,958 | 2,179,641 |
| **all** | **1,074,644** | **11,815,610** |

- **The pass on all 1.07M stored lite pages** takes about 2.4 CPU-hours (7.9 ms/page measured), $0.
- **Reading the unread backlog with lite on Batch.** At the bake-off's measured $0.71 per 1,000 pages (2,400 px images;
  production images are smaller, so this runs high):
  - the 1500s + 1600s (7.65M pages) cost about **$5.4K**;
  - every Latin page left unread (11.8M) costs about **$8.4K**;
  - the pass adds about 26 CPU-hours.
- **Compared with the other routes:**
  - Round 4's Calamari post-pass costs 61 CPU-s/page, about 5,400 CPU-days for the same 7.65M pages.
  - 3.8 Flash runs through the agy quota at about 225 pages/h, which is 1,389 days for the whole Latin queue.

### What this does not show
- **Agreement, not truth.** The references are Opus reads (three per leaf, with no human check). LP vs F is a gap of
  0.1 points, which is inside the reference noise.
- **Gothic is barely tested.** Only 4 of the 99 pages are blackletter, and 2 of the 3 losses are gothic. The 1400s (247K
  lite pages) are mostly gothic. Measure the pass there before applying it to them.
- **The prompt.** Lite here ran the bake-off's generic prompt. Production output carries `<tags>`, and some pages mix
  Latin with vernacular words (`after`, `for`). Applying the pass needs two guards: protect tag names, and run only on
  Latin text.
- **What it leaves wrong:**
  - The pass cannot fix an ſ that lite wrote as s; view N does not count those, view D does.
  - Proper names the lexicon does not know are its main failure mode.
- **Not replicated.** One run, one frozen model.

*Spend:* $0. No model calls (stored reads only). Opus by-eye ran on the subscription. Mongo reads only.

*Artifacts:* `scripts/eval/latin-longs-pass-5924/`:
- The pass and its tooling: `longs-pass.mjs` (build / dev / apply), `fetch-corpus.mjs` (training text, read-only),
  `params.json` (frozen) and `dev-grid.json`.
- The output: `reads/LP.jsonl.gz` with its run record, and `LP-changes.jsonl.gz` (every change, with its margin).
- The scores: `results-LP.json.gz` and `results-LP-posthoc-fold-f.json.gz`, from `latin-bakeoff-5924/score.mjs`
  unchanged, run on L, LP, F, L1a and L1b.
- `byeye-pages.json`, `reach-count.mjs` and `reach-2026-10-22.json`.
- The model itself (8.7 MB) is not committed. It rebuilds from `corpus-books.txt` with `longs-pass.mjs build`
  (sha256 in the run record).

No writes to `pages`, `books` or any production store.
