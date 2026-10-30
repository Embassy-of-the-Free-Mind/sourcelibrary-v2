---
stage: metadata
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 5372
n_pages: null
verdict: "The author-blocked flash-lite merge lane proposes 1,777 HIGH work merges over 53,111 author-linked live books. A Sonnet judge reading every book in every group accepts 64.6% [62.1–66.9] of the normal groups and 49.1% [43.1–55.0] of the 37 largest authors' groups; about 10% of all groups contain a different work outright. Of the 1,106 groups both models accept, 60/60 read by hand are right (95% lower bound ~94%). Applying them moves 1,620 books (101 hidden) off 1,370 retired ids."
status: adopted
decision: "Flash-lite HIGH alone is not safe to apply (the June 16/16 check was too small). Apply only groups a second model accepts, with scripts/maintenance/apply-verified-work-merges.mjs (full before-state backup, hidden carriers moved, slugs aligned, aliases kept). Applied 2026-10-30 on Derek's go: 1,620 books moved, 0 stale, books_catalog synced (3,345 rows)."
superseded_by: null
issue: [7761, 3887, 4246]
router_evidence: "none — a catalogue-identity measurement, no OCR or translation route"
---
## 2026-10-30 · Can the existing merge lane be applied as is? (#7761)
<!-- PRIOR ART: scripts/analysis/llm-verify-work-merges.mjs (the proposer; June validation 16/16); 2026-10-29-work-identity-recall-7761.md (the recall gap this closes part of); scripts/eval/work-recall/merge-precision.mjs (the second judge). -->

**Why.** About one live book in six has an edition or translation under another work_id (previous entry). The coverage report shows the merge lane has judged only 8,411 of 53,111 author-linked live books (16%).

**Run.** `llm-verify-work-merges.mjs` on all 5,226 author blocks (CONC 32, rolling pool) and `--mega` on the 37 authors with >50 work_ids: `gemini-3.1-flash-lite`, thinking off, temperature 0, ~6 minutes plus ~9 minutes. 1,510 + 267 HIGH groups. Then `merge-precision.mjs --n all`: `claude -p --model sonnet` (subscription, no tools) reads every BOOK in each group (title, author, year, language, pages; up to 4 per existing id) and gives one verdict.

| | groups | all same work | volume or part | container / commentary / excerpt | different work | unsure |
|---|---|---|---|---|---|---|
| normal blocks | 1,510 | **975 (64.6%)** | 116 | 162 | 110 | 147 |
| mega authors | 267 | **131 (49.1%)** | 27 | 50 | 30 | 29 |

The 40-author pilot (the largest normal blocks) was worse, 6/20, with the Suyuti, Ptolemy and Avicenna groups mixing treatises, a single book of the *Canon*, and collected volumes.

**By hand, accepted groups only.** 40 drawn uniformly from the normal 975 and 20 from the mega 131: **60/60 right.** They are respelt reprints (Linnaeus *Systema vegetabilium* 1774/1784/1797), duplicate scans (Libavius *Alchemia* 1597), translations (Alberti *De re aedificatoria* Latin 1485, Italian 1546–1833, French 1553; Medina *Arte de navegar* in Spanish, French, Dutch; Bullinger's *Confessio* in Latin, German, French), manuscript witnesses of one text (Flexel, Cod. Pal. germ. 325 and 836), and a Nôm and a quốc ngữ *Kim Vân Kiều* of 1894. Verdicts by title and record, not by page image.

**Apply plan (dry run).** 1,106 accepted groups → 1,105 planned (1 has no existing id), 1,620 book writes, 101 of them hidden books that carry a retired id, 1,370 retired ids kept as aliases. Backup: `scripts/output/verified-work-merges-backup-*.json` holds each book's full before-state.

**Applied 2026-10-30.** 1,620 books moved (0 changed since plan), 1,105 `work_id_merges` rows, `sync-books-catalog.mjs` 3,345 rows, 0 errors. Of the 59 frame books the judge found with an unlinked sibling on 2026-10-29, **15 now share a work_id with it** (27 of 228 judged pairs), so the judge-as-called miss rate on that frame falls from 59/291 (20.3%) to 44/291 (15.1%). Known flaw: the surviving work_title is the winner id's own, so Alberti's work page now reads *L'architettura* rather than *De re aedificatoria*; the proposal's uniform title should win.

**Titles, 2026-10-30.** For the 906 merged works whose books did not already all carry the proposer's title, `title-judge.mjs` (Sonnet CLI) chose between CURRENT and PROPOSED or corrected both: proposed 652, current 32, corrected 222. Of the 222, 166 are found in our own records and 56 are not. I read all 56: they are spelling normalisations or the original-language title (Dürer *Vier Bücher von menschlicher Proportion*, Bodin *De la démonomanie des sorciers*), and one I pinned by hand (Vesalius → *Epitome*). `retitle-verified-work-merges.mjs` wrote 2,383 books (216 hidden) in two runs, 1,814 + 569, after the first died partway. Ids and slugs are unchanged. Live check: https://sourcelibrary.org/work/l-architettura-di-leonbatista-alberti now titles *De re aedificatoria: 11 editions*. Backups are in ops `backups/work-merges-7761/`.

**Not established.** The 17,795 live books with no `author_id` are outside this lane.
