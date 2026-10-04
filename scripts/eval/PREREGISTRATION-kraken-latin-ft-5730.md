# Preregistration — Kraken fine-tuned on our corrected early-print pages vs flash-lite, Latin 1500–1699 (#5730)

Written 2026-10-04 by Hetzner job `kraken-latin-ft-5730`, **before any training run and before any fine-tuned output
exists**. Derek, 2026-10-04: "start the kraken fine-tune on our corrected latin pages". Cap: **$10** (RunPod GPU +
any Gemini), whatever the epoch.

**Question.** Does a Kraken model fine-tuned on our own pages read Latin print of 1500–1699 better than production
`gemini-3.1-flash-lite`? If yes, it is a candidate free CPU lane for the Latin backlog. **No routing change follows
from this run**; that is a separate decision.

## Sealed test set (fixed now)

The `latin-1500-1699` cell of the #5660 bake-off as extended by its Amendment 2 (`results/open-engine-print-5660/cells-r3.json`,
job `ocr-bakeoff-5660c`, commit f386840a3): **61 pages, one per book** — 40 library pages (EEBO-TCP same-edition
references on our `bim_` EEBO-microfilm scans: 15 from `eebo-tcp-5488`, 25 from `eebo-tcp-latin-5660`) and 21
Wikisource-la pages (external scans, `ref-ws`). The slug list is copied to
`results/kraken-ft-5730/test-set.json`. Same JPEGs, same references, same scorer as every #5660 arm.

**Exclusion (no leakage).** No page of any book in any of these enters training: every registry in
`scripts/eval/benchmark/*.json`, every `ed-*` reference (this repo and the bake-off's worktree), the bake-off's
candidate and chosen lists, and every book in `cells.json` / `cells-r3.json` — **1,535 books**. A training book that
shares a TCP text with an excluded book is also dropped. The list is `results/kraken-ft-5730/exclusions.json`.

Grade: 40 library pages < 50 → **directional** under the #4925 rule, whatever the result.

## Training data (counted by source; nothing else enters)

| source | what | books | pages offered |
|---|---|---|---|
| human-corrected pages (`page_revisions` `source: manual`, `pages.ocr.source` manual, `ocr.edited_by`) | Latin 1500–1699 | see results (the whole library holds **12** `manual` OCR revisions) | ≈ 0 |
| EEBO-TCP (CC0) keyed text on the **same EEBO microfilm** as our `bim_` scans — catalogued Latin | Morison *Plantarum historiae* 1680 (Latin), Comenius *Orbis pictus* 1659 (Latin/English facing), Playford *Briefe Introduction to the Skill of Musick* 1654 (catalogued Latin, actually English) | 3 | 1,169 (all pages) |
| EEBO-TCP — English 1587–1698 (same printers, type and long s) | 41 books | 41 | 2,935 (≤ 80 per book, seeded) |
| CAMENA / Wikisource | not used: Wikisource-la folds ſ → s, which would label the same glyph two ways | 0 | 0 |

**Why English is in a Latin model, said up front.** After the exclusions, only three Latin books we hold have a
verified keyed transcription of the same edition. A TCP match is verified, not assumed: our stored read of up to 40
pages per book must reach character-trigram similarity ≥ 0.5 with some TCP page on at least half of them (median ≥
0.5). 64 title/author/year candidates → **44 verified**; the 20 rejected include the English translation of a Latin
book (*Antiprognosticon*), Ockham's *Summa logicae* matched to a *Summa theologiae*, and an English *Lac puerorum*.
Kraken reads glyphs: the roman and italic type, the ſ / f pair, ligatures and abbreviation marks are shared between
English and Latin print of the period, and the test's 40 library pages come from the same microfilm. So the
**Wikisource subset (21 pages, not EEBO microfilm, not TCP convention) is reported separately** as the check that a
gain is reading, not imaging- or convention-matching.

**Lines.** Each training page is segmented by Kraken's default `blla` and read by CATMuS-Print; the read is matched
to its TCP page side (or a pair of sides) by trigram Dice ≥ 0.55; the read and the side text are aligned globally
(edlib) and each line's span is mapped to its TCP span. A line is kept if its folded CER against the CATMuS read is
≤ 0.30, it has ≥ 4 letters, no TCP `<gap>`, and a length ratio in [0.6, 1.6]; a page enters only if ≥ 50 % of its
lines are kept. Drop counts are reported per reason. (`kraken-ft-5730/align_lines.py`.)

**Normalisation rule (the TRUTH).** TCP characters as keyed — **ſ kept**, abbreviation strokes (combining macron),
ꝰ, ę, &, æ kept; `char:EOLhyphen` → `-` at the line end; whitespace collapsed; Unicode **NFD** (the base model's
codec is NFD). New code points are added to the codec (`--resize union`). Images: width ≤ 2,400 px, JPEG q92 (the
`benchmark-seal.mjs` rule, so training and test images share a resolution).

## Arms

1. `gemini-3.1-flash-lite` — production; the existing #5660 outputs (generic prompt, thinking 0, temperature 0).
2. `kraken-catmus` — Kraken 7.1, `blla` + `catmus-print-fondue-large` (CATMuS-Print), unchanged.
3. `kraken-ft-5730` — CATMuS-Print fine-tuned: `ketos train -i catmus… --resize union -u NFD -B 16 -r 1e-4
   --warmup 500 --augment -q early --lag 5 --min-epochs 3 -N 30`, seed 5730, validation = 5 % of training pages
   (seeded; training books only). The checkpoint with the best validation accuracy is the arm.

Arms 2 and 3 read the **same `blla` lines** (one segmentation per test page, then two recognisers), on one RunPod
SECURE GPU. Speed per page is measured separately on Hetzner CPU (`nice`, the shared box) for both Kraken arms on 10
test pages, segmentation included.

## Scoring and decision rule

Scored by `benchmark-score.mjs` exactly as #5660 (whole-page CER for the EEBO strata, the passage aligner for
`ref-ws`); paired per page against lite. The text a Kraken arm submits is its lines in `blla` order.

- Δ = CER(ft) − CER(lite) per page; median Δ with a seeded bootstrap 95 % CI (5,000 resamples), sign test.
- **beats lite** ⇔ CI-upper(median Δ) < 0 ∧ sign test p < 0.05 ∧ catastrophic(ft) ≤ catastrophic(lite)
- **loses to lite** ⇔ CI-lower(median Δ) > 0
- **ties** otherwise.
- The same rule for ft vs `kraken-catmus` (does the fine-tune help Kraken at all).
- Also, each arm through the #5660 rule (`benchmark-cost-lane.mjs --cells`, unchanged) for comparability.

Reported per arm: CER (median, mean), catastrophic (CER > 0.5), on all 61 and separately on the 40 library and 21
Wikisource pages; a **convention-folded** CER (diacritics and combining marks removed, ſ→s, u/v and i/j folded,
`¬`→`-`) as the check that a gain is not abbreviation-convention matching; the long-s (ſ→f) misread tally and the
abbreviation-mark tally (`open-engine-print-5660.mjs tally`); s/page on Hetzner CPU.

## Stops

- Spend: the pod's name carries a deadline (`sl-5600-kraken5730-…-until-<UTC>`) under the live RunPod watchdog;
  deadline = what $9 buys at the pod's hourly price, less the time already spent. At the deadline the pod is
  terminated whatever the epoch, and the best checkpoint pulled before then is the arm.
- If fewer than 20,000 training lines survive alignment, the run continues but the result is labelled
  *small-data*.
- Training never sees a test book; a leak found after the fact voids the run.

## Amendment 1 — training pages capped lower (2026-10-04 02:25Z, before any training step)

On the pod, `blla` + CATMuS reading is CPU-bound (Kraken's CLI is single-threaded; the A40 pod's CPU quota is 7.65
cores): ≈ 16 s per page per process, so the 4,104 offered pages would take ≈ 3 h of reading alone. The English cap
drops from 80 to **20 pages per book** (a second seeded draw from the 80, seed `5730b-<book>`); the three catalogued
Latin books stay whole. Offered pages: **1,989** (1,169 catalogued Latin + 820 English, 44 books). Readers per pod: 7.
Nothing else changes. The images and stored reads of the 2,115 pages dropped are not used.

Also recorded: the image host returns Cloudflare error 1010 to Python's default User-Agent; the fetch sends
`SourceLibrary-eval/1.0 (kraken fine-tune #5730)`.
