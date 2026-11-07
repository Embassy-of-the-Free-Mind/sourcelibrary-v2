---
stage: translation
measure: [judged]
languages: [la, en, de, grc, fr, it, nl, zh, sa, he, ar, bo, ko, es, ja]
scripts: []
canons: []
n_books: 365
n_pages: 365
verdict: "Re-judging wave 2 (365 books, 2026-11-01) with Gemini 3.8 Flash at medium thinking: it passes the controls gate (swap 15/15, drop 15/15, repeat 15/15), where Flash-low failed (repeat 13/15). It agrees with Opus at α 0.68 [0.61, 0.74] on the score, up from Flash-low's 0.53 (Δα +0.15 [+0.07, +0.23]). The two Gemini tiers agree with each other at only α 0.65. So wave 2's low agreement came from the tier, not the family. By Flash-medium, 90.4% of pages score ≥ 4 [86.0–94.1] and 9.0% have a major defect [5.4–13.4], against Opus's 86.3% and 13.6%. Flash-medium is kinder by 4–5 pp; the paired intervals just touch zero. No self-preference was detected on the score: +0.06 points [−0.07, +0.18]. Gemini 4 Argon (medium), on a 40-item subset, went 15/15 on controls, but the gate needs at least 10 of each kind, so it is not certified. Its α vs Opus on 25 books is 0.86 [0.69, 0.93]."
status: informational
decision: "No route or prompt changed. For the paper (#4916), the cross-family second judge is gemini-3.8-flash (medium). Flash-low is retired as a judge. Argon needs one more day of calls (≥ 5 more of each control) before it can be gated."
superseded_by: null
issue: [5274, 4916]
router_evidence: "none — the instrument is re-measured, not a route: the same wave-2 items, a different judge"
defect_rates: "none — a judge-agreement measurement on wave 2's served-page draw, not a route comparison: no route is decided, and the pages carry fidelity and major-defect shares per judge, not misleads/wrong_text per 1,000 words"
---
## 2026-11-01 · Wave 2 re-judged by Gemini 3.8 Flash and Gemini 4 Argon (#5274, for #4916)
<!-- PRIOR ART: 2026-10-30-tca-wave2-dual-judge-5274.md (the run re-judged here: its items, packets, prompt and Opus verdicts, unchanged); analyze-wave2.mjs (the estimator and self-preference form, reused in analyze-rejudge.mjs). -->

**Question.** In wave 2, the Gemini judge (3.8 Flash at low thinking) failed its repeat control and agreed with Opus
at only α 0.53. That left the paper with no valid second judge. Was the cause the model tier or the judge family?
measure = `judged`. All numbers are rates of books, one interior page each. Results are in
`scripts/eval/results/tca-gemini-rejudge-2026-11-01/` (`analysis.md` for every table).

### Design

- **Same items and instrument.** All 410 wave-2 items (365 books + 45 blinded controls) were judged with the same
  rubric (`JUDGE-PROMPT.md` + `IMAGE-ADDENDUM.md`), the same one-call-per-item format (`judge-agy.mjs`), and on
  `agy -p` on the subscription. No API was used, at $0.
- **One change to the images.** For the 33 items where wave 2 showed the whole spread, these judges saw the
  corrected single-page image (`getPageSource()`'s pick: 5 split halves, 28 crops). Opus and Flash-low saw the
  spread. Those items are flagged (`images.json → spread_flag`), and every α is also given without them: the score's α moves
  by ≤ 0.02, invention's by 0.045.
- **Models.** `gemini-3.8-flash` resolves in agy to **Flash (Medium)** (agy's model resolver, logged). agy offers
  no Gemini Pro, so the heavy arm is **Gemini 4 Argon (Medium)**, with `AGY_ALLOW_HEAVY=5274`.
  - Wave 2's `l7a` account was locked to Flash-low. This run used root's login on `earthai-live`.
- **Argon subset (seed 20261101, `argon-subset-ids.txt`).** 40 items:
  - the 20 books from wave 2's by-eye table;
  - 5 swap, 5 drop and 5 repeat controls;
  - the 4 repeat originals not already among the 20;
  - 1 random main item.

  It used exactly the box cap of 40 heavy calls, with `--attempts 1` so a retry could not spend another item's
  call.
- **Positive control first.** Three items were given another book's image. Flash flagged all three as wrong leaf.
  It quoted words that are in the image's book and absent from the item's own transcription (3/3,
  `positive-control/`).
- **Cost.** Flash: 417 calls, 9.1M input and 3.4M output tokens (3.3M of them thinking), median 30 s per call.
  Argon: 40 calls, 0.6M input and 0.14M output tokens.

### Controls gate (`score.mjs --gate`; read first)

| judge | swap rated ≤ 2 | drop flagged omission | repeat within one | gate |
|---|---|---|---|---|
| Opus 5.5 (wave 2) | 15/15 | 14/15 | 15/15 (13 exact) | **PASS** |
| Gemini 3.8 Flash-low (wave 2) | 15/15 | 15/15 | 13/15 | FAIL |
| **Gemini 3.8 Flash (medium)** | 15/15 | 15/15 | 15/15 (12 exact) | **PASS** |
| Gemini 4 Argon (medium), subset | 5/5 | 5/5 | 5/5 | FAIL on n (the gate needs ≥ 10 of each kind) |

Only Opus and Flash-medium give corpus rates below. Argon's numbers are instrument diagnostics: its controls were
all caught, but they are too few to certify.

### Headline (wave 2's 365 books; post-stratified by language × model arm)

| judge | fidelity ≥ 4 | any major defect | fidelity 5 (raw share) |
|---|---:|---:|---:|
| Opus (wave 2 headline) | 86.3% (81.3–90.9) | 13.6% (9.0–18.7) | 49.9% |
| **Gemini 3.8 Flash** | **90.4% (86.0–94.1)** | **9.0% (5.4–13.4)** | 60.5% |
| Opus − Flash (paired bootstrap) | −4.1 pp [−9.3, +0.5] | +4.6 pp [−0.1, +9.3] | |

The two passing judges rank pages alike but put the "major" line in different places. Flash is about 4–5 pp
kinder, and the intervals just reach zero. So the paper's rate should be quoted with its judge: **13.6% by
Opus, 9.0% by Gemini 3.8 Flash**.

### Judge reliability vs Opus (α, bootstrap by book)

| measure | Flash-low (365) | **Flash-medium (365)** | Flash-medium, subset (25) | Argon, subset (25) |
|---|---|---|---|---|
| fidelity (ordinal) | 0.53 [0.44, 0.61] | **0.68 [0.61, 0.74]** | 0.76 [0.47, 0.89] | 0.86 [0.69, 0.93] |
| fidelity ≥ 4 | 0.53 [0.39, 0.65] | **0.71 [0.60, 0.81]** | 0.45 [0.06, 0.76] | 0.69 [0.36, 0.92] |
| major defect | 0.52 [0.38, 0.65] | **0.70 [0.59, 0.81]** | 0.53 [0.15, 0.84] | 0.69 [0.36, 0.92] |
| omission | 0.53 | 0.69 | 0.75 | 0.76 |
| invention | 0.50 | 0.52 [0.36, 0.65] | 0.60 | 0.76 |
| ocr_misread (image) | 0.54 | 0.61 | 0.32 | 0.21 |

- **Flash-medium agrees with Opus measurably better than Flash-low did.** The paired gain is Δα +0.15
  [+0.07, +0.23] on the score, +0.18 [+0.07, +0.30] on ≥ 4, and +0.18 [+0.07, +0.31] on major.
- **On the full 365 books, Flash-medium reaches "tentative" (α ≥ 0.67)** on the score, ≥ 4, major and omission.
  Invention (0.52) and the image misread flag (0.61) stay "not settled". Exact agreement is 70.1%; within one,
  98.4%.
- **Two tiers of one family agree with each other no better.** Flash-low vs Flash-medium is α 0.65 [0.56, 0.73]
  on the score, lower than Flash-medium vs Opus. So wave 2's 0.53 was mostly Flash-low's instability. It was not
  a gap between families.
- **Argon looks closer to Opus than Flash-medium does, but this is not shown.** On the same 25 books, its α is
  0.86 against Flash-medium's 0.76, and Argon and Flash-medium agree with each other at α 0.89. The subset is 20
  hand-picked disagreements plus 5, and the intervals overlap.
  - These 25 books were picked for Opus and Flash-low disagreeing. Flash-low's α of 0.10 on them is there by
    construction, and it is no estimate of anything.

### Self-preference (difference in differences; Opus − Gemini on Claude-translated pages, minus the same on Gemini-translated pages)

| judge | score | matched in language × script cells | share ≥ 4 |
|---|---|---|---|
| Flash-low (wave 2) | +0.15 [−0.03, +0.34] | +0.16 [−0.02, +0.35] | +2.6 pp [−5.1, +9.8] |
| **Flash-medium** | **+0.06 [−0.07, +0.18]** | +0.07 [−0.06, +0.20] | +3.9 pp [+0.6, +7.1]* |

- **No self-preference was detected on the score.** The sign is the self-preference direction, and the estimate
  is less than half of Flash-low's.
- **\*The ≥ 4 interval is too narrow.** On the 54 Claude-translated pages, Opus and Flash never disagree on ≥ 4
  (0 discordant pages), so the bootstrap gives the Claude side no spread. With 0/54 discordant, that side could
  plausibly be off by ±5 pp, which takes in zero.
  - What the 3.9 pp does show: the whole "Flash is kinder" gap sits on Gemini-translated pages.
- Caveat: Claude-translated pages are concentrated in hard scripts, so family and difficulty are not separated.

### The 20 disputed books against wave 2's by-eye verdicts

Wave 2's `eye-notes.md` §1 read the 20 books where Opus and Flash-low disagreed most. It found Opus right on 12,
4 ties or splits, and 4 not settled.

| judge | sides with the eye on the 12 Opus-right books | gives Opus's exact score | ties (3) within one of both |
|---|---:|---:|---:|
| Flash-low (wave 2) | 0/12 (by selection) | 0/12 | 3/3 |
| **Flash-medium** | **10/12** | 4/12 | 3/3 |
| Argon | **11/12** | 6/12 | 3/3 |

"Sides with the eye" means two things: the judge is within one point of Opus's score, and it is no closer to
Flash-low's. Both new judges miss #16, an Italian label under four paragraphs of anatomy: they give 2, the same as
Flash-low, where the eye backed Opus's 1 ("mostly not this page's text"). Flash-medium also repeats Flash-low's
2 on #7, a Tibetan page with three leaves translated in reverse order, where the eye backed Opus's 4.

Neither new judge repeats wave 2's two breaches of the addendum. On #1, wave 2 scored the image, not the text;
both new judges give 5. On #15, it scored the leaf mismatch; both give 2, the same as Opus.

Two caveats:
- The 20 books were selected for Flash-low being far from Opus, so any steadier judge will look closer to Opus
  by regression alone.
- The "eye" was wave 2's job session (a Claude reader with the image open), not a human. A same-family reader
  backing the Opus judge is weaker evidence than a human one. The human check is #6338/#6420's calibration
  (α 0.46–0.55 between readers).

### What the paper can say (#4916)

1. A cross-family second judge now exists and passes the same controls: Gemini 3.8 Flash at medium thinking. It
   agrees with Opus at α ≈ 0.7 on the score, ≥ 4 and major (tentative), on all 365 books.
2. The wave-2 α of 0.53 came from the model tier. Flash-low was unstable (failed repeats), and two Gemini tiers
   agree with each other at only α 0.65.
3. The headline defect rate depends on the judge: 13.6% [9.0–18.7] by Opus and 9.0% [5.4–13.4] by Gemini 3.8 Flash
   (n = 365 books, page draw 2026-10-30, Gemini judged 2026-11-01). Neither is the truth. A defensible bracket is
   ~9–14% of pages with a major defect.
4. No judge self-preference on the score at ±0.2 points.
5. Invention (α 0.52) and the image misread flag (0.61) are not yet reliable across families. Do not quote either
   as a corpus rate without naming the judge.

### Decisions taken (no ask)

- **Pro became Argon (medium).** agy lists no Gemini Pro; the brief allowed Argon. Medium rather than high,
  because argon-high has locked the shared account before (2026-10-19).
- **Corrected images for the 33 spread items, as the brief asked**, flagged, with α also given without them.
- **Argon's 40 items:** the 5 extra slots went to the 4 repeat originals (a repeat with no original cannot be
  scored) plus 1 seeded main.
- **What went to the store.** Only the passing new judge, Flash-medium, went to
  `store/scores/translation-corpus-audit-judge@2/2026-10.jsonl` (410 rows, run
  `translation-corpus-audit-tca-gemini-rejudge-2026-11-01`). Argon's verdicts stay in the results directory.
- **Two small tool fixes.** `score.mjs --store` labelled every judge `claude-<judge>`; a Gemini judge now keeps its
  own name. `judge-agy.mjs` gained `--attempts`.

### Left for another day (the box cap bound)

To gate Argon, it needs at least 5 more of each control kind (15 heavy calls). For an α not dominated by disputed
books, it needs about 25 more random main items. That is one more day's 40, and it has not been run.

Artifacts: `scripts/eval/translation-corpus-audit/analyze-rejudge.mjs`, the results dir
`tca-gemini-rejudge-2026-11-01/` (verdicts, per-judge `report-*.{json,md}`, `analysis.{json,md}`, `images.json`,
`positive-control/`). The images themselves are in the job scratch.
