---
stage: translation
measure: [judged]
languages: [la, en, de, grc, fr, it, nl, zh, sa, he, ar, bo, ko, es, ja]
scripts: []
canons: []
n_books: 365
n_pages: 365
verdict: "Served translations, wave 2 (2026-10-30, 365 books, Opus judge with the page image): 86.3% of pages judged fidelity ≥ 4 [81.3–90.9] and 13.6% with a major defect [9.0–18.7], post-stratified by language × model arm; no measurable change from wave 1 (87.2%, Δ −0.9 pp [−7.8, +6.1]). The Gemini 3.8 Flash-low judge failed its repeat control (13/15 within one), so its rates are not reported; the two judges agree at α 0.53 on the score (not settled), and neither judge measurably favours its own family's translations (Δ 0.15 points [−0.03, +0.34])."
status: informational
decision: "No route or prompt changed. 14 served pages contained (8 invented English, 6 transcriptions of another leaf). draw.mjs now names every served model (arm.mjs)."
superseded_by: null
issue: [5274, 4916, 5301]
router_evidence: "none — a served-corpus measurement; model arms were not randomly assigned (the router sends hard scripts to Opus), so no route is compared"
---
## 2026-10-30 · Translation corpus audit, wave 2: dual judge, image-grounded (#5274, for #4916)
<!-- PRIOR ART: scripts/eval/results/translation-corpus-audit-2026-09-30/README.md (wave 1, the method repeated here); _series-monthly-translation-corpus-audit.md (the monthly rows); #5695 (a text-only judge measures fidelity to the transcription). -->

**Question.** For a page a reader opens at random, how faithful is the English to the page's source, now that routing
has changed since 2026-09-30 (router #6740/#7263, agy Flash, Opus-direct for hard scripts)? And is the judge itself
sound: does a second judge from the other model family agree with it, and does either judge favour its own family?
measure = `judged` throughout, never accuracy. Results in `scripts/eval/results/translation-corpus-audit-wave2-2026-10-30/`
(`analysis.md` for every table, `eye-notes.md` for the hand read).

### What changed in the instrument

- **`armOf()` was blind.** It knew only `gemini-3.1-flash-lite*` and `gemini-3-flash-preview`; everything else
  read `other` and the draw **excluded** it. A census of every served page of every live book (`census.mjs`,
  24,810 books, 5,742,852 pages) found: flash 2.32M, lite (preview + GA) 3.10M, **agy 3.8 Flash-low 141K**,
  no model recorded 107K, **Opus 5.5 49K**, Gemini 2.x 8K, corpus imports 6K, **Argon 3.8K**, a handful of
  Sonnet/Haiku/human. `arm.mjs` names all of them (unit test pins the census list); draw.mjs and score.mjs use it.
- **Prompt provenance:** 3.56M pages carry a prompt version and hash, 2.05M a version only, **131K neither**.
  In the draw, 7 of 365 items have neither; versions other than the current v13 are 60% of the draw, so no
  old-version supplement was needed.
- **Both judges see the page image** (`IMAGE-ADDENDUM.md`, appended verbatim for both). Fidelity is still scored
  against the transcription, so the score stays comparable with wave 1; the image adds `ocr_misread`,
  `ocr_wrong_leaf` and `image_first_words` (a check that the judge really opened the image: the words it reports
  were found in the transcription on 334/365 pages for Opus, 343/365 for Gemini; the rest are mostly scripts
  where the OCR itself misreads).

### Design

One interior text page per book (draw.mjs's page rule), live books only, seed 20261030. Cells = language × model arm:
each arm gets its page share of the language quota, floored at 6 books where the cell has ≥ 6 live books, the floors
taken out of the larger cells; inside a cell, books are ordered by script type (print / manuscript / unknown, from
`pages.script_type`) and period (pre-1500, 1500–1700, 1700–1900, 1900+) and taken systematically, so script × period
are proportionally represented without quotas. **365 books**, more than the ~300 aimed for, because in eight
languages the floors push past the language quota (Chinese 24 for 17, Arabic and Tibetan 24 for 12, Spanish 18 for 6 …). Cells with fewer than 6 live books were not floored (17
cells, e.g. Greek/argon 1 book, Latin/claude-other 5: `draw-log.json → cells`). Headline weights: each language's
eligible translated pages × each arm's share of them (`arm-shares.json`), which undoes the floors. Controls: 15
swap, 15 drop, 15 repeat, blinded into 28 packets.

Judge A: Claude Opus, one subagent per 15-item packet, JUDGE-PROMPT.md + addendum. Judge B: Gemini through
`agy -p` on the subscription, one call per item, same text (`judge-agy.mjs`). **Positive control first:** three
items whose image was swapped for another book's page; Gemini flagged all three as wrong leaf and quoted words
visible only in the swapped image. Cost $0 API; agy used 0.6% of one account-week.

### Controls gate (read first)

| judge | swap rated ≤ 2 | drop flagged omission | repeat within one | gate |
|---|---|---|---|---|
| Opus (with image) | 15/15 | 14/15 | 15/15 (13 exact) | **PASS** |
| Gemini 3.8 Flash-low (with image) | 15/15 | 15/15 | **13/15** (10 exact; Hebrew 1→4, Korean 3→5) | **FAIL** |

The Gemini judge is reported as failed: its rates below are instrument diagnostics, not corpus estimates.

### Headline (Opus judge; n = 365 books, 2026-10-30)

| statistic | lang × arm (headline) | lang only |
|---|---:|---:|
| fidelity ≥ 4 | **86.3%** (81.3–90.9) | 87.1% (82.7–91.1) |
| any major defect | **13.6%** (9.0–18.7) | 12.8% (8.9–17.1) |
| fidelity 5 | 46.8% (40.1–53.7) | 51.6% |
| fidelity ≤ 2 | 2.9% (0.8–5.4) | 3.0% |
| transcription misreads the image (`ocr_misread`) | 21.3% (15.6–26.9) | — |
| transcription is of another leaf (Opus flag) | 6 of 365 books | — |

The image field is the new number: on about one page in five the judge saw the transcription misread the leaf in
a way that changes meaning, and that sits *outside* the fidelity score, which is fidelity to the transcription.

### By language, script, period (Opus; descriptive; < 30 books exploratory, ≥ 30 directional, ≥ 50 decision-grade)

| language | books | mean | ≥ 4 % | major % |
|---|---:|---:|---:|---:|
| Latin | 58 | 4.19 | 84.5 | 15.5 |
| Greek | 35 | 4.40 | 88.6 | 8.6 |
| German | 35 | 4.63 | 94.3 | 5.7 |
| English (modernisation) | 35 | 4.54 | 91.4 | 8.6 |
| Arabic | 24 | 4.25 | 83.3 | 16.7 |
| Tibetan | 24 | 4.42 | 91.7 | 8.3 |
| French | 24 | 4.83 | 100 | 0 |
| Chinese | 24 | 4.08 | 75.0 | 25.0 |
| Sanskrit | 18 | 3.50 | 44.4 | 55.6 |
| Spanish | 18 | 4.61 | 94.4 | 5.6 |
| Italian | 17 | 4.18 | 88.2 | 17.6 |
| Dutch | 17 | 4.71 | 100 | 0 |
| Korean | 12 | 4.08 | 83.3 | 16.7 |
| Japanese | 12 | 2.25 | 25.0 | 66.7 |
| Hebrew | 12 | 3.67 | 66.7 | 33.3 |

Unweighted cells (the floors over-represent small arms inside a language). Script: print 83.2% ≥ 4 (184 books),
manuscript 79.5% (73), unknown 88.9% (108). Period: pre-1500 71.0% (31), 1500–1700 86.7% (120), 1700–1900 82.6%
(144), 1900+ 90.0% (50). **Japanese is the outlier:** 8 of 12 pages carry a major defect, five of them English that
is not a translation of the page (contained, below), all on kuzushiji / early-modern books translated by lite or
flash.

**Model arms are not compared.** The router sends hard scripts to Opus, so raw arm rates (Opus 92.6% ≥ 4 on 54
books, agy-flash 92.9% on 42, flash 82.9% on 117, lite 79.5% on 146) mix model with book difficulty and prompt
era. Two or more arms share a language × script × period cell in 57 cells, and **no cell holds 10 books of
any one arm except Latin/print/1500–1700 lite (15)**: every within-cell contrast is exploratory (`analysis.md`).
By prompt version: Opus/v13 42 books 100% ≥ 4, agy-flash/v13 92.9%, lite/v10 78.5% (65), lite/11 74.1% (27),
flash/11 53.8% (13), same caveat.

### Judge reliability (Opus vs Gemini, 365 books, α bootstrap by book)

- fidelity (ordinal): α 0.53 [0.44, 0.61] — not settled
- fidelity ≥ 4 (nominal): α 0.53 [0.39, 0.65] — not settled
- major defect: α 0.52 [0.38, 0.65] — not settled
- omission 0.53, invention 0.50, ocr_misread 0.54 — all not settled
- exact 61.4%, within one 96.2%; Gemini scores 0.26 points higher on average (fidelity 5 on 72.5% of pages vs
  46.8%; major 8.7% vs 13.6%).

So the two families agree roughly on how good a page is and not on where "major" starts, as #6338/#6420 found with
human readers (α 0.46–0.55). **Every rate above is Opus's threshold, quoted per judge.**

### Self-preference (does each judge favour its own family?)

Difference in differences of (Opus score − Gemini score) on Claude-translated pages (Opus 5.5, 54 books) minus the
same on Gemini-translated pages (311 books): **+0.15 points [−0.03, +0.34]**; matched inside the 15 language ×
script cells holding both families: +0.16 [−0.02, +0.35]. On the share ≥ 4: +2.6 pp [−5.1, +9.8]; on the share
without a major defect: +3.6 pp [−4.2, +10.9]. The sign is the self-preference direction (Opus relatively kinder to
Claude text, or Gemini relatively harsher to it), but no interval excludes zero: **no self-preference detected at
this n**; an effect of about a third of a point cannot be ruled out. Caveats: the Gemini judge failed its stability
control, and the Opus-translated pages are concentrated in hard scripts (Tibetan, Chinese, Sanskrit, Arabic). The
planted-control comparison of the same two families as a lane judge is #7611 (PR #7807, preregistered 2026-10-30, no
results yet); this run does not use its control set.

### Wave 1 → wave 2, and the Oct-1 monthly draw

| run | judge | n | ≥ 4 | major |
|---|---|---:|---:|---:|
| wave 1, 2026-09-30 (arm-corrected) | Opus, text only | 311 | 87.2% (81.7–91.9) | 14.4% (8.9–20.4) |
| **wave 2, 2026-10-30** (lang × arm) | Opus, with image | 365 | 86.3% (81.3–90.9) | 13.6% (9.0–18.7) |
| wave 2, lite/flash pages only | Opus, with image | 263 | 85.0% (79.6–90.1) | 14.8% (9.8–19.9) |
| monthly draw 2026-10-01 (lang) | Opus, text only | 103 | 83.3% (74.4–91.5) | 14.8% (6.8–23.8) |

Δ wave 2 − wave 1: ≥ 4 **−0.9 pp [−7.8, +6.1]**, major −0.8 pp [−8.5, +6.4]; on lite/flash pages only −2.2 pp
[−8.9, +5.0]. No change is detectable; the instrument changed too (the judge now sees the image), so a small
real change could hide in either direction. The Oct-1 monthly draw (judged late, unchanged instrument, gate 15/15 ·
15/15 · 15/15) fits the same picture and is the series row for 2026-10.

### By eye

The 20 books the judges disagree on most, read against the image (`eye-notes.md`): **Opus right on 12, Gemini on 0,
4 ties or splits, 4 not settled** (corrupt Tibetan, Sanskrit, Chinese). Twice Gemini lowered fidelity for an image
mismatch, which the addendum forbids; on garbled pages it gave 5 where the English papers over the garble.

**Contained, same run (14 pages, 14 books; `contained` label on #5274):** 8 pages whose English is not a
translation of the transcription (5 Japanese, 1 German, 1 Latin, 1 French label catalogued Italian), and 6 whose
transcription is another leaf's text (2 duplicate the previous page, 1 is shifted by a leaf, 2 Hebrew, 1 OCR
loop). Books held (`tca-wave2-contained-5274`), pages withheld with snapshots. List in `eye-notes.md` §2.

### What the paper can say (#4916)

1. One page in seven to eight that readers meet carries a major translation defect by the Opus judge's threshold
   (13.6% [9.0–18.7], n 365 books, 2026-10-30), unchanged since September within ±7 pp.
2. That rate is a threshold of one judge, not a fact about pages: a second family agrees at α ≈ 0.5.
3. Fidelity to the transcription is not fidelity to the page: on ~21% of pages the transcription itself misreads
   the leaf, and ~1.6% (6/365) transcribe another leaf.
4. No judge self-preference at ±0.35 points; the same-family Gemini judge also failed a stability control
   that Opus passed.
5. Do not compare models from this sample.

### Decisions taken (no ask)

- Gemini judge = `gemini-3.8-flash-low` for all items: the box's agy login may run only that model; `3.8-flash`
  and Pro/Argon are refused by the guard, so **the 40-item Pro subset was not run**.
- 365 books rather than ~300: floors of 6 where the brief asked, rather than dropping them.
- The Oct-1 draw judged as-is, text-only, and stored as judge@1 / 2026-10; wave 2 stored as judge@2 (image).
- Gemini verdicts are kept in the results dir; only the gate-passing judge (Opus) goes to the score store.

Artifacts: `scripts/eval/translation-corpus-audit/{arm,census,draw-wave2,fetch-images,judge-agy,analyze-wave2}.mjs`,
`IMAGE-ADDENDUM.md`, results dirs `translation-corpus-audit-wave2-2026-10-30/` and
`translation-corpus-audit-monthly-2026-10/`, store `translation-corpus-audit-judge@2/2026-10.jsonl` (410 rows) and
`judge@1/2026-10.jsonl` (148 rows). Census rows (24 MB) in the job scratch, gzipped; the summary is committed.
