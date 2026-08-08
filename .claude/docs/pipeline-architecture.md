# Source Library Pipeline Architecture (v2)

> The full line as of August 2026 — stages, the one door, the budget dial, the lanes,
> and where things actually run. The v1 document (April 2026, the orchestrated era at
> full throttle) is archived verbatim at `archive/pipeline-architecture-v1-2026-04.md`;
> its velocity/cost tables and cron schedule describe a topology that no longer runs.
>
> **See also:** `pipeline.md` (states, prompts, per-phase detail), `memory/pipeline-ops.md`
> (operational reference, priority ordering, lessons), `translating-a-book.md` (the
> per-book runbook), `batch-processing.md` (Batch API mechanics).
> Epics: #3725 (rationalization), #3756 (the full line).

---

## The line is longer than the state machine

`pipeline_auto.status` ends at `complete`, but a *readable, findable* book needs more.
The full line:

```
import → archive → OCR → translate → distill → images → finalize   ← the state machine
                                          ↓ downstream (no status field yet — #3756 A1)
                       embeddings · identity (work/edition) · discoverability
```

**The seven core stages** (each with its status transitions, run by orchestrator phases):

| # | Stage | Status flow | Mechanism |
|---|-------|-------------|-----------|
| 1 | Import/enroll | → `queued` | import scripts/APIs; Phase 0 auto-enrolls |
| 2 | Archive | `archiving` → `archive_complete` | Hetzner + local-Mac archivers → R2 |
| 3 | OCR | → `ocr_submitted` → `ocr_complete` | Phase 2 submit (Gemini Batch, 50% off) + collector |
| 4 | Translate | → `translate_submitted` → `translate_complete` | Phase 4 dispatch → translate-worker (sequential, cross-page context) |
| 5 | Distill | → `enriched` → `chapters_complete` | enrich-worker: summary+index, chapters |
| 6 | Images | → `images_submitted` → `images_complete` | Phase 8 extraction (Lambda/batch) |
| 7 | Finalize | → `cover_selected` → `complete` | Phase 8.9 + 9 (the live "finalize tail") |

**Downstream stages** — real work, currently statusless (measured 2026-08-08 over
19,465 live books; see #3756 §A for the coverage table):

- **Embeddings** — Supabase workers fill `page_translations`, `book_embeddings`,
  `artwork_embeddings`, `gallery_text_embeddings`, `clip_embeddings` (see `embeddings.md`).
  Paid; to be dial-gated when enrolled as phases (#3756 A2).
- **Identity** — `work_id` (#3260) and `edition_key` (#3710) are ~99% covered and
  maintained by their own sweeps (see invariants `work-identity.md`, `edition-identity.md`).
- **Discoverability** — collections, galleries, catalog sync to Supabase, ISR warmup.

Books enter mid-line all the time (already-OCR'd imports, re-translations); phases
select on *predicates* (what's missing), not on history.

---

## The one door: translate-core

Every code path that writes `pages.translation` goes through
**`scripts/lib/translate-core.mjs`** (issue #3725 — it replaced 13 divergent writers).
The door enforces:

1. **Model routing** — `getTranslateModelForBook` (flash for BPH + non-Latin scripts,
   lite otherwise), never hardcoded.
2. **Prompts from the DB** — `prompts` collection (`type: 'translation'` /
   `'english_modernization'`, `is_default: true`); provenance (`prompt_id`, hash,
   version) stamped on every page.
3. **Revision before overwrite** — `page_revisions` snapshot inside
   `writePageTranslation`; callers cannot forget it.
4. **Counter sync** — `syncBookTranslationCounters` recomputes the canonical
   visible-pages counters (#3293) and bumps `updated_at` for the Supabase sync.

Plus the guards: the **human-edit guard** (`source: 'manual'` / `edited_by` is never
silently overwritten; explicit `overwriteHuman: true` required), the **translatability
predicate** (`isTranslatablePage` — soft-hidden, skip types, blank-from-OCR,
recitation/safety blocks), and the **semantic health check** (#3756):
`assessTranslationHealth(ocrText, translationText)` detects collapsed (body < 800
chars against real OCR) and runaway (body > 3× OCR body; clears normal CJK expansion,
#2532) outputs. `writePageTranslation({ refuseUnhealthy: true })` refuses to persist
an unhealthy result — **opt-in**, used by the repair lane; the production worker's
behavior is unchanged.

**TS twin** (#3749, in progress): API routes use `src/lib/types/ai-models.ts`
(routing), `src/lib/prompts.ts` (DB-first prompt fetch, incl. english_modernization
and the stitch prompt), `src/lib/page-counts.ts` (counters). Parity is pinned by
`tests/unit/translate-core-parity.test.ts` and `translate-edge-cases.test.ts` — change
either side and the suite fails. Full route write-through is the remaining #3749 work.

---

## The budget dial + spend-guard

Spend is a **number, not a switch** (`scripts/lib/spend-guard.mjs`, #3737):

- Dial: `system_config.processing_control.daily_budget_usd`.
- **Default-closed**: unset/null/0 ⇒ no paid dispatch, even with `paused: false`.
- Orchestrator Phase 2 (OCR submit) and Phase 4 (translation dispatch) call
  `budgetAllowsDispatch()` each cycle; at the ceiling, dispatch stops. In-flight work
  always finishes. `--phase N --book=ID` operator runs bypass the dial, like the pause.
- Spend measured from `gemini_usage` by **ObjectId range** (the `timestamp` field is a
  string on old rows — Date queries silently return nothing). `cost_usd` is a computed
  estimate and sometimes absent ⇒ the guard can **undercount**: a brake, not accounting.
- Every cycle logs `[spend-guard] … spend $X / $Y` — the dial is always visible.

Turn-on steps (Derek) are in `memory/pipeline-ops.md` § "The Budget Dial".

**Priority within the budget:** `books.processing_priority` (higher first, absent = 0)
leads every paid candidate sort — Phase 2, Phase 4, translate-worker self-dispatch,
and the archive crons. Feeder weights (sponsorship 200, reader request 100, fresh
import 80, curated collection 50): `memory/pipeline-ops.md` § "Priority Ordering".
So "what will tomorrow's $5 buy" is answerable: the top of that sort.

---

## The collector cron

Submitting a Gemini batch is half a transaction — **collection is the other half**,
and it must always be scheduled, or paid results rot uncollected (the 2026-08 acute
failure: `process-batches` was archived with no replacement; 22 zombie jobs lost).

- **Live:** `scripts/batch/collect-batch-results.mjs` on Hetzner every 30 min
  (#3713/#3717; `--limit 200 --abandon-stale=7`, log `collect-batch.log`). Collects
  results for the express-lane routes and any other Batch API submitter.
- `scripts/workers/batch-collector.mjs` is the orchestrated-era collector (every
  10 min under the scheduler); returns with the scheduler when the line restarts.
- **Key rule:** batch jobs are visible only to their creating API key — any collector
  must hold a **superset** of every submitting key (Vercel/Hetzner key drift caused
  348 false "failed" jobs, 2026-06-05).
- **Verify semantically:** `pages_ocr`/`pages_translated` moving is success; a clean
  collector log is not (`batch_jobs` counters lie by omission — the silent-success
  incident class).

---

## The lanes

| Lane | Entry | Dial-gated? | Notes |
|------|-------|-------------|-------|
| **Orchestrated** | scheduler → `pipeline-orchestrator.mjs` phases → `translate-worker.mjs` | **Yes** (Phases 2 & 4) | Bulk. Sequential translation with cross-page context. Currently dormant (below). |
| **Express** (one-off books) | `POST /api/books/[id]/batch-ocr-async` / `batch-translate-async`; `/batch-translate` skill; `translating-a-book.md` | No (human-initiated, small) | Spend still logs to `gemini_usage` (counts toward the measured total). Batch-API translation = no cross-page context: sanctioned per-book, banned for bulk. Owed: route dedup against pending `batch_jobs` (double-submit = double-charge, #3756 §D) + TS-door write-through (#3749). |
| **Preview** | Phase 1.5 preview OCR (first 25 pages, inline); Lambda `preview-translate` via SQS FIFO | Via orchestrator | Gets metadata/classification before full OCR; fast reader preview. |
| **Repair** | `retranslate-pages.mjs`, `retranslate-stale.mjs`, collapse/loop detectors | No (targeted, paid, `--dry-run` default) | Writes through the door with `refuseUnhealthy: true` — never replaces a bad translation with another bad one. |
| **Human** | Reader/editor PATCH routes, hand-corrections in Mongo | n/a | Marked `source: 'manual'` / `edited_by`; the door's human-edit guard makes them unoverwritable by every AI lane. |

---

## Machine topology (verified 2026-08-08)

**Hetzner** (`root@46.224.122.120`, auto-pulls `main` ~5 min; crontab source of truth:
`infrastructure/hetzner-crontab`, orchestrated-era reference `scripts/workers/crontab.production`):

| What | Schedule | State |
|------|----------|-------|
| Scheduler / main orchestrator loop | (`*/2` when enabled) | **DORMANT** — not in the live crontab; returns when Derek sets the dial + unpauses + re-adds the scheduler line |
| `translate-worker.mjs`, `enrich-worker.mjs` | (scheduler-managed) | **DORMANT** with the line paused (since 2026-06-08) |
| Finalize tail — `pipeline-orchestrator.mjs --phase 9` (runs 8.9 + 9) | every 15 min | **LIVE** — completes books whose pages arrive via any lane |
| `collect-batch-results.mjs` | every 30 min | **LIVE** (#3717) |
| Archiving + acquisition crons, archiving-watchdog, daily health alert | various | **LIVE** — books keep piling at `archive_complete`; looks like an outage, isn't |

**Local Mac (launchd):** `archive-{erara,harvard,gallica}.mjs` every 30 min — those
hosts block datacenter IPs. The e-rara warehouse backlog is Mac-only.

**Lambda (eu-central-1):** preview + manual translation (SQS FIFO), image extraction
(SQS standard). Deprecated for bulk translation.

**Vercel:** the app, the express-lane routes, lightweight crons (social, health,
daily report). No pipeline orchestration.

---

## Invariants (read before touching)

The scar tissue lives in `.claude/docs/invariants/` — routed from CLAUDE.md by
subsystem. Most pipeline-relevant: `archive-fetch-failures.md`, `paired-artifacts.md`
(page images vs OCR must line up), `visibility-and-stats.md`, `quote-and-snippet-integrity.md`,
`measurement-instruments.md` (job counters lie; measure semantic outputs),
`request-path-queries.md`. Also: `page_revisions` is a **mixed** corpus — segment by
`source` before quoting numbers (`data-provenance.md`).

Known traps that survived from v1: `gemini_usage.timestamp` is a string (use ObjectId
ranges); `paused: true` doesn't stop in-flight workers (cancel jobs to actually stop);
Batch API files/jobs are key-scoped; Mongo saturates near ~40 concurrent Lambda jobs.

The human-readable layer (explainer + incident record artifacts, #3756 §E) should be
kept true as phases land.
