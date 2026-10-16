Lands: #6740
PR: yes

# DRAFT brief (planner v0, rank 1 of 15). Not dispatched: the session that reads #6740 dispatches it.

**Question.** Should new Latin pages be translated by Gemini 3 Flash rather than Flash-Lite 3.1, the engine
`getTranslateModelForBook` assigns today?

**Why this test, ranked first** (`scripts/eval/estimator/planner/results/plan-v0-2026-10-15.json`):
- **Volume:** 1,040,524 Latin pages are untranslated, 561,246 when weighted by readers. That is the largest queue in
  the library.
- **Only API engines can carry it this quarter.** 3.8 Flash CLI, Sonnet and Opus fall outside the planner's capacity
  rule: half of each subscription for 13 weeks (#6561 `meter.json`).
- **Uncertainty is in the judges, not the engines.**
  - Under the Opus judge, estimator v2 has 3 Flash ahead by **+0.20 [+0.15, +0.25]** points, P = 1.00.
  - Under the Gemini 3.1 Pro judge it is **+0.09 [−0.47, +0.63]**, P = 0.61. No Gemini judge has ever scored Latin.
  - The two-family mean gives P(Flash-Lite is not best) = 0.82, with an expected gap of 0.047 page-fractions where it
    is not best.
  - That is an expected loss of 21,871 reader-weighted page-fractions.
- **Cost:** about 0.44% of one account-week (13 Opus judge calls, 40 Gemini judge calls) plus $0.04 of paid API.

**Pinned prediction (post it on the issue before any arm runs).** Paired difference, 3 Flash − Flash-Lite:
- Opus judge: +0.20 [+0.15, +0.25];
- Gemini judge: +0.09 [−0.47, +0.63].
Both come from v2's posterior with no round effect. The planner's rule 1 applies: compare this difference only with the
same round's difference, never a level.

**Pages.**
- 20 Latin pages, one per book, from works with a published English translation.
- Exclude every page in the #6182 xl panel, xlref-t1 and #6545.
- Locate references with the translation-vs-reference harness (`scripts/eval/translation-vs-reference/`, #5702).
- Seal the list (seed 6740) before any arm runs. Record each reference's style and licence. Report canonical pages
  apart (recitation, #5523).

**Arms** (one call per page each; the prompt is `translate-core`'s, unchanged):
- **A:** Flash-Lite 3.1, the incumbent, on the paid API (allowed under Derek's Gemini rule).
- **A′:** Flash-Lite 3.1 again, as the A-vs-A noise floor.
- **B:** Gemini 3 Flash (`gemini-3-flash-preview`) on the paid API, about $0.04.
  - **Derek's Gemini rule allows only Flash-Lite on the paid API without asking.** Get a one-line OK at dispatch.
  - If there is no OK, use pages whose stored English is already by 3 Flash. Say so in the write-up: those pages are
    then not a random draw.

**Judges.**
- Blind, two families, one round, with #6545's rubric: `scripts/eval/pro-translate-6545/JUDGE-PROMPT.md`, and
  `JUDGE-PROMPT-PRO.md` for the Gemini judge.
  - Opus via `claude -p`, batches of 3.
  - Gemini 3.8 Flash high via `agy -p`, one item a call.
- **Controls:** 10 planted errors in a copy of arm A (negation, number or name, dropped clause), excluded from fidelity.
  5 repeats per judge, for test–retest.
- **Agreement:** report Krippendorff's α for fidelity and for reversals with `judgeReliability()` /
  `reliabilityLine()` (`scripts/eval/lib/agreement-stats.mjs`), bootstrap by book, beside the result (eval-design §2).
  - α below 0.667 means not settled: quote levels per judge.

**Sequential stop rule (fixed now).**
1. Run 20 pages. Take the paired difference B − A per judge, with a 95% interval by book.
2. **Stop: switch to 3 Flash** if the interval excludes 0 in B's favour under **both** judges (the conjunctive rule,
   #6694), the difference exceeds the A-vs-A floor, and planted-error catch is at least 8 of 10 per judge.
3. **Stop: keep Flash-Lite** if both intervals include 0 and both |means| are under 0.15.
4. **Otherwise** add 30 pages, drawn the same way (n = 50), once. At 50, apply rule 2. If it still fails, report "not
   settled at n = 50" and stop. Never extend twice.

**Failed reads** are counted, not scored (#6523).

**Done when:**
- the result is posted on the issue beside the pinned prediction, with α and controls;
- the experiment entry is merged;
- if rule 2 fired, a one-line routing PR for `getTranslateModelForBook` (Latin) is opened as `tier:hold` for Derek.
