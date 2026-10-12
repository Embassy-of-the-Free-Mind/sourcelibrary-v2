---
stage: translation
measure: judged_vs_reference
languages: [fa, sa, lzh, grc, he]
scripts: [Arab, Deva, Hani, Grek, Hebr]
canons: []
n_books: 132
n_pages: 132
verdict: "3.1 Pro with full thinking does not beat 3.8 Flash given the same prompt (Opus judge −0.02 [−0.23, +0.19], 53 pages). Opus as a translator beats 3.8 Flash in all five languages under the cross-family Pro judge (+0.47 to +0.52). Correcting the stored English helps, but less than retranslating with Opus."
status: undecided
decision: "Route Persian, Sanskrit, Chinese, Greek and Hebrew translation to Opus (claude -p) where subscription capacity allows; otherwise keep 3.8 Flash. Not 3.1 Pro. No correction pass (#6545)"
superseded_by: null
issue: [6545, 6553]
---
## 2026-10-12 · Pro with full thinking, Opus, and correcting the stored English, against 3.8 Flash, in the five lowest-scoring languages (#6545)

PRIOR ART: `2026-10-07-other-languages-pareto-6182.md` (Pro at thinking 128 tied 3.8 Flash), `2026-10-08-cli-arm-xl-365-6331.md` (the stored 3.8 Flash CLI arm C38 and the pages), `2026-10-03-xlref-t5-sanskrit-pali-chinese-vs-reference.md` (Opus +0.85 over Flash on 20 pages, judged by Opus only; Flash check-and-fix inside the noise), `pareto-6182/RUNBOOK-cli38-xl.md`. The pages, references, item line and judge prompt are #6182's/#6331's (`pareto-6182/build-xl-packet.py`; prompt sha256 b0b98c17…, plus one error-span field). Scripts: `scripts/eval/pro-translate-6545/`. Numbers: `scripts/eval/results/pro-translate-6545/{r1s1,r2s1,r1s2}/scores.json`.

### Question

**Decision it changes:** should Persian, Sanskrit, Chinese, Greek and Hebrew be translated by Gemini 3.1 Pro (CLI) or by Opus (`claude -p`) instead of Gemini 3.8 Flash (CLI)? **Second question:** for the backlog, should we correct the stored English or retranslate it?

### Design

- **Pages:** the #6331 xl pages, one page per work, each with a published English translation.
  - Persian 23, Sanskrit 30, Chinese 25, Hebrew 29.
  - Greek: a 25-work random subsample of 69 (seed 6545).
  - 132 pages in all.
- **Staged.** Stage 1 (Persian, Sanskrit) ran every arm. A preset cut then dropped arms. Stage 2 (Chinese, Greek, Hebrew) ran only the arms that survived. Both cuts were posted on #6545 and #6553 before stage 2.
- **Arms.** Every arm got the same one-page prompt that `units.jsonl` holds and #6331 sent.

  | id | what | where it comes from |
  |---|---|---|
  | **FP** | the English in use (gemini-3-flash-preview) | #6182's production arm; stored |
  | **C38** | 3.8 Flash low via `agy -p`, the #6331 run of 8 Oct | stored |
  | **C38S / C38S2** | 3.8 Flash low via `agy -p`, run today, twice | the prompt plus the #6523 marker suffix. C38S is the same-prompt baseline; C38S2 is the A-vs-A |
  | **PRO** | `gemini-3.1-pro-high` via `agy -p` | the CLI's default thinking, not lowered; same prompt as C38S |
  | **OPUS** | Opus 5.5 via `claude -p` (subscription), tools off | same prompt as C38S |
  | **CF / CO** | 3.8 Flash / Opus correct FP | given the source, the page image and FP; told to fix meaning only and change nothing that is right; one pass |
  | **DF / DO** | the edit contract (diagnose, then repair) | the corrector sees only the accuracy spans both judges agreed on in FP; the script applies only replacements inside those spans |

  - The fixed CLI translation runner (#6578) has not merged. So the Gemini arms ran through `scripts/eval/run-cli-arm.py`, in plan mode with one nudge. The marker suffix and the unwrap are #6578's.
- **Judges.** All judged blind, in one round per stage, with the #6182 rubric (fidelity 1–5 against source and reference, reversal, omission, invention), plus error spans typed *accuracy* or *style*.
  - **Opus** (`claude -p`) judged every item, in batches of 3.
  - **Gemini 3.1 Pro** (`agy -p`, one item per call) judged every item.
  - **Fable** (`claude-fable-5-1`) judged a random 100 items (46 + 54) across all panels.
  - Round 2 (stage 1 only) judged the edit-contract arms. They need the judges' round-1 spans, so they could not be in round 1. Round 2 also judged FP, C38S, C38S2, OPUS and CO beside them. Round-2 scores are compared only with each other.
- **Controls.**
  - Planted errors: 10 per panel, in a copy of C38 (a negation, a number or name, or a dropped clause). There is no twin, so a catch must locate the error at its span. Planted items are excluded from fidelity.
  - Repeats: 20 items per panel in stage 1, and 10 in stage 2, to save the Claude weekly allowance. These give test–retest.
- **Family rule.**
  - A pair that involves an Opus-made arm is **headlined by the Pro judge**.
  - A Gemini-only pair is headlined by the Opus judge.
  - Fable is not independent of the Opus arm.
  - A verdict counts only where the Opus and Pro judges agree on its sign.
- **Intervals:** 95%, 2,000 bootstrap draws resampled by work. Here a work is a page.
- **Cut rule (from the brief, fixed before any judging):**
  - A translator must beat 3.8 Flash beyond the noise floor in both stage-1 languages, under the cross-family judge.
  - A corrector must beat the stored English in the same way, with acceptable anchoring and over-correction.
  - Fable is dropped if its alpha with Opus is ≥ 0.8 and it catches the same plants.

### Result 1: translators

**Fidelity per panel** (headline judge in bold; 95% interval by work):

| panel | n | judge | FP (in use) | C38 (stored 3.8) | C38S (3.8, same prompt) | PRO | OPUS |
|---|---|---|---|---|---|---|---|
| Persian | 23 | Opus | 3.70 [3.39, 4.00] | 3.83 [3.48, 4.17] | 4.00 [3.61, 4.35] | **3.96 [3.61, 4.30]** | 4.65 [4.43, 4.87] |
| | | Pro | 3.22 [2.83, 3.61] | 3.57 [3.17, 3.96] | 3.74 [3.35, 4.13] | 3.96 [3.57, 4.30] | **4.22 [3.74, 4.65]** |
| Sanskrit | 30 | Opus | 3.53 [3.30, 3.77] | 3.83 [3.53, 4.10] | 4.17 [3.90, 4.40] | **4.17 [3.87, 4.43]** | 4.77 [4.57, 4.93] |
| | | Pro | 3.20 [2.93, 3.47] | 3.77 [3.47, 4.10] | 4.20 [3.87, 4.50] | 4.47 [4.20, 4.70] | **4.67 [4.43, 4.87]** |
| Chinese | 25 | Opus | 3.92 [3.64, 4.20] | 4.16 [3.96, 4.36] | 4.28 [4.08, 4.48] | — | 4.84 [4.68, 4.96] |
| | | Pro | 3.50 [3.13, 3.92] | 4.00 [3.71, 4.29] | 4.08 [3.75, 4.42] | — | **4.54 [4.21, 4.83]** |
| Greek | 25 | Opus | 3.72 [3.32, 4.08] | 4.00 [3.68, 4.28] | 4.16 [3.84, 4.44] | — | 4.72 [4.52, 4.88] |
| | | Pro | 3.44 [3.00, 3.84] | 3.96 [3.56, 4.36] | 4.00 [3.60, 4.36] | — | **4.52 [4.08, 4.84]** |
| Hebrew | 29 | Opus | 4.14 [3.83, 4.41] | 4.21 [3.97, 4.45] | 4.17 [3.90, 4.41] | — | 4.55 [4.34, 4.76] |
| | | Pro | 3.97 [3.59, 4.31] | 3.72 [3.34, 4.10] | 3.97 [3.59, 4.31] | — | **4.48 [4.21, 4.72]** |

PRO was dropped at the stage-1 cut and not run in stage 2.

**Paired differences against 3.8 Flash, beside the noise floor:**

| panel | PRO − C38 (Opus) | PRO − C38S (Opus) | OPUS − C38S (**Pro**) | OPUS − C38S (Opus) | floor: C38S2 − C38S (Opus / Pro) | judges agree on OPUS? |
|---|---|---|---|---|---|---|
| Persian | +0.13 [−0.22, +0.44] | −0.04 [−0.39, +0.26] | **+0.48 [+0.17, +0.78]** | +0.65 [+0.35, +0.96] | 0.00 [−0.29, +0.24] / −0.12 (round 2, 17 pages) | yes |
| Sanskrit | +0.33 [+0.07, +0.60] | +0.00 [−0.27, +0.27] | **+0.47 [+0.13, +0.80]** | +0.60 [+0.33, +0.87] | −0.24 [−0.56, +0.08] / −0.36 (round 2, 25 pages) | yes |
| Chinese | — | — | **+0.46 [+0.00, +0.92]** | +0.56 [+0.32, +0.80] | −0.04 [−0.36, +0.24] / +0.17 [−0.25, +0.58] | yes |
| Greek | — | — | **+0.52 [+0.08, +1.00]** | +0.56 [+0.32, +0.84] | −0.08 [−0.32, +0.16] / +0.08 [−0.28, +0.48] | yes |
| Hebrew | — | — | **+0.52 [+0.14, +0.90]** | +0.38 [+0.14, +0.62] | +0.21 [+0.03, +0.38] / 0.00 [−0.28, +0.28] | yes |
| stage 2 pooled | — | — | +0.50 [+0.26, +0.76] | +0.49 [+0.35, +0.65] | +0.04 [−0.10, +0.18] / +0.08 [−0.13, +0.28] | yes |

- **Pro with full thinking is not better than 3.8 Flash.**
  - Against the stored C38 it gains +0.13 in Persian and +0.33 in Sanskrit. But 3.8 Flash re-run today with the same prompt (C38S) gains the same, and PRO − C38S is −0.02 [−0.23, +0.19] pooled under the Opus judge.
  - Under its own family's judge (Pro), PRO − C38S is +0.24 [−0.04, +0.53]. That is inside its interval and in the direction self-preference would push it.
  - The issue's estimator gave P(Pro > 3.8) = 0.45 for Persian and 0.77 for Sanskrit. The measured answer is a tie in both.
- **Opus beats 3.8 Flash in all five languages** under the cross-family judge, by +0.46 to +0.52. That is about twice the run-to-run noise of 3.8 Flash itself (A-vs-A between −0.24 and +0.21).
  - The Opus judge and Fable agree on the sign in every panel.
  - In Chinese the headline interval touches zero (+0.46 [+0.00, +0.92]); the Opus judge's is +0.56 [+0.32, +0.80].
  - Opus's own judge puts it +0.38 to +0.65 ahead, so self-preference does not explain the gap.
- **Reversals per 100 pages** (Opus judge / Pro judge):

  | arm | Persian | Sanskrit | Chinese | Greek | Hebrew |
  |---|---|---|---|---|---|
  | OPUS | 0 / 13 | 0 / 3 | 0 / 8 | 0 / 4 | 3 / 7 |
  | C38S | 9 / 26 | 3 / 10 | 8 / 17 | 12 / 4 | 7 / 14 |
  | FP | 13 / 35 | 20 / 23 | 8 / 17 | 20 / 12 | 3 / 14 |

  Pages where either judge flagged one, OPUS against C38S: 3 vs 6, 1 vs 3, 2 vs 5, 1 vs 3, 2 vs 4.
- **The two 3.8 Flash runs differ.** The stored C38 (8 Oct, no marker suffix) scores below today's C38S in Sanskrit, by +0.33 [+0.07, +0.63] (Opus judge). C38 also has more reversals (13 vs 6 per 100 pages, stage 1). This matches #6331's finding that C38 reversed more often than the API. A fresh run of the same prompt (C38S2) moves a panel by up to ±0.25. **Read any 3.8-vs-X difference under about 0.25 here as noise.**
- **Did not read:** none, in any arm, after retries. One reply per arm (PRO, C38S, C38S2, OPUS) restarted mid-answer, so the text carries a stray `<<<BEGIN>>>` seam. That text was judged as returned, as #6578's unwrap would keep it. On the Persian page where PRO did this, both judges scored it 3 against 5 for every other arm.
- **Speed and calls per page** (median seconds; calls including nudges and limit re-runs):

  | arm | seconds per page (median) | calls per page |
  |---|---|---|
  | C38 (stored) | 9 | 1.0 |
  | C38S | 16–20 | 1.0 |
  | PRO | 60 | 1.0 |
  | OPUS | 27–30 | 1.0–1.16 |
  | CF | 47 | 1.47 |
  | CO | 26 | 1.0 |

  - The OPUS re-runs were Claude session-limit hits, not model failures.
  - PRO runs drew down the shared Gemini subscription quota. The account hit "Individual quota reached" at 03:42 UTC, with several jobs on it, and stayed blocked for 2 h 50 min.

**By eye: the five pages where Pro and the stored 3.8 differ most** (stage 1, mean of the Opus and Pro judges; each page read against the judges' quotes and, for the first two, against the texts):

1. **Kumārasambhava with Mallinātha, Sanskrit:** PRO 5/5, C38 3/2.
   - PRO translates the verses, the whole commentary with its Pāṇinian derivations ("the present tense *laṭ* is used in the sense of the past with *sma*"), and the footnotes.
   - C38 condenses the commentary into a gloss, drops the grammar and the footnotes, and loses *bhavasyāpi*.
   - C38S does the same (3/2). Opus is complete (5/5).
2. **Śaṅkara on Brahmasūtra 3.2.5, Sanskrit:** PRO 5/5, C38 3/3.
   - C38 reverses the sūtra: "that nature is **concealed** by meditation on the Supreme Lord". The sūtra says meditation makes the hidden manifest, and PRO has it right.
   - C38S (5/5) does not make the error, so it is run-to-run, not the model.
3. **Persian prose with verse:** PRO 3/3, C38 5/5. This is PRO's restart seam: a truncated first draft, then the page again in full. It is a CLI output defect, not a translation error.
4. **Anaṅgaraṅga, Sanskrit:** PRO 5/5, C38 4/3.
   - C38 reverses who is tested ("because she is testing him"; the source says she must be tested) and adds "restraint".
   - C38S 4/4.
5. **Gītā 9.29–31 with commentary, Sanskrit:** PRO 5/5, C38 4/3. C38 drops *prārthyamāna* ("being entreated"), misreads *yogya* and drops the footnote. C38S 4/4.

*(Sixth: Arthaśāstra on courtesans. C38 swaps killer and victim; PRO 4/4; C38S 5/5.)*

What Pro gets right that the stored 3.8 does not: full commentary instead of a summary, and no reversals. But **C38S usually gets the same pages right**. The stored C38 run is the weak one, not 3.8 Flash. Opus matches or beats PRO on every one of these pages.

### Result 2: correct the stored English, or retranslate? (stage 1)

**Risk measures first.**

| | 3.8 Flash corrects (CF) | Opus corrects (CO) | contract, Flash (DF) | contract, Opus (DO) |
|---|---|---|---|---|
| planted errors fixed / left (2 per draft, 10 pages per panel) | 32 / 3 of 35 | 33 / 1 of 35 (1 unclear) | — | — |
| over-correction: pages where both judges gave FP a 5 | 0 of 4 scored lower | 0 of 4 lower | — | — |
| … where both gave ≥ 4: lower under the Pro judge | 1 of 13 | 2 of 13 (higher on 5) | 2 of 8 (round 2) | 1 of 8 |
| share of characters changed, median / p90 | 1.3% / 6.0% | 1.7% / 9.4% | 0.5% / 1.9% | 0.6% / 1.7% |
| changed characters inside spans the judges flagged | 28% | 41% | 93% | 96% |
| accuracy spans per page vs FP (Opus / Pro judge) | −0.79 / −0.38 | −1.53 / −0.68 | −0.69 / −0.81 | −0.90 / −0.88 |
| style spans per page vs FP | +0.13 / 0.00 | +0.13 / +0.02 | +0.14 / +0.07 | +0.14 / +0.07 |
| invented edits per 100 pages (Opus / Pro judge) | 7.5 / 5.7 | 11.3 / 13.2 | 0 / 0 | 0 / 2.4 |
| new accuracy errors per 100 pages (Opus / Pro) | 32 / 38 | 26 / 57 | 5 / 19 | 7 / 21 |

The table's terms:
- **Invented edits:** content in the corrected text that the judges typed as an added fact or fabricated fill, and that is not in the draft.
- **New accuracy errors:** accuracy spans whose quote exists only in the corrected text.

What the table shows:
- The correctors repair rather than polish: accuracy spans fall and style spans hardly move. Anchoring on planted errors is low.
- The edit contract is the safest arm (fewest new errors, no invented edits). But it also repairs the least.

**Scores** (round 1 for CF and CO; round 2 for the contract arms; never mixed):

| | Persian | Sanskrit | pooled |
|---|---|---|---|
| CF − FP (headline Opus) | +0.26 [+0.04, +0.52] | +0.20 [−0.03, +0.40] | +0.23 [+0.06, +0.38] |
| CO − FP (headline Pro) | +0.35 [+0.00, +0.74] | +0.63 [+0.30, +0.93] | +0.51 [+0.25, +0.77] |
| CO − C38S, retranslating with 3.8 (Pro) | −0.17 [−0.61, +0.26] | −0.37 [−0.73, +0.00] | −0.28 [−0.57, +0.00] |
| CO − OPUS, retranslating with Opus (Pro) | −0.65 [−1.13, −0.22] | −0.83 [−1.20, −0.50] | −0.76 [−1.04, −0.47] |
| *round 2:* DF − FP (headline Opus) | +0.18 [−0.06, +0.41] | +0.32 [+0.12, +0.52] | +0.26 [+0.12, +0.43] |
| *round 2:* DO − FP (headline Pro) | +0.29 [+0.00, +0.59] | +0.60 [+0.36, +0.88] | +0.48 [+0.26, +0.69] |
| *round 2:* DO − CO (Pro) | −0.12 | −0.28 [−0.52, −0.04] | −0.21 [−0.43, +0.02] |
| *round 2:* DO − OPUS (Pro) | −1.18 | −1.04 | −1.09 [−1.41, −0.79] |

- **By draft noise** (thirds of FP's score; gain under the Opus / Pro judge), Opus's free correction gains:
  - noisiest third (FP ≈ 2.7): +0.88 / +0.82
  - middle third: +0.33 / +0.44
  - cleanest third (FP ≈ 4.1): +0.33 / +0.28

  It does not harm clean drafts here. Flash's correction gains +0.35 / +0.41 on the noisiest third and +0.06 / +0.06 on the middle third.
- **Answer to the backlog question: retranslate, with Opus.** Every correction arm improves the stored English, but none of them beats retranslating with Opus, and the Opus correction does not beat retranslating with 3.8 Flash either. If correction is used at all, route it to the noisiest third of pages. That is where its gain is largest, and it is still below a retranslation. All four correction arms were dropped at the cut. The prior from xlref-t5 (check-and-fix inside the noise) holds for Flash. For Opus, correction is a real gain, but the smaller of the two options.

### Result 3: the judges

| | stage 1 (Persian, Sanskrit) | stage 2 (Chinese, Greek, Hebrew) |
|---|---|---|
| Opus–Pro alpha (ordinal) | 0.63 [0.53, 0.72] (fa 0.58, sa 0.67) | 0.60 [0.51, 0.67] (zh 0.59, grc 0.56, he 0.64) |
| test–retest alpha: Opus / Pro | 0.85 [0.79, 0.90] / 0.76 [0.65, 0.84] | 0.84 / 0.69 |
| arm pairs ranked the same way, Opus vs Pro | 35 of 42 (83%) | 23 of 30 (77%) |
| error-span F1, Opus–Pro | 0.40 | 0.37 |
| Fable–Opus alpha / Fable–Pro alpha | 0.74 [0.65, 0.81] / 0.63 | 0.70 [0.57, 0.80] / 0.58 |
| Fable–Opus span F1 / ranking agreement | 0.61 / 38 of 42 | 0.61 / 24 of 30 |
| self-preference, difference in differences* | +0.16 [−0.03, +0.35] | −0.06 [−0.27, +0.17] |

\* The self-preference row is (Pro judge − Opus judge) on Gemini output minus the same on Opus output.

- **Agreement in plain terms.** The Opus and Pro judges agree moderately (alpha ≈ 0.6, near the ~0.3–0.6 the literature reports for multilingual LLM judges). Each judge agrees with itself better than with the other. Stage 1 shows a small self-preference, inside its interval; stage 2 shows none. On the Opus arm itself, (Opus judge − Pro judge) minus the same on C38 is +0.17 in Persian and +0.03 in Sanskrit. The issue's prior was +0.32 / +0.31.
- **Which judge catches errors.** Planted meaning errors were located at the right span:

  | judge | stage 1 | stage 2 | all |
  |---|---|---|---|
  | Opus | 17 of 18 | 26 of 28 | **43 of 46 (93%)** |
  | Fable | 10 of 10 | 15 of 15 | **25 of 25 (100%)** |
  | Pro | 12 of 18 | 25 of 28 | **37 of 46 (80%)** |

  Pro missed 3 of 7 stage-1 negations. In stage 2 it found 18 of 18. On this measure **Fable and Opus are the better judges and Pro the weakest**. Fable judged only 100 items, so its 25 of 25 has a wide interval.
- **Is Opus the outlier?** No. On the Fable subset, where Fable and Pro give the same score, Opus differs by a point or more on 33 of 252 units (stage 1) and 23 of 195 (stage 2), and never by 2 or more. Opus is higher on about half of those. Pro is the outlier on 68 and 47, and Fable on 26 and 21.
- **Fable stays in the record.** Its alpha with Opus stayed under the 0.8 drop line, so it judged its full 100. It adds little that Opus does not, apart from catching every plant.
- **Judges disagree:** no language was dropped. The routing verdicts below hold only where the Opus and Pro judges agree on the sign, and they agree on Opus − 3.8 in every panel.

### Preregistered prediction (issue comment of 2026-10-12, estimator #6557), scored

The estimator's panel means sit on a higher level than this round. FP, the stored English, came in under the lower end of its interval in all four stage-1 cells (Opus judge 3.70 and 3.53 against 3.97 and 3.93 predicted). C38 also came in below its interval in all four (3.83 / 3.57 / 3.83 / 3.77 against 4.20–4.39). PRO, OPUS, CF and CO fell inside their intervals in 15 of 16 cells; CO under the Pro judge in Persian fell below (3.57 against [3.63, 5.0]).

The signs mostly matched:

| prediction | measured |
|---|---|
| Opus > 3.8 (0.98–0.99 under the Opus judge) | yes |
| Pro > 3.8 in Sanskrit (0.77) | yes against C38, no against C38S |
| Pro vs 3.8 in Persian, a coin flip (0.45) | a tie |
| 3.8 correction > 3.8 (0.25–0.30) | no in Sanskrit; in Persian +0.13, inside the noise |

A judging round has its own level. That is why this experiment compares only within a round.

### Threats and limits

- These are AI judges against one published translation, not a scholar. A fidelity score is agreement with the source and reference as the judges read them. It is not measured accuracy.
- **n.**
  - 23 to 30 pages per panel. Each panel has its own intervals of about ±0.3.
  - Greek is a 25-work subsample.
  - Round 2 covers only the 42 stage-1 pages that had an agreed span.
- **Opus did not always open the page image when correcting.** In 1 of 3 test calls it answered from the text alone; through the CLI the image can only be offered as a file to read. The Gemini correctors had it attached inline.
- **Stage 2 used 10 repeats per panel, not 20**, to stay inside the Claude weekly allowance. The account stood at 92% when stage 2 began.
- **Capacity.**
  - Opus via `claude -p` runs on a weekly subscription allowance shared with every other job. This experiment alone used roughly a fifth of a week, with judging the largest part.
  - Pro's default thinking at 60 s a page drew down the Gemini quota quickly.
  - Neither cost is a dollar figure, and neither is measured here as a backlog rate.
- C38 was run on 8 Oct with no marker suffix. PRO and OPUS are compared fairly only against C38S, which got the same prompt.
- The correctors' page images were fetched as `display_photo`, which for a page split from a spread is the whole spread. The 3 such pages in the set are all in stage 2, where no corrector was judged, so no reported number is affected. `fetch-images.mjs` now uses `getPageSource`.
- In 2 of 132 pages the planter found no site; those panels have 9 controls instead of 10. One planted pair swap (two coordinated names) was excluded as not a meaning error.

### Routing

- **Persian: route to Opus, not Pro.** Moderate confidence: +0.48 [+0.17, +0.78] under the Pro judge, n = 23, judges agree, though their alpha in Persian is the lowest (0.58). Pro ties 3.8.
- **Sanskrit: route to Opus, not Pro.** Moderate-to-good confidence: +0.47 [+0.13, +0.80], n = 30. Pro ties 3.8 given the same prompt.
- **Chinese: route to Opus.** Moderate confidence: +0.46 [+0.00, +0.92] under the Pro judge, +0.56 [+0.32, +0.80] under Opus, n = 25. Pro was not tested in stage 2 (it was dropped at the cut).
- **Greek: route to Opus.** Moderate confidence: +0.52 [+0.08, +1.00] under the Pro judge, n = 25 works.
- **Hebrew: route to Opus.** Moderate confidence: +0.52 [+0.14, +0.90] under the Pro judge, +0.38 under Opus, n = 29.
- **Where Opus capacity is not available, keep 3.8 Flash**, with the marker prompt. Do not use 3.1 Pro. Do not add a correction pass on top of a retranslation.

*Measure:* judged against a human reference (Opus and Pro judges on every item, Fable on 100). It is not accuracy in the sense of eval-design §2. *Grade:* moderate. Five panels of 23–30 works, two judges of different families agreeing on every routing sign, and the A-vs-A measured in each round. *Replicated?* Partly. Opus > Flash replicates xlref-t5's +0.85 on Sanskrit/Chinese at half the size (+0.47 to +0.62 against same-prompt 3.8), this time under a cross-family judge and in three more languages. Pro = 3.8 replicates #6182's tie, now with full thinking.

*Cost:* $0. Gemini through `agy -p` on the subscription; Opus and Fable through `claude -p` on the subscription. No API key, no database write.

*Files:* `scripts/eval/results/pro-translate-6545/r1s1/` (stage 1, all arms), `r2s1/` (edit-contract round, with `contract.json`), `r1s2/` (stage 2). Each holds `key.json` (labels → arms, plants; no reference text) and `scores.json`. The judge packets and outputs quote published translations and stay on the box (`$JOB_SCRATCH/w/judge/`).
