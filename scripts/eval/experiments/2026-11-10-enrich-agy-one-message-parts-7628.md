---
stage: metadata
measure: [none]
languages: [zho, lat, eng, grc, san, deu, ita, fas]
scripts: [Hani, Latn, Grek, Deva, Arab]
canons: []
n_books: 10
n_pages: null
verdict: "Books over 600K characters, read in parts of one message (120K) instead of 600K conversations of four messages: input tokens 3.70M against 8.00M for the same 10 books (0.46), output 288K against 221K, requests 151 against 92. At input + 6 x output that is 5.44M against 9.34M (-42%). Quotes found verbatim on the pages: 1,074/1,264 (85%; the pilot's whole-book rate was 82%). All 10 written, including 2 books the lane had failed on unparseable JSON. The briefs and abstracts of three books (Zhao Rugua, Selenus, Seneca/Marmita), read beside the stored ones, are as accurate and slightly more specific, with no style-list slips. No parse failures, no retries needed in this run."
status: adopted
decision: "PART_CHARS = 120K for books over MAX_CHARS (600K); books under it keep one conversation (the 2026-10-28 pilot). JSON repair (parseJsonLoose), one retry of an unusable reply, and one agy retry of a book this lane failed, in the same PR."
superseded_by: null
issue: [7628]
feeds: cost
landed: scripts/workers/lib/enrich-agy-lane.mjs
---
PRIOR ART: `2026-10-28-enrich-agy-one-call-7628.md` (the whole-book pilot this changes only for books over its 600K cap) and
`scripts/workers/lib/enrich-agy-lane.mjs` (its header carries the turn-cost note this measures).

## 2026-11-10 · Long books in one-message parts (#7628)

**Why.** agy cuts one message at ~190K characters, so a 600K part went as four 150K messages, and every turn re-reads
the conversation: 150 + 300 + 450 + 600 = 1.5M characters read for 600K of text. A 471K-character book took 242K input
tokens, about twice its text. A book over 600K is already summarized from its parts' extractions (the reduce prompt),
so a smaller part changes only how much neighbouring text the model sees while it extracts.

**How.** `enrich-worker.mjs --agy --compare-out` (nothing written) on 8 long books already enriched by the old lane, one
per language, plus 2 the lane had failed. Old figures are each book's stored `enrich_batch_books.agy` row. Scratch on
the main box: `/data/scratch/sl/enrich-eff-compare/` (`new/*.json`, `analyze.mjs`, `side.md`).

| book | lang | parts old/new | req old/new | input K old/new | ratio | quotes on page |
|---|---|---|---|---|---|---|
| 4e73ce | Chinese | 2/7 | 5/8 | 253/167 | 0.66 | 204/222 |
| 0bb837 | Latin | 3/17 | 11/18 | 823/374 | 0.45 | 112/130 |
| 67e76b | English | 2/11 | 8/12 | 859/368 | 0.43 | 71/88 |
| f4516a | Greek | 2/7 | 6/8 | 368/170 | 0.46 | 45/56 |
| 9ef3ae | Sanskrit | 2/8 | 7/9 | 488/211 | 0.43 | 49/62 |
| 518062 | German | 4/20 | 12/22 | 854/502 | 0.59 | 128/149 |
| 6f2ef8 | Italian | 3/18 | 13/19 | 1383/449 | 0.33 | 119/140 |
| 281b25 | Persian | 2/8 | 6/9 | 566/210 | 0.37 | 42/57 |
| 4794e7 | English (failed before) | 6/33 | 17/34 | 1681/887 | 0.53 | 234/275 |
| f7d8fd | English (failed before) | 2/11 | 7/12 | 725/365 | 0.50 | 70/85 |

**Limits.** The 6x output weight is the 2026-11-07 assumption, not a measured pool rate; at 10x the saving is still
~36%. Requests rise ~64% on long books, so the daily request cap (#8508, 4,000) binds sooner for them; the pool floors
are unchanged. One German part needed 2 messages (page markers pushed it past 150K). Quality was read on three books'
summaries, not judged blind; the index counts against the stored rows are not comparable (the stored read is sliced).
