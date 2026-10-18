---
stage: ocr
measure: agreement
languages: [la]
scripts: [Latn]
canons: []
n_books: 99
n_pages: 99
verdict: "Under the preregistered bar, GLM-OCR earns the 1500s (median CER 3.1% vs flash-lite 5.6%, paired Δ −1.1 points, CI −2.9 to −0.3) and no open engine earns the 1600s. The whole margin is flash-lite writing ſ as f. With f folded to s (post hoc), lite reads 0.7% / 1.4% and beats every open engine in both centuries by 1–5 points. By eye, lite read the letters better on all 12 pages checked. Gemini 3.8 Flash (agy) is best overall: 0.6% / 1.4%."
status: undecided
decision: "Recommended: no standing Latin lane on the GEX45. Fix ſ on the Gemini side instead (3.8 Flash, or lite plus a long-s pass). The preregistered rule names GLM-OCR for the 1500s; Derek decides (DECISION on #5924). MinerU2.5-Pro and olmOCR-2 are queued behind Mongolian (gpu-queue 20-latin-mineru-olmocr)"
superseded_by: null
issue: [5924, 6871, 5660]
---
PRIOR ART: `PREREGISTRATION-open-engine-print-5660.md` Amendment 4 (this run's preregistration, commit 2ebde6a21, pushed before any arm read these pages; the harness and scorer followed in 460a01e26, before any output was scored). `2026-10-06-latin-print-r4-by-book-5924.md` (round 4: e-text references, no gothic; it found that long-s is lite's whole gap). `scripts/eval/latin-refs-5924/` (the 99 Opus leaf references this scores against). `2026-10-18-gex45-capability-card-6871.md` and `2026-10-18-zh-residue-bakeoff-6871.md` (the engine installs, serve flags and harness, reused).

## 2026-10-18 · Does an open engine on the GEX45 read Latin print better than flash-lite, century by century? (#5924, #6871 row 2)

**By the preregistered rule: yes for the 1500s (GLM-OCR), no for the 1600s. The win, though, is flash-lite's ſ → f habit,
not better reading.** Set that habit aside and lite beats every open engine in both centuries. A long-s fix on the
Gemini side gets more than the box would, and it costs nothing in GPU-days.

**Design (Amendment 4, unchanged).**
- **Pages.** 99 Latin leaves, one per book, drawn at random from our holdings: 59 from the 1600s and 40 from the 1500s.
- **References.** Three Opus reads per leaf (PR #6883).
- **Images.** Every arm read the same image: the `pages.photo` leaf, its sha256 matched to the sidecar on all 99 pages.
  Leaves with a long side over 2,400 px were downscaled once (38 pages), and `inputs.json` holds both hashes.
- **Primary view N.** latin-norm@1 (abbreviations right whether kept or expanded), then ſ→s, v→u, j→i, letters only.
  **f stays f**, so an ſ written as f is an error.
- **Order tolerance.** Engine lines are re-placed at the reference offset of their 6-grams before the CER, so the position
  of a side-note is not counted.
- **Statistics.** Per century, the median page CER with a paired bootstrap CI against lite (10,000 resamples, seed 5924).
- **Noise floor.** The median |L1a − L1b| over two lite reads at temperature 1.
- **Bar.** All three must hold: the CI lies below 0; |Δ| exceeds the noise floor; catastrophic pages (CER > 0.5, or a loop)
  number no more than lite's + 1.

### Results, view N (preregistered). Median page CER % (95% CI); Δ = arm − lite, in points

| arm | 1600s (n = 59) | Δ vs lite (CI), W/L | cat. | 1500s (n = 40) | Δ vs lite (CI), W/L | cat. | bar 1600s / 1500s |
|---|---|---|---|---|---|---|---|
| **L** gemini-3.1-flash-lite, T 0 (paid) | 4.2 (3.4–4.6) | — | 0 | 5.6 (4.8–6.2) | — | 0 | — |
| F Gemini 3.8 Flash low, agy (not a box lane) | **0.6** (0.2–0.8) | −3.2 (−3.9, −2.6), 52/6 | 0 | **1.4** (0.5–2.5) | −4.0 (−4.6, −2.0), 34/5 | 2 (filter blocks) | pass / fails crit. 3 |
| K Kraken 7.1 + CATMuS-Print (CPU) | 2.5 (1.4–3.9) | −1.4 (−2.5, +1.1), 32/27 | 1 | 4.3 (2.8–7.4) | −0.1 (−1.6, +0.9), 20/19 | 0 | no / no |
| G GLM-OCR 0.9B | 2.8 (2.2–3.4) | −1.1 (−1.9, +0.2), 34/24 | 4 (3 loops) | **3.1** (2.5–5.2) | **−1.1 (−2.9, −0.3), 27/13** | 1 | no / **PASS** |
| P1 PaddleOCR-VL-1.6, layout on | 7.8 (6.9–8.6) | +3.2 (+2.4, +5.1), 5/53 | 1 | 8.4 (7.5–10.7) | +3.0 (+1.9, +4.8), 5/35 | 1 | no / no |
| P0 PaddleOCR-VL-1.6, layout off (fleet recipe) | 8.5 (7.2–10.2) | +4.3 (+3.0, +5.9), 2/57 | 5 | 10.8 (8.8–13.3) | +5.1 (+4.4, +6.5), 2/38 | 3 | no / no |
| M MinerU2.5-Pro, O olmOCR-2 FP8 | queued | | | queued | | | |
| noise floor (median \|L1a − L1b\|) | 0.22 | | | 0.27 | | | |

The preregistered verdict, as the rule reads: **1500s → GLM-OCR; 1600s → none.** MinerU and olmOCR could still change the
1500s name, but only if one of them passes with a lower median.

### Where the margin comes from

**Long s.** Each cell is the count of the reference's ſ that the engine read as `f` / as `s` / kept as `ſ`. The references
hold 3,983 ſ (1600s) and 3,229 (1500s).

| arm | 1600s ſ→f / ſ→s / ſ | 1500s ſ→f / ſ→s / ſ |
|---|---|---|
| L lite | **2,566** / 1,060 / 287 | **2,285** / 729 / 125 |
| F 3.8 Flash | 119 / 1,563 / 2,269 | 98 / 1,591 / 1,387 |
| K Kraken CATMuS | 61 / 3,643 / 0 | 58 / 2,997 / 0 |
| G GLM-OCR | 255 / 3,191 / 0 | 253 / 2,676 / 0 |
| P0 / P1 Paddle | 2,423 / 288 / 0 · 2,605 / 487 / 0 | 1,565 / 422 / 0 · 1,901 / 652 / 0 |

**Post hoc (not preregistered; added after the by-eye read): view N with f → s folded on both sides,** so an ſ written as
f stops counting (`score.mjs --fold-f`).

| arm | 1600s | Δ vs lite (CI), W/L | 1500s | Δ vs lite (CI), W/L |
|---|---|---|---|---|
| L lite | **0.7** (0.2–0.9) | — | **1.4** (0.9–2.6) | — |
| F 3.8 Flash | 0.4 | −0.1 (−0.2, +0.1), 32/22 | 1.1 | −0.4 (−0.5, −0.2), 27/9 |
| K Kraken | 2.3 | **+1.2** (+0.9, +2.0), 6/51 | 4.3 | **+1.6** (+0.9, +3.2), 7/33 |
| G GLM-OCR | 2.4 | **+1.4** (+1.0, +2.1), 5/52 | 2.9 | **+0.9** (+0.6, +1.8), 8/31 |
| P1 / P0 Paddle | 4.5 / 4.7 | +3.2 / +3.7 | 5.2 / 8.0 | +3.6 / +4.8 |

- **Diplomatic view D** (preregistered, secondary; nothing folded) also puts lite ahead of every open engine in both centuries.
  Medians: 1600s L 5.1, K 7.5, G 7.5, P1 9.3, F 3.3; 1500s L 6.0, G 8.0, K 8.1, P1 10.2, F 4.7. The open engines never
  output ſ at all.
- **By eye** (`read-from-image`, two Opus subagents, 6 pages each: the 3 largest wins and 3 largest losses of the best open
  arm per century against lite, `byeye-pages.json`):
  - **GLM-OCR, 1500s.** Lite read the letters better on all 6 pages. GLM's three wins come from lite writing ſ as f
    (p288, p58), plus about 25–30 truncated line-starts that lite copied from the facing page's edge strip (p288, p8). GLM's
    three losses are real:
    - a 12 KB loop on Greek (p67);
    - the first five lines of a gothic page dropped, with repeated lines (p29);
    - a dropped running head and garbled Greek (p26).
  - **Kraken, 1600s.** One real win (p30, lite ſ→f on clean roman). Two more "wins" are the ſ penalty alone; on everything
    else lite is as good or better (p478, p406). The three losses are Kraken's segmentation:
    - two-column pages read across both columns line by line (p945, p263);
    - side-notes merged into body lines and garbled dense italic (p353).
  - **The references.** The readers found one reference slip (`Anil-` for printed `Amil-`), one silent misprint correction
    (`domicilia` for printed `domiclia`), one stray numeric line, and one doubtful `nihil`/`nibil`. That is about 1 slip per
    3 pages checked, small next to the gaps above.

### Throughput on the GEX45 and the cost of the backlog

Rates are this run's, measured on the 99 pages with the model loaded, alone on the card at util 0.6, 16 clients (8 Paddle
runners). Backlog sizes are #5924's: 1500s 2.21M pages, 1600s 2.81M, the whole Latin queue 7.5M. One GPU-day = 24 h of
the card.

| arm | pages/h | peak VRAM | 1500s | 1600s | all Latin 7.5M | card's rate (100-page mix) |
|---|---:|---:|---:|---:|---:|---:|
| P0 Paddle, layout off | 4,041 | 9,448 MiB | 23 d | 29 d | 77 d | 3,715 |
| P1 Paddle, layout on | 4,178 | 16,940 MiB | 22 d | 28 d | 75 d | 3,163 |
| G GLM-OCR (5 of 99 pages ran to the 6,000-token cap) | 1,734 | 16,468 MiB | **53 d** | 68 d | 180 d | 1,462 |
| K Kraken CATMuS, CPU (10 processes × 2 threads, i5-13500; GPU idle) | 1,517 | — | 61 box-days | 77 | 206 | — |
| F 3.8 Flash via agy (2 parallel, subscription quota) | 225 | — | 409 days of calls | 520 | 1,389 | — |
| L lite, synchronous API | — | — | $3.1K (Batch ≈ half) | $4.0K | $10.6K | — |

Lite cost as measured: 1,120 input and 758 output tokens per page, so **$1.42 per 1,000 pages** synchronous and about $0.71 on
Batch. The box is $8.18 per day whatever it does, so a 1500s GLM lane would be about 53 days of it.

### What this does not show
- **References are model-made** (Opus ×3, no human check), so "accuracy" here is agreement with Opus. Correlated misreadings
  survive, and the gaps between the top arms (F vs lite after the fold, under 0.5 points) are inside the reference noise.
- **Little gothic:** 4 of the 40 1500s pages are blackletter, and none in the 1600s. The backlog is about 30% gothic by eye
  (round 4), and on the one gothic page read by eye GLM dropped a block. The 1500s verdict does not carry over to
  blackletter.
- **Prompts.** Lite and Flash ran the generic transcription prompt of rounds 1–4, not production's prompt. Production lite's
  ſ habit may differ, but round 4 and #5521 found the same habit.
- **Not run:**
  - **Kraken-ft (#5730).** The model lives only on the main Hetzner box, which neither gex45 nor this job's host can
    reach. #5730 found it ties stock CATMuS off EEBO film.
  - **MinerU and olmOCR.** Queued behind Mongolian, which has GPU priority (Derek, 2026-10-18).
- **Catastrophic counts include filter blocks.** F lost 2 pages to Gemini's filter: one blocked outright, one cut mid-page.

*Replicated?* No. L1a/L1b is a noise floor, not a replication.

*Spend:* gemini-3.1-flash-lite, 3 × 99 page reads: 332,517 input + 225,329 output tokens = **$0.42** (logged through
`gemini-script-client.mjs`). agy $0 (subscription). GPU: the owned box. Opus by-eye: subscription.

*Artifacts:* `scripts/eval/latin-bakeoff-5924/`:
- `reads/*.jsonl.gz`: every arm's full text, with each arm's run record.
- `inputs.json`: the hashes of the fed images.
- `results-7arms.json.gz`: `node score.mjs <reads>`, every per-page score.
- `results-7arms-posthoc-fold-f.json.gz`: the same with `--fold-f`.
- `byeye-pages.json`: the 12 pages read by eye.
- The harness: `prep.py`, `read.py`, `drive.sh`, `kraken-arm.sh`, `gemini-arm.mjs`, `queue-task.sh`.
- `backlog-manifest.mjs`, `fetch-chunk.py` and `backlog-task.sh`: the 1500s backlog read, **prepared, not queued**, as
  Derek's inbox note asked. It writes only files, staged on gex45 at `/root/jobs/latin-bakeoff-5924/staged/21-latin-1500s.sh`.

No writes to `pages`, `books` or any production store.
