# Pipeline next step: one function says what happens to a book next

PRIOR ART: `.claude/docs/invariants/pipeline-status-truth.md` covers status claims that run ahead of the work, holds, and the finalize rule. It guards individual writes; it has no derived state, no exits for blocked books, and no lane table. `scripts/lib/finalize-decision.mjs` (`decideFinalize`) is the closest code: it decides one transition, finalize, and uses its own denominator (`pages_ocr / pages_count`, done at 50%). `scripts/audit/status-output-drift.mjs` checks status against output for five statuses, sampled. `scripts/lib/reenroll-eligibility.mjs` and `requeue-untranslated-complete.mjs` are hand re-entries for one graveyard each. `pipeline-phases.md` and `pipeline-architecture.md` describe the phases as written. Sibling design docs: `translation-state.md` (#3402) and `page-counts.md` (#5325). This doc consumes both.

**Read this when:** writing a phase selector or a lane, adding a `pipeline_auto.status` value, parking a book anywhere (`needs_attention`, `failed`, `parked`, a quarantine), hand-driving books through the line, or answering "why isn't this book moving?" and "what is the line working on?"

**Status:** design, 2026-10-01. Tracking issue #5469, under the consolidation program #5302. The migration steps below become issues linked from #5469. Until step 1 lands, `pipeline_auto.status` is the only stored state, and the measurements below come from a draft of the function run read-only over the corpus.

---

## Who asks "what happens next", and what goes wrong for them

1. **A reader** opens a book showing 25 of 300 pages. They take it as a curatorial choice ("they hold it but didn't translate it"), when in fact the line dropped it. Nothing on the page looks broken, so nobody reports it. This is the costliest failure, and it is invisible.
2. **Derek** asks "what is running, what is stuck, and what does the rest cost?" Today the answer means reading five worker files and running three ad-hoc queries.
3. **An operator, or a session hand-driving a cohort**, needs to know which lane will pick up a book, and whether its next step will happen at all. The 2026-10-01 re-entries (5 reader stubs, 162 OCR stubs, the #5467 wave plan) were all written by hand because the line would never have reached those books.

One derived answer serves all three: **the next step for this book, or the reason it is blocked and when that is checked again.**

## Why this exists

Each phase selects books by `pipeline_auto.status`, a label written by more than a dozen writers across the orchestrator, the enrich worker, the image worker, collectors, importers and maintenance scripts. The label records what a writer decided at some past moment. It does not record what the book is now. Measured on 2026-10-01 over all 92,807 books with `pages_count > 0`:

| shape | measured | why the line never fixes it |
|---|---:|---|
| **`complete`, but next step is OCR** | 12,049 live books (`translation_state.rung = transcribing`) | no phase selects `complete` for OCR. Finalize completes at 50% of `pages_count` (`decideFinalize`), while the ladder needs 90% of the whole book. Books finalized before #4661 were completed at 10%. |
| **`complete`, but next step is translation** | 2,564 live (body: rung `transcribed`/`translating`) + 3,665 live (tail: `readable`, not `complete`) | gap-fill reaches `complete` only when no fresh book is waiting, and uses a third denominator (`ocr − blank`) |
| **`needs_attention`, no exit** | 15,004 books; 3,701 live. Of these, 3,023 live books are OCR-able (images held, preview only) | nothing selects it. The top reason on live books is a pre-#4661 "Very low OCR coverage" park (2,871). 14,216 have no `attention_reason` at all. |
| **`archiving`, no timeout** | 7,786 books; 7,379 last touched in August | Phase 1 polls it but has no failure exit. 2,435 of them already hold a preview transcription. |
| **other graveyards** | `parked` 984, `failed` 563, `loop_quarantine_hold` 167, `paused` 5 | none is selected by any phase. 309 `parked` are waiting on a benchmark (kuzushiji) that a hold would express better. |
| **dead verdicts on books we already hold** | 1,312 books carry `archive_verdict: dead`; the draft blocks only 17 for a dead source, because the rest already hold ≥ 90% of their images by counter | a source dying matters only while we still need its images. The verdict parks the whole book anyway. |
| **one queue, 21 lanes** | 21 lanes can pick up work. Six of them skip a hold, pause or budget check (lane table below) | the only way to learn which lane serves a book is to read its selector |

Distribution of the draft next step over the same corpus:

| next step | all books | live |
|---|---:|---:|
| `ocr` | 50,589 | 18,944 |
| `done` | 10,718 | 9,214 |
| `archive` | 9,855 | 3,495 |
| `translate` (body) | 8,524 | 2,905 |
| `translate` (tail, readable → complete) | 4,849 | 4,540 |
| `enrich` | 1,736 | 1,112 |
| `blocked: held` | 3,701 | 1,981 |
| `blocked: source_unreachable` | 2,693 | 0 |
| `blocked: source_restricted` | 126 | 0 |
| `blocked: source_dead` | 16 | 1 |

Caveats on the draft: `archive` reads the `pages_archived` counter, which `page-counts.md` measured as wrong on live books (until #5325 lands, that row is provisional). `images` is not measured, because no book-level field records that extraction ran (see the inputs table).

## The function

```
nextStep(book) → { step, reason, in_flight, recheck_at }

step ∈ archive | ocr | translate | enrich | images | done | blocked
```

**Pure**: it reads only stored fields on the book document, so a full-corpus pass is a single projection scan and needs no `pages` reads. It lives in `scripts/lib/pipeline-next-step.mjs` and is pinned by `tests/unit/pipeline-next-step.test.ts`. A TS twin is needed only if a request path ever computes it, and none should: `/admin` reads the stored field. If a twin is ever added, add a parity test too.

### Inputs (all already stored, or owned by a sibling design)

| input | field | owner |
|---|---|---|
| reading progress | `translation_state.rung`, `.english_original` | `translation-state.md`, stamped by sync-worker |
| archive progress | `pages_archived / pages_count` (pages carrying `archived_photo`) | `page-counts.md`, `recountBook()` (#5325) |
| source health | `pipeline_auto.archive_verdict`, and the source-probe record | archiving watchdog (#4611, #5462) |
| hold | `pipeline_auto.hold` | `pipeline-hold.mjs` (#4790) |
| policy blocks | the lane allowlist, keyed by language/script/source (Tibetan, Syriac, kuzushiji, English IA text-first) | lane registry (step 4) |
| distill output | `summary`, `chapters`, or `pipeline_auto.<stage>_skipped_reason` | the predicates in `STATUS_OUTPUT_CLAIMS` (orchestrator), unchanged |
| images output | **new** `pipeline_auto.images_done_at` or `images_skipped_reason` | image collectors (step 1 adds the stamp; today only the status records it) |
| in flight | `book.job` → an open `jobs` row, or an open batch run | the lane that dispatched it |
| progress memory | `pipeline_auto.attempts[step] = { n, last_at, last_progress }` | written by `stampNextStep` when a step is re-issued without progress |

### Rule, first match wins

1. `rung = no_pages`, or `content_type = artwork` → **`done`** (`not_a_text`)
2. hold marker present → **`blocked: held`**. The hold's issue and release condition are the exit.
3. a job or batch run is open on the book → keep the step that dispatched it, `in_flight: true`. No lane may select an in-flight book. This replaces the `*_submitted`, `summarizing` and `chapters` statuses, and the orphan detector's guesswork about them.
4. Archive below 90% **and** rung below `transcribed`. The images are still needed, so source health decides:
   - source verdict `dead` → **`blocked: source_dead`**
   - `restricted` → **`blocked: source_restricted`**
   - unreachable or unconfirmed → **`blocked: source_unreachable`**
   - otherwise → **`archive`**

   A book that already has its text does not need its images re-fetched, so a dead source no longer blocks it.
5. the book's language/script/source has no approved OCR lane → **`blocked: ocr_policy`**
6. `rung ∈ {no_text, transcribing}` → **`ocr`**. If the last two OCR issues added no pages → **`blocked: ocr_stalled`**.
7. not `english_original` and `rung ∈ {transcribed, translating}` → **`translate`** (`body`)
8. not `english_original` and `rung = readable` → **`translate`** (`tail`). The last 10% counts: in #4685, about 60% of these pages turned out to be real text the line had dropped. Lanes rank tail after body.
9. no summary or chapters, and no recorded skip → **`enrich`**
10. no images stamp, and no recorded skip → **`images`**
11. otherwise → **`done`**

Cover selection and finalize are not steps. They are bookkeeping done inside `images` and `done`. "Complete" in the status sense becomes `step = done`, and `done` is recomputed every time, so a book cannot be finalized ahead of its OCR. When a re-OCR or a recount changes the inputs, the book leaves `done` automatically. That reopening is deliberate, and it is why cutting a lane over is actuation (see "Spend").

### The three denominators collapse into one

Today finalize uses `ocr / pages_count ≥ 0.5`, gap-fill uses `translated / (ocr − blank) < 0.9`, and the reader uses the ladder. `nextStep` reads only the rung, so there is one denominator, the ladder's. The #5325 finding that 25–50% of "translation < 90%" books are "nothing-to-translate" to the lane is a disagreement between the lane's page selector (`isTranslatablePage`) and `pages_translatable`. It is fixed in the recount (#5326), not here. Until then the audit counts it as a named shape (`translate_selector_empty`), so the gap stays visible and is not hidden.

## Blocked reasons: every one has an exit

A blocked book carries `reason`, `recheck_at` and `owner`. The re-check is a cheap, scheduled re-evaluation, and it never pays for model work. **No reason exists without an exit.** `failed`, `parked`, `paused`, `needs_attention` and `loop_quarantine_hold` are retired as states. Their books land in one of the rows below, or become actionable again.

| reason | today's home | re-check | exit | owner |
|---|---|---|---|---|
| `held` | `held` + marker | daily, `pipeline-hold-drift.mjs` (exists) | the hold's release condition | the issue on the marker |
| `source_unreachable` | `needs_attention` with "source unreachable since…", or `archiving` with a stall | 24 h, exponential backoff to 7 d | the probe answers, so the step becomes `archive`. After 3 *confirmed* 404/410 answers, it becomes `source_dead`. A timeout never confirms a death (#4611). | archiving watchdog |
| `source_dead` | `needs_attention`, `archive_verdict: dead` | 30 d re-probe | the probe answers, or an alternate scan is imported under the same `work_id` (#5462) | #5462 |
| `source_restricted` | IA lending / printdisabled | 90 d | access opens, or an alternate edition is found | #5462 |
| `ocr_policy` | `parked` (kuzushiji), holds used as policy (Tibetan, Syriac) | when the lane registry changes | an approved lane exists for that script | the lane's issue |
| `ocr_stalled` | `needs_attention` "OCR stalled", `loop_quarantine_hold`, the 50–90% band that finalize waved through | when the OCR engine or prompt version changes, else 90 d | a new engine or lane adds pages. Pages that will never transcribe get a per-page `ocr_refused_reason` and drop out of `whole`. That is a ladder input, so the book reaches `transcribed` honestly instead of being waved through. | OCR lane |
| `translate_refused` | `failed` after MAX retries, `loop_quarantine_hold` | translation prompt or model change, else 90 d | as above, per page | translate lane |
| `split_review` | `needs_attention` "Split review needed" | when the review queue is worked | a human decision is recorded on the book | review queue |
| `needs_human` | everything else, today mostly reasonless `needs_attention` | weekly digest | a human records a reason from this table | ops |

`needs_human` is the only reason with no automatic exit. The audit fails if it holds more than 100 live books, so it cannot grow back into a 15K graveyard.

**A transient error is not a state.** A failed dispatch increments `attempts[step]` and backs off, and the book keeps its step. After N failures without progress, it becomes the `*_stalled` or `*_refused` reason for that step, with that reason's exit. That covers what `failed` and `retry_count` do today, but with a way back.

## The lane table

A lane declares what it serves and who pays for it. The table is **generated from code**: each worker exports a `LANE` descriptor, registered in `scripts/lib/lanes.mjs`. A test fails if a worker in `scripts/workers/crontab.production` or `vercel.json` writes pages or books without being registered. `/admin/pipeline` renders the table next to today's count of books per step. The survey below is the starting registry (2026-10-01).

| step | lane | selects (after the cutover: `pipeline_next.step = X` plus) | trigger | budget | hold / pause / scope today |
|---|---|---|---|---|---|
| archive | `archive-bulk.mjs` | IA, not `bulk_unsuitable`, first translations first | scheduler 10 min | unmetered | pause + scope; **no hold check** |
| archive | `archive-ocr.mjs` | priority / IIIF / warehouse | scheduler 10 min | unmetered | pause + scope; **no hold check** |
| archive | `archive-iiif-local.mjs`, `archive-{erara,harvard,gallica}.mjs` (laptop launchd), `acquire-gap-batch.mjs`, `archive-acquired-cron.sh` | named hosts / acquisitions | manual / hourly | unmetered | **no hold check**; `--any-status` |
| ocr | orchestrator Phase 1.5 (preview) | first 25 pages | 5 min | dial | all |
| ocr | orchestrator Phase 2 (full) + `batch-collector.mjs` | priority, then `_priority` | 5 min / 10 min | dial + `canSubmitMore` | all |
| ocr | `bulk-reocr-local.mjs`, `realtime-ocr.mjs`, `reocr-launch-books.mjs`, `bulk-reocr-opened-books.mjs` | named lists | manual | priced at submit (dial sees it) / unmetered | **ignore holds by design or omission** |
| ocr | `syriac-kraken-lane.mjs`, `ndl-koten-lane.mjs`, Tibetan relaunch (`/root/tibetan-reocr`, outside the repo), `mineru-ocr-worker.mjs` | one script each | manual / 30 min | GPU lease or free CPU | per lane |
| translate | `translate-worker.mjs` (realtime) | `processing_priority ≥ 90` | 2 min | dial (scoped) | all |
| translate | chained batch (`translate-batch-chained.mjs`) and orchestrator Phase 4 `enrolForPhase4` | priority < 90, visible, not English | 5 min / hourly | dial or envelope, per-book approval | hold yes; **no pause check** |
| translate | Phase 4 gap-fill (`partialBooks`) | finished books under 90% of `ocr − blank` | 5 min, only when no fresh book waits | dial | all |
| translate | seam batch, `realtime-translate.mjs`, `retranslate-stale.mjs`, `es-translate-worker.mjs` | named books | manual | envelope / dial / **none** | mixed |
| enrich | `enrich-worker.mjs` (summary, chapters, quality, collections) | `translate_complete` → | scheduler 5 min | dial (scoped) | all |
| images | orchestrator Phase 8 + `image-extract-worker.mjs` + Lambda | `chapters_complete`, plus a statusless backfill | 5 min | dial (scoped) | pause + scope; **no hold filter** |
| any | `collect-batch-results.mjs` | open batches | 30 min | committed | **no hold or pause check** |
| any | API routes `/api/process*`, `/api/translate`, `/api/admin/bulk-reocr`, `/api/admin/bulk-ocr-new`, `/api/scan/start-ocr`, `/api/books/[id]/batch-translate-async` | the request | admin click | **none** | **none** |

Rules the registry enforces:

- **One lane per (step, cohort) wins.** `translate` is realtime for priority ≥ 90, chained for everything else, and tail after body. Gap-fill stops being a lane: it is `translate` with `reason: tail`. Phase 4 fresh dispatch and chained auto-enrolment stop competing for the same books.
- **Every lane declares `respectsHold`, `respectsPause` and `budget`.** A lane that declares `false` must give a reason in the descriptor (example: bulk re-OCR ignores holds because a hold is often the very thing its re-OCR is waiting on). The six unguarded rows above become either guarded or justified.
- **Budget is a lane property, never a book state.** A closed dial does not block a book. It leaves the book's step standing, and the lane idles. `/admin/pipeline` shows "N books at `translate`, lane idle: dial closed", and that is the honest answer to "why isn't this moving".

## Stored shape and the single writer

```
pipeline_next: {
  step: 'ocr', reason: 'transcribing', in_flight: false,
  recheck_at: null, owner: null,            // set for blocked
  inputs: { rung: 'transcribing', archived: 0.98, verdict: null, hold: null, job: null },
  version: 1,                                // rule version; a bump restamps on the next pass
  computed_at: ISODate
}
```

- **Writer: `stampNextStep(db, book)`**, in the same module. It runs from two places, both calling the same function:
  - **sync-worker**, every 2 h, after `translation_state`, in the same `$set`
  - **collectors and dispatchers**, at the moment they open or close a job, for that one book, so `in_flight` and the step after a job are never 2 h stale
- **`pipeline_auto.status` becomes a cache.** During migration it is written as today, and the audit compares it to the step. After cutover, `stampNextStep` writes it from the step (one mapping table, for the old dashboards), and nothing else writes it. The raw `updateMany` rollbacks in the orphan and zombie detectors are the first writers to go, because they bypass both the hold guard and the output guard.
- **Registry:** `pipeline_next` goes in `books-known-fields.json` with a doc string in `book-docs.mjs`, and the sweep that first stamps it is logged per `field-sprawl.md`. When migration ends: one field in; `retry_count`, `finalize_requeues`, `finalize_ocr_requeues`, `pre_hold_status`, `hold_reason`, `attention_reason`, `parked_reason`, `parked_from` and `failure_reason` out (or folded into `attempts`/`reason`).

## The audit

`scripts/audit/pipeline-next-step-audit.mjs`, daily on Hetzner, exit 1 = FAIL. It files or updates one issue (the scheduled-detector rules in `measurement-instruments.md`).

1. **Full-corpus recompute.** One projection scan of `books`; recompute `nextStep`; compare it with the stored `pipeline_next` and with `pipeline_auto.status`. It reports a table by shape. The named shapes are:
   - `terminal_but_actionable`: status ∈ {complete, needs_attention, failed, parked, …} but the step is actionable
   - `selected_but_done`
   - `in_flight_without_job`
   - `blocked_without_recheck`
   - `recheck_overdue`
   - `translate_selector_empty`
   - `step_with_no_lane`: a step for a cohort that no registered lane serves

   **FAIL:**
   - stored step disagrees with the recompute for more than 1% of books, outside the 2 h freshness bound
   - any live book is in `step_with_no_lane`
   - any `blocked` book has no `recheck_at`
   - `needs_human` holds more than 100 live books
2. **Flow snapshot.** Counts per step (live and all) go to `ops_reports` (`type: 'pipeline_next_daily'`) with a **fixed denominator**: every book with `pages_count > 0`. Throughput charts read this, so a total cannot fall because a snapshot changed scope (the 37K → 10K → 92K denominators of September).
3. **Positive control, every run.** Perturb one sampled book's stored step in memory and require the comparator to flag it. If the control does not fire, the run reports `probe_broken`, never PASS.
4. **Negative control, recorded once in the PR.** Stamp a wrong step on a hidden test book, watch the audit go red, restore. A guard that has never gone red is decoration (`tests-that-are-not-guards.md`).

`status-output-drift.mjs` stays as it is until cutover step 6, then becomes the `selected_but_done` shape of this audit.

## Spend: cutting a lane over is actuation

Today the graveyards hold tens of thousands of books that *should* get OCR or translation, and the selectors cannot see them. A lane that switches to `pipeline_next.step` will see them all at once. **Each cutover is therefore a decision to spend, and it takes an estimate and Derek's yes when it exceeds the floor.** (Same rule as `pipeline-status-truth.md`: requeueing the #4661 books was "$8,000 two hops upstream".) The dial still paces the lane. What the cutover decides is *what the dial spends on*, so the estimate is pages remaining × unit price for the step's cohort, and it goes in the decisions row. The function and the audit (steps 1–2) spend nothing.

## Migration, ranked

Each step is an issue linked from #5469 and can be merged on its own. The ranking: steps that make the size of the problem visible come first, then steps that fix it without moving money, then the cutovers ordered by reader value per dollar, and deletion last.

0. **Independent bug fixes, now.** (a) `enrich-worker.mjs` `setPipelineStatus` and `markFailed` write `pipeline_auto.updated_at`, but its own orphan sweep and orchestrator Phase 8.5 read `pipeline_auto.last_updated`. A book enrich just moved to `summarizing` therefore looks 30 minutes stale and gets rolled back while it is still being worked. (b) Phase 1.95 (warehouse promote) and the artwork skip are gated by the pause switches of phases 2 and 1, not their own. Neither depends on this design.
1. **Writer, observe only.** `nextStep()` + `stampNextStep()` + tests; sync-worker stamps `pipeline_next`; collectors stamp at job open/close; `images_done_at` stamped by the image collectors; registry entry. No selector changes. *Depends on:* `translation_state` (stamped on 2026-10-01: 554 books, all held, lack it). The `archive` input stays provisional until #5325.
2. **Audit**, with the crontab line. Its first run publishes the disagreement table above as a measured baseline, and that table sizes every step after it.
3. **Exits.** One re-check scheduler (`scripts/workers/pipeline-recheck.mjs`, daily) for the `blocked` reasons. It absorbs the archiving watchdog's re-probe (#4611, with its "unconfirmed timeout never escalates" fix) and #5462's re-probe. `ocr_policy` is read from the lane registry. It writes only `pipeline_next` and probe records, never a step that spends. It is free, and it turns `needs_attention` from a graveyard into a classified list.
4. **Lane registry.** `LANE` descriptors on every worker; `scripts/lib/lanes.mjs`; the crontab/vercel coverage test; `/admin/pipeline`; the six unguarded lanes get guards or written reasons. The API routes get the shared `assertLaneGuards()` that workers use. No change to which books are selected.
5. **Cutovers, one lane at a time; each is an issue with an estimate and a decisions row.** In this order:
   - **a. translate.** The chained, realtime and gap-fill lanes select `step = translate` (body before tail). This retires the #5467 hand wave driver: the live pools it targets are `translate` books.
   - **b. enrich.** Cheap, and lets 1,112 live books leave a hand-run lane.
   - **c. archive.** Unmetered. Picks up the 7,786 `archiving` books and the source-blocked rows through the scheduler instead of by hand.
   - **d. ocr.** The largest by far: 18,944 live books, most of them the 12,049 live `complete`-but-preview books of #4719. This is the most expensive cutover, so it goes last among the paid lanes, behind its own estimate. The `ocr_stalled` bound must be live first, or the 50–90% band loops forever.
   - **e. images.** Last; its cohort is the smallest reader gain per dollar.
6. **Status becomes a cache.** `stampNextStep` is the only writer of `pipeline_auto.status`; the orphan and zombie raw `updateMany` rollbacks are removed (in-flight is now explicit); `failed`, `parked`, `paused`, `loop_quarantine_hold` and `needs_attention` leave the enum (`doc-enum-drift.mjs`); `finalize-decision.mjs` is deleted (finalize is `done`).
7. **Delete the hand re-entries.** `reenroll-quarantined.mjs` + `reenroll-eligibility.mjs`, `requeue-untranslated-complete.mjs`, `partialBooks`, the #4719 sweep plan, the per-phase status selectors; the legacy `pipeline_auto` fields listed above get an `$unset` sweep. That is a field deletion and waits for Derek.

## Decisions Derek owns (defaults in bold)

1. **Archive before OCR**: a book needs ≥ 90% of its images on R2 before OCR runs. The exception is a dead or restricted source whose images we already hold, which is never blocked again. *Alternative:* OCR straight from the source URL, which is faster but leaves the corpus unpreserved if the host disappears.
2. **The tail is part of `translate`** (readable → complete), ranked after body. *Alternative:* stop at `readable` and leave the last 10% to reader requests.
3. **Cutover order is translate → enrich → archive → OCR → images**, and each paid cutover arrives as a decisions row with an estimate. Nothing in steps 0–4 spends.
4. **No mass status rewrite.** The ~24.5K graveyard books (needs_attention, archiving, parked, failed, quarantine) keep their old `status` until step 6, and the cutovers make them selectable. That avoids a 24.5K-row data migration with nothing to show for it. *Alternative:* re-stamp status from the step in step 1, which is quicker to read but is a bulk write on a field every phase actuates on.
5. **The `needs_human` ceiling is 100 live books.** Above that, the audit goes red.

## Do not

- Do not add a status. If a book needs a new state, it is a `blocked` reason with an exit, or it is not a state.
- Do not select on `pipeline_auto.status` in a new lane. Select on `pipeline_next.step` (observe mode until your lane's cutover).
- Do not park a book without `recheck_at`. "A human should look" is `needs_human`, and it has a ceiling.
- Do not compute a rung or a coverage ratio inside a selector. Read `translation_state` and `pipeline_next`; if either is absent, the book is unstamped, and that is not the same as being done or failed.
- Do not treat a closed dial as a book property. The book keeps its step, and the lane idles.
