---
stage: ocr
measure: agreement
languages: [la]
scripts: [Latn]
canons: []
n_books: 99
n_pages: 99
verdict: "GLM-OCR + a LoRA on 1,982 stored flash-preview reads: median CER 1.7% (1600s) / 3.2% (1500s) against lite's 4.2 / 5.6%, keeping ſ 88% of the time, but the paired CI touches or crosses 0. With ſ→f folded, lite is better by 0.9 points in both centuries. FAILS the preregistered bar."
status: rejected
decision: "No standing Latin lane on the GEX45 from this student. It learned the teacher (1.8% CER against the teacher on held-out pages), so the ceiling is the teacher: a re-run needs a 3.8-Flash teacher via agy (quota resets ~2026-10-24) and more pages, under a new prereg (#6871 item 2)"
superseded_by: null
issue: [6871, 5924]
---
## 2026-10-20 · Can a distilled GLM-OCR read Latin print well enough to replace flash-lite? (#6871, Derek's item 2)
<!-- PRIOR ART: 2026-10-18-latin-gex45-bakeoff-5924.md (the 99 frozen references, scorer, bar and arms L/G/F); 2026-10-06-latin-print-r4-by-book-5924.md (stored flash-preview ≈ 3.8-flash on Latin print); 2026-10-19-mongol-real-pilot-score-5664.md (a LoRA on real labels on this box). -->

**Question.** GLM-OCR 0.9B reads at ~1,700 pages/h on the GEX45, $0 at the margin, but stock it trails flash-lite once
flash-lite's ſ→f habit is set aside. Does fine-tuning it on a Flash model's reads of OTHER Latin pages close that gap?

**Design.** Preregistered: `scripts/eval/latin-distill-6871/PREREGISTRATION.md` (7e581c930), committed before training.
- **Teacher.** The stored production read by `gemini-3-flash-preview`. Derek's brief asked for 3.8 Flash via agy, but
  agy's quota was exhausted on both boxes that have it ("resets in 84 h"). Round 4 (#5924) measured flash-preview
  level with 3.8-flash on Latin print, and it costs $0.
- **Training set.** 1,982 pages from 966 Latin printed books, 1500–1699, with 0 reference books or works. Each page has
  ≥ 5 ſ in the teacher's text, because Derek asked to "keep long s" and the stored teacher keeps ſ on only ~8 % of its
  pages. Production markup is stripped (`clean-teacher.mjs`).
- **Training.** LoRA r 16 / α 32 on the language model's linear layers, lr 1e-4, effective batch 8.
  - It ran 495 optimizer steps: 2 epochs of 1,982 pages, since 18 images did not fetch.
  - 2.5 h on the card, peak 7.9 GB.
  - The smoke gate passed: loss over steps 1–5 was 1.02, steps 21–25 0.92.
  - The last 5 steps averaged 0.28; val loss 0.35.
- **Reading.** The merged model was served as arm G, minus speculative decoding (the merged checkpoint has no MTP layer),
  on the same fed images. **G2** is stock GLM under the same flags. It matches G (1600s 2.79 / 2.79 %, 1500s 3.22 /
  3.12 %, inside the noise floor), so D is compared with G.

**Result** (`latin-bakeoff-5924/score.mjs`, unchanged; the student scored in the G slot). Median page CER, Δ vs lite (L) in points, 95% CI:

| | 1600s (n = 59) | Δ vs L (CI) | W/L | 1500s (n = 40) | Δ vs L (CI) | W/L |
|---|---|---|---|---|---|---|
| **view N (the bar)** | | | | | | |
| L flash-lite | 4.21 | — | | 5.60 | — | |
| G stock GLM-OCR | 2.79 | −1.07 (−1.92, +0.23) | 34/24 | 3.12 | −1.08 (−2.89, −0.28) | 27/13 |
| **D distilled** | **1.72** | **−1.42 (−2.51, 0.00)** | 35/22 | **3.18** | **−1.47 (−2.62, +0.08)** | 25/15 |
| F 3.8 Flash (#5924) | 0.6 | | | 1.4 | | |
| **view N, ſ→f folded** | | | | | | |
| L | **0.66** | — | | **1.39** | — | |
| G | 2.39 | +1.38 | 5/52 | 2.88 | +0.92 | 8/31 |
| D | 1.47 | **+0.94 (+0.78, +1.27)** | 6/53 | 2.90 | **+0.91 (+0.29, +1.58)** | 11/29 |
| **diplomatic view D** (nothing folded) | | | | | | |
| L / G / D | 5.06 / 7.47 / **2.47** | | | 5.97 / 8.00 / **4.37** | | |

**Against the rule: FAIL.**
1. **View N passes in neither century.** The median gain is large: −1.4 points, 35 wins to 22 losses in the 1600s. But
   the CI's upper end is 0.00 in the 1600s and +0.08 in the 1500s, and the bar needs it below 0.
2. **The ſ-folded condition fails in both.** The student is 0.9 points behind lite, against a 0.3 allowance. So once
   lite's ſ→f habit is set aside, lite still reads the letters better.
3. **D does not beat stock GLM in the 1500s** (3.18 vs 3.12).

**What the training did.**
- **Long s, as asked.** D keeps ſ for 3,511 of 3,983 reference ſ (1600s) and 2,715 of 3,229 (1500s), and writes ſ as f
  only 126 and 119 times. Lite manages 287 and 125 kept, and stock GLM 0.
- **Best diplomatic reading.** In the diplomatic view D is the best arm we have measured: 2.47 / 4.37 %, against
  3.8 Flash's 3.3 / 4.7 % and lite's 5.1 / 6.0 %.
- **It learned the teacher closely.** On the 100 held-out val pages (48 other books), D's text is a median 1.8 % CER from
  the teacher's (75 % of pages under 5 %). So the letter errors left on the references are the teacher's. Distillation
  works, and the ceiling is the teacher, not the student.
- **Unchanged.** Speed is still 1,760 pages/h. Catastrophic pages: 1 (1600s) and 2 (1500s), within the bar.

**Decision.**
- No standing Latin lane on the GEX45 from this student.
- The cheapest next test is the same recipe with a **3.8-Flash teacher via agy** after the quota resets (~2026-10-24),
  and more pages (≥ 5K), under a new prereg. F reads 0.6 / 1.4 % (view N) on these references. How flash-preview
  reads them is unmeasured: 85 of the 99 reference pages have no stored read. So whether a 3.8 teacher is cleaner here
  is the open question that run answers.
- Until then Latin stays on the Gemini side (the #5924 ſ fix).

**What this does not show.**
- The references are three Opus reads (agreement, not accuracy).
- Gothic is 4 of 40 1500s pages, so no verdict carries over to blackletter.
- The teacher's prompt is production's, and it regularises spellings (#5924 round 4). The student copies that habit.

*Spend:* $0. Stored teacher reads, the owned GPU (2.5 h of training plus 3 × 99 page reads), and Opus none.
*Artifacts:* `scripts/eval/latin-distill-6871/`:
- `train.jsonl.gz` / `val.jsonl.gz` (labels and image URLs);
- `reads/{D,Dval,G2}.jsonl.gz`;
- `results/res-*.json.gz` (per-page scores);
- `results/train-log.jsonl` and `results/summary.json`.

The adapter and merged weights stay on gex45 at `/root/jobs/latin-distill-6871/run/`. No production write.
