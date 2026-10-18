# Librarian speed A/B (#6904): registered rule

Committed before any arm ran (eval-design §10.2, "Fixed before the run").

PRIOR ART: `scripts/eval/librarian-grounding/` (runs the agent in-process, no arms, no timing);
`scripts/eval/agentic-qa-6182/` (blind judge packet + driver, for a different task). The harness
here is built from the first; the judge packet follows the second's X/Y blinding.

## Arms
- **A** — today's request: `gemini-3-flash-preview`, default thinking on every round.
- **B** — `thinkingConfig: { thinkingLevel: LOW }` on every round that offers tools, and one
  system-prompt line asking for all first-round searches at once, in parallel. The forced
  no-tools synthesis round keeps the default thinking. Same model, same grounding and citation passes.
- **A2** — A run a second time, on the 8 questions in `questions.json` `aVsA`. A-vs-A2 is the noise floor.

Questions: `questions.json` (40, frozen before any run). Order is interleaved per question.

## Judging (`measure: preference`, source-grounded)
- Per question, the two answers are shown as X and Y in a seeded random order, with the question and
  the page text of the sources both arms retrieved (cited pages first).
- Criteria: answers the question; claims supported by the pages given; useful sources; no invented quotes.
- Verdict: X better, Y better, or tie. Plus, per answer, `grounding_failure` (a quotation not on any
  page given, or a claim the cited page contradicts or does not support).
- Two Opus judges (Claude subscription). Where their verdicts differ, a third Opus judge decides.
  Grounding flags: majority of the judges who read the pair.

## Decision rule
- Noise floor **N** = |X wins − Y wins| / 8 on A-vs-A2, taken as at least 1/8 (the resolution of an
  8-question control).
- B's net loss **L** = (B losses − B wins) / 40.
- **Quality gate passes iff** L ≤ N, **and** the questions where only B has a grounding failure are no
  more than the questions where only A has one. Every B-only grounding failure is read by eye and listed.
- **Ship B as the default iff** the quality gate passes and B's median time-to-done is lower than A's.
  Otherwise B ships behind `LIBRARIAN_FAST_TOOL_ROUNDS`, off.
- Speed is reported as p50/p90 of time to first text and time to done, per arm, on the same 40 questions.

## Envelope
Approved by Derek 2026-10-18: ≤ 100 Librarian turns, stop at $4 by the turns' own usage numbers.

## Amendment before the main run (smoke test, 4 turns, excluded from analysis)
- Smoke (q02 A and B; q02, q03 B): B's thinking tokens fell from 947 to 0 and its searches left at
  1.4–1.9 s instead of 3.9 s, but at LOW thinking the model wrote no opening sentences before its tool
  calls, so its first words came at 18–21 s against A's 3.1 s. Rewording the B line to ask for the
  Step 1 opening first did not bring them back (2 of 2). The reworded line is the one that runs.
- Search tool results took 17–20 s from this box in both arms; both arms share it.
- Added to the ship rule, before any main-run turn: **B ships as the default only if its median time
  to first text is also no later than A's.** A reader waiting 20 s for a first word is the experience
  this issue is about, whatever the time to done.
- Turns: 4 smoke + 88 main = 92 of the 100 approved.
