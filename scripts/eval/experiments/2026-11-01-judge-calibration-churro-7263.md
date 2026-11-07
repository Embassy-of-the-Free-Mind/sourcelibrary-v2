---
stage: ocr
measure: [judged_vs_reference]
languages: [la, de, fr, en, it, grc]
scripts: [Latn, Grek]
canons: []
n_books: 140
n_pages: 140
verdict: "Against CHURRO-DS human transcriptions (140 pages, one per source document, 7 strata, 384 Opus verdicts), the route judge never accepts text at 3% CER or worse (0/91 planted; 16/16 wrong-page controls; 19/20 repeats agree), and it accepts half the time at 1.0% order-free CER (95% CI 0.7 to 1.4), which is the router's 1% bar. At that bar: print sensitivity 0.82 (0.74 to 0.87), specificity 0.85 (0.75 to 0.92), kappa 0.64; English 0.82, French 0.70, Latin 0.55, German 0.50. Manuscripts: kappa 0.29 (0.14 to 0.45). The two error types pull apart: on planted errors the judge is strict (specificity 1.00, sensitivity 0.65: it rejects 13/70 human transcriptions and 29/49 0.35% slips); on real model reads it is lenient (specificity 0.41). Self-preference (DBG): none on print, -0.02 (-0.18 to +0.12); on manuscripts +0.43 (+0.20 to +0.66), robust to the CER definition and to forgiving abbreviation expansion."
status: informational
decision: "No rule changes (rules.json untouched, as briefed). On print the judge can stand as the sole judge of its own model's text, and its accept sits at the router's 1% bar. On manuscripts it cannot: an Opus-written manuscript read or correction is over-accepted by about 43 points against gold, so a manuscript cell's Opus route needs a second judge or a reference before it decides anything (Derek's call, #7809). The worked plug-in correction (latin-lite/print) leaves the cell's decision where it is, but shows a single sensitivity/specificity pair cannot correct absolute k/n: the synthetic and real-read calibrations move it in opposite directions."
superseded_by: null
issue: [7263, 6740, 7809, 7866]
router_evidence: "none — the items are CHURRO-DS pages and synthetic candidates, not pages a lane serves; this measures the JUDGE, not a route. The real reads (agy Flash-low, Opus, on the live OCR prompt) are external pages and do not belong in a cell's k/n."
defect_rates: "none — a calibration of the judge's accept against human transcriptions, not a route comparison; defect classes per item are in scripts/eval/judge-calibration-7263/results/rows.jsonl"
---
## 2026-11-01 · How good is the route judge? Opus against CHURRO-DS human transcriptions, 7 strata (#7263)

Part of #7263. This is step 2 of the R&D plan of 2026-11-01: judge calibration against an external gold set.

PRIOR ART:
- `scripts/eval/route-judge-6740/judge.mjs`: `judgePrompt`, `opusCall`, `parseVerdict`, unchanged. They are reached through `scripts/eval/correction-pass-7818/lib.mjs` `judgeAbsolute`: the page image sits in the workspace, and Opus runs as `claude -p --model opus` on this box's subscription. `paceCheck` is the box's pace guard.
- `scripts/eval/lib/metrics.mjs` (`scoreAgainstReference`, `normalizeForScript` v4, `windowedErrorRate`) supplies the CER. `scripts/eval/lib/agreement-stats.mjs` `wilson` and `scripts/eval/lib/paired-stats.mjs` `makeRng` are imported.
- `scripts/eval/lib/plant-ocr-errors.mjs` was read and does not fit. It plants ONE grammatical error in la/de/fr body lines found through our markup. It has no English, Italian or Greek, and it cannot grade a text by CER. The graded planter here (`lib.mjs plantGraded`) adds OCR-shaped character confusions, dropped words and one dropped line, and re-scores until the band is reached.
- #7866 used wrong-page and planted controls (8/8, 12/12). The same kind of controls are run here.
- Searched `scripts/eval/INDEX.md` and `EXPERIMENTS.md` for "CHURRO", "sensitivity", "specificity", "self-preference" and "gold". bench-2 (2026-09-03) ran CHURRO-3B as an engine. No record calibrates the judge against an external human transcription.

Code: `scripts/eval/judge-calibration-7263/` (`lib.mjs`, `run.mjs`). Committed results are in `results/`: `score.json`, `rows.jsonl` (one row per judged item: example id, kind, CERs, accept, fidelity, defect classes), `sample.json`, and `ppi-latin_lite_print-{all,synthetic,reads}.json`.

**Licence.** The CHURRO-DS card says: "Due to licensing restrictions on the original datasets used in Churro, use is permitted for research purposes only." Calibrating an evaluation instrument is research use. No CHURRO text or image is committed (this repo is public): only example ids, CERs and verdict fields. Defect quotes are left out because they quote CHURRO text. Bulky files stay in `$JOB_SCRATCH/judge-cal-7263`.

### 1. Design

**Gold.** CHURRO-DS (Stanford, EMNLP 2025, arXiv 2509.19768), test and dev splits. That is 2,340 pages, 60 per (language, print/handwriting) cluster, fetched through the HF datasets-server rows API. The gold is the text of each `cleaned_transcription` `<Page>`: one `<Line>` per line, inline tags dropped, their text kept (`lib.mjs goldText`).

**Strata** (`run.mjs draw`, salt `cal7263`). The languages we route that CHURRO holds: Latin, German, French and English print. Italian and Greek occur only as manuscripts in test and dev, and the train-split filter API was down. Latin manuscripts are the manuscript cluster. Each stratum has 20 pages, 140 in all:
- one page per source document across all strata (`docKey`: the example id less its page token);
- round-robin over collections, so 6 to 20 collections per stratum;
- 200 to 6,000 scored characters per page.

**Candidates per page** (`run.mjs packet`):
- **One real read.** agy `gemini-3.8-flash-low` (via agy-guard) on alternate pages, Opus through `claude -p --model opus` on the others: 70 each. Both use the live OCR prompt (v19.1, read from Mongo; no writes) on the image alone, the request `cli-ocr.mjs read` sends.
- **One planted gold.** S1 (target CER 0.3%, median reached 0.35%), S2 (3%, median 3.0%) or S3 (10% with a whole line dropped, median 8.6% order-free), rotating: 49 / 49 / 42.
- **The gold itself** on alternate pages (70).

Controls:
- 2 wrong-page items per stratum (this image, another page's gold);
- 20 seeded repeats (judged twice).

**Budget.** 384 judge items, 385 Opus judge calls (one retried after an unparsed reply), under the 400 cap. Reads took another 70 Opus and about 70 agy calls. The Claude meter stood at 2% of the week at the start. No paid API was used.

**Truth.** A candidate is truly acceptable when its CER against the gold is ≤ τ.
- The primary τ is **1%**: the router's accept is judged acceptance, and the fitted 50% point below lands there. The record also reports 0.5%, 2% and 5%.
- The primary CER is **order-free** (`lib.mjs cerLines`): each gold line is aligned on its own (fitting alignment) anywhere in the candidate. It was added after the first score, before any conclusion was drawn.
- Why order-free: the windowed CER charged correct reads up to 50% when a page's columns or blocks were read in another order than CHURRO's transcriber chose, for example a two-column play page or a multi-article newspaper. The diffs are in `$JOB_SCRATCH/judge-cal-7263/read-diffs.txt`.
- The windowed CER is kept as a sensitivity. An abbreviation-tolerant word error (`werTolerant`: "dni" → "domini" is not charged) checks the manuscript strata, where the gold is diplomatic.

**Statistics.**
- Sensitivity = P(judge accepts | truly acceptable); specificity = P(judge rejects | not).
- Wilson intervals; kappa with a page-cluster bootstrap (2,000).
- Self-preference as the DBG score (arXiv 2506.02592): bias = judge verdict − gold verdict, Opus-written minus Gemini-written, with a page bootstrap. A CER-adjusted logistic is the second check.

### 2. Controls

| control | result |
|---|---|
| wrong page (another page's gold on this image) | **16/16** rejected with fidelity ≤ 2 |
| repeat judgement | **19/20** same accept |
| S2 plants (3.0% CER) | **0/49** accepted |
| S3 plants (8.6%) | **0/42** accepted |
| S1 plants (0.35%) | 20/49 accepted (0.28 to 0.55) |
| the gold itself (0%) | 57/70 accepted (0.71 to 0.89) |

The judge never let a ≥ 3% text through in any stratum.

### 3. Sensitivity, specificity and kappa per stratum (order-free CER ≤ 1%)

Items: gold + plant + real read (350). The columns after kappa split the same items by how their truth is known: **synthetic** (gold and plants, where the truth is exact) and **reads** (real model output, scored against the human gold).

| stratum | n | sens k/n | sensitivity (95% CI) | spec k/n | specificity (95% CI) | kappa (95% CI) | synthetic sens / spec | reads sens / spec | kappa, windowed CER |
|---|---|---|---|---|---|---|---|---|---|
| **pooled** | 350 | 143/186 | 0.77 (0.70–0.82) | 121/164 | 0.74 (0.67–0.80) | 0.51 (0.40–0.60) | 0.65 / 1.00 | 0.99 / 0.41 | 0.44 |
| **print** | 200 | 108/132 | 0.82 (0.74–0.87) | 58/68 | 0.85 (0.75–0.92) | 0.64 (0.51–0.76) | 0.66 / 1.00 | 0.98 / 0.38 | 0.52 |
| **manuscript** | 150 | 35/54 | 0.65 (0.51–0.76) | 63/96 | 0.66 (0.56–0.74) | 0.29 (0.14–0.45) | 0.63 / 1.00 | 1.00 / 0.42 | 0.27 |
| Latin print | 50 | 24/30 | 0.80 (0.63–0.90) | 15/20 | 0.75 (0.53–0.89) | 0.55 (0.21–0.83) | 0.65 / 1.00 | 1.00 / 0.29 | 0.40 |
| German print | 50 | 25/34 | 0.74 (0.57–0.85) | 13/16 | 0.81 (0.57–0.93) | 0.50 (0.23–0.78) | 0.53 / 1.00 | 0.94 / 0.00 | 0.43 |
| French print | 50 | 28/33 | 0.85 (0.69–0.93) | 15/17 | 0.88 (0.66–0.97) | 0.70 (0.50–0.88) | 0.71 / 1.00 | 1.00 / 0.50 | 0.58 |
| English print | 50 | 31/35 | 0.89 (0.74–0.95) | 15/15 | 1.00 (0.80–1.00) | 0.82 (0.64–0.96) | 0.76 / 1.00 | 1.00 / 1.00 | 0.70 |
| Italian MS | 50 | 13/19 | 0.68 (0.46–0.85) | 16/31 | 0.52 (0.35–0.68) | 0.18 (−0.11–0.42) | 0.65 / 1.00 | 1.00 / 0.17 | 0.15 |
| Greek MS | 50 | 12/18 | 0.67 (0.44–0.84) | 23/32 | 0.72 (0.55–0.84) | 0.37 (0.14–0.61) | 0.65 / 1.00 | 1.00 / 0.53 | 0.37 |
| Latin MS | 50 | 10/17 | 0.59 (0.36–0.78) | 24/33 | 0.73 (0.56–0.85) | 0.31 (0.02–0.58) | 0.59 / 1.00 | – / 0.55 | 0.31 |

The reads columns rest on few truth-reject reads per stratum: German print has 3 and English print 2. Read them as direction, not value.

Pooled at other bars:

| τ | sensitivity | specificity | kappa |
|---|---|---|---|
| 0.5% | 0.77 | 0.70 | 0.46 (0.36–0.56) |
| 2% | 0.77 | 0.77 | 0.55 (0.44–0.64) |
| 5% | 0.63 | 0.76 | 0.30 (0.21–0.40) |

Agreement peaks between 1% and 2%.

**Where the judge's bar sits.** Fitting a logistic of accept on log₁₀ order-free CER (gold excluded), the judge accepts half the time at **1.0% (0.7 to 1.4)**: print 0.7%, manuscripts 0.8%.

**Two operating points, not one.**
- *Strict on planted errors.* Specificity is 1.00, but sensitivity is 0.65. The judge rejects 59% of 0.35% slips (21/49 carry a `wrong_text` tag: one changed letter that makes another word) and 13 of 70 untouched human transcriptions.
- The rejected golds are listed in `score.json` `gold_rejected`. The defects cited are concrete: a signature not on the leaf, three columns read straight across, interlinear notes merged, misread names.
- One was checked by eye (`ocrd/heyden_paedono_1548_0014`): the gold carries a page number and a signature `D iij` that this leaf does not print (show-through only). **The judge was right and the gold wrong.** CHURRO's gold is not error-free, so part of the 0.65 is the gold, not the judge. That check was made by a model of the same family as the judge; it is a hint, not an independent verdict.
- *Lenient on real reads.* Specificity on real model reads is 0.41: 43 of 73 reads that miss the gold by > 1% were accepted. Part of this is the gold's own conventions and errors, as above. Part is real: a model's misreads are fluent, while a planted `c` for `e` is not. **Planted errors overstate the judge's specificity on what routes actually produce.**

**Side finding.** agy Flash-low reads Latin manuscripts badly: 1/10 accepted. 12 of its 30 manuscript reads miss the gold by > 10% order-free; Opus has 14 such reads.

### 4. Self-preference (DBG, arXiv 2506.02592)

bias = judge accept − gold accept (order-free CER ≤ τ) on each real read. DBG = mean bias on Opus-written reads − mean bias on Gemini-written reads. The pages are balanced: the two readers alternate within each stratum.

| τ | Opus: judged / gold-accept | Gemini: judged / gold-accept | DBG pooled | DBG print | DBG manuscript |
|---|---|---|---|---|---|
| 0.5% | 63 / 32 of 70 | 46 / 25 of 70 | +0.14 (−0.02, +0.30) | +0.00 (−0.20, +0.19) | +0.33 (+0.10, +0.57) |
| **1%** | 63 / 36 | 46 / 31 | **+0.17 (+0.02, +0.33)** | **−0.02 (−0.18, +0.12)** | **+0.43 (+0.20, +0.66)** |
| 2% | 63 / 41 | 46 / 35 | +0.16 (+0.01, +0.30) | −0.02 (−0.17, +0.12) | +0.40 (+0.16, +0.62) |
| 5% | 63 / 46 | 46 / 48 | +0.27 (+0.14, +0.41) | +0.08 (−0.07, +0.23) | +0.53 (+0.33, +0.74) |

On windowed CER the 1% DBG is +0.21 (+0.06, +0.37); print +0.08 (−0.12, +0.28), manuscript +0.40 (+0.17, +0.62). CER-adjusted logistic (accept ~ log₁₀ CER + Opus-written, reads only): coefficient +2.56 (95% CI +1.18, +3.94), an odds ratio of about 13 at equal CER.

Where it sits (`score.json` `reads_by_band`), accepted / reads:

| reader, type | order-free CER < 1% | 1–3% | 3–10% | ≥ 10% |
|---|---|---|---|---|
| Opus, print | 36/36 | 3/3 | 1/1 | — |
| Gemini, print | 27/28 | 2/4 | 4/7 | 0/1 |
| Opus, manuscript | — | 6/6 | 9/10 | **8/14** |
| Gemini, manuscript | 3/3 | 5/5 | 4/10 | **1/12** |

The gap is in the manuscripts. It survives forgiving abbreviation expansion: at ≥ 15% abbreviation-tolerant word error, Opus manuscript reads are accepted 13/20 and Gemini's 3/19.

What remains confounded:
- Opus may regularise a manuscript in ways the diplomatic gold does not (word division, punctuation, i/j, u/v are folded; expansions are now forgiven).
- The judge reads such output as faithful, which it may be.
- A third, non-Claude judge, or a by-eye panel, is the way to separate these.

On print there is nothing to separate: Opus reads print very well (36/40 under 1%), and the judge treats both authors' text alike.

**Against the prior figure.** The −0.11 to −0.13 used so far (estimator v2) is a diff-in-diff between two judges (Opus and Gemini Pro) on #6545 translations. It has no gold, so it cannot tell bias from quality: the plan's concern was right. For print OCR this record agrees there is no measurable self-preference. For manuscripts it finds a large one.

### 5. Correcting a router k/n: the plug-in, worked on one cell

The method is the sensitivity–specificity plug-in of prediction-powered inference for an imperfect judge (Angelopoulos et al. 2023; Lee et al., arXiv 2511.21140, which stays unbiased under a shift between calibration and test sets). The corrected rate is

θ = (p + spec − 1) / (sens + spec − 1),

with a delta-method interval over three sources (the router's n, and the calibration set's m₁ truly-acceptable and m₀ not-acceptable items) and a Beta bootstrap (`lib.mjs plugIn`; `run.mjs ppi`).

**Cell:** `latin-lite/print`, live table `2026-10-31-correction-pass-7818`, decision *keep lite>opus*, 835,238 pages waiting. k/n is the book-scaled `eff` the Beta posterior uses. Calibration: print pooled (all items), order-free CER ≤ 1%: sens 0.82, spec 0.85, Youden 0.67, so the plug-in scales distances by 1/0.67 = 1.5×.

| route | judged k/n | judged | corrected θ | delta 95% CI | bootstrap 95% CI |
|---|---|---|---|---|---|
| lite (the draft) | 90.1/131 | 0.69 (0.60–0.76) | **0.81** | 0.66–0.95 | 0.66–0.96 |
| lite>opus | 118.8/127 | 0.94 (0.88–0.97) | 1.00 (raw 1.18) | — | 1.00–1.00 |
| lite>agy-flash-low | 119.1/126 | 0.95 (0.89–0.97) | 1.00 (raw 1.19) | — | 1.00–1.00 |
| agy-flash-low-read | 31.0/44 | 0.70 (0.56–0.82) | 0.83 | 0.61–1.00 | 0.60–1.00 |

Reading it:
1. **The decision does not move.** The plug-in is monotone in p, so with one (sens, spec) pair for the cell the routes keep their order. The two top routes both sit above sens, so the correction clips them both at 1.
2. **The judge's k/n underestimates CER-defined acceptance on the drafts.** lite 0.69 → 0.81. The judge is stricter than 1% CER on slips, and that strictness counts as a false negative here.
3. **But a single pair does not transfer.** With the synthetic-only pair (sens 0.66, spec 1.00), every route corrects to 1.00. With the real-read pair (sens 0.98, spec 0.38), lite corrects to 0.17 (0.00–0.56) and lite>opus to 0.86 (0.61–1.00) (`ppi-latin_lite_print-{synthetic,reads}.json`).
4. The answer depends on which kind of error the calibration items carry. The plug-in is valid only when the calibration set's errors are the kind the route makes. CHURRO's planted errors are not. Its real reads are, but their truth is CER against a gold that has its own conventions and errors.

What this means for the router (a recommendation, not applied):
- **Print.** Keep relative decisions on judged k/n. The judge's bar is the router's bar (1.0%), it has no measured self-preference, and a monotone correction cannot reorder routes within a cell. Absolute acceptance figures (on /quality) should carry the interval from the plug-in with the real-read calibration, not the raw k/n.
- **Manuscripts.** Do not let the Opus judge decide an Opus-written route: +0.43 DBG is larger than any `switch.within` margin (0.08). The manuscript cells are HOLD now (< 10 pages a route), so nothing has been decided on this bias yet.
- **Next calibration.** It should use our own pages with a clean external reference (Wikisource and DTA print pages as in #7818 Arm W, Derge for Tibetan). Real route outputs scored against a reference that shares the routes' conventions would give a (sens, spec) the plug-in can carry. CHURRO stays useful for manuscripts and for languages we have no reference in.

### 6. Limits

- 20 pages a stratum: per-language intervals are wide (Latin print kappa 0.21–0.83). The pooled print and manuscript rows are the ones to quote.
- CHURRO's pages are not ours. Its print skews to the 19th and 20th centuries and to newspapers in places; our queue is 1500–1800 print.
- The gold has errors, one confirmed by eye. Sensitivity on gold items is a lower bound on the judge's.
- Italian and Greek are manuscripts only, and Greek is mostly Byzantine liturgical hands and papyri.
- The order-free CER does not charge text a read ADDS outside the gold's lines. The judge's `wrong_text` tags on the reads show where that happened.
- Self-preference is measured on OCR reads, not translations, and only between Opus and Gemini 3.8 Flash-low.

TAKEN: train split not used (the HF filter API was down, and Greek print was absent from its index); test + dev only, so Italian and Greek are manuscripts.
