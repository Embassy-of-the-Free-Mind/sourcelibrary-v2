---
stage: ocr
measure: judged
languages: [la, de, grc, lzh, ar, he]
scripts: [Latn, Grek, Hani, Arab, Hebr]
canons: []
n_books: null
n_pages: 2178
verdict: "Full preregistered run, all 2,178 Opus-adjudicated stored reads: image gain (log p | image − log p | no image, Qwen2.5-VL-7B AWQ) ranks the words Opus marked wrong at unit AUROC 0.58 (95% CI 0.56–0.60) against a bar of 0.75. No language clears it; Chinese is below chance (0.44), where text-only perplexity scores 0.68. Gain does not beat perplexity pooled (paired CI −0.02 to +0.06). At a 10% flag rate precision is 2.6% on a 1.4% base rate. It does see text that is not on the leaf: 41 planted controls 0.95, invented spans 0.82. The repeat pass is deterministic (r 0.9999), so this is not noise."
status: rejected
decision: "No image-gain pre-screen in front of agy/Opus review on #6420: it neither replaces nor pre-filters a round, in any language. The amendment cells (phrase plants, SKQS, span recall at precision 0.5) score themselves in gex45 task 55-grounding-6871a and post to #6871; the real-error cells cannot change this verdict unless they clear all three bars"
superseded_by: null
issue: [6871, 6420]
---
PRIOR ART: `2026-10-18-image-gain-guessed-text-detector-6871.md` (the interim on 707 pages, same preregistration). This entry is the full run that interim queued (`50-grounding-6871`). It finished on gex45 at 2026-10-18 17:32Z, and its numbers were never posted until this job copied them back. Preregistration: `scripts/eval/grounding-6871/PREREGISTRATION.md` (6812ff73b). Amendment for the 2026-10-22 brief: `PREREGISTRATION-AMENDMENT-6871a.md` (89b2ff5c3, committed before any of its items was scored).

## 2026-10-22 · Image gain as a guessed-text detector: the full preregistered run (#6871 row A)

**Question.** The common failure is wrong words in fluent text (#6420). Does an open VLM's per-token image gain find the spans a sealed Opus marked wrong in our stored reads, well enough to pre-screen pages before review?

**Answer: no.** The full set gives the same result as the interim, and it is a little lower.

**Set and scorer** (unchanged from the 2026-10-18 entry).
- 2,178 stored reads that lane B Opus adjudicated (#6420 / #6694 sets calib, gate, main200b, q300), rebuilt read-only. The 509 pages split from a spread are scored against their own leaf.
- Labels: 3,693 located spans of Opus's quoted errors, plus 41 planted controls on pages Opus judged clean.
- Qwen2.5-VL-7B-Instruct-AWQ on the gex45 RTX PRO 4000, teacher-forced. Image capped at 2,400 px; the no-image pass drops the image part.
- Units are words, or 3-character Han chunks. Bootstrap CIs over pages (2,000 draws).

**Result (preregistered bar: unit AUROC ≥ 0.75, CI above 0.5, and gain beats text-only perplexity).**

| group | pages (with a bad span) | bad units / units | AUROC gain (95% CI) | AUROC text-only perplexity | paired gain − perplexity | precision at 10% flag (recall) | base rate | AUROC image surprisal (descriptive) | bar |
|---|---|---|---|---|---|---|---|---|---|
| **all** | 2,178 (1,528) | 10,868 / 776,187 | **0.58** (0.56–0.60) | 0.56 | −0.02 to +0.06 | 2.6% (18%) | 1.4% | 0.72 | **no** |
| latin | 1,022 (722) | 5,603 / 444,256 | 0.58 (0.56–0.61) | 0.57 | −0.04 to +0.08 | 2.4% (19%) | 1.3% | 0.71 | no |
| german | 402 (320) | 1,735 / 117,977 | 0.58 (0.51–0.64) | 0.57 | −0.11 to +0.13 | 3.3% (22%) | 1.5% | 0.77 | no |
| greek | 257 (199) | 1,614 / 115,381 | 0.63 (0.60–0.65) | 0.52 | +0.06 to +0.15 | 3.0% (22%) | 1.4% | 0.70 | no |
| chinese | 356 (179) | 751 / 35,347 | **0.44** (0.40–0.48) | 0.68 | −0.31 to −0.17 | 2.1% (10%) | 2.1% | 0.69 | no |
| arabic | 105 (80) | 934 / 38,902 | 0.58 (0.55–0.62) | 0.63 | −0.11 to +0.01 | 4.3% (18%) | 2.4% | 0.74 | no |
| hebrew | 36 (28) | 231 / 24,324 | 0.60 (0.54–0.67) | 0.53 | −0.04 to +0.21 | 1.6% (17%) | 0.9% | 0.61 | no verdict (< 30 pages) |

**By kind (all groups).**

| kind | bad units | AUROC gain (CI) | AUROC perplexity | paired gain − perplexity | AUROC image surprisal |
|---|---|---|---|---|---|
| **invented** | 1,132 | **0.82** (0.77–0.86) | 0.35 | +0.33 to +0.59 | 0.67 |
| garbled | 919 | 0.64 (0.57–0.69) | 0.61 | −0.10 to +0.13 | 0.84 |
| sub_lexical (a different word) | 5,818 | 0.56 (0.54–0.58) | 0.57 | −0.04 to +0.02 | 0.71 |
| sub_char (one letter, ſ/f, an accent) | 3,001 | 0.50 (0.48–0.52) | 0.62 | −0.15 to −0.08 | 0.71 |

**Planted controls (descriptive):** all 41 score 0.95 (0.92–0.96). The 21 with three fluent wrong words score 0.86; the 20 with one sentence from another page of the same book score 0.97.

**Noise floor, on 300 seeded pages.**
- Scored again with a fresh server: unit-gain r 0.9999, median |Δgain| 0.011, AUROC 0.606 vs 0.606. The pass is effectively deterministic, so every CI above is sampling error only.
- At a 1,200 px cap: r 0.92, median |Δgain| 0.16, AUROC 0.59. Halving the resolution barely moves it.

**Page level (exploratory, `explore.py`, not preregistered).**
- The share of low-gain units ranks the pages Opus called serious at 0.66 (0.64–0.68). It ranks the pages holding invented or garbled text at 0.64 (0.60–0.67).
- Image surprisal does about the same: 0.68 and 0.67.
- The interim's two leads did not hold up on the full set:
  - Chinese serious pages: 0.69, not 0.99.
  - Greek serious pages: 0.77, against an interim 0.79. Greek is the only cell above 0.75, it is exploratory, and its CI is 0.71–0.83.

**Throughput.** The main pass scored 1,291 items in 4,414 s, about **1,050 pages/h for the image + no-image pair**. The capability card had 1,340 pp/h; the gap is because real pages are longer than the card's sample. At that rate, all 9.33M OCRed pages would take ≈ 370 GPU-days.

**Reading.**
- **The paper's signature is real, but only for text the leaf does not have.** That covers invented spans (0.82) and swapped-in sentences (0.97). They are fluent, so text-only perplexity misses them (0.35). The image does not support them, so their gain is low.
- **The errors readers actually meet are not that.** About 81% of the bad units Opus marks are a wrong word or a wrong letter inside a real line. On those, gain is at chance (0.56 and 0.50).
- **Precision is the binding problem.** Bad units are 1.4% of units. At the best operating points precision stays near 2–4%. A review queue built on it would be over 95% clean text.
- **Chinese inverts.** There, gain ranks errors below clean text (0.44), while perplexity reaches 0.68. A misread Han character in a stored Gemini read is often one the VLM also finds likely given the image (a look-alike). The no-image prior then penalises it more than the image helps.
- **Image surprisal** (−log p | image) is again the best single number: 0.72 pooled, 0.84 on garbled text. Even so it is far from 0.75 on real spans, and it was not what this row tested.

**Decision.** No image-gain pre-screen in front of agy/Opus review on #6420, in any language. It neither replaces nor pre-filters a review round. The $0 GPU does not buy a guessed-text screen with this scorer.

**The 2026-10-22 amendment (pending, self-scoring).**
- Derek's go asked for more than the first run had:
  - phrase plants (1–3 phrases from another page of the same book);
  - a Chinese SKQS cell;
  - the bar *recall ≥ 0.6 at precision ≥ 0.5*;
  - repeat noise.
- These are preregistered in `PREREGISTRATION-AMENDMENT-6871a.md`:
  - 50 phrase-plant pages (Latin 22, Greek 13, SKQS 15);
  - 71 SKQS real reads, Paddle and lite, each set against the Kanripo WYG text of the same leaf;
  - span recall at precision ≥ 0.5 (R@P50) for every cell, including the full #6420 set.
- The amendment runs as gex45 gpu-queue task `55-grounding-6871a`, which posts its table and verdict to #6871 and #6420 itself.
- **It cannot overturn the decision above unless a real-error cell clears all three bars.** On the #6420 set, B1 has already failed in every group.

**Threats and limits.**
- Opus's error lists are not exhaustive. Some negatives are errors, which lowers every scorer alike.
- The scorer judges another engine's read (mostly Gemini's), not its own decode. That is the setting we need, but not the paper's.
- One model and one prompt. Qwen2.5-VL-7B is weak on Han and Arabic print.
- The groups follow the book's lane group, not the page's language.

**Cost.** $0 this round: no paid model, no rented GPU. The 10-18 run used ≈ 2.5 h of gex45 in all (three interim holds, then the queued remainder and both noise passes). Nothing was written to any store.

*Replicated?* The interim (707 pages) and the full set (2,178) agree: 0.60 and 0.58.

*Artifacts:* `scripts/eval/grounding-6871/results/full-2026-10-18/` holds `results.json`, `explore.json`, `hold.log.txt`, `task.log.txt` and `state.txt` (the gex45 queue on 2026-10-22). The amendment's code is `plant-phrase.mjs`, `skqs-real.py`, `score-6871a.py`, `report-6871a.py` and `queue-task-6871a.sh`, with items in `results/items-6871a.jsonl.gz`. The per-token log-probs stay on gex45 in `/root/jobs/grounding-6871{,a}/`.
