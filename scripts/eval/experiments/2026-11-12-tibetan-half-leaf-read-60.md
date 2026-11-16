---
stage: ocr
measure: accuracy
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: null
n_pages: 176
verdict: "Reading each leaf in two halves does not read better: against the printed reference it is 0.004 below the per-leaf read on Kangyur EAP310 (CI includes 0), 0.118 below on Nyingma EAP310 and 0.147 below on Nyingma EAP105 (Drametse), because a half often loses or invents lines and the halves then cannot be joined. Thirds are worse (−0.26 to −0.44). Downscaling the EAP310 frames to EAP105 size changes nothing (paired median 0.000, CI within ±0.002). The ~0.16 gap between EAP310 and EAP105 Nyingma stays in every arm, so it is the manuscripts or the reference, not the reader's resolution."
status: rejected
decision: "Half-leaf reading is not a route for the manuscript volumes. Frame size does not limit this reader: asking the British Library for larger originals of EAP105 and EAP039 is not worth it on this evidence."
superseded_by: null
feeds: route
defect_rates: "none — scored by syllable identity against printed e-texts (kanjur_align.py), not by judge defect tags; no route was changed, the live per-leaf read is arm A"
issue: [60]
---
## 2026-11-12 · Does reading each Tibetan leaf in halves, or at a smaller frame size, change accuracy? (#60; job tib-halfleaf-60 on gex45)
<!-- PRIOR ART: 2026-10-01-kangyur-ocr-accuracy-confirmatory-redraw-4523.md (the 95 Kangyur pages, scores and scorer this re-reads); scripts/eval/results/tibetan-nyingma-reference-2026-10-01/README.md (the 81 Nyingma pages and the rKTs Gpb reference); 2026-10-26-yigdzin-vllm029-gex45-parity-6871.md (the vLLM 0.29 worker, its environment and the OMP_NUM_THREADS hang). -->

**Reader:** BDRC/tibetan-ocr @ 50506eb6d8ed8738df86b448f6f6cdc688de29ea (Yigdzin v1), production worker `scripts/gpu/yigdzin-vllm/yig_leaf_worker.py` on vLLM 0.29, gex45 RTX PRO 4000. The processor caps an image at 1,003,520 px; the worker also resizes frames wider than 2,400 px.

**Pages:** the 176 pages already scored on 1 October with `bdrc-yigdzin-v1` and retrieval ≥ 0.05 — 95 Kangyur (EAP310, Derge Kangyur e-text), 45 Nyingma EAP310 (Tshamdrak, rKTs Gpb), 36 Nyingma EAP105 (Drametse, 1,536 × 1,024 frames, Gpb). Each stored frame was fetched once and every arm read the same file. Nothing was written to Mongo, R2 or pages.

### Arms
- **A** per-leaf read, as production (`--mode partition`, leaves cut by `leafsplit.py`). **A2** the same, run again: the noise floor.
- **W** whole-frame read (`--mode whole`).
- **B** EAP310 only: frame downscaled to 1,536 × 1,024 (Lanczos, JPEG q85), then as A.
- **C** each leaf of A's cut split into left/right halves with 10% overlap, each half read through the worker's `path` rows, joined line by line with the overlap de-duplicated (`halfjoin.py`, 8 tests). When the halves disagree on line count both texts are kept and the page is counted as a mismatch.
- **C3** thirds. Read in the same card hold although C did not beat A, because it cost minutes; it is reported, not needed for the decision.

### Scoring and controls
`kanjur_align.py` unchanged. **Positive control:** re-scoring the stored 1 October text reproduced 100/100 stored identities with `etext-index-full.pkl` (median 0.947), 19/100 with `etext-index.pkl` — so the full index is the one used, and is used here. Noise control (`--noise 0.05 --n 50`): Derge 0.968, Gpb 0.972, 50/50 hits each. Shuffle control (A text against the wrong page): Derge 0.257, Gpb 0.164. A against the stored 1 October scores: +0.002 median in every group. A2 against A: median 0.000 [0, 0] in every group (A2 differs on a handful of looping leaves).

Paired differences are page-paired medians with a bootstrap 95% interval (resampled pages). **With 36–95 pages per group, a paired difference under about 0.02 cannot be told from zero.**

### Results (median identity to the printed reference)

| Group | n | Arm | median | IQR | ≥ 0.90 | < 0.70 | paired median vs A [95% CI] | pages with fewer / more lines than A |
|---|---|---|---|---|---|---|---|---|
| Kangyur EAP310 | 95 | A | 0.957 | 0.920–0.979 | 77 | 4 | — | — |
| | | A2 | 0.957 | 0.920–0.979 | 79 | 4 | 0.000 [0.000, 0.000] | 2 / 1 |
| | | W | 0.942 | 0.915–0.967 | 74 | 4 | −0.009 [−0.012, −0.006] | 44 / 3 |
| | | B | 0.955 | 0.925–0.979 | 78 | 3 | 0.000 [−0.002, 0.001] | 8 / 0 |
| | | C all | 0.911 | 0.809–0.963 | 50 | 9 | −0.004 [−0.044, 0.001] | 4 / 42 |
| | 52 | C clean | 0.960 | 0.938–0.982 | 48 | 1 | +0.006 [0.003, 0.009] | — |
| | | C3 | 0.666 | 0.524–0.767 | 12 | 51 | −0.260 [−0.292, −0.232] | 0 / 83 |
| Nyingma EAP310 (Tshamdrak) | 45 | A | 0.928 | 0.842–0.958 | 31 | 6 | — | — |
| | | A2 | 0.928 | 0.842–0.958 | 31 | 7 | 0.000 [0.000, 0.000] | 0 / 1 |
| | | W | 0.908 | 0.836–0.956 | 29 | 4 | −0.003 [−0.006, 0.000] | 24 / 1 |
| | | B | 0.931 | 0.844–0.961 | 32 | 6 | 0.000 [−0.000, 0.000] | 4 / 3 |
| | | C all | 0.772 | 0.645–0.936 | 13 | 17 | −0.118 [−0.169, −0.007] | 1 / 25 |
| | 19 | C clean | 0.940 | 0.828–0.968 | 13 | 1 | 0.000 [−0.003, 0.004] | — |
| | | C3 | 0.561 | 0.461–0.694 | 3 | 34 | −0.304 [−0.370, −0.259] | 0 / 40 |
| Nyingma EAP105 (Drametse) | 36 | A | 0.772 | 0.687–0.844 | 4 | 11 | — | — |
| | | A2 | 0.772 | 0.688–0.843 | 4 | 11 | 0.000 [0.000, 0.000] | 0 / 0 |
| | | W | 0.754 | 0.686–0.855 | 5 | 12 | −0.004 [−0.011, −0.002] | 11 / 0 |
| | | C all | 0.644 | 0.515–0.698 | 1 | 27 | −0.147 [−0.199, −0.092] | 0 / 29 |
| | 5 | C clean | 0.807 | 0.744–0.891 | 1 | 1 | −0.008 [−0.028, 0.114] | — |
| | | C3 | 0.348 | 0.282–0.409 | 0 | 36 | −0.441 [−0.485, −0.381] | 0 / 36 |

"C clean" is the pages where the halves agreed on line count (43/95, 26/45 and 31/36 pages were mismatches). It is a selected subset — the easy pages — so its +0.006 on Kangyur is not evidence that halves help; it is under the 0.02 that can be told from zero anyway. C3 mismatched on 83/95, 40/45 and 36/36.

**Pixels the model actually saw** (median width): EAP310 W 1,227, A 1,739 per leaf, B 1,536, C 1,290 per half of a 2,138 px native half (1.35× A's scale), C3 1,100 of 1,425. So B gives the model only 0.88× A's pixels per leaf: production preprocessing already throws most of a large frame away, which is why shrinking it first costs nothing. EAP105: A 1,536 (native), C 845 native per half — halves give a small frame no extra resolution.

**Speed** (loaded box, model load excluded): A 0.57 s/leaf, C 0.53 s/half, C3 0.71 s/third, B 0.81 s/leaf, W 1.06 s/frame.

**W and the 1 October run.** W reads 0.003–0.009 below A and drops lines on about half the pages. Character similarity of the stored 1 October text to A is 0.9928 and to W 0.9951 (W closer on 83 pages, A on 72, tie 21): the stored run cannot be assigned to one mode from its text; its scores sit with A (+0.002).

**Leaf cut.** On 11/140 EAP310 frames `leafsplit.py` cut 3–4 "leaves", the extra ones being the colour chart or ruler strip (by eye on _249). Every arm reads them as Latin-letter junk.

### By eye (n = 12: the 6 pages where C beat A most, and the 6 where it lost most)
- **C better:** _95 Kangyur — A invented 12 extra lines on a 7-line repetitive leaf; the halves did not (A2 gave 8, so this is a looping leaf, not resolution). _292 Drametse — A swapped formula clauses on lines 6–7; in C the line end is read from its own half. _220 — A gave 8 lines on a 7-line leaf. _445, _170, _249 — the gain is less junk on chart/ruler strips, not better reading of text.
- **C worse:** _195, _280, _223 Kangyur — a legible 7-line right half came back as an empty page, and the worker's minimum-token re-decode then forced ~1,600–2,000 syllables of Latin junk; these crops carry much grey background and the colour chart. _367, _152 Drametse — the left half's 7 lines read as 2, line 0 running to 1,140 characters past the cut. _181 Drametse — each half drops a different line, so the join cannot pair them.

The losses are the reader failing on a half-image that no longer looks like a leaf; the gains are mostly loops and strips that a better leaf cut would also fix.

### Answers in the brief's terms
- **C ≥ A by 0.03 with the interval excluding 0, in any group?** No. C is below A in all three groups (significantly in both Nyingma groups). Half-leaf reading is not a candidate route; no full re-read is costed.
- **B within 0.02 of A?** Yes (0.000, interval within ±0.002, on both EAP310 groups). Frame size does not limit this reader; larger British Library originals of EAP105 and EAP039 are not worth asking for on this evidence. Caveat: at production preprocessing a large frame gives the model only 1.13× the pixels of a 1,536 px one, so this measures the reader as deployed, not what a reader without the 1 MP cap could do.
- **Does the EAP105 gap persist?** Yes. EAP310 Nyingma minus EAP105 Nyingma: A 0.156, W 0.154, B (EAP310 at EAP105's frame size) 0.159, C 0.128 (confounded by join failures), C3 0.213. The gap is the manuscripts or the reference, not the reader's resolution.

### Card
Run as gpu-queue tasks `60-tib-halfleaf` (21:30–22:12Z) and `60-tib-halfleaf-r2` (22:15–22:25Z; the first run's A and W read 0 images because of relative crop paths but exited 0 — the task now marks an arm done only when every image has a read). It waited for `zy-ocr-zh-shi-ji-8053-c007` to finish. Nothing was paused: a pending queue task holds the filler by the filler's own rule, and the filler queued `zy-ocr-euro-fr19-6871-c021` at 22:30:07Z. Card at 2 MiB after.

### Files
- Scripts: `scripts/eval/tibetan-half-leaf-60/` (`lookup-pages.mjs`, `prep_arms.py`, `halfjoin.py` + `test_halfjoin.py`, `gpu-task.sh`, `assemble.py`, `score.sh`, `summarize.py`).
- Per-page scores (no text): `scripts/eval/results/tibetan-half-leaf-60/per-page-scores.jsonl`; aggregates `summary.json`.
- Frames, reads and alignments: `/root/jobs/tib-halfleaf-60/` on gex45 (scratch; archived to R2 after 7 idle days). The 6.9 GB of lossless crops were deleted after scoring.
