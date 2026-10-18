---
stage: pipeline
measure: [preference]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Thinking LOW on the Librarian's tool rounds, plus one parallel-search prompt line, halves time to done (p50 20.5 → 11.7 s) with no quality loss two blind Opus judges can see (B 20, A 18, tie 2 on 40 readers' questions)."
status: adopted
decision: "Fast tool rounds on by default in src/lib/embassy/librarian.ts; LIBRARIAN_FAST_TOOL_ROUNDS=0 turns them off (PR #6909, #6904)"
superseded_by: null
issue: [6904]
---
PRIOR ART: `scripts/eval/librarian-grounding/` (the in-process harness this extends; no arms, no timings); `scripts/eval/agentic-qa-6182/` (the X/Y blind-judge packet and driver pattern). Registered rule: `scripts/eval/librarian-speed-6904/PREREGISTRATION.md`, committed before the run (`84b11cef3`, amended after the smoke test and before the main run in `7afe79ef8`).

## 2026-10-18 · Can the Librarian answer faster without answering worse? (#6904)

**Who it is for.** A reader at /librarian who types a question and watches. #6904 traced first words at 3.5 s and a full answer at 16–25 s.

**Design.**
- 40 first questions from real threads (`embassy_messages`, 30 days to 2026-10-18), frozen in `questions.json` before any run.
- The production agent (`streamAgenticResponse`) ran in-process on Hetzner against production data, on `gemini-3-flash-preview`, with interleaved arms:
  - **A** = today's request;
  - **B** = `thinkingConfig: { thinkingLevel: LOW }` on every round that offers tools, plus one prompt line asking for every search in the first round, in parallel. The forced no-tools synthesis keeps the default thinking.
  - **A2** = A again on 8 questions, as the noise floor.
- Judging: two blind Opus judges (`claude -p`, subscription) per pair, with X/Y seeded per judge, and a third judge on the 16 pairs where the first two disagreed. Each judge saw the question, both answers as the reader sees them, and the whole text of every page either arm retrieved, cited pages first.
- Measure: `preference`, source-grounded, plus a per-answer `grounding_failure` flag (an invented quotation, or a claim the cited page does not support).

**Timing** (in-process, from Hetzner; time from the call to the event):

| arm | n | first text p50 | first text p90 | done p50 | done p90 | rounds mean (max) | tool calls | thinking tok | output tok | prompt tok | $/turn |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|
| A | 40 | 3.3 s | 17.0 s | 20.5 s | 26.4 s | 2.42 (4) | 3.6 | 910 | 1,450 | 32.4K | 0.023 |
| B | 40 | 2.0 s | 8.0 s | 11.7 s | 20.3 s | 2.00 (2) | 2.8 | 0 | 1,188 | 23.4K | 0.015 |
| A2 | 8 | 3.6 s | 18.5 s | 16.8 s | 24.1 s | 2.38 (4) | 3.1 | 874 | 1,401 | 32.4K | 0.023 |

- Paired on the same question, B finished sooner on 37 of 40 (median −7.2 s) and showed its first words sooner on 28 of 40 (median −2.3 s).
- `thoughtsTokenCount` fell from about 910 per turn to 0, so `thinkingLevel: LOW` is honoured as spelled in `@google/genai` 1.49 (`ThinkingLevel.LOW`).
- Goals from #6904: a full answer at least 25% faster is **met** (−43% at p50). First words at 1.5 s or sooner is **not met** in this harness (2.0 s at p50).
- In both arms, 19 of 40 turns wrote no opening sentences before the first search. Those readers see search steps and no prose until the searches return, so p90 first text is long in both arms.
- The search tools took about 8.5 s per round from this box (p50, A). CLIP was unreachable from here, so image search fell back to keywords in both arms. Production times will differ.

**Quality** (registered rule; final verdicts after the third judge):

| comparison | B (or A2) wins | A wins | ties | answers with a grounding failure, only in A / only in the other / both |
|---|---:|---:|---:|---|
| B vs A, 40 | 20 | 18 | 2 | 13 / 7 / 8 |
| A2 vs A, 8 (noise floor) | 6 | 2 | 0 | 4 / 1 / 0 |

- Noise floor N = |6 − 2| / 8 = 0.50. B's net loss L = (18 − 20) / 40 = −0.05, inside the floor.
- B-only grounding failures (7) ≤ A-only (13). **Quality gate: PASS.** B's medians for done and for first text are both lower, so **B ships as the default.**
- Each judge alone: J1 B 20, A 17, tie 3; J2 B 19, A 19, tie 2. B is not worse under either judge.
- Judge agreement, J1 vs J2: preference α 0.48 over 48 pairs, **not settled**; grounding flag α 0.63 over 96 answers, **not settled**.
  - Read the win counts per judge, not as facts about the answers.
  - An A-vs-A split of 6–2 means this design cannot see a small quality difference. What it shows is that B is not worse beyond the noise at n = 40, under each judge separately.
- The 7 B-only grounding failures were read against the page text: q09, q13, q20, q24, q29, q33, q34. Each is a claim or quotation pinned to the wrong page of a book the turn retrieved, e.g. a table of contents cited for a summary of the Watchers (q20). None is a quotation found on no page at all. A's 13 are the same kind of failure.

**A discarded first judging pass (instrument fault, disclosed).**
- The first packets cut every page at 2,500 characters. Under that cut, B lost 14–22 with 11 B-only grounding failures, and the gate failed.
- Reading two of those flags against the full page showed both were real quotations further down the page: q11 p.241 at character 3,160, and q18 p.342 at 3,136.
- The packets were rebuilt with whole pages, and with both page-link shapes (`?page=N` and `/page-number/N`). Every judge then re-ran on the same answers. The rule was not changed.
- The fix moved the result, so both passes are kept in `results/` (`judge-discarded-truncated/scored.json`). Three of the first pass's eleven B-only flags (q11, q18, q21) disappear with whole pages.

**Examples.**
- **q03** "When was the first time fungi were mentioned in books?" B wins under both judges; A 22.4 s, B 9.4 s. A cites a Tragus page for Pliny's "phlegm of trees", which is on a different page. B's page-cited claims (Dioscorides, Pliny's silver vessels, Galen via Mattioli, Micheli) check out. Both judges noted that A does better at naming Theophrastus as the earliest source.
- **q20** "What do you know about the book of Enoch" A wins under both judges; A 14.0 s, B 10.2 s. B cites Charles p.15, a table of contents, for its summary of the Watchers, and Milik p.16 for James Bruce and Laurence, neither of whom is on that page. A's quotations match Charles p.82 and the Henoch edition pp.37–38.
- **q14** "How do I identify an engraving I photographed in a museum?" Tie under both judges; A 3.6 s, B 2.9 s. Both answers send the reader to the same Identify an Artwork tool with the same link.

**Quicker first word (route; no gate).** `src/app/api/embassy/chat/route.ts` now runs auth, the body parse and the Mongo connection together. The thread, replay and last-message lookups run alongside the rate limits. The thread and its first message are inserted together.
- The rate limits keep their order (per-IP before the global ceiling) and still finish before any write and before the model is called.
- In `streamAgenticResponse`, the notebook load now runs alongside the catalogue load.
- Time to the `threadId` event, route handler in-process against production Atlas (auth, model and limiter counter names stubbed; `route-bench/`): before p50 53 ms, p90 68 ms; after p50 33 ms, p90 43 ms (n = 20 each, interleaved).
- This removes 2 of 5 sequential Mongo round trips for an anonymous first turn. Atlas is close to this box, so the saving here is small. On Vercel each removed round trip is worth that region's Atlas latency. Most of the 1.0 s pre-model time in #6904's trace is not in this handler's Mongo path.

**Cost.** 92 Librarian turns (4 smoke + 88 main) of the 100 approved, **$1.81** by the turns' own usage numbers (cap $4). Judging was on the Claude subscription: 96 + 14 first-pass judgements (discarded) and 96 + 16 second-pass judgements.

**Replicated?** No. The A-vs-A floor is wide, and judge agreement is not settled.
- After deploy, watch `embassy_messages.usage` (rounds, thinkingTokens), and `embassy_errors` `grounding` and `broken_citation` rows per turn, against the 30 days before.
- A rise in grounding edits per turn is the signal to turn it off (`LIBRARIAN_FAST_TOOL_ROUNDS=0`).

**Also found (both arms).** By majority of the judges, 21 of 40 A answers and 15 of 40 B answers pin at least one claim or quotation to a page that does not support it. That is after the production grounding pass, which checks quotations and numbers against the pages read but not which page a claim is linked to. This is outside #6904's scope.

**Artifacts.** `scripts/eval/librarian-speed-6904/`:
- `questions.json`, `PREREGISTRATION.md`;
- `run.ts` (generation), `build-packets.ts`, `JUDGE-PROMPT.md`, `judge-driver.sh`, `score.mjs`;
- `route-bench/`;
- `results/main.jsonl.gz` (every turn: timings, usage, the final text, sources), `results/judge/` (key, verdicts, scored), `results/route-bench.txt`.
