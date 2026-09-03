# Pipeline status must not claim work the book cannot show

**Read this when:** writing or changing a pipeline phase, calling `setPipelineStatus`,
advancing `pipeline_auto.status` from anywhere, or adding a guard that asserts some stage
"really did its job."

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
