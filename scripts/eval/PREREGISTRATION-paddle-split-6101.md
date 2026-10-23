# Preregistration — PaddleOCR-VL on split leaves, Chinese/Japanese woodblock print (#6101 follow-up)

PRIOR ART: `scripts/eval/PREREGISTRATION-chinese-print-cbeta-6101.md` (the sealed 200, the reference, the scorer and
the stats, all reused unchanged here); `scripts/eval/experiments/2026-10-07-chinese-print-against-cbeta-6101.md` (the
result this follows up). Neither tests split leaves.

Committed on `eval/paddle-split-6101` on 2026-10-22, **before any split leaf was read on the GPU**.

**Question.** On the 198 shared pages of #6101 (PR #6139), PaddleOCR-VL 1.6 lost to Flash-Lite and Flash (median CER
0.128 vs 0.068 / 0.052; catastrophic 14.6 % vs 1.5 % / 0 %). With NDL's label strip removed it tied lite on characters
(0.067 vs 0.067), and its failures were page-level: the left leaf read first, the label read instead of the page, 90 s
timeouts, one leaf dropped. If each spread is cropped above NDL's label strip and split at the gutter, and the right
leaf is read before the left (vertical right-to-left order), does Paddle read woodblock print as well as lite, or as
well as Flash?

**Pages.** The same 198 pages of the sealed 200 (`chinese-print-cbeta`, Mulberry32(6101), 54 print books) on which
Paddle, lite and Flash all answered in #6101: 172 woodblock, 26 movable type. The two excluded pages stay excluded
(`5595ab-p45` reference misfit; one Flash RECITATION refusal). Same JPEGs (≤ 2,400 px wide).

**Arms** (all on the same 198 pages):

| arm | what | source |
|---|---|---|
| P0 | Paddle on the whole spread, as run in #6101 (default pipeline, layout detection on) | stored, `bench/…/paddleocr-vl-1.6` |
| L | Gemini 3.1 Flash-Lite, as run in #6101 | stored |
| F | Gemini 3 Flash (preview), as run in #6101 | stored |
| **P1** | Paddle on split leaves: crop above NDL's label strip, split at the gutter, read the RIGHT leaf then the LEFT, concatenate. `use_layout_detection=False` (each leaf goes to the VLM whole). | new, gex45 |
| P2 | P1 with layout detection on (the default pipeline, the P0 setting). Secondary arm. | new, gex45 |

No new Gemini calls. Paddle stack on gex45 `/root/pz` (paddleocr 3.7.0 / paddlepaddle-gpu 3.2.1, #5547), runner
`scripts/gpu/paddle-zh-run.py` (native backend, one runner), page timeout 90 s **per leaf**.

**Image preparation (CPU, before the GPU).**
- **Label strip:** NDL photographs every volume over a ruler with the library's label strip below it. The crop line is
  DETECTED per image (the top of the full-width ruler band: rows where both outer image edges turn from grey background
  to light ruler), not set as a fixed fraction. Everything below it is dropped. A page where the ruler is not found is
  left uncropped and counted.
- **Split:** `scripts/lib/gutter-detect.mjs` `detectGutterPixel()` on the cropped spread (the detector `split-book.mjs`
  uses), with `split-book.mjs`'s 3 % overlap on each leaf. A low-confidence or missing gutter falls back to the
  detected gap centre if there is one, else the image centre, and is counted.
- **Check by eye before any read:** 10 split pairs, chosen at random (seed 6101), opened and looked at for a cut column
  of text or a leaf that still carries part of the facing leaf. Recorded in the experiment file. If any cut column is
  found, the split is fixed and re-checked before the read.

**Scoring.** `benchmark-score.mjs`, unchanged, Han only, on the same references, after the #6101 `nolabel` filter
(lines matching 国立国会図書館 / 國立國會圖書館 / 請求記号 / ガラス使用 removed) applied to **every** arm's output — the
label-stripped scoring of #6101, so P0, L and F carry the numbers already published as the sensitivity table. A leaf
that times out or errors contributes empty text; a page whose two leaves are both empty scores CER 1.0.

**Measures**, per arm: median CER with a book-cluster bootstrap 95 % CI (2,000 resamples, seed 6101); catastrophic rate
(CER > 0.5) with a Wilson CI; paired median ΔCER vs L and vs F with book-cluster CIs, W/L/T; invention_ref median;
loops; timeouts; s/leaf (recognition wall time, one runner, RTX PRO 4000 Blackwell). By class: woodblock (n = 172) and
movable type (n = 26).

**Bar (P1; the decision).**
- **Adopt-grade for print** if BOTH hold:
  1. P1's catastrophic rate ≤ L's + 2 percentage points (L is 3/198 = 1.5 %, so P1 ≤ 3.5 %, i.e. ≤ 7 of 198 pages), and
  2. the paired median Δ(P1 − L) has its 95 % upper bound ≤ +0.010.
- **Better reader than Flash** only if the paired median Δ(P1 − F) has its 95 % upper bound < 0.
- Otherwise P1 fails. P2 is reported against the same bar but does not decide anything on its own; if P2 passes and
  P1 fails, that is reported as a lead for a new preregistration, not as an adoption.
- The bar is on all 198 pages. The woodblock-only figures (n = 172) are reported beside it; the frame this serves is
  woodblock, so a pass overall that fails on woodblock alone is reported as a fail for woodblock.

**Descriptive (NOT preregistered as a test).** The Paddle failures from #6101's every-page pass (CER > 0.5, misfit,
timeout, or < 30 characters on a text page; ≈ 285 woodblock pages) are re-read with P1. Each is classed by its P0
failure kind (spread order: CER > 0.5 at length ratio 0.8–1.25; label-only/empty; timeout; one leaf dropped: length
ratio 0.3–0.7; other) and the count each kind P1 fixes (CER ≤ 0.5) is reported. With one engine on those pages, a
P1 fail can also be a reference misfit; that is said beside the numbers.

**If P1 passes.** P1 reads the other woodblock pages of the frame (≈ 1,883 read by Paddle in #6101 minus the shared set)
for a full-frame failure rate with a Wilson CI, and the GPU-days for the non-Siku Chinese/Japanese print frame are
projected from the measured s/leaf. Nothing is written to `pages` or `books`; routing is Derek's decision (#6688).

**Licence.** CBETA (CC BY-NC-SA 4.0) and every engine's output stay on Hetzner. Only scores, counts and hashes are
committed, after the same 12-character n-gram leak scan as #6101.

**Spend.** $0: the flat-rate GEX45 and stored Gemini outputs. The GPU run takes `flock /root/gpu.lock`; the Tibetan
read (#6871 row 4) is paused between its resumable chunks and re-queued afterwards.
