---
stage: metadata
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 3056
n_pages: null
verdict: "A census of the two unjudged routes plus the #8293 extras found 127 work_id clusters that clearly join different works (256 books to move) and 31 more that are arguable (35 books). The census covered all 1,987 model-merged clusters with no second judge and all 169 legacy seeds, and a reader read every flagged cluster. The model route holds a different work in 89/1,987 clusters (4.5%) on clear calls, 114 (5.7%) with arguable ones. Legacy seeds: 16/169 (9.5%), and 19 (11.2%) with arguable. The planted gate passed at 60/60, with 30/30 controls clean. The six clusters with a wrong Wikidata id were fixed and applied on Derek's note (57 books moved). The split writer dry-runs the rest of the clear list: 125 clusters, 242 books. The default apply skips clusters with a settled first-translation card, which leaves 102 clusters and 208 books."
status: informational
decision: "Only the six wrong-Wikidata clusters were applied (sweep wikidata-six-work-splits-2026-11-07). The rest of the reviewed list waits for Derek (#8293). Containers (283) and volume-or-part (32) stay as they are."
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

Evidence for the clear calls: 101 from the record, 23 from OCR text, 3 from the image. For the arguable calls: 19 record, 9 OCR, 3 image. By route, clear/arguable: model 89/25, legacy 16/3, Wikidata 4/1, title+author 17/2 (Tesla and `local:n::`), second-judged 1. Tesla: 17 different work, 2 same. `local:n::`: 2 different work, 28 same, 1 container. Of the 28 #8291-confirmed rows, 27 were confirmed and 1 is undecided. A reader noted six QIDs whose Wikidata item names a different work than the books carrying it (Q108374728, Q135214551, Q1242501, Q15715550, Q110965843, Q1230444). They are covered in the next section.

**Writer.** `scripts/maintenance/apply-reviewed-work-splits.mjs`, with the pure planner in `scripts/lib/work-split-plan.mjs` and tests in `tests/unit/work-split-plan.test.ts`. It runs as a dry run by default. The dry run writes the plan with a full before-document backup of every moving book. `--apply <plan>` re-reads every carrier and refuses a cluster whose ids, slugs or aliases have changed. It logs one row per cluster to its own collection, `work_id_splits`, and one `sweep_log` row per book; `--revert <sweep>` undoes them. It does not log to `work_id_merges`, because every reader of that collection treats a row as winner ← losers: the overmerge audit and the admin merge count would both count a split as a merge.

**Alias rule.** The source id stays with the books that do not move. It never becomes an alias on a moved book: `workAliasTarget` runs before the editions query and has no liveness check, so one such alias would redirect every stayer's address. An alias the stayers hold, or the stayers' live slug, is dropped from the moved books. An alias only moved books hold goes to the moved group with most holders. Moved books get `work_id_source: work-split:reviewed`, which the nightly `--remint-local` leaves alone (it rewrites `local-mint` only).

**The six wrong-Wikidata clusters, applied.** Derek's inbox note (10:28Z) asked for these six to be fixed and applied, and only these. First I re-checked every id on the Wikidata API. Q108374728 (Bywater *Poetics*) and Q135214551 (Loeb *Letters to Friends*) are P31 Q3331189 edition items, not works. Every target is a work class with the right P50. Rows: `split-wikidata-six-8293.jsonl`. Sweep: `wikidata-six-work-splits-2026-11-07`.
- Q108374728 is dissolved. *De partibus* goes to Q1180725, the Aldine *Mechanica* to Q2337123, and the two MSS, the Aristotle/Ptolemy/Hero codex and Works vol. 2 each get their own local id.
- Q135214551 is dissolved. Offices 1755 and Ethical Writings go to Q1180721, Tusculan 1894 to Q1233156, and the three Orationes to `local:a:cicero:orations`. Rhetorica ×2 get a new `local:a:cicero:opera-rhetorica`. VLF 12 B gets its own id. Phil. Works vol. 1 (1523) goes to the existing *De philosophia* vol. 1 id. The three Manutius 1583 volumes (Opera tomus 8/9) go to `local:a:cicero:ciceronis-opera-tullii`, which already holds 1583 Opera vols 2–10.
- Q1242501: 21 *De officiis* editions go to Q1180721, and the slug `cicero-de-officiis` goes with them. The VLF 70 codex goes to its own local id, not Q1180721, because it holds Topica, Boethius, Macrobius and Seneca but no *De officiis*. That departs from the note. The Somnium-only books stay and are retitled (`cicero-somnium-scipionis`).
- Q15715550: the Arithmetica books go to Q131310260 with their slug. The *musica* MS stays and is retitled.
- Q110965843: all three Apologeticus books go to Q4780426. `/work/Q110965843` now redirects there.
- Q1230444: BPG 74 C (led by the Argonautica) stays and is retitled *Argonautica Orphica*. The hymns ×3 go to Q1313790, and the collected Orphica ×3 to `local:a:orpheus:orphica`, with `homer-orphica` kept as an alias that redirects.

In total 57 books moved and 4 stayers were retitled. Three silent (`under_review`) FT cards were copied to the destination that took most of the books (Q1242501→Q1180721, Q15715550→Q131310260, Q110965843→Q4780426); none was moved. Three pending `work_merge_queue` rows were set to `superseded`. I revalidated 107 paths and synced `books_catalog`, then checked the Supabase counts. Every live page answered 200. Four ids return 404 on purpose, because we hold neither the *Poetics* nor the *Letters*: Q108374728, Q135214551, `aristotle-on-the-art-of-poetry` and `cicero-the-letters-to-his-friends`. Some slugs carry another author's surname (`callimachus-orphic-hymns`, `homer-argonautica-orphica`). The nightly `assign-work-slugs.mjs` builds them from the bylines, so that is a byline problem, not a split one.

*Incident.* The first `--apply` crashed after cluster Q108374728 had moved (6 books plus their `sweep_log` rows). The cause was a `const mainDest` used before its declaration (TDZ). I wrote that cluster's `work_id_splits` row by hand from the plan, with a `note`, and fixed the code by making it a function declaration. On the re-run, the identity check skipped Q108374728, as designed. I revalidated that cluster's paths by hand. So `--apply` is not transactional across clusters, but it can be re-run safely.

**The general case, report only (#8325).** I scanned every QID `work_id` on `books` against Wikidata P31 (`qid-nonwork-scan-8293.jsonl`): 96 QIDs on 454 books are not plain work items. 80 are edition/translation items (322 books), 4 are not a work (47), 4 are physical manuscripts (30), 5 need a translated-work check (46), 2 have no P31 (7) and 1 is a redirect (2). Q108375225 (Ogle *De partibus*) is one of them. None was fixed here.

**Dry run, clear list (after the six).** The run reads 127 rows and yields 125 clusters. It refuses 2, Q108374728 and Q135214551, which no book carries any more. 242 books move, 24 of them not visible (25 `hidden`), in 172 groups: 44 go to an existing work_id and 128 to new ids (0 restored retired ids). 2 aliases are kept on moved books and 66 dropped; the source id is aliased 0 times. With arguable rows: 154 clusters, 282 books, 4 refused.

**Settled-card gate.** 23 of the source ids carry a SETTLED first-translation card (15 `prior_exists`, 5 `no_prior_known`, 3 `not_a_single_work`; 34 moving books). Moving books from under a settled public claim changes what it covers. So `--apply` refuses those clusters unless it is given `--allow-settled-cards`. The default apply is **102 clusters, 208 books** (24 hidden, 104 new ids). With the flag it is 125 clusters, 242 books.

**Readers that notice** (clear list):
- `/work/[id]` (`src/app/work/[id]/page.tsx`, ISR 6h): 295 work paths to revalidate.
- `/book` work siblings (`src/lib/work-siblings.ts`, ISR 24h): 218 book pages.
- The nightly `assign-work-slugs.mjs` re-slugs by work_id; the writer sets the slug itself.
- `books_catalog` (`scripts/workers/sync-books-catalog.mjs`, incremental on `updated_at`): needs a sync after apply.
- First-translation cards (`work_translation_history`, keyed by work_id): 91 sit on source ids, 23 of them settled (gated, above). Moved books leave them. Apply copies a silent card to a destination that takes most of the books.
- `src/lib/canon-works.ts`: 2 canon entries name a source id (`aristotle-metaphysics`, `Q172891`). Their pages keep the stayers only.
- `work_merge_queue`: 20 pending pairs were computed on fused clusters; apply sets them to `superseded`.
- Orchestrator copy-dedup (`scripts/workers/lib/work-copy-dedup.mjs`, every 2 min): 19 moved books that a stayer stood in for become eligible for processing. That is up to 3,955 pages of OCR and 10,858 pages in all, i.e. **spend**. Most of them are `parked` or `archive_complete`.
- Sitemap and works index: 10 new multi-edition works appear.
- Search work grouping (`src/lib/work-grouping.ts`): follows the new ids.
- Embeddings and author pages: no effect.

**Not done here.** Apart from the six, nothing was applied. `merge-work-clusters.mjs` (identical-title and edition-conflict lanes) has no memory of splits and could rejoin a split pair; a guard that reads `work_id_splits` is a follow-up. Closing `llm-verify-work-merges.mjs --apply`, the path that left these 1,987 clusters unjudged, is in its own PR, #8313.
