---
stage: ocr
measure: [accuracy, stability]
languages: [sa]
scripts: [Mlym]
canons: [sanskrit]
n_books: 1
n_pages: 9
verdict: "On 9 verse leaves of Whish 147, no preprocessing beats the plain colour crop for Opus 5.5. With one read per variant, pooled per-row CER is: best single channel 0.32, string holes masked 0.37, per-row crops 0.41, CLAHE grey 0.48, Sauvola binarised 0.59. The plain-crop baseline is 0.34, and a variant had to score under 0.23 to count as better. Reads of perturbed images (shifted, rescaled, gamma) do not err more independently than repeat reads of one crop. Merged akshara by akshara, 5 perturbed reads give 0.29 with the best channel as fifth member and 0.38 without it. Perturbed reads land in the good mode less often than plain ones (17 of 45 against 13 of 27)."
status: rejected
decision: "Not adopted. The rollout (#7119) keeps the plain colour column crops and the J-text pick over 4 candidates (0.17 pooled, best-of-3 job). Replacing a plain re-read with a perturbed or preprocessed one would lower the share of good candidates. Letter-level voting loses to picking a whole read. Agreement of 4 or 5 of 5 perturbed reads marks text at CER 0.13 (a third of the text), but 3 of 3 same-crop reads already give 0.13 (30%), so it adds no new confidence signal."
superseded_by: null
issue: [7119]
---
PRIOR ART: 2026-10-23-whish147-stability-recall.md (PR #7203) — the 3 plain colour Opus reads per leaf, the crops (reproduced here SHA-256 identical) and the per-row scorer are reused as the baseline and control; it measured repeat reads of one image and never altered the image. 2026-10-22-whish147-line-strips.md — single-row strips set by eye on half-leaves with the OCR lane prompt; the per-row arm here cuts the stability test's column crops instead and keeps the fresh prompt.

## 2026-10-23 · Do altered images help a single read, and do reads of different images merge better than repeat reads? (#7119)

Part of #7119. These are research experiments 5 and 2 from the #7119 research comment, approved by Derek on 2026-10-23.

**Question.** One Opus read of a Whish 147 leaf is bimodal: on most leaves it is either nearly the published text or a run of near-misses (pooled CER 0.34; best of 3 reads 0.18). Repeat reads of the same crop make correlated errors, so voting across them does not help.
- Exp 5: does any preprocessing of the image beat the plain colour crop?
- Exp 2: do reads of different versions of the image disagree in ways a letter-level merge can exploit?

**Design.**
- *Leaves and method.* The 9 verse leaves of the #7119 gate (4b, 5t, 5b, 6t, 6b, 7t, 8t, 8b, 9t; Sāṅkhyakārikā 1–58). One sealed `claude -p` Opus 5.5 call per leaf per variant, with the image only, through `claudeCall`. The fresh-read prompt is unchanged (hash `ef836994a6f1e9ca`, checked at start). The plain colour crops reproduce the stability test's byte for byte (`pieces.json`), and its 3 Opus reads per leaf are the baseline and the control (`control/`).
- *Exp 5 variants* (`variants.py`, cut at the same pieces as the plain crop):
  - CLAHE: CLAHE on the L channel, grey.
  - Best single channel: the R, G or B channel with the best Otsu separability on the leaf, stretched. It picked R on 8 leaves and B on 8-t.
  - Sauvola: Sauvola binarisation (window 51 px, k 0.2) of the CLAHE grey.
  - Holes masked: the two string holes painted grey.
  - Per-row crops: each of the 4 column pieces cut into its physical rows and sent in row-major order, 36–40 strips per leaf. The prompt changes only in its sentence describing the files.
- *Exp 2 perturbations* of the plain crop: leaf box shifted +3% and −3% of its width and height; every piece scaled 0.85 and 1.15; gamma 0.7.
- *Score.* `score.py` uses the stability test's per-row best-window CER against the GRETIL span (`score_lib.py`, unchanged). The baseline reproduces as 0.339, with an oracle best-of-3 of 0.178.
- *Noise threshold.* One read per leaf is a draw from a bimodal distribution, so the threshold is a bootstrap: draw 1 of the 3 baseline reads per leaf and pool, 10,000 times. That gives p2.5 / p50 / p97.5 = **0.234 / 0.341 / 0.441**. The 3 real baseline read sets pooled at 0.37, 0.40 and 0.24. A variant counts as better only below 0.234, and worse only above 0.441.
- *Merge.* Every read is transliterated to IAST, normalised by the scorer's own norm(), and split into aksharas (C*V, a trailing consonant closes the akshara). Reads are star-aligned on the read closest to all the others: Needleman–Wunsch over aksharas, with substitution cost equal to the normalised letter distance and gap cost 1. Each position takes a plurality vote, and a gap counts as a vote. An insertion is kept when more than half the reads have one there. The merged text keeps the centre read's rows and is scored with the same per-row scorer. Each edit is charged to a merged akshara, so CER splits by vote count.
- *Calls.* 90 Opus calls, all on the subscription, with no Gemini or API key and nothing written to pages: 45 for Exp 5 and 45 for Exp 2. The cap was 200.

**Result: Exp 5, preprocessing (one read per leaf; baseline 0.339, better below 0.234, worse above 0.441).**

| variant | pooled CER | chars scored | good reads (CER < 0.2) | verdict |
|---|---|---|---|---|
| plain colour (3 stored reads) | 0.339 | 4,545 per read set | 13 of 27 | baseline |
| best single channel | 0.323 | 3,958 | 3 of 9 | within noise; 8-t declined (all rows `[illegible]` on the B channel) |
| string holes masked | 0.365 | 5,061 | 4 of 9 | within noise |
| per-row crops | 0.410 | 4,240 | 3 of 9 | within noise |
| CLAHE grey | 0.476 | 3,839 | 2 of 9 | **worse** |
| Sauvola binarised | 0.590 | 1,664 | 1 of 9 | **worse**, and it wrote a third of the text ("heavy binarisation noise") |

**Result: Exp 2, perturbation ensemble.**

| arm | merged / pooled CER | ≥4 of 5 agree: CER (share of text) | the rest: CER (share) |
|---|---|---|---|
| one plain read (pooled, 27 reads) | 0.339 | | |
| oracle best of 3 plain reads | 0.178 | | |
| **control**: merge of the 3 same-crop plain reads | 0.353 | 3 of 3 agree: 0.125 (30%) | 0.451 (70%) |
| single perturbed reads, pooled per perturbation | 0.37–0.51 (shift− 0.514, worse) | | |
| merge A: shift+, scale 0.85, scale 1.15, gamma, best channel | **0.285** | 0.129 (35%) | 0.370 (65%) |
| merge B: shift+, shift−, scale 0.85, scale 1.15, gamma | 0.379 | 0.136 (32%) | 0.495 (68%) |
| like for like with the control: merge of any 3 perturbed reads (mean of 10 triples) | 0.372 (0.33–0.42) | 3 of 3 agree: 0.126 (27%) | |
| oracle best of 3 perturbed reads (mean of 10 triples) | 0.236 | | |
| oracle best of 5 perturbed reads | 0.140 | | |

- **No preprocessing helps.** The best single channel and masked holes sit inside the baseline's own spread. CLAHE and Sauvola are worse. On Sauvola Opus mostly declines, so the CER it does report covers a third of the text. Per-row crops repeat the line-strips result: Opus does not read rows better in isolation.
- **Perturbed reads do not decorrelate.** The bimodality survives every perturbation. Each read is still near the text or near chance as a whole: 7-t scores 0.05 shifted +3% and 0.62–0.66 on the other four perturbations. Perturbed reads are in the good mode **less** often than plain ones (38% against 48%). Their best-of-3 is worse (0.236 against 0.178), and 3 perturbed reads merge no better than 3 same-crop reads (0.372 against 0.353). On 8-t, all 3 plain reads are good (0.03–0.05) and 4 of 5 perturbed reads are poor, so the good mode depends on the exact image, but not in any way a perturbation can steer.
- **The merge only works where two reads are already good.** Merge A's 0.285 comes from 7-t and 6-b, where two or three members landed in the good mode (7-t: 0.139 merged, 6-b: 0.055). On 5-t and 8-t one good read among five is outvoted (0.35, 0.53). 0.285 is inside the single-read noise band, and above the J-text pick from the best-of-3 job: 0.20 over 3 Opus reads, 0.17 with one Fable read added (that job's #7119 comment).
- **Agreement as a confidence.** Akshara positions where 4 or 5 of 5 perturbed reads agree score CER 0.13–0.14 (32–35% of the text); 5 of 5 agree, 0.09–0.11. Positions with one vote score 0.68–0.76. That split is real, but 3 of 3 same-crop reads already give it (0.125 on 30%), so perturbation adds nothing as a confidence signal.
- **One new good read.** On 8-b, scale 1.15 gave 0.111. Of the 15 reads of that leaf across both tests, only one other read is good (Fable, 0.10). It shows that more draws can find a good read on a hard leaf. It is not evidence that scaling helps: the same scale scored 0.57–0.64 on 5-t, 6-b, 7-t and 9-t; it has the most good reads of any variant (5 of 9) and still pools at 0.367.

**What it means.** The rollout should keep the plain colour column crop and pick whole reads, as the best-of-3 job does (J-text over 3 Opus + 1 Fable plain reads, 0.17). Do not swap plain re-reads for perturbed or preprocessed ones: they are good less often. Do not vote letter by letter: it needs at least two good reads to win, and once two exist the pick already finds one.

- *Replicated?* One manuscript, 9 verse leaves of a famous text, one read per variant per leaf. Variant-level figures move by about ±0.1 between draws (bootstrap above), so only the CLAHE and Sauvola "worse" verdicts and the good-mode rates are firm. Commentary leaves are not tested.
- *Not done.* The cords hanging from the holes could not be masked: tracking them by colour wandered onto the text, checked by eye. Masking them would also hide text in the full-width rows, so the masked-holes variant masks the holes only. Per-row segmentation fits one evenly spaced grid of the leaf's known row count (`rows.json`) between the holes, nudged ±20 px per piece; each leaf was checked by eye with one row per strip.
- **Artifact.** `scripts/eval/results/whish147-perturb-2026-10-23/`. It holds `pieces.mjs`, `variants.py`, `read.mjs`, `score.py`, `score_lib.py`, `pieces.json`, `variants.json`, `scores.json`, `scores.txt`, all 90 reads with meta (prompt hash, image SHA-256, timing, usage) and `reads/calls.jsonl`. The 27 control reads are in `control/`. The crops are not committed: `variants.py` rebuilds them from the page images.
