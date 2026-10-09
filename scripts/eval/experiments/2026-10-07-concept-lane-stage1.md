## 2026-10-07 · Does the concept-abstract lane, built on 1,216 books, put more traditions in the first ten results than the page vectors? (#6173 stage 1)
<!-- PRIOR ART: scripts/eval/experiments/2026-10-07-embedding-granularity-cross-tradition.md (#6173 pilot; the same 25 queries on a 12K-page scratch pool with in-memory vectors) and 2026-10-07-tradition-diversity-rerank.md (#6211; the page lane's re-rank, judged on the pilot pool and counted by label in production). Neither reads the stage-1 `page_concepts` table through the production code path, and neither has a same-books control. -->

- **Question.** The pilot proposed a second index: a model-written abstract of each page's ideas, embedded. Stage 1 built it for 1,216 books (325,308 pages). Read through production's own code, does it beat the page vectors on the pilot's 25 queries, and by how much once the choice of books is taken out?
- **Answer: yes, by about half a tradition, with no loss of precision.**
  - **Same 1,216 books, spread on:** relevant traditions in the first ten go from **3.76** (page vectors) to **4.36** (abstracts), +0.60 (95% CI [0.16, 1.00]; 14 queries better, 2 worse). P@10 0.68 → 0.73 (+0.05, CI [−0.05, 0.14]).
  - **Same books, spread off:** 2.92 → 3.40, +0.48 (CI [−0.12, 1.08]; 12 better, 6 worse). The interval includes 0.
  - **Against search today** (page vectors, whole library, spread on): 3.36 → 4.36, **+1.00** (CI [0.44, 1.52]; 16 better, 4 worse). About 0.4 of that is the choice of books, not the index: the page vectors on the same 1,216 books already reach 3.76.
  - **No query is left with one relevant tradition or none** in the abstract lane (0 of 25). The page lanes leave 1 to 3.
  - **The gain is smaller than the pilot's** (+1.12 on a 12K-page pool).
- **measure:** accuracy against by-eye relevance. `rel_trad@10` = distinct tradition families (`traditionFamily(books.tradition)`, the label production's re-rank uses) with a relevant page in the top 10; `P@10` = relevant pages in the top 10. Relevant = a gold passage, or by-eye grade 2. These families are not the pilot's eight shelf labels, so these numbers do not line up with the pilot's 1.68 and 2.80.

### What was tested

Five lists of ten per query, all through `conceptPageSearch` or its own steps (`scripts/eval/cross-tradition/concept-lane-stage1.mts`):

| list | index | books | spread |
|---|---|---|---|
| `page_all` | page vectors (`match_semantic`) | whole library | on (search today) |
| `page_s1` | page vectors | the 1,216 stage-1 books | off |
| `page_s1_div` | page vectors | the 1,216 stage-1 books | on |
| `concept` | abstracts (`match_page_concepts`) | the 1,216 stage-1 books | off |
| `concept_div` | abstracts | the 1,216 stage-1 books | on |

- **The control.** Production has no exact search inside 1,216 books (`match_pages_in_scope` is bounded work). The two `page_s1` lists read `page_translations` directly: the HNSW index with pgvector's iterative scan and a `book_id` filter, 40 candidates, then the same live-book filter and `diversify` call that `conceptPageSearch` makes.
- **Judging.** 811 pages (every non-gold page in any list) were read by eight Claude Sonnet readers, in book order, with the list and the rank hidden, up to 2,500 characters of page text each. Grades: 2 = states or develops the idea, 1 = touches it, 0 = not about it. I re-read 14 grades and agreed with all 14.
- **Not graded:** 8 pages whose text is not in English (Tibetan, Syriac), all in `page_all`. They count as not relevant. Five are in one query (c17), where `page_all` therefore scores 0. Counting them relevant would raise `page_all` by at most 0.04.

### Result

| list | rel_trad@10 | P@10 | families@10, any page | books@10 | queries with ≤ 1 relevant tradition |
|---|---|---|---|---|---|
| `page_all` (search today) | 3.36 | 0.70 | 4.12 | 8.1 | 3 |
| `page_s1` | 2.92 | 0.70 | 3.64 | 6.8 | 3 |
| `page_s1_div` | 3.76 | 0.68 | 4.92 | 7.8 | 1 |
| `concept` | 3.40 | 0.76 | 4.00 | 8.5 | 0 |
| **`concept_div`** | **4.36** | 0.73 | 5.52 | 9.1 | 0 |

Paired differences over the 25 queries (bootstrap, 10,000 resamples, seed 6173):

| comparison | rel_trad@10 | better / worse | P@10 |
|---|---|---|---|
| `concept` − `page_s1` | +0.48 [−0.12, 1.08] | 12 / 6 | +0.06 [−0.05, 0.16] |
| `concept_div` − `page_s1_div` | +0.60 [0.16, 1.00] | 14 / 2 | +0.05 [−0.05, 0.14] |
| `concept_div` − `page_all` | +1.00 [0.44, 1.52] | 16 / 4 | +0.03 [−0.06, 0.13] |

Gold passages almost never reach a top ten in any list (0.04 to 0.08 per query). They were found by reading for a tradition's own words in a 12K-page pool; in the whole library other pages rank above them.

### The abstracts themselves: 10 read against their page images

Ten abstracts, one per book language (English, German, Latin, Pali, Greek, Sanskrit, three Chinese editions, Arabic-Latin), seeded draw from the 325,308.

- **10 of 10 describe the page in the image.** None describes another page or another book.
- **10 of 10 use no proper name and no term of art**, as the prompt asks.
- **2 of 10 add a small inference the page does not state.** The Aṅguttara-Nikāya abstract says the teacher's insight "allows the teacher to guide others"; the page lists the powers only. The Bhāgavata Purāṇa abstract says the deeds prove "the indwelling soul possesses power"; the page says they prove the Lord's.
- **Provenance:** all ten carry model (`gemini-3.1-flash-lite`), `prompt_version` (`concept-abstract-v1`), run, `content_hash` and the hash of the page text they were made from.

### What was built

- **1,216 books, 343,347 abstracts** on `pages.concept_abstract`; 18,039 are `NONE`. **325,308 rows** in `page_concepts` (1,210 books), with an HNSW index, 1.45 GB in all.
- **Spend: $43.42 of the $50 approved** ($41.44 generation, $1.98 embedding). This test added 25 query embeddings.
- About 2,000 selected pages have no abstract: their requests errored inside finished Batch jobs.

### Reading it

- **The lane helps, and less than the pilot said.** +0.5 to +0.6 on the same books is the fair figure. The +1.0 against today's search mixes in the stage-1 books, which were chosen from eight tradition shelves.
- **The spread re-rank and the lane add up.** Each alone gives about +0.5 to +0.8 on these books; together 2.92 → 4.36.
- **Precision did not fall.** The pilot saw the abstract lane below chunks on P@10; here it is level with or above the page vectors.

### Limits

- **The queries are the pilot's**, written by an AI in the same plain register as the abstracts. The stage-1 plan asked for 25 queries written by people; nobody has written them.
- **The judges are a model**, and lenient compared with the pilot's (P@10 0.70 here against 0.36 there, on a far larger library). The comparison between lists is paired and blind; the absolute values are not comparable with the pilot.
- **No bar was set before this run.** The pilot's bar (+1.0 over today, +0.5 over the best arm that needs no new index, both intervals above 0) is met at exactly +1.00 and +0.60, and the first of those is helped by the book selection.
- **25 queries.** The no-spread interval includes 0.

### Next

The corpus-wide pass is about $530 at Batch prices and stays one decision. Before it: 25 queries written by people, run with this script.

**Reproduce:**

    node --env-file=.env.production.local node_modules/.bin/tsx scripts/eval/cross-tradition/concept-lane-stage1.mts retrieve --dir D
    node --env-file=.env.production.local node_modules/.bin/tsx scripts/eval/cross-tradition/concept-lane-stage1.mts score --dir D --date 2026-10-07

Lists, judgments and scores: `scripts/eval/cross-tradition/results/2026-10-07-concept-lane-stage1-*.json`.
