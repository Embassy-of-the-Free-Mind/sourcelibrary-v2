---
stage: pipeline
measure: [none]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "With web tools and no connector, Claude linked us on 13 of 50 history questions and Gemini on 0 of 50 (95% upper bound about 6%). Claude's rate splits sharply: 11 of 20 when asked for a named work we hold, 2 of 30 on a general question, and on those general questions it never linked a book or page. Told to use sourcelibrary.org, Claude linked a book or page on 10 of 10 but mostly could not reach the text; Gemini linked only the homepage. CLI agents, not chat products; 240 runs on 2026-11-05."
status: adopted
decision: "Under the rule fixed before the run: discovery volume is the lever for Claude, and the no-install promise fails when pointed, so no paste-this sentence on /connect yet. Fix the first failing step: nothing on the pages an assistant lands on says how to reach the text."
issue: [8161]
---

PRIOR ART: `2026-11-04-no-install-llms-8161.md` (three answers, address and instructions given) and `2026-11-04-mcp-trigger-instructions-8154.md` (connector on, web off). Neither asks whether an assistant finds us unprompted.

## 2026-11-05 · Does an assistant with nothing installed link to us?

**Method.** `scripts/eval/citation-benchmark-8161/README.md`: panel, rule and code were committed before the first run (0e5c6dfb8). 70 fixed questions; `topic` and `work` twice per engine, so 240 runs. Claude Code on Sonnet with WebSearch and WebFetch; Gemini 3.8 Flash Low through agy. Every run answered, no failed exits. The per-run rows are in `results/2026-11-05/`; the raw event streams stayed on gex45, in `/root/jobs/citation-8161/baseline-2026-11-05/raw`. Measured on the production build of d8f92d1ef, within hours of the robots and search changes shipping, so this is a before reading for anything those changes do to search indexes.

**Result, counted per question.**

| Stratum | Engine | Questions | Surfaced us | Linked us | Linked a book or page | A-vs-A disagree |
|---|---|---|---|---|---|---|
| General history (`topic`) | Claude | 30 | 9 | 2 | 0 | 1 of 30 |
| Named work we hold (`work`) | Claude | 20 | 14 | 11 | 10 | 2 of 20 |
| Both | Claude | 50 | 23 | 13 | 10 | 3 of 50 |
| Both | Gemini | 50 | not measurable | 0 | 0 | 0 of 50 |
| Modern (`modern`), the false-positive control | Both | 10 each | 0 (Claude) | 0 | 0 | |

| Told to use sourcelibrary.org (`pointed`) | Linked a book or page | Used our search | Read `llms.txt` |
|---|---|---|---|
| Claude, 10 runs | 10 | 1 | 0 |
| Gemini, 10 runs | 0 (the homepage only, all 10) | 0 | 0 |

Who else gets linked, runs across `topic` + `work`, of 100 per engine. Claude: us 23 (20 on the main host, the rest on reading-room hosts), Wikipedia 18, Internet Archive 9, Gutenberg 8, Deutsche Digitale Bibliothek 8. Gemini: Wikipedia 38, Internet Archive 29, Stanford Encyclopedia 15, Google Books 13. Of our 23, 20 are from `work`.

**Under the rule fixed before the run.**
- Claude surfaced us on 23 of 50 questions and linked on 13 of those 23, which is the row "the path works; discovery volume is the lever". The pooled figure hides the split: on general questions it linked 2 of the 9 where it saw us, and on named works 11 of 14.
- `pointed` is under 8 of 10 for Gemini, so the row "fix the first failing step" applies.
- `modern` is 0, so the run stands.

**What the answers showed.**
- **Linking is not reading.** Claude's `pointed` path runs homepage, then collection, then a book's landing page, and stops. At least 7 of its 10 answers open by saying it found only catalogue summaries (read from the opening lines of each). The text is one link further: for one book checked, the landing page has about 14 KB of visible text and its `/read` page about 260 KB. Nothing on the homepage or that book's landing page mentions `llms.txt` or `/search/text`. So the pointed row in the rule passed on answers that failed the acceptance test, and the README now says so.
- **General questions reach our glossary, not our books.** The links on `topic` are `/encyclopedia/` pages. No general question led to a page of a primary source.
- **Models repeat what the page says about itself.** "No prior translation found" went into answers, and one opens "I found no other English edition". Another also passed on the page's statement that the English is AI-assisted. Our first-translation claims now travel in assistants' answers, which raises the cost of a wrong one (`first-translation-claims.md`).
- **A dead host in Anthropic's search results.** `ficino.sourcelibrary.org` surfaced in 12 runs and returns NXDOMAIN from 1.1.1.1, queried on gex45. `bhutan.sourcelibrary.org`, queried the same way, resolves. Queried from the laptop, 1.1.1.1 returned proxy addresses, so that check does not count.
- Of 94 distinct links of ours, 92 opened. One failure is the dead host. The other, `/encyclopedia/Black%20Bile%20(Melancholy`, timed out after the scorer's URL pattern cut it at the parenthesis, so it is not evidence of a broken page.

**What this does not show.**
- **Claude chat, ChatGPT, Grok or Perplexity.** These are CLI agents with their own search stacks and system prompts, framed to link sources. It is a proxy to re-run and compare with itself.
- **Gemini's real reach.** Its stream holds no tool output, and in 119 of 120 runs it used only `search_web` and opened no page, under an instruction to avoid its shell. Its zero is what its search grounding cited, not a test of whether it could read us.
- **The named-work rate as a level.** Those questions quote our own catalogue titles, such as "Ethica (Latin Original)", which favours a match on our page. No reader phrases it that way. Treat 11 of 20 as an upper bound, and compare it only with itself.
- **Accuracy.** Links were tested for opening. Quotations were not checked against pages.
- **The panel's balance.** `topic` was written by the author, and volume slices were excluded from `work`, which under-samples Chinese.
- **Isolation of the earlier test.** On the laptop, `--setting-sources ''` left the account's `@sourcelibrary.org` email and a session hook in the model's context. The #8154 trigger test ran with those flags from a checkout whose login I did not check, so it may have carried the same hint. Its paired comparison is less exposed than an absolute rate would be.

**Cost.** Subscription only. The account's weekly meter read 70% before and after, so under about one point. No paid API.
