Lands: #6740
PR: yes

# DRAFT brief (planner v0, rank 2 of 15). Not dispatched: the session that reads #6740 dispatches it.

**Question.** Should new German pages be translated by Gemini 3.8 Flash low through the CLI (`agy -p`, subscription,
$0) rather than Flash-Lite 3.1?

**Why this test, ranked second:**
- **Volume:** 171,676 German pages are untranslated, 146,146 when weighted by readers.
- **Capacity:** 3.8 Flash low CLI can carry that this quarter (planner capacity rule: 983,000 pages at half the agy
  account). Opus and Sonnet cannot.
- **The evidence already favours 3.8 Flash.**
  - Estimator v2 has it ahead by **+0.52 [+0.41, +0.64]** points under the Opus judge (P = 1.00) and **+0.50
    [+0.02, +1.00]** under the 3.1 Pro judge (P = 0.95).
  - The expected loss of staying on Flash-Lite is 18,745 reader-weighted page-fractions.
- **Why test, then?** Planner rule 1 (from estimator v1): a route changes only on a within-round paired test that
  includes the incumbent. Every German 3.8 Flash score so far came from Opus-judged panels: 22 pages in #6182 and #6331.
  This test supplies the cross-family round.
- **Cost:** about 0.45% of one account-week (20 agy reads, 13 Opus judge calls, 40 Gemini judge calls). No paid API
  beyond the Flash-Lite arm.

**Pinned prediction (post it on the issue first).** 3.8 Flash CLI − Flash-Lite:
- Opus judge: +0.52 [+0.41, +0.64];
- Gemini judge: +0.50 [+0.02, +1.00].

**Pages.**
- 20 German pages, one per book, from works with a published English translation.
- Exclude the #6182 and #6331 xl pages.
- References via the #5702 harness. Sealed list, seed 6741.
- Prefer Fraktur and Antiqua in proportion to the live German shelf: count it read-only at dispatch.

**Arms:**
- **A:** Flash-Lite 3.1, the incumbent, on the paid API.
- **A′:** a second Flash-Lite run, as the noise floor.
- **B:** `gemini-3.8-flash-low` through the fixed CLI translation runner (#6578, or `run-cli-arm.py` with the #6523
  sentinels and tool gate).
  - One page per call, seeded with the previous page's English as production does.
  - Count plan-mode chatter and restart seams as failed reads (#6545 found a `<<<BEGIN>>>` seam).

**Judges.** As brief 1:
- Opus (`claude -p`) and Gemini 3.8 Flash high (`agy -p`), blind, one round, #6545 rubric;
- 10 planted errors, 5 repeats per judge;
- Krippendorff α with `reliabilityLine()`, bootstrap by book.
- **Self-preference watch:** the Gemini judge is in arm B's family. The conjunctive rule (both judges must agree) is what
  protects against that. Report (B − A) under each judge separately.

**Sequential stop rule (fixed now).**
1. 20 pages.
2. **Stop: switch** if B − A excludes 0 under both judges and exceeds the A-vs-A floor.
3. **Stop: keep Flash-Lite** if both include 0 with |mean| < 0.15.
4. Otherwise extend to 50 once, then decide by rule 2 or report "not settled".

**Done when:**
- the result is posted beside the pin, with α, controls and failed reads;
- the experiment entry is merged;
- a `tier:hold` routing PR is opened if rule 2 fired.
- Also record the agy calls per page and seconds per page, so the planner's capacity number can be checked.
