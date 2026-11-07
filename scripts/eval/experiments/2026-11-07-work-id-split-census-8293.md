---
stage: metadata
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 3056
n_pages: null
verdict: "A census of the two unjudged routes plus the #8293 extras found 127 work_id clusters that clearly join different works (256 books to move) and 31 more that are arguable (35 books). The census covered all 1,987 model-merged clusters with no second judge and all 169 legacy seeds, and a reader read every flagged cluster. The model route holds a different work in 89/1,987 clusters (4.5%) on clear calls, 114 (5.7%) with arguable ones. Legacy seeds: 16/169 (9.5%), and 19 (11.2%) with arguable. The planted gate passed at 60/60, with 30/30 controls clean. The split writer dry-runs the clear list with 0 refusals."
status: informational
decision: "The reviewed list and a dry-run-only split writer are ready. Applying them waits for Derek (#8293). Containers (283) and volume-or-part (32) stay as they are."
superseded_by: null
issue: [8293, 8291, 7761, 4329]
router_evidence: "none — catalogue-identity work, no OCR or translation route"
feeds: repair
---
## 2026-11-07 · Which live work_id clusters must be split, and how? (#8293)
<!-- PRIOR ART: 2026-11-07-work-id-overmerge-audit-8291.md measured a sample of the same routes with the same instrument (overmerge-audit.mjs, reused unchanged here, with a census subcommand added); scripts/maintenance/apply-verified-work-merges.mjs is the merge writer whose backup/sweep_log shape the split writer copies; scripts/lib/work-id-remint.mjs already knew a split writes no alias for the old id. -->

**Why.** #8291 estimated that about 8% of the clusters in two routes join different works. That figure came from a sample. Splitting needs a list: every cluster, which books leave, and where each goes.

**Frame.** This uses the #8291 frame, reproduced exactly. The census covers every not-yet-judged cluster in two routes: model merge with no second judge (1,868 new plus the 119 #8291 read, so 1,987) and legacy seed (169). Nothing was stratified. Read-only throughout: no `work_id` changed on production.

**Gate, read before any result.** A new planted set, `overmerge-planted-8293.jsonl` (seed `overmerge-8293-2026-11-07`): 30 easy, 30 hard and 30 known-good controls, each read first. Result: **60/60 caught [94–100]**, and the strict count is also 60/60. Controls: 30/30 `all_same_work`, with 0 false alarms. Passed.

**Judge.** `overmerge-audit.mjs census` uses `claude -p --model sonnet` on the subscription with the prompt unchanged: 347 calls, 0 failures. Model route: same 1,104, unsure 121, volume-or-part 259, different 115, container 269. Legacy route: same 24, volume-or-part 69, different 21, container 4, unsure 1.

**Read.** The read list was 603 clusters and 3,056 books (466 hidden). It holds the 531 the census flagged, the 28 rows #8291 confirmed, 19 Tesla patent clusters and 31 `local:n::` empty-author keys. Eight Opus readers worked with `split-read.mjs` (record packet, OCR pages, page images, existing-work lookup). For each different-work call they named the odd books and their destination, and labelled the evidence. Only image-opened claims are called by eye. I then read all 127 clear splits myself, and they hold. The weakest are same-subject disputations by different respondents (Burckhardt *de tutelis*, Zwinger *de resurrectione*), and I kept them as clear.

| label | clusters | books in them |
|---|---|---|
| different work, clear | 127 | 711 (256 move) |
| different work, arguable | 31 | 150 (35 move) |
| container (listed, none split) | 283 | 1,653 |
| volume or part (listed, none split) | 32 | 158 |
| same work | 118 | 353 |
| undecided | 12 | 31 |

Evidence for the clear calls: 101 from the record, 23 from OCR text, 3 from the image. For the arguable calls: 19 record, 9 OCR, 3 image. By route, clear/arguable: model 89/25, legacy 16/3, Wikidata 4/1, title+author 17/2 (Tesla and `local:n::`), second-judged 1. Tesla: 17 different work, 2 same. `local:n::`: 2 different work, 28 same, 1 container. Of the 28 #8291-confirmed rows, 27 were confirmed and 1 is undecided. A reader noted six QIDs whose Wikidata item names a different work than the books carrying it (Q108374728, Q135214551, Q1242501, Q15715550, Q110965843, Q1230444). That is out of scope here.

**Writer.** `scripts/maintenance/apply-reviewed-work-splits.mjs`, with the pure planner in `scripts/lib/work-split-plan.mjs` and tests in `tests/unit/work-split-plan.test.ts`. It runs as a dry run by default. The dry run writes the plan with a full before-document backup of every moving book. `--apply <plan>` re-reads every carrier and refuses a cluster whose ids, slugs or aliases have changed. It logs one row per cluster to its own collection, `work_id_splits`, and one `sweep_log` row per book; `--revert <sweep>` undoes them. It does not log to `work_id_merges`, because every reader of that collection treats a row as winner ← losers: the overmerge audit and the admin merge count would both count a split as a merge.

**Alias rule.** The source id stays with the books that do not move. It never becomes an alias on a moved book: `workAliasTarget` runs before the editions query and has no liveness check, so one such alias would redirect every stayer's address. An alias the stayers hold, or the stayers' live slug, is dropped from the moved books. An alias only moved books hold goes to the moved group with most holders. Moved books get `work_id_source: work-split:reviewed`, which the nightly `--remint-local` leaves alone (it rewrites `local-mint` only).

**Dry run, clear list.** 127 clusters, 0 refused. 256 books move, 24 of them not visible (25 `hidden`), in 182 groups: 49 to an existing work_id, 133 to new ids (0 restored retired ids). 2 aliases are kept on moved books and 66 dropped; the source id is aliased 0 times. With arguable rows included: 157 clusters, 291 books, 1 refused (Q135214551, whose target Q1242501 is itself split in the run).

**Readers that notice** (clear list):
- `/work/[id]` (`src/app/work/[id]/page.tsx`, ISR 6h): 306 work paths to revalidate.
- `/book` work siblings (`src/lib/work-siblings.ts`, ISR 24h): 232 book pages.
- The nightly `assign-work-slugs.mjs` re-slugs by work_id; the writer sets the slug itself.
- `books_catalog` (`scripts/workers/sync-books-catalog.mjs`, incremental on `updated_at`): needs a sync after apply.
- First-translation cards (`work_translation_history`, keyed by work_id): 93 sit on source ids. Moved books leave them.
- `src/lib/canon-works.ts`: 2 canon entries name a source id (`aristotle-metaphysics`, `Q172891`). Their pages keep the stayers only.
- `work_merge_queue`: 22 pending pairs were computed on fused clusters.
- Orchestrator copy-dedup (`scripts/workers/lib/work-copy-dedup.mjs`, every 2 min): 26 moved books that a stayer stood in for become eligible for processing. That is up to 4,513 pages of OCR and 11,748 pages of translation, i.e. **spend**. Most of them are `parked` or `archive_complete`.
- Sitemap and works index: 11 new multi-edition works appear.
- Search work grouping (`src/lib/work-grouping.ts`): follows the new ids.
- Embeddings and author pages: no effect.

**Not done here.** Nothing was applied. `merge-work-clusters.mjs` (identical-title and edition-conflict lanes) has no memory of splits and could rejoin a split pair; a guard that reads `work_id_splits` is a follow-up. Closing `llm-verify-work-merges.mjs --apply`, the path that left these 1,987 clusters unjudged, is in its own PR, #8313.
