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
