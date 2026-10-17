---
stage: pipeline
measure: judged
languages: []
scripts: []
canons: []
n_books: null
n_pages: 739
verdict: "On 30 questions written in advance, Jev re-ranking about 300 production candidates puts a relevant page in 98% of top-10 slots (96–100), against 54% (46–61) for search_translations and 70% (63–76) for search_concept, at $0.011 and about 2 s a question."
status: undecided
decision: "Recommended: offer the 300-candidate Jev re-rank to the Librarian as a passage tool for question-shaped requests; not in the /search UI yet, and not as a replacement for the untranslated-page lane."
superseded_by: null
issue: 6875
---
## 2026-10-17 · Can Jev re-rank search candidates against a reader's question? (#6875)
<!-- PRIOR ART: 2026-10-13-jev-as-topic-ranker-animism-6652.md (Jev ranks pages for one fixed topic rubric, AUC 0.92; not a per-question rubric over search results); 2026-10-04-clef-vs-jev-instruction-page-screen.md (Clef ties Jev at 5x the price, so Jev was used here). Neither tests Jev in front of the production search lanes. -->

- **Question.** Keyword and meaning search do poorly on requests like "a passage where someone describes leaving their body". If we take the candidates production search already finds and let Jev score each one against the question, are the top 10 better, and at what latency and cost?
- **Answer.** Yes, by a wide margin, on every kind of question tried. The re-rank put a page the judge graded "gives what was asked" in 98% of top-10 slots, against 54% for `search_translations` and 70% for `search_concept`. It beat `search_translations` on all 30 questions, and beat `search_concept` on 27 and tied it on 3. Reading the first ~300 candidates is as good as reading ~1,800, and costs a sixth as much.
- **Ranker.** Jev (`typesafe-ai/jev` on the Vercel AI Gateway), with a fresh OIDC token from `vercel env pull` using the env file's `VERCEL_API_TOKEN`. Clef was not needed.

### Results (n = 30 questions; precision@10, question-level bootstrap 95% CI)

| arm | what it is | P@10 strict (grade 2) | P@10 lenient (grade ≥ 1) | latency per question | $ per question |
|---|---|---|---|---|---|
| A | `search_translations` as served (`/api/search?pages_only=true`) | 54% (46–61) | 91% (87–95) | 6.6 s median (12 of 30 first tries came back `partial`; retried) | 0 |
| B | `search_concept` as served (`/api/search/semantic?level=page`) | 70% (63–76) | 95% (93–97) | 0.6 s | 0 |
| C | Jev re-rank of the full pool (~1,800: keyword lane read to 1,900 + semantic lane) | 97% (93–100) | 100% | keyword read 18 s + Jev 32 s observed (median) | $0.068 |
| D | Jev re-rank of the pool's first ~300 (keyword ~200 + semantic ~100) + A + B | **98% (96–100)** | 100% | Jev **1.8 s** measured (10 questions; one cold start 10 s), on top of the candidate lanes | **$0.011** |

Paired differences (strict): D − A +44 points (37–51), 30 wins / 0 losses; D − B +28 (22–35), 27 / 0; C − D −1 (−3 to +1).

By kind of question (strict P@10, 8/8/8/6 questions): experiences A 43% · B 71% · D 95%; practices 53% · 76% · 100%; claims 59% · 64% · 98%; objects 63% · 67% · 100%.

Hardest question for every arm: q04 "an account of a dream that the dreamer believed foretold the future" (A 50%, B 60%, C 40%, D 70%). Jev's top pages there were about prophetic dreams in general, not accounts of one.

### Method

- **Questions.** 30, written and committed (`questions.json`, commit before any search ran) across experiences, practices, claims and objects, and across alchemy, magic, mysticism, Kabbalah, astrology, medicine, theosophy, memory arts and devotional practice.
- **Baselines** are the production routes the MCP tools call, over HTTP, first 10 pages with a non-empty snippet. `search_concept` keeps its default tradition spread, as the Librarian gets it.
- **Pool.** The production keyword stage (`buildPageSearchStage`, highlight block removed) read to 1,900 pages instead of its 500 cap, plus `semanticPageSearchGlobal` read as deep as it goes (74–100 rows; the RPC stops there whatever `k` is asked), plus the A and B pages. Visible books with pages only. Median 1,808 pages. Text is the English translation (the OCR where a page has none), with the AI continuity notes and translator's notes cut, first 4,000 characters.
- **Jev.** One call per page with two `noul` wordings (the page gives what was asked / it does not), score = (w1 + 1 − w2) / 2, as in #6652. Top 10 by score, at most 2 pages per book. Scores repeat across runs: r = 0.9993 on 3,013 pages scored twice.
- **Judge.** Opus via `claude -p`, one call per question, the union of the four arms' top 10 (21–29 pages) shuffled by a seeded hash and labelled P1…Pn, so the judge did not know which arm a page came from. Grades: 2 = the page gives what was asked; 1 = on the topic but not the kind of passage asked for; 0 = not relevant.
- **Spot check.** I read 20 judgements drawn by seed (8 re-rank pages graded 2, 6 baseline pages graded 0–1, 6 baseline pages graded 2) and agreed with all 20; one (a nightmare graded 0 for "possessed by a spirit") I would have accepted as 0 or 1, which leaves the strict score unchanged. Marked `spot` in the judgements file.

### What this does not show

- **Untranslated pages drop out.** Jev reads English. B returned 80 untranslated (OCR-only) pages across the 30 questions, 49% of them graded relevant (77% of its translated pages); the re-rank's top 10s kept 7. A shipped version should keep the untranslated lane beside it, not behind it.
- **Most re-ranked hits came from the semantic lane** (79% of D's top 10). The keyword lane read deeper than production added 49 of C's 300 pages and did not raise precision.
- **One judge, a model.** Opus graded every page; my agreement on 20 is a check on the judge, not a second reference. Jev and the judge both read the same text, so a page whose text reads as on-topic but is not (a summary, a table of contents) can fool both; the judge's grade-1 reasons show it caught several of these.
- **Ceiling.** At 98% the re-rank is near the top of the scale, so this cannot rank C against D or say how much headroom is left. Recall was not measured: a top 10 can be all relevant and still miss the best passage in the library.
- **B's spread.** `search_concept` spreads its list across traditions by default; part of its gap is that spread, which the re-rank arms did not apply (they cap 2 pages per book only).
- **Latency** was measured from a Hetzner box over the public gateway at 48 concurrent calls. Inside a Vercel function the network leg is different.

### Cost of this run

Jev $2.03 for the 30 full pools plus $0.11 for the latency check (gateway `marketCost`); one Gemini query embedding per question. Opus judging on the subscription via `claude -p`.

**Artifacts.** `scripts/eval/question-search-6875/` (`questions.json`, `pool.ts`, `jev-rank.mjs`, `judge.mjs`, `analyze.mjs`); results in `scripts/eval/results/question-search-6875/` (`summary-2026-10-17.json`, `arms-2026-10-17.json`, `judgements-2026-10-17.jsonl`: every judged page with its arms, Jev score, grade and the judge's reason). Pools and raw Jev scores (~135 MB) stay on the job box.
