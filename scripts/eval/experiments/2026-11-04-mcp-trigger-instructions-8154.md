---
stage: reader
measure: [none]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "New server instructions that say when a reader needs primary sources raised connector use on 30 history questions from 17 to 30 (13 gained, 0 lost; exact McNemar p = 0.0002) and left 10 modern questions at 0. Claude Code on Sonnet only, one run per question, web tools denied, questions written by the author."
status: adopted
decision: "Ship the new instructions. They passed the rule fixed before the run (at least +5 of 30, at most +1 of 10). Claude chat is not measured here; read the live rate from the session funnel in #8159."
issue: [8154]
---

PRIOR ART: `scripts/eval/mcp-latency-probe.mjs` (server speed, not model behaviour). Nothing under `scripts/eval/` measured whether a model chooses a tool.

## 2026-11-04 · Do better server instructions make Claude use the connector when it should?

**Question.** The instructions a client reads were mostly about volunteer review shifts. Does saying when a reader needs primary sources change whether Claude reaches for the connector, without firing on questions we cannot help with?

**Method.** 40 questions in `questions.json`, run once per arm through `claude -p --model sonnet` in an empty directory, 80 runs in all. A local server (`shim.mjs`) served the live production tool list with the arm's instructions and returned a stub for every call. A run counts as triggered if it called any of our tools. Web, file and agent tools were denied.

**Rule, fixed before the run.** Ship if history questions trigger at least 5 more times of 30, net and paired, and modern questions at most 1 more of 10.

**Result.**

| Questions | Old | New | Gained | Lost |
|---|---|---|---|---|
| History, n = 30 | 17 | 30 | 13 | 0 |
| Modern, n = 10 | 0 | 0 | 0 | 0 |

Exact McNemar on the 13 discordant history pairs: p = 0.0002. One run exited non-zero (new arm, history question 1) after it had already called a tool, so it counts as triggered; counting it as a miss gives 29 of 30 and does not change the decision.

**What this does not show.**
- **Claude chat.** The test ran Claude Code. Chat may treat server instructions differently, and ChatGPT and Grok were not run.
- **The absolute rate.** With web search denied, the connector was the only way to look anything up, so 30 of 30 is higher than a reader with web search would see. The gain is the finding, not the level.
- **Near misses.** The modern questions are easy negatives. Modern scholarship about the past, the likeliest over-trigger, was not tested.
- **Answer quality.** Every call returned a stub, so this says nothing about whether the answers improved.
- **The questions.** The author wrote both the questions and the new wording, one run each. No real user questions exist to draw from, since `mcp_tool_calls` holds tool arguments rather than what people asked.
