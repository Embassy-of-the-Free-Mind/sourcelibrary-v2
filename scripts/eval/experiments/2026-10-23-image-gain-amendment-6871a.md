---
stage: ocr
measure: judged
languages: [la, de, grc, lzh, ar, he]
scripts: [Latn, Grek, Hani, Arab, Hebr]
canons: [chinese-classics]
n_books: null
n_pages: 2299
verdict: "Preregistered amendment 6871a (phrase plants, a Chinese SKQS cell, span recall at precision ≥ 0.5): no real-error cell clears any of the three bars. On the full #6420 set image gain has R@P50 0.00 (CI 0.00–0.00): at no threshold are half the flagged words wrong. SKQS real errors: gain AUROC 0.53, R@P50 0.03. Planted phrases from another page of the same book are found (AUROC 0.94, R@P50 0.98). The detector sees text swapped in from elsewhere. It does not see the wrong words a reader meets."
status: rejected
decision: "No image-gain pre-screen in front of agy/Opus review on #6420 (confirms 2026-10-22-image-gain-full-run-6871.md). Row A of #6871 is closed."
superseded_by: null
issue: [6871, 6420]
---
PRIOR ART: `2026-10-22-image-gain-full-run-6871.md` (the full preregistered run; it queued this amendment and records the B1 verdict) and `2026-10-18-image-gain-guessed-text-detector-6871.md` (the interim). Preregistration: `scripts/eval/grounding-6871/PREREGISTRATION-AMENDMENT-6871a.md` (89b2ff5c3), on top of `PREREGISTRATION.md` (6812ff73b).

## 2026-10-23 · Image gain, amendment 6871a: phrase plants, SKQS, span recall at precision 0.5 (#6871 row A)

**Where this came from.** gex45 gpu-queue task `55-grounding-6871a` ran from 02:50Z to 03:00Z on 2026-10-23, scored itself and posted its table to #6871 and #6420. Its numbers never reached the repo. Job gpu-steward-20261027 copied the outputs back. It then re-ran the committed `score-6871a.py` (sha256 c88c6e6d…, identical to the copy on gex45) over `main.jsonl` + `rerun.jsonl` on gex45's CPU. The rerun reproduced `new.json` byte for byte.

**Question.** The 2026-10-22 brief asked for three additions:
- span recall at a precision useful for review;
- a second script with real errors (Chinese SKQS);
- plants that look like real misreads: a phrase taken from another page of the same book.

Do any of these change the "no pre-screen" verdict?

**Answer: no.** All three bars are preregistered: B1 unit AUROC ≥ 0.75 and beats perplexity; B2 R@P50 ≥ 0.6; B3 beats repeat noise. No real-error cell passes any of them.

**Scorer.** Unchanged: Qwen2.5-VL-7B-Instruct-AWQ, per-token log p(read | image) − log p(read | no image), teacher-forced, on the gex45 RTX PRO 4000. R@P50 is the best span recall over thresholds where unit precision ≥ 0.5. Its CI comes from 500 page-cluster bootstraps.

### Real errors

| cell | pages (with a bad span) | AUROC gain (95% CI) | AUROC text-only perplexity | R@P50 gain (CI) | verdict |
|---|---|---|---|---|---|
| #6420, all | 2,178 (1,528) | 0.58 (0.56–0.60) | 0.56 | **0.00** (0.00–0.00) | fail |
| #6420, Arabic | 105 (80) | 0.58 | 0.63 | 0.00 | fail |
| #6420, Chinese | 356 (179) | 0.44 | 0.68 | 0.01 | fail |
| #6420, German | 402 (320) | 0.58 | 0.57 | 0.00 | fail |
| #6420, Greek | 257 (199) | 0.63 | 0.52 | 0.00 | fail |
| #6420, Latin | 1,022 (722) | 0.58 | 0.57 | 0.00 | fail |
| #6420, Hebrew | 36 (28) | 0.60 | 0.53 | 0.00 | no verdict (< 30 pages) |
| SKQS vs Kanripo, all | 71 (60) | 0.53 (0.48–0.57) | 0.60 | **0.03** (0.00–0.08) | fail |
| SKQS, PaddleOCR-VL-1.6 reads | 36 (27) | 0.43 | 0.62 | 0.00 | fail |
| SKQS, flash-lite reads | 35 (33) | 0.58 | 0.59 | 0.08 | fail |

- **R@P50 = 0 on the #6420 set.** With a 1.4% base rate, no threshold makes half of the flagged words real errors. That holds at every threshold, in every language.
- **Gain is below chance on PaddleOCR-VL reads of SKQS (0.43)**, as it was on #6420 Chinese (0.44). Paddle's wrong characters are ones the image makes *more* likely: a look-alike glyph is a plausible reading of the leaf.

### Plants (descriptive)

| cell | pages | AUROC gain | R@P50 gain |
|---|---|---|---|
| phrase plants (new), all | 50 | 0.94 (0.92–0.96) | 0.98 (0.92–1.00) |
| phrase plants, Latin / Greek / SKQS | 22 / 13 / 15 | 0.98 / 0.95 / 0.97 | 0.98 / 0.79 / 1.00 |
| 2026-10-18 word plants, all | 21 | 0.86 | 0.35 |
| 2026-10-18 sentence plants, all | 20 | 0.97 | 1.00 |

- **The reading the prereg named applies:** plants pass and real errors fail. The detector sees text that is not on the leaf. A whole phrase or sentence from elsewhere is found almost every time. A single swapped word is found about a third of the time at precision 0.5. Most real wrong words are a letter or two off and look plausible, and those it misses.

### Repeat noise and throughput

- **Repeat noise.** The second pass, with a fresh server, gives the same ranking (#6420 rerun AUROC 0.61; new items within 0.01). B3 fails on #6420 pooled because the rerun's AUROC lies outside the main CI, not because the runs disagree.
- **Throughput.** 121 items in 134 s = **3,251 pp/h** for the image + no-image pair (rerun 3,134 pp/h). That is above the capability card's 1,340 pp/h, because these pages are short.

### Not preregistered: image surprisal alone

The scorer also reports log p(read | image) alone, as a comparison column. That signal ranks real errors better than gain everywhere:
- #6420 pooled AUROC 0.72; German 0.77; Arabic 0.74;
- SKQS 0.88;
- on SKQS flash-lite reads, R@P50 0.75 (35 pages, base rate 17%).

**This is a post-hoc look at one comparison column, not a result.**
- The #6420 cells still have R@P50 0.00.
- The SKQS cell is 35 flash-lite pages in one collection.
- On the PaddleOCR-VL reads of the same leaves, R@P50 is 0.00.

Before it could change a decision, a new preregistration would have to fix the threshold on one set and test it on another. Nothing is queued for it.

*Artifacts:* `scripts/eval/grounding-6871/results/amendment-2026-10-23/`:
- `new.json`: the plant-phrase and SKQS cells;
- `real6420.json`: the #6420 cells and the 2026-10-18 plants;
- `report.md`: the self-posted table;
- `main.jsonl.gz`, `rerun.jsonl.gz`: per-token log-probs of the 121 new items;
- `hold.log.txt`, `task.log.txt`, `score.log.txt`.

Items: `results/items-6871a.jsonl.gz`. The #6420 per-token log-probs stay on gex45 in `/root/jobs/grounding-6871/`. $0: no paid model, no rented GPU, nothing written to any store.
