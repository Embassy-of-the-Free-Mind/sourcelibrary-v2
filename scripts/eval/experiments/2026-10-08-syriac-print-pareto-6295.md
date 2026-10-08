## 2026-10-08 · Printed Syriac on the Pareto page: which reader, and is the Kraken text good enough to translate from? (#6295) — directional; translations stay withheld

PRIOR ART: `2026-09-16-syriac-retest-do-the-beth-mardutho-kraken-models-read-4746.md` (Kraken models on two
manuscripts' line ground truth; no print, no translation), `scripts/eval/pareto-6182/` (translation arms, two
blind Opus judges, PLANT + DUP gate, A-vs-A floor; references were published English translations). This run adds
a printed-Syriac reference set and a translate-from-OCR arm. Preregistration:
`scripts/eval/PREREGISTRATION-syriac-pareto-6295.md` (and its 2026-10-08 amendment for the spend rule).

**Question.** Two decisions wait on it (#6295): (1) re-translate the Kraken-read Syriac pages (≈ $45, not
approved) or keep their English withheld; (2) where to spend on Syriac OCR: a column splitter, a Kraken
fine-tune (#5730), or nothing.

**Design.** 24 printed Syriac books we hold have a Digital Syriac Corpus e-text (srophe/syriac-corpus, CC BY 4.0):
one page per book, sealed (seed 6295) before any arm ran. 4 of the 24 have no e-text window (their passage is not in
the corpus: two Jacob of Sarug volumes, Patrologia Syriaca I.2 copy B, Bar Hebraeus vol. 1) and are reported, not
scored. **20 pages, 20 books, 18 editions** (14 same edition as the e-text, 6 another edition). Every result is
**directional** (under 30 books); intervals resample editions (2,000 draws). The reference window is voted across
arms (every arm whose fitted span has word error < 0.5), never cut by one engine.
OCR measure: consonantal CER (`syriac-pareto-6295/syriac-cer.mjs`; vowel points, seyame and Syriac punctuation
folded, a Latin column ignored; fixtures `scripts/eval/fixtures/syriac/`, `tests/unit/syriac-cer.test.ts` 15/15
passing before any score). Accuracy = 1 − median CER.

**Selection bias, read this first.** A page was eligible only if its Kraken lane read already shared ≥ 8 word
bigrams and ≥ 20 % of its bigrams with the e-text. Pages Kraken reads badly are less likely to be drawn, so Kraken's
figures are an upper bound for the lane, and Gemini's are measured on pages chosen by Kraken.

### Step 1 — OCR (20 pages)

| engine | median CER [95%] | accuracy | pages ≤ 10 % CER | pages ≥ 50 % | cost per 1,000 pages |
|---|---|---|---|---|---|
| Kraken OmniSyr, lane (gutter split) — **in use** | 0.130 [0.076, 0.168] | 87 % | 7 | 0 | $0.11 (CPU) |
| Kraken OmniSyr, no split | 0.140 [0.076, 0.176] | 86 % | 7 | 0 | $0.11 (CPU) |
| Kraken Qoruyo Eastern | 0.140 [0.108, 0.222] | 86 % | 5 | 0 | $0.11 (CPU) |
| Kraken Qoruyo Estrangela | 0.156 [0.078, 0.213] | 84 % | 7 | 0 | $0.11 (CPU) |
| Kraken Sophro Mhiro | 0.193 [0.090, 0.398] | 81 % | 6 | 4 | $0.11 (CPU) |
| Gemini 3.1 Flash-Lite, fresh read (Batch) | 0.683 [0.626, 0.711] | 32 % | 0 | 20 | $1.28 (metered, all scripts) |
| MinerU 3.4 pipeline (CPU) | 1.000 [1, 1] | 0 % | 0 | 20 | $0.38 (CPU) |

- The served lane text scores identically to the OmniSyr re-run on every page.
- **Stored Gemini reads** (each page's read before the Kraken lane, never regenerated): Gemini 3 Flash on 9 pages,
  median CER 0.474 [0.342, 0.667], against 0.114 for the lane on the same pages; Gemini 3.1 Flash-Lite on 9 pages,
  1.000 [0.609, 1], against 0.167. Lite's fresh read writes fluent-looking Syriac built from a few stock words
  (ܟܠܗܘܢ ܟܠܗ repeated): invention, not misreading. Its A-vs-A: 0 of 20 pages identical, median difference 5.3 points.
- MinerU returns no Syriac at all (its OCR model has no Syriac script).
- **Column-splitter rule** (CI of the paired median difference must exclude 0): **no difference shown**, median
  0 [0, 0]. The gutter cut fired on 5 of the 20 scored pages and changed the score on 4: better on 3 (Aphrahat
  two-column pages, 0.22 → 0.12 and 0.19 → 0.17; Odes 0.18 → 0.17), worse on 1 (0.16 → 0.17). The lane already splits, so there is
  nothing to buy here.
- **OCR lever rule**: OmniSyr is best; every Kraken model's interval overlaps it, and no arm reaches a median CER
  ≤ 0.10, so the rule recommends **a Kraken fine-tune** (#5730), not a new engine and not a splitter.
- **Cost.** Kraken (any of the four models) **$0.11 per 1,000 pages**: 60.7 s a page at 2 threads on this box (a
  16-core Hetzner cax41, about €32 a month), CPU time only, measured 2026-10-08 with the box under other load.
  MinerU **$0.38 per 1,000 pages**: 641 s for 24 pages, priced at the whole box. Lite's fresh read on these pages
  billed $2.08 and $2.59 per 1,000 at Batch (dense Syriac output); the chart uses the all-script metered rate.

### Step 2 — translation (gemini-3.1-flash-lite, the production translator for Syriac)

Each page translated four times with the production one-page request (pinned v13, Batch, thinking budget 0, 0
thinking tokens billed): **R**, R′ = the e-text window twice; **K**, K′ = the served Kraken text twice. Two blind
Opus judges (`claude -p --model opus`, subscription), one item per page with the four drafts shuffled, scored
against the Syriac e-text (no published English exists for most of these pages; the judges read Syriac).
**Judge gate: PASS** — J1 and J2 each caught 8/8 planted reversals and tied 4/4 duplicates; the two judges'
fidelity scores agree within 1 point on 100 % of page × draft pairs.

| draft | fidelity 1–5 [95%] | share ≥ 4 | pages with a reversed statement | omission pages | invention pages | cost per 1,000 pages |
|---|---|---|---|---|---|---|
| from the e-text (R) | 4.33 [4.11, 4.53] | 95 % | 5 / 20 | 4 | 3 | $0.74 |
| from the e-text again (R′) | 4.40 [4.17, 4.62] | 90 % | 2 / 20 | 3 | 4 | $0.74 |
| **from the Kraken text (K) — what production would translate** | **3.00 [2.68, 3.30]** | 20 % | 12 / 20 | 19 | 17 | $0.79 |
| from the Kraken text again (K′) | 2.90 [2.60, 3.20] | 15 % | 11 / 20 | 19 | 18 | $0.80 |

- **Noise floor** (R′ − R): +0.075 [−0.109, +0.275], so f = 0.275.
- **K − R: −1.33 [−1.66, −0.97]**; K′ − R′: −1.50 [−1.84, −1.17]. The lower bound is far below −f, and K has
  12 reversal pages against R's 5 (> 5 + 2). Both conditions of the rule fail.

**Verdict (the issue's preregistered rule).** Kraken-text translations are **outside the noise floor**: keep the
Kraken-read translations withheld, and do not spend the ≈ $45 re-translation on today's Kraken text. The OCR lever
Step 1 favours is a **Kraken fine-tune** (#5730): the lane reads about 87 % of consonants right, and on the same
pages that costs 1.3 points of fidelity and more than doubles the pages with a reversed statement. A splitter buys
nothing measurable; Gemini Flash-Lite and MinerU are not readers of Syriac.

**Not run here** (spend rule of 2026-10-08: only `gemini-3.1-flash-lite` on the paid API; no GPU rental):
Gemini 3.8 / 3.7 / 3.5-Lite / 3 Flash, OCR and translation — CLI arms, pending (export on the box,
`/mnt/HC_Volume_105839809/jobs/syriac-pareto-6295/cli-export/`); PaddleOCR-VL and GLM-OCR (no stored Syriac read,
no GPU). Two `gemini-3.8-flash` OCR Batch jobs a previous run of this job had submitted before the rule were
cancelled while still RUNNING, and none of their output was used.

**Limits.** 20 books, directional. AI judges, not a human Syriacist; they judge against the Syriac and may misread
it the same way for every draft, which the R′ − R floor and the plants partly check. The draw leans towards
pages Kraken reads (above). The 6 other-edition pages carry textual variants against every engine equally.

**Spend.** Metered $0.173 (OCR $0.112, translation $0.061), all `gemini-3.1-flash-lite` Batch; the cancelled
3.8-flash jobs' billing, if any, is under their $0.39 estimate. Kraken and MinerU on Hetzner CPU; judges on the
subscription. No page written, no routing changed.

**Replicated?** No.

**Artifacts.** `scripts/eval/results/syriac-pareto-6295/` (`ocr-score.json`, `ocr-summary.json`,
`translation-summary.json`, judge keys; numbers only, no e-text), `scripts/eval/syriac-pareto-6295/` (scorer, window
vote, units, packet, judge prompt and runner). The e-text windows, drafts and judge packets stay on the box
(`/mnt/HC_Volume_105839809/jobs/syriac-pareto-6295/`).
