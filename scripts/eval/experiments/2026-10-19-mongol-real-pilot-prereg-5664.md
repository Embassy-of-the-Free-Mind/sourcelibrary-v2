---
stage: ocr
measure: judged_vs_reference
languages: [mn]
scripts: [Mong]
canons: [mongolian-kanjur]
n_books: 5
n_pages: 34
verdict: "Preregistration only: continue the synthetic-trained Kanjur reader on ~500 real columns (B/C/D transliterations), 40 % of a 14,400-row mix, 900 steps; scored on v23 real prose (baseline CER 55.5 %) and the frozen 30-column meaning check (baseline 0/30). No result here."
status: undecided
decision: null
superseded_by: null
issue: [5664, 6871]
---
PRIOR ART: `2026-10-18-mongol-real-ground-truth-5664.md` (PR #6960: the 628 confirmed real columns, the v23 eval set, the 55.5 % baseline, and `build_train.py` + `train.py --init-adapter`, used unchanged here); `2026-10-18-mongol-synth-prereg-5664.md` (the frozen meaning set and `judge.mjs`, scored unchanged) and its score entry in PR #6924 (0/30 match, synthetic held-out CER 3.9 %: a domain gap, so "train next on real Kanjur lines"). Nothing in `scripts/eval/INDEX.md` trains a Mongolian reader on real columns.

## 2026-10-19 · Preregistration: do real Kanjur columns fix the Mongolian reader? A gated pilot (#5664, #6871 row 6)

Written and committed **before any training on real columns, and before any read by the pilot adapter**. The 55.5 % baseline and the leakage counts below come from a CPU-only dry run of the build (no GPU, no model).

**Question.** The synthetic-trained reader (`10-mongol-synth-train/adapter-final`) reads synthetic columns at 3.9 % CER and real Kanjur prose at 55.5 %. Does continuing it on about 500 real columns close that gap, before anyone spends more on real text? realgt's bar of 1,000 columns was a guess. This pilot measures instead.

### Arms
- **(a) adapter-final, unchanged.** It is re-read in the same task and harness, as a determinism check against the realgt baseline reads.
- **(b) adapter-final, continued** (`train.py --stage train --init-adapter`) on real columns mixed with synthetic. Every value is fixed now:
  - **Real columns:** the kept B/C/D body columns and the kept title columns outside the 30 frozen meaning volumes. Titles of every 10th rKTs text are held out, as in `build_train.py`. The leakage filters below remove 18. The dry run leaves **494 distinct real columns**.
  - **Mix:** 14,400 rows, of which **40 % are real**. That is 5,760 real rows, so each real column is seen about 11.7 times. The other 8,640 rows are a seeded draw from the 80K synthetic columns.
  - **Schedule:** **900 steps** at batch 8 × accumulation 2 (one pass over the mix). lr 1e-4 with cosine decay, warmup 30, LoRA r = 16 as loaded from adapter-final. There is a 1.75 h clock: if it stops training early, the step reached is reported.
  - **Load gate.** First a 25-step smoke run on 400 mix rows. Its loss at step 25 must be < 3.0 (a fresh LoRA logged 4.5 at step 25). That proves training continued the adapter rather than starting a new one. If it fails, the smoke is retried with the adapter loaded as the base (Unsloth's loader, trainable). If both fail, nothing trains and the run is reported as a harness failure.
- **Not run:** a fresh LoRA on real columns only, more steps, and other mix ratios. This is one arm, by design.

### Leakage guard (`pilot_build.py`; the task refuses to train on any violation)
- **Text id.** The forbidden works are Mng1.491's work (rKTs 670, the v23 dhāraṇī) and the 40 works of the frozen meaning and name sets. No title row may be one of them, and no body row may lie on a leaf inside one of their Mng1 spans. Nothing from source A or from the 30 frozen meaning volumes is used.
- **String overlap.** Any real or synthetic training row that shares a word 5-gram, or a 30-character normalised run, with any of the 157 v23 labels is dropped. The dry run drops 18 real columns and 1 synthetic row. The 18 are mostly the Buddha epithet *ilaǰu tegüs nögčigsen burqan* in B and C, plus the shared dhāraṇī formulae.
- **Final re-scan.** The written `traindata/labels.jsonl` is checked again: no image from a frozen volume, no v23 image, no overlap. The dry run found 0 violations.
- **Shorter overlaps are allowed.** Word 2- and 3-grams are the language itself (*namo buddhaya*): 119 of the 157 v23 columns share a 2-gram with B/C/D. The robustness subset **v23-clean3** below therefore drops every v23 column that shares a word 3-gram with any final training label (dry run: 118 of 157 remain).
- **Name-set volumes are not excluded wholesale.** realgt counted v24 (72 C columns) among its 516. The name check is not scored here, and its 10 works are blocked by text id. A later name check on this adapter must note that v24 trained.

### Measures
- **Primary: pooled CER on v23**, all 157 line-marked columns, as realgt defined them: the sum of edit distances over the sum of reference letters, after `align.py norm()` (letters and word breaks only). Baseline 55.5 %. `score_pilot.py` reproduces it from the realgt reads to the digit (0.5546).
- **Reported with it:**
  - the same CER on the 112 Opus-confirmed columns (baseline 52.9 %) and on v23-clean3 (baseline 55.3 %);
  - CER on the real training columns, which measures memorisation, not reading (baseline 49.7 %);
  - CER on the 400 synthetic held-out columns, which measures forgetting (baseline 3.8 %).
- **Secondary: the frozen 30-column meaning check.** It is scored unchanged with `judge.mjs` (sealed Opus, the Derge window, shuffled controls; the stdin fix from PR #6924). Baseline 0/30 match, 3 partial, controls 0/30. The synthetic prereg's bar applies as written: ≥ 18 match with ≤ 3 control matches.
- **By eye:** 5 v23 columns, each read rendered in the training font under its crop. This is a check only, with no bar.

### Bars (decided now)
- **"Real data works": v23 CER ≤ 35 %.** Recommend a Mongolist and more real text, plus a second real-data run sized from this one.
- **"Worth a Mongolist and more real text": any drop of ≥ 10 points**, so v23 CER ≤ 45.5 %, while still above 35 %.
- **Below that (CER > 45.5 %):** 500 real columns do not move the reader. More real text alone is not the next step. Re-examine the architecture or segmentation first.
- **Qualifiers that can only demote a verdict:**
  - If v23-clean3 misses a bar that v23-all meets, the result is reported at the lower bar. Stock-phrase memory is not reading.
  - A synthetic held-out CER above 15 % is reported as forgetting. It does not change the v23 verdict.
  - If arm (a)'s re-read differs from the baseline by more than 1 point, the harness has drifted, and the comparison is made against (a)'s re-read instead.

### Threats, stated in advance
- **Selection bias.** The real columns are the ones the reader already half-read: the screen and the Opus check kept them. Training on them may teach less than the same number of hard columns.
- **Narrow text.** There are five texts, three of them dhāraṇīs, and v23 is itself a dhāraṇī. A gain on v23 may not carry over to sūtra narrative. The meaning check, across 30 volumes, is the guard against that.
- **Labels.** Opus accepted a wrong string on 7 of 70 controls, so a few training labels are probably misaligned.
- **One seed, one run.** There is no variance estimate. A difference of a few points is not resolved.

### Licence and use
- The B/C/D transliterations are CC BY-NC-ND 4.0. Training for this measurement is internal research.
- The texts, the labels, the reads of real prose and the trained adapter stay on gex45, under `/root/jobs/`. This repo gets ids and scores only.
- **No model trained on them writes `pages` until the authors answer** (Derek is sending the request).

**Run:** gpu-queue task `07-mongol-real-pilot` on gex45. It sorts before `51-zh-guarded-read-resume`; Mongolian is priority 1 (Derek, 2026-10-18). Timeout 3 h, with ≤ 2 h of training. The last step reads v23 and the frozen 30 to files, and its process exits, which unloads the model. Code: `scripts/eval/mongol-realpilot-5664/`.

**Spend:** $0. The GPU is the owned gex45, and the judge is Opus on the Claude subscription. No agy, no paid API, no IMU data. **Nothing is written to `pages` or any production store.**
