---
stage: pipeline
measure: [none]
feeds: prompt
landed: src/lib/embassy/librarian.ts
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Requiring a tool call on a follow-up's first round, with no_search_needed as the way to decline, cut research follow-ups answered without a search from 70.7% to 2.4% (n=41) on flash-lite, against 29.3% for the prompt lines alone. Not measured on gemini-3-flash-preview."
status: adopted
decision: "Follow-up search on by default in src/lib/embassy/librarian.ts; LIBRARIAN_FOLLOWUP_SEARCH=0 turns it off (#8151)"
superseded_by: null
issue: [8151]
---
PRIOR ART: `scripts/eval/librarian-speed-6904/run.ts` (the in-process harness and interleaved arms; it sends first questions with no history). Harness: `scripts/eval/librarian-followup-8151/`.

## 2026-11-05 · Does the Librarian search when a reader asks a follow-up? (#8151)

**Who it is for.** A reader part way through a thread who asks a closer question and gets an answer from the model's memory: no page to check, and links built from memory.

**Design.**
- 50 follow-ups from real threads (`embassy_messages`, 90 days to 2026-11-05), each with its real history, one per thread, drawn by seeded hash from 60 answers that used no tool and 30 that did. Labelled by hand before any run: 41 research, 9 other (thanks, requests to write something). One labeller, no second opinion. The questions stay private.
- The production agent ran in-process on `earthai-l7a` against production data.
- **Arms:** A = today's prompt. P = the follow-up prompt lines alone. B = those lines, and the first round must call a tool, with `no_search_needed` as the way to decline. No new model call.
- A and P ran interleaved. B ran afterwards once P had failed, so B's comparison with A is not interleaved.
- **Answer model: `gemini-3.1-flash-lite`, not production's `gemini-3-flash-preview`.** Only flash-lite may run on the paid API without asking. The search tool's query embeddings still ran on `gemini-embedding-2-preview`, as they do in any Librarian turn.

**What this does not show.**
- The search rate, latency or cost on the production model. Flash-lite searches far less on its own: of the 20 follow-ups drawn because production had searched, arm A did not search on 10. Treat the 70.7% baseline as flash-lite's, not as a production rate; production's is 16.7% of follow-ups (373 of 2,202 in this draw, including non-research).
- Answer quality. No judge read these answers.

**Search rate** (a search = any tool but `no_search_needed`, `add_to_notebook`, `present_choices`):

| arm | research, no search (n=41) | other, no search (n=9) |
|---|---:|---:|
| A | 29 (70.7%) | 8 (88.9%) |
| P | 12 (29.3%) | 6 (66.7%) |
| B | 1 (2.4%) | 4 (44.4%) |

The gate in #8151, under 3% of research follow-ups, is met on flash-lite at n=41; one miss in 41 is a wide interval. B over-searches: 5 of the 9 "other" messages got a search, including a one-word agreement. It declined 5 times in all (one research message).

**Latency and cost, all 50, A vs B** (flash-lite, in-process; tokens also priced at production's rate of $0.50/$3.00 per million, ignoring cached input):

| arm | n | first text p50 | done p50 | done p90 | rounds | prompt tok | $/turn flash-lite | $/turn at 3-flash rate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 50 | 4.8 s | 9.3 s | 17.1 s | 1.30 | 21.9K | 0.0086 | 0.0173 |
| B | 50 | 11.7 s | 16.5 s | 26.2 s | 2.02 | 39.1K | 0.0130 | 0.0259 |

Paired, B finished a median 5.3 s later. Split by what A did on the same question:

| what A did | n | first text p50, A → B | done p50, A → B | $/turn at 3-flash rate, A → B |
|---|---:|---|---|---|
| searched | 13 | 9.4 → 9.2 s | 14.3 → 12.2 s | 0.0252 → 0.0239 |
| did not search | 37 | 4.5 → 12.4 s | 8.7 → 17.6 s | 0.0145 → 0.0266 |

So a turn that was searching anyway costs nothing extra. The price is paid by the turns that now search, and it is mostly the search itself. First text moves the most, since a required tool call leaves no opening sentences before the search; the reader sees search steps during that wait.

**Expected production cost, from production's own records (not this replay):** follow-ups over 90 days: no-tool n=373, $0.0142/turn; searched n=1,829, $0.0293/turn. If all 373 had searched: about $5.60 more over 90 days, 9.6% on follow-up spend. A declined turn pays one extra round instead.

**Links.** Book links in the raw answers, checked against `books` (`visible: true`, `pages_count > 0`), before the post-answer repair:

| arm | turns | book links | not live | in turns that searched |
|---|---:|---:|---:|---:|
| A | 50 | 106 | 33 (18 turns) | 0 |
| B | 50 | 93 | 0 | 0 |

Every dead slug came from a turn that had not searched, which is the mechanism this change removes. Author and page-number links were not checked: a first attempt over HTTP hit the site's rate limit (429), so that pass was discarded. No blank answers in either arm. Sourcing notes fell from 26 of 50 answers to 10.

**Spend.** $1.71 by the turns' own usage numbers: A and P $0.968 on 100 turns, B $0.648 on 50, smoke $0.045 on 4, final-code check $0.052 on 4. Side effects: one `ai_usage` row per turn and `embassy_errors` rows with `threadId` null when a citation was flagged, which the admin health count sees for 24 hours.

**Changed after the run.** The first round's allowed tools now exclude `present_choices` and `add_to_notebook`, because the first ends a turn with no answer. Arm B ran before this. No B turn's first round called either tool, so the restriction would not have blocked any of them. 4 more B turns on the final code ran without error ($0.052).

**Next.** Read `toolCalls` on real follow-ups once this ships: the share of research follow-ups with no search, the `no_search_needed` reasons, and `usage` tokens per turn. That is the production measure this replay could not make.
