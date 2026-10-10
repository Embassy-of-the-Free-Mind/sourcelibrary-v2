## 2026-10-07 · Does a tradition-aware re-rank put more traditions in the first ten results without losing known items? (#3514, #3895)
<!-- PRIOR ART: scripts/eval/experiments/2026-10-07-embedding-granularity-cross-tradition.md (#6173; quota and MMR over a 12K-page pool, with by-eye shelf labels and no known-item check) and scripts/eval/embed-format (#6170; the two known-item gold sets). Neither runs the shipped re-ranker on the stored books.tradition labels, and neither measures production's own candidate pool. -->

- **Question.** The #6173 pilot found that re-ordering today's page vectors with a per-tradition quota raised relevant traditions in the top 10 from 1.68 to 2.20. Does the re-ranker we can actually ship (the stored `books.tradition` labels, the 40 candidates `match_semantic` returns) do that, and does it cost known-item recall? The bar from the brief: traditions in the top 10 must rise, and recall@10 on the known-item gold must not fall by more than 0.02.
- **Answer: it passes, and the gain is modest.**
  - **Pilot pool, judged pages:** relevant traditions in the top 10 go from **1.68 to 1.88** (+0.20, 95% CI about [0.00, 0.40]; 7 queries better, 2 worse). Queries with at most one relevant tradition fall from 15 to 10. P@10 0.36 → 0.34.
  - **Known items:** recall@10 unchanged on both gold sets (28 of 30 and 29 of 31).
  - **Production, 25 queries, any page:** tradition families in the first ten go from **2.84 to 4.16**; the largest family's share falls from 0.70 to 0.50. Nobody judged these pages for relevance.
  - **A quota with no score margin gains more (+0.36, CI [0.12, 0.60]) and fails the known-item bar** by one query of 31. The shipped setting is the strongest one that passed.
  - **The ceiling is the candidate pool, not the re-ranker.** In production the 40 nearest pages hold 4.68 families on average, and for one query in 25 a single family. A re-rank cannot promote what retrieval did not return.
- **measure:** accuracy against by-eye relevance on the pilot pool (`rel_trad@10`, as in #6173: distinct traditions with a relevant page in the top 10, using the pilot's gold and judgments); recall@10 against one gold page (set A) or any page of an expected book (set B); a count of label families in production, which is a measure of spread only.

### What was tested

- **The re-ranker:** `diversify` in `src/lib/search/diversity.ts`, called the way `conceptPageSearch` calls it. Each screen of ten holds at most 2 rows per tradition family and 2 per work. Rows are re-ordered, never dropped. With a `margin`, a capped row is passed over only for a row whose cosine is within the margin of it.
- **Labels:** `books.tradition` (#4773), read from Mongo as production reads it. All 1,011 books of the three pools have one. A book counts under its specific label when it also carries a European period label (a Renaissance Latin Kabbalah counts as Jewish).
- **Candidates:** the top 40 by cosine. `match_semantic` returns at most `hnsw.ef_search` = 40 rows whatever `match_count` asks, so 40 is production's pool. The top 100 is reported as a sensitivity check.
- **Default policy:** `defaultDiversity(query)`. Off for a quoted phrase, a year, a query that names a person ("Agrippa on …") or names its tradition ("Sufi metaphysics …"). It left the re-rank on for all 25 concept queries, and turned it off for 16 of 30 set-A queries and 22 of 31 set-B queries.
- **MMR was not built.** It tied the quota in the pilot (2.24 against 2.20) and needs every candidate's vector, which the RPCs do not return.

### Result

Concept, 25 pilot queries, top-40 candidates (`scripts/eval/cross-tradition/rerank-eval.mts`):

| setting | rel_trad@10 | diff vs today (95% CI) | better / worse | P@10 | queries with ≤ 1 relevant tradition | families@10, any page | largest family share |
|---|---|---|---|---|---|---|---|
| off (today) | 1.68 | | | 0.36 | 15 | 3.20 | 0.64 |
| quota 2, margin 0.01 | 1.76 | +0.08 [−0.12, 0.28] | 4 / 2 | 0.35 | 11 | 4.08 | 0.51 |
| **quota 2, margin 0.02 (shipped)** | **1.88** | **+0.20 [0.00, 0.40]** | 7 / 2 | 0.34 | 10 | 4.56 | 0.43 |
| quota 2, margin 0.03 | 2.00 | +0.32 [0.12, 0.52] | 9 / 1 | 0.34 | 9 | 4.92 | 0.38 |
| quota 2, no margin | 2.04 | +0.36 [0.12, 0.60] | 9 / 1 | 0.32 | 9 | 5.36 | 0.31 |
| quota 3, no margin | 1.92 | +0.24 [0.08, 0.44] | 5 / 0 | 0.32 | 12 | 4.92 | 0.35 |
| author (1 per author and work), margin 0.01 | 1.88 | +0.20 [0.04, 0.36] | 5 / 0 | 0.38 | 10 | 3.96 | 0.58 |

Up to 7 of 250 top-10 slots held a page no judge had read; they count as not relevant. With 100 candidates the no-margin quota reaches 2.16 and the shipped setting stays at 1.88. The pilot's own quota on its by-eye labels gives 2.00 at 40 candidates and 2.20 at 100.

Known items, top-40 candidates, recall@10:

| setting | A: 30 #5729 queries, gold page | B: 31 Librarian golden-set queries, expected book |
|---|---|---|
| off (today) | 0.933 (28) | 0.935 (29) |
| quota 2, margin 0.02, all queries | 0.933 (28) | 0.968 (30; gains `ripley-green-lion`) |
| **quota 2, margin 0.02, default policy (shipped)** | **0.933 (28)** | **0.935 (29)** |
| quota 2, margin 0.03, default policy | 0.933 (28) | 0.903 (28; loses `suhrawardi-illumination`) |
| quota 2, no margin, default policy | 0.933 (28) | 0.903 (28; loses `suhrawardi-illumination`) |
| quota 2, no margin, all queries | 0.933 (28) | 0.903 (loses `ibn-arabi-unity`, `suhrawardi-illumination`; gains `ripley-green-lion`) |

Production, the 25 concept queries through `conceptPageSearch` → `match_semantic` (`live-spread.mts`):

| | today | with the re-rank | in the 40 candidates |
|---|---|---|---|
| tradition families in the first ten | 2.84 | **4.16** | 4.68 |
| largest family's share of the ten | 0.70 | 0.50 | |
| books in the first ten | 7.4 | 8.1 | |
| queries with one family only | 3 | 1 | 1 |
| rows of ten that changed | | 2.2 | |

"prima materia" is the plain case: today ten early modern European pages; after, six, with two modern European and two Hermetic. No Arabic, Greek or Chinese page is among its 40 candidates, so none can appear.

### Reading it

- **The bar is met, narrowly.** Traditions rise on the judged pool (+0.20, an interval that reaches zero) and clearly in production's label count (+1.32 families). Known-item recall does not move.
- **The margin is what keeps known items.** It was chosen on the two sets it is reported on, between two values (0.02 and 0.03) that differ by one query. Treat 0.02 as a starting point, not a measured optimum.
- **A query that names its tradition should not be spread.** Both queries the unconditional quota lost ask for one tradition by description. The default policy catches the one that names it ("Sufi …") and not the one that describes it ("philosophy of illumination and the world of light").
- **Where the rest of the gain is.** The pilot's best arm was the quota on a concept-abstract lane (3.24). At full scale the nearest 40 pages are mostly one tradition before any re-rank runs. More traditions on the first screen needs candidates from more traditions: the concept lane (#6173, stage 1 under way), a per-tradition search (#6077), or a wider pool, which today's index cannot serve (40 rows took 4 to 7 s on a cold cache on 2026-10-07, against the app role's 3 s limit).

### Caveats

- **The judged pool is small and balanced** (12K pages, 38 books per shelf). Production is 5.2M translated pages, 56% of books under one label.
- **The pilot's tradition names and the stored labels differ.** Relevance is scored in the pilot's eight traditions; the quota counts in the stored labels' families. The pilot's "Hermetic" and "Christian" shelves are mostly one stored family (early modern Europe), so the quota separates them less than the pilot's labels did.
- **The production measure counts any page.** A spread of traditions with worse pages would score the same. The margin bounds the cosine a swap may give up (0.02); nothing here measures relevance in production.
- **AI judges and AI-written queries**, as in #6173. Set A's queries keep the page's proper names, which is why the policy turns the re-rank off for half of them.
- **The Librarian's fused list was not measured.** It applies the same function to an RRF-fused list (`RRF_DIVERSITY_MARGIN` 0.004, so a row two lanes agree on is never passed over). The live vector lanes were timing out during this run, so a Librarian measure today would be a keyword-lane measure.
- *Replicated?* The production count was run once. The pool measures are deterministic.

### Spend

Under $0.01: query embeddings for the production runs. The pool measures use stored vectors.

### Artifacts

`scripts/eval/cross-tradition/`: `rerank-eval.mts` (pool measures; needs the #6173 and #6170 work directories on the job box), `live-spread.mts` (production count), `untranslated-fused.mts` (#5729 check, for when the index is live), `results/2026-10-07-rerank.json`, `results/2026-10-07-live.json`, `results/2026-10-07-untranslated-fused-before.json` (the #5729 gold through the app today: 4 of 40 in the top 10).
