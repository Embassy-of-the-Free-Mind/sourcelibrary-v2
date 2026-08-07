# A derived store outside the pipeline fails silently

**Read this when:** touching embeddings or any Supabase store derived from Mongo, adding or pausing a scheduled job on the pipeline box, or writing a monitor that asks "is this still running?"

*Added 2026-08-07 after a 60-day outage that nothing detected.*

---

## The incident

Page vectors (`page_translations`) had exactly one writer: the `embed-gemini`
cron. It was found commented out behind a `#PAUSED-GEMINI` marker, its log empty
and dated **June 9** — dark for two months. Measured when finally noticed:

| | books |
|---|---|
| covered | 11,339 |
| thin (<90%) | 4,420 |
| **zero vectors** | **2,462** |

Semantic search was blind on roughly **45% of the corpus**. Nothing alerted, and
nothing could have: an unembedded book and a book with no semantic match return
the same empty list. It surfaced only because a reader spent a working day
concluding the corpus was thin on passages it actually holds, and chasing *that*
led to the vectors. Fixed in #3691 (the pipeline writes them now) and #3690 (the
API says when a book is unembedded). Class-level follow-up: #3692.

## The rules

**A step that lives outside the pipeline can be switched off without anything
downstream noticing.** Enrichment failing is loud; a cron not running is silent.
When a derived artifact is required for a surface to work, write it *in* the
pipeline stage that produces its input, and keep the standalone worker for bulk
backfill only. `enrich-worker` Phase 6 now writes page vectors inline for exactly
this reason.

**`updated_at` is not necessarily a write timestamp — check before monitoring
it.** On `page_translations` it mirrors the **Mongo source's** timestamp (that is
what the neighbouring `mongo_updated_at` column is for; `--restale` diffs them to
catch re-OCR without re-embed). Probed while six shards were actively writing, it
read **42 days old**. A monitor built on it lies in both directions: silent
during the outage, screaming during the repair. The stores do not even agree on
the column — `clip_embeddings` uses `created_at`.

The signal that would have fired on day one is **coverage against the Mongo
denominator** — "how many live books have zero rows" — which needs no history and
catches a store that is falling behind, not merely one that has stopped.

**A silent absence is not a small absence.** Before concluding a corpus lacks
something, check that the index covering it was ever built. The reader's
conclusion ("the corpus is thin here") was a perfectly reasonable reading of a
blank result and was wrong about the corpus and right about the index.

## Traps in the tooling

- **`--missing-only` cannot reach a book with ZERO rows.** It scans books already
  present in the table, so a book that was never embedded is invisible to it.
  That is what `--books-file` exists for. This was undocumented until 2026-08-07.
- **A flag can be accepted and ignored.** `--books-file` took
  `--worker-id`/`--worker-count`, *printed* `(worker 3/8)` in its mode line, and
  then loaded the whole list anyway — so eight shards each embedded the same
  ~900k pages. The upserts are idempotent so no data was harmed, but it was 8×
  the API calls and began drawing 429s. **The tell was that all eight logs
  reported byte-identical progress counters, which independent shards cannot
  do.** Check that parallel workers *diverge*, not merely that they started.
- **A job with no log redirect cannot be observed even in principle.** Several
  crontab entries have none (`restic-backup.sh`, `moltbook-*`, `catchup.sh`).
  Backups you cannot verify are the sharp case.
- **A `#PAUSED-` marker records no reason and no return date.** One line of *why*
  would have made a 60-day gap obvious to anyone reading the crontab.
- **Don't infer a job's health from a fixed staleness threshold.** A 48h rule
  flagged `harvest-erara-catalog` and `fix-broken-image-thumb` as dead; both run
  **weekly** and were fine. Read the schedule before calling a job dead.
- **The crontab is not the whole schedule.** `enrich-worker` appears zero times
  in it and runs constantly — `scheduler.mjs` dispatches it. Grepping the crontab
  and stopping there produces a confident wrong answer about what runs.

## Two writers, one composer

Page vectors now have two writers (`enrich-worker` Phase 6 and the bulk cron).
Both compose text and rows through **`scripts/lib/page-embedding-text.mjs`**.
Import it; never re-type it. The book-level composer earned this rule the hard
way — copy-pasted into three places, all three carrying the same field-name bugs,
putting the literal line `People: , , , ,` into 14,237 Supabase rows. A wrong
field name yields well-formed text that says nothing, so nothing fails loudly.

Two rules inside that composer are easy to get wrong and are pinned by tests:

- **Editorial wrappers are dropped content-and-all**, not unwrapped. A page-89
  `<meta>` routinely describes page 88, so unwrapping embeds the wrong page's
  subject and mislocates every citation to it.
- **The `translation` column stays empty when the text came from OCR.** It feeds
  surfaces that promise English; an untranslated original still gets a vector,
  but its original-language text must not land in that column.

See `.claude/docs/embeddings.md` for the five stores and their writers.
