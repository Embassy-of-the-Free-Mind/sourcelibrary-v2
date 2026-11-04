---
stage: ocr
measure: [judged]
languages: [la, de, fr, en, zh, bo, he, ar, it]
scripts: [Latn, Hani, Tibt, Hebr, Arab]
canons: []
n_books: 1005
n_pages: 1502
verdict: "Re-scored 2,848 stored Opus verdicts (1,005 books, 896K words) as defects per 1,000 words. With the live route as the bar (Derek's steer), the defect rule runs the same route as the k/n router in every comparable cell but three. German first read: read@4 > agy@4 at the $0.01 weight, read@4 at $0.001. Latin first read: read@4 > agy instead of arm c. Tibetan: agy instead of Opus, but the judge's Tibetan severities are a floor. English pre-1800: scans only, as k/n. The judge quotes 158 of 160 planted Latin/German/French errors; 57 of 80 re-checked defects hold up."
status: undecided
decision: "Nothing switched. Proposed rule and table posted on #6740 for Derek; router-table defect fields shown beside k/n (build.py, defect-rates.json); experiments-lint requires defect_rates on new ocr/translation records from 2026-10-30."
superseded_by: null
issue: [6740]
router_evidence: "none — a re-score of verdicts already in the router's evidence; it adds per-word defect fields beside k/n and changes no k/n"
defect_rates: "scripts/eval/route-judge-6740/results/defect-rate-2026-10-30/score.json"
---
PRIOR ART: `scripts/eval/route-judge-6740/judge.mjs` score (accepted k/n and wrong-text pages k/n per route) and
`scripts/eval/estimator/router-table/build.py` (the Beta-binomial router on those two numbers). Both count **pages**.
`judge-planted-7611` (2026-10-29) scored planted items as "rejected or named". Here the control asks the narrower
question: was the planted span **quoted**, and at what severity.

## 2026-10-30 · Route on defects, not page yes/no: re-scoring every stored judge verdict (#6740)

**Why.** The judge stores rich verdicts: accept, fidelity 1–5, and defects tagged with a taxonomy class, a quote and a
severity. The router reads only "accepted k/n" and "pages with any wrong text". So one misleading numeral and ten
count the same, and a cheaper route that swaps words but keeps pages "accepted" looks free. On 2026-10-27 a Tibetan
corrector raised page identity while it changed "seventh" to "nine".

Totals: 2,848 distinct verdicts on 1,502 pages of 1,005 books, 896K words. They carry 5,606 cosmetic, 3,102 misleads
and 1,819 wrong-text defects.

**Rule first.** The rule is in `route-judge-6740/results/defect-rate-2026-10-30/RULE.md`, commit 950d1cb75. It was
written before any rate was computed.

Derek's steer 1 (inbox, 21:10Z) arrived before that commit, but the job read it only after the first results. So it
is applied as a labelled amendment, **S1**, exactly as written: calibrate the labels, make the live route the bar,
keep misleads as a cost and wrong text as a gate. Two post-hoc checks, A1 and A2, are reported as sensitivities only.

### What was read (coverage)

| source | verdicts | books | prompt | dates |
|---|---|---|---|---|
| route-judge-6740 results, 15 runs (pilot, router tests, #7517, #7545, #7701 ×3, #7263, #6871, diff-QA ×2) | 2,070 verdicts on 1,003 pages | 887 | judgePrompt p1 (+ the Kanripo reference on zh-dice) | 2026-10-25 → 10-30 |
| Mongo `lane_judge_verdicts` (#7611 sampler) | 374 verdicts on 374 pages | 111 | the same judgePrompt (OCR and translation templates) | 10-28 → 10-30 |
| agy-ocr-per-call-6740 (Chinese) | 172 verdicts on 60 pages | 30 | p1 (+ reference) | 10-27 |
| siku-percall-5600 (Classical Chinese translation) | 232 verdicts on 118 pages | 30 | p1 plus the Siku spot-check lines | 10-29 |
| judge-planted-7611 (positive control only) | 180 items | 36 pages | p1 | 10-29 |

- **The prompt barely varies.** Every route-judge verdict saw the same prompt text. The Kanripo reference block was
  added on 2026-10-26 and is sent only on zh-dice items. So no route comparison crosses prompt versions.
- **Words.** 728K of the 896K words were counted from the exact candidate text the judge read. Its sha256 reproduces
  the verdict id, or the store's text_hash. The other 168K take the page's size from another stored text of the same
  page. Those are runs whose packets live on hetzner or l7a: neither resolves from gex45, so they were not read.
- **Not counted.** gpu-flash-vs-opus-7263 has no severities. The k/n-only evidence of #5924, #6553, #7568, #7341,
  #6567 and #6361 has no severity verdicts. So 29 of the router's 47 base cells have tested routes with no defect
  rate. The table names them.

### Positive control first

| language | planted errors | quoted in a defect | severity of the hit | page rejected |
|---|---|---|---|---|
| Latin | 52 | 52 (93–100%) | wrong text 48, misleads 4 | 52 |
| German | 56 | 55 (91–100%) | wrong text 50, misleads 5 | 56 |
| French | 52 | 51 (90–100%) | wrong text 49, misleads 2 | 51 |
| English (#6871) | 2 | 2 | wrong text 2 | 2 |
| Tibetan (syllables) | 20 | 16 (58–92%) | **cosmetic 8**, misleads 6, wrong text 2 | 8 |

- Bar 0.80. Latin, German and French pass with room. Tibetan passes exactly at 0.80, and half its hits are called
  cosmetic. **Tibetan per-word severities are a floor.** Derge decides that cell, as #6560 set.
- **False positives.** The judge re-read 36 Latin, German and French texts it had accepted before. It found 14
  misleads and 0 wrong text in 11,450 words (1.2 misleads per 1,000 words) on texts it had passed.

### Calibration (steer 1 A): 80 defects re-read on the quote and the leaf alone

Forty misleads and forty wrong_text defects, all OCR, were drawn round-robin across the taxonomy classes, one a page.
Each went to a fresh Opus call that saw only the quoted span and the page image.

| tagged | re-read as wrong text | misleads | cosmetic | same as the page | real error (misleads or worse) |
|---|---|---|---|---|---|
| wrong text (40) | 28 | 4 | 3 | 5 | 32/40 (65–90%); content classes only 23/26 |
| misleads (40) | **17** | 8 | 5 | 10 | 25/40 (47–76%); content classes only 18/26 |

- **The labels are not inflated in one direction.** About a fifth of wrong_text tags and a third of misleads tags did
  not hold up as errors.
- **Many of the misses are positional.** A neighbour page's strip, a spread not split, a page-number tag: a re-read
  that sees only the quote cannot see these.
- **Severity is unstable at the misleads/wrong_text line.** 17 of 40 misleads were re-read as wrong text. S1 deflates
  misleads by 0.625 and wrong text by 0.80, and never treats one tag as exact.

### Rates per route (posterior mean (90%), defects per 1,000 words; n in books)

The full table, all 71 rated cell × route groups, is in `score.json` `router_cells`. The router table shows the same
fields beside k/n: `router-table/defect-rates.json`, scenario build `2026-10-30-defect-rates`, whose 109 decisions are
identical to the live table. A sample:

| cell | route | books | misleads | wrong text | accepted |
|---|---|---|---|---|---|
| Latin print, Flash-Lite drafts | lite (draft) | 39 | 6.3 (5.0–7.6) | 5.3 (3.6–7.2) | 24/60 |
| | lite > Opus | 9 | 0.2 (0.0–0.5) | 0.09 (0.00–0.36) | 30/30 |
| | lite > agy Flash-low | 37 | 3.1 (2.1–4.4) | 1.00 (0.48–1.67) | 41/58 |
| German print, Flash-Lite drafts | lite > Opus | 30 | 1.3 (0.4–2.8) | 0.20 (0.02–0.52) | 28/30 |
| | lite > agy Flash-low (live) | 82 | 1.9 (1.3–2.6) | 0.61 (0.22–1.18) | 135/156 |
| German first read | read@4 (live) | 72 | 0.9 (0.5–1.3) | 0.12 (0.00–0.44) | 66/72 |
| | read@8 | 22 | 1.9 (0.7–3.7) | 0.23 (0.02–0.58) | 18/22 |
| | LightOnOCR > agy@4 | 25 | 1.6 (0.8–2.7) | 0.93 (0.04–2.78) | 20/25 |
| | read@4 > agy@4 | 20 | 0.5 (0.1–1.0) | 0.15 (0.00–0.65) | 20/20 |
| Tibetan Kangyur | Yigdzin > Opus (live) | 60 | 1.5 (0.8–2.4) | 0.23 (0.10–0.42) | 52/60 |
| | Yigdzin > agy Flash-low | 60 | 0.6 (0.3–0.8) | 0.23 (0.09–0.43) | 53/60 |
| English pre-1800, no text | LightOnOCR | 29 | 2.4 (1.5–3.5) | 2.8 (0.2–8.1) | 18/29 |

### Defects a correction introduced (span diff, both texts held)

A misleads or wrong-text defect on the corrected text counts as introduced when its quote is not in the draft.

- **Latin print, agy Flash-low > lite:** introduced 1.2 per 1,000 words (0.6–2.3; 9 books, 21K words), 14 of them O6
  word swaps. It removed 7.1 per 1,000 words.
- **Opus correction introduced none** on Latin (32K words) or on German 3 Flash drafts, and 0.7 per 1,000 words on
  German Flash-Lite drafts (0.0–2.4; 30 books). Tibetan: 0.13 per 1,000 words. Chinese: 0.7 to 2.1 per 1,000 words.
- **agy Flash-high on Chinese Paddle drafts:** introduced 3.7 per 1,000 words (1.9–5.4), against 6.5 removed. The
  "seventh → nine" class (O6 and O7) is the bulk of what correctors introduce.
- Every correction removed far more than it introduced. Per corrector and cell: `score.json`
  `introduced_by_correction`.

### Decisions: k/n against the defect rule

S1, at w_m = $0.01 per misleading defect (default plan fee), with sensitivities at $0.001 and $0.1:

- **German first read:** k/n keeps read@4. S1 switches to read@4 > agy@4 correction at $0.01, but keeps read@4 at
  $0.001. Break-even is $0.004 per misleading defect, and the correction arm has only 20 books. Not robust.
- **LightOnOCR > agy@4 on Fraktur:** below the live read@4 at $0.01 and $0.1. It is the pick only at $0.001, where
  price dominates.
- **German read@8:** fails the gate against read@4 (wrong text 0.23 against 0.12 + 0.15; P 0.56).
- **Latin first read (arm c):** k/n switched to PERO > agy (written). S1 picks read@4 > agy instead, at $0.01 and
  $0.1, and PERO > agy@4 at $0.001. Arm c's 2.3 wrong-text defects per 1,000 words come mostly from a 72-page,
  4-book depth sample in the lane sampler. On the 18-book draw it had 0 wrong text in 4,486 words. Clustering, not a
  verdict.
- **English pre-1800:** keep scans only. This agrees with k/n's HOLD. LightOnOCR's wrong text, 2.8 per 1,000 words,
  fails the ceiling.
- **French first read @4:** keep. Same as k/n.
- **German, French and Latin-GPU lite corrections on agy:** keep the live agy route under S1.
  - The preregistered rule (Opus as bar, before the steer) would have **kept German lite on Opus**: agy's wrong text
    is 0.61 against Opus's 0.20.
  - Derek's bar is the live route, which is already agy.
- **Tibetan:** S1 switches Opus correction to agy Flash-low (fewer misleads, the same wrong text). The control says
  the Tibetan severities are a floor. **Not proposed**; Derge decides.
- **Hebrew, Arabic, Chinese and Latin 3 Flash:** not comparable. The live Opus correction has no defect verdicts, so
  what a switch would replace is unmeasured.

**What the preregistered rule got wrong.** Its gate was relative to the best rated route only, so a cell with one
route passed trivially. Under it, LightOnOCR would have been switched in for English pre-1800 at 10 wrong-text pages
of 29. The A1 ceiling (wrong text ≤ 1.0 per 1,000 words with P ≥ 0.9) fixes this. It was chosen after seeing that
cell and is labelled post hoc.

**Doctrine.** The proposed eval-design §10.3 is in `results/defect-rate-2026-10-30/eval-design-10.3.md`. The job
could not write `.claude/docs/`.

*Replicated?* No. The calibration rests on 80 re-reads by one judge family. Artifacts:
- `scripts/eval/route-judge-6740/defect-rate.mjs` (inventory, recheck) and `defect-rate.py` (rates, model, rule);
- `results/defect-rate-2026-10-30/` (RULE.md, score.json, control-detail.json, recheck.jsonl.gz, eval-design-10.3.md).
