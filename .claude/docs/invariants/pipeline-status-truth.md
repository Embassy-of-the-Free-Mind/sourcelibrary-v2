# Pipeline status must not claim work the book cannot show

**Read this when:** writing or changing a pipeline phase, calling `setPipelineStatus`,
advancing `pipeline_auto.status` from anywhere, adding a guard that asserts some stage
"really did its job," or **bulk-writing OCR onto books that are already translated**.

*Added 2026-08-08 from #3740 / PR #3765.*

---

**`pipeline_auto.status` is what every phase selects on.** Written ahead of its output, a
book becomes permanently *past* the phase that would have filled it in: nothing errors,
nothing retries, and it never appears in a queue again. **A status that runs ahead of the
work is worse than no status.**

Measured 2026-08-08 across 58,635 text books: **28,263** sat past enrichment with no
summary, **27,867** past chapters with no chapters. None of them were failing loudly.

## How it happened — the shape to watch for

The orchestrator wrote the *success* status on the *failure* path, unlabelled:

- **Phase 7** writes `chapters_complete` from three places — chapters extracted, book under
  10 pages, and `extract-chapters` failed `MAX_RETRIES` times (`// Non-critical — skip`).
- **Phase 6** does the same in its `catch`: after `MAX_RETRIES` throws it writes
  `summary_indexed` and increments `log.enriched`.

The two skips only ever bumped an **in-memory counter that dies with the run**. So
`chapters_complete` conflates *extracted*, *too short to have any*, and *we gave up* — three
different books, one indistinguishable status.

**Rule:** if a phase advances the status on a path where the output was not produced, it
must record why, on the document, at that moment. `log.x_skipped++` is not a record.

## Absence is not failure — the half that turns a guard into an outage

The obvious predicate (*the field is non-empty*) is wrong, and wrong in a way worse than
the bug it fixes. Absence has two causes that are indistinguishable after the fact: the
stage failed, or **the stage correctly decided there was nothing to do**. A single-work
volume legitimately has no chapters; a 6-page pamphlet is not meant to have them; an
English book needs no translation.

A predicate reading absence as failure would re-stall ~28K books permanently, most with no
reader impact — a far bigger outage than the silent-success bug.

**So a status is satisfied by output OR by an explicitly recorded skip**, and the skip is
written at decision time with a *reason*, not a boolean — you will want to know why when
the policy changes. Enforced by `statusOutputViolation` /`STATUS_OUTPUT_CLAIMS` in
`scripts/workers/pipeline-orchestrator.mjs`; the skip fields are
`<stage>_skipped_reason` under `pipeline_auto`.

## Change behaviour in observe mode first

The guard sits at `setPipelineStatus`, which **53 call sites** pass through. Flipping all of
them at once, in a pipeline about to be restarted, is how a silent-success bug becomes an
outage. Default is observe: record the violation to `audit_log` and
`pipeline_auto.output_missing`, then still advance. `STATUS_GUARD_ENFORCE=1` refuses and
parks at `needs_attention`. Flip it only once the recorded violations look right.

## Measuring this

`scripts/audit/status-output-drift.mjs`, sharing the guard's predicates — change one, change
both. **Two filters are load-bearing:**

1. `resource_type` absent + `pages_count > 20`. Artwork records have no pages and are
   *correctly* `complete`. Counting them read **25,244** broken books where the truth is
   **344**.
2. A recorded skip counts as satisfied, or the audit re-reports every legitimate skip
   forever.

Same family as the `archived_photo` invariant in `CLAUDE.md` (a marker that records work
becomes its own skip condition) and `archive-fetch-failures.md`. Repairing the existing
backlog means re-running enrichment at scale — budget-dial work (#3737), visible books
first.

## "Complete" must mean the work is FINISHED, not that some output exists (#4661)

Phase 9 decided completion with a floor: anything above **10%** OCR coverage was stamped
`complete`. The preview pass transcribes the first **25 pages**, so a 250-page book sat
at exactly 10%, cleared the floor, and finalized as done — after which it was invisible
to every later pass, because the OCR queue reads only `archive_complete`.

Measured 2026-09-04: **13,329 books** (13,318 visible to readers) stamped `complete`
with ≤30 of >50 pages transcribed. They hold 1,870,238 pages of which 322,861 are
transcribed — **1.55M pages never read**, in books the pipeline believed it had
finished. Control, run because a number that size is usually a definition problem:
11,387 `complete` books have ≥90% OCR, so the status is normally honest.

**The tell is that it does not look like a failure.** A book showing 25 of 250 pages
reads as a *curatorial choice* — "we hold it, we didn't translate it" — not as a dropped
queue. That is why it survived: nothing was red, no job errored, and the reader-facing
page was merely thin. When you find a book that looks deliberately un-translated, check
`pages_ocr` against `pages_count` before believing the story.

**The rule, now executable:** `scripts/lib/finalize-decision.mjs` (`decideFinalize`).
This doc stated the principle for months and did not prevent the bug, because the logic
lived inline in a 5,400-line worker where nothing could test it. Extracting it was the
fix; the prose is now just the pointer.

Two thresholds, deliberately not one — ≥90% completes (the canonical readable bar, not a
second invented one), <50% requeues to `archive_complete`, and the 50–90% band completes
on purpose because those books have usually hit pages that will never transcribe
(damage, blanks, RECITATION blocks). **A requeue must be bounded**: only continue while
the OCR count is still growing, or the state machine is an infinite loop.

The 13,329 existing books are NOT repaired by that fix — finalize only revisits
`cover_selected`. Requeuing them queues ~$8,000 of OCR and translation behind the next
open valve, which is actuation two hops upstream of the spend and belongs to a human.

## A bulk OCR rewrite of finished books queues their retranslation (#4523, 2026-09-25)

Gap-fill (orchestrator, `partialBooks`) re-dispatches any book at `translate_partial` /
`translate_complete` / `chapters_complete` / `complete` whose `pages_translated` is under
90% of `pages_ocr − pages_blank`. It translates pages whose translation is older than the
OCR or that carry `translation_stale`, using `getTranslateModelForBook`. So **writing new
OCR onto finished books is a decision to retranslate them**, at the dial's pace and on the
router's model, and nobody has to approve it. It happened: 145 flash-lite jobs, 2,336 pages,
32 Tibetan books between 2026-09-12 and 09-25, all from a transcription about to be
replaced, while the memory said "retranslation not approved, no lane exists."

- Before a bulk OCR apply on finished books, decide whether retranslation should follow.
  If it needs approval, **hold the books first**
  (`hold-pipeline-books.mjs --ids … --reason <x>-awaits-<who> --issue N --release "…" --apply`).
  Page-level writers never touch status, so the apply is unaffected.
- Release with **`--to ocr_complete`**. A plain release restores the prior status, and
  `loop_quarantine_hold` (common in re-OCR cohorts) is selected by no translate phase.
- "Nothing is running" is a count, not a belief: `jobs.countDocuments({type:'translation', book_id:{$in:…}, created_at:{$gte:…}})`.

## `held` — the one status a worker may never write (#4790)

`held` is set only by `scripts/lib/pipeline-hold.mjs` (via
`scripts/maintenance/hold-pipeline-books.mjs`) and always together with
`pipeline_auto.hold` — reason, issue, `held_at`, `held_from_status`, and a one-sentence
release condition. No phase selects it, so a held book leaves every lane; and
`setPipelineStatus` refuses any other status while the marker is present, so no rollback
or retry can put it back. Release restores `held_from_status` and records a
`pipeline_release` book_event. It is the opposite of `needs_attention`: not "something went
wrong, a human should look" but "nothing is wrong yet, and running the lane would make it
so". `scripts/audit/pipeline-hold-drift.mjs` finds a marker without the status (a writer
this rule does not know about) and a hold whose release condition has been met.

## A completion predicate must count what the writer actually writes (#4839)

*Added 2026-09-15.*

A job finishes when `progress.completed + failed >= total`. For image extraction the
writer recounted `completed` as "target pages carrying `detected_images`" — but a
candidate page the model looked at and found **no illustrations on** never gets that
field, because the writer deliberately refuses to overwrite existing detections with an
empty array. Such a page is extracted, paid for, and permanently uncounted. Every book
with one illustration-free page parked at `completed = total − k` forever.

**The two sides of a job must agree on what "done" means.** The extraction Lambda already
had the honest test — it skips a page whose `image_extraction_updated_at >= job.created_at`
— while the counter used a different one. Where a worker and its writer each carry their
own notion of completion, they drift, and the drift is silent: no error, no failure count,
just a job that never finishes.

**A reaper that cancels is a re-dispatcher.** Cancelling the stalled job unset `book.job`;
the orphan detector then rolled the book back and Phase 8 re-submitted **every page**, not
the missing ones — every ~35 minutes, indefinitely. Measured to 2026-09-14: 1,385
cancellations and 3,209 re-paid pages in 7 days; of 40 cancelled jobs sampled by their own
`gemini_usage` rows, **all 40** had already paid for every page they were cancelled over.
So: **finalize on drain, not on an exact count** (`scripts/workers/lib/image-job-drain.mjs`),
and record the pages that never reported on the job row — an abandoned page must be
findable, never a silent skip.

**A detector that runs before the advance step will undo it.** The orphan detector (Phase 4)
fires before Phase 8's completion check, and the writer unsets `book.job` the moment a job
completes — so a *correctly finished* book looked exactly like an orphan. **59 of the last
60 successfully completed image jobs were re-dispatched this way.** Before rolling a book
back for want of a job, check whether the job it names has already finished.

**Tell:** a lane whose jobs are almost all `cancelled` with a healthy `completed` count
inside them, or a book whose `pipeline_auto.status` oscillates between a `*_submitted`
state and the state before it.

## Measuring a loop: the field that holds only the LATEST value (#4839)

The first retrospective here said 391 of 400 cancelled jobs had produced nothing — because
it asked `image_extraction_updated_at`, which keeps only the most recent extraction, so
every earlier cycle's work had been overwritten by a later one and read as "never
attempted". `gemini_usage` rows carry their own `job_id` and cannot be overwritten; judged
by those, the same population was 40/40 fully paid. **When measuring what a past run did,
use a record that is append-only per run, never a last-write-wins field on the object the
run touched.**
