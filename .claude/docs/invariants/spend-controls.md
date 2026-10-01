# Spend controls — the dial, the pause, and the five ways they have failed

**Read this when** you are adding or changing anything that calls Gemini from a
worker, cron, or scheduled job; adding a line to `infrastructure/hetzner-crontab`
or `vercel.json` crons; touching `scripts/lib/spend-guard.mjs` or `scripts/lib/pause.mjs`; or asking "why
did the daily budget not hold?" or "why did the pause not stop it?"

The dial is `system_config.processing_control.daily_budget_usd`, changed **only**
via `scripts/maintenance/set-dial.mjs` (versioned — it snapshots the prior doc).
Unset/0 means no paid dispatch: default-closed on purpose.

There is a standing check — `scripts/audit/spend-perimeter.mjs`, wired to CI on
changes to workers, the crontab, or `vercel.json`. It fails on an ungated
spending phase, an unclassified schedule, or a worker whose `main()` does not
gate — and, since #5492, on a spender whose spending path does not ask its
pause key (`isPaused(control, '<key>')`, `scripts/lib/pause.mjs`), or a doc or
the emergency-stop route that names a key no lane reads. **If you are adding a
spender, that check is what will catch you; this doc is for the part it cannot
check.**

## The five failure modes

They are indistinguishable from outside — all of them present as "I set a limit
and it didn't hold." Name the mode before fixing anything.

**1. Wrong meter** (#3826, fixed #3835). The guard summed Mongo `gemini_usage`
while the logger wrote Supabase. It read $9.00 on a day that billed ~$2.3K
against a $15 dial. `getTodaySpendUsd` now sums BOTH stores and **fails closed**
when the primary is unreadable — an unreadable meter must stop the line, not
green-light it.

**2. Ungated paths** (#4436). A perfect meter cannot stop a path that never calls
the gate. Five of seven orchestrator spending phases never asked — including
Phase 1.5, which the crontab runs every two minutes, so the phase that ran most
often was the one the ceiling could not stop. Separately, import-time preview OCR
spent ~$392 in four days straight through a **pause** (#4432).

**3. Dispatch is not consumption** (#4446). `translate-worker` gated
`selfDispatch()` — which creates work — but `main()` also drained
already-queued jobs and asked nothing. Caught live on the 2026-08-31 relight:
5,011 orphaned jobs / 107,938 pages draining while the guard truthfully logged
`CEILING REACHED — no new dispatch`. Both statements were correct at once.

> **A queue is stored spend.** Anything that turns a queued job into Gemini
> calls has to ask, or the ceiling only limits how fast you ENQUEUE money.

Corollary: **removing a producer does not empty its queue.** #4432 deleted the
feature that created those jobs; the jobs kept running for days.

**4. Committed but unpriced — fixed for the orchestrator, OPEN elsewhere.** A
batch job writes its usage row at SUBMIT; the true cost lands only when the
collector picks it up. A `cost_usd: 0` placeholder makes the spend in between
invisible, so the dial over-dispatches by whatever is in flight. Measured
2026-08-31: dial $5, cut off at $5.08 *visible*, settled at **$6.32** (26% over)
once 13 batches / 2,350 pages / $2.87 were priced. Scales with in-flight batch
size.
- **Fixed (#4567, PR #4825, 2026-09-14):** the orchestrator's four placeholder
  writes, and `bulk-reocr-local.mjs`, price at submit with
  `estimateBatchCostUsd()` (measured per-lane rates, failures blended in);
  collection overwrites the estimate with actuals, never adds to it.
- **Still open:** the TypeScript batch submit paths (`/api/**/batch-ocr-async`,
  `batch-ocr-multi`, `batch-translate-async`) still write `cost_usd: 0`
  placeholders. So do the chained and seam batch translation lanes
  (`meterPlaceholder` in `translate-batch-chained.mjs` / `translate-batch-seam.mjs`
  logs zero tokens and no `cost_usd`; the run's own `spent_est_usd` is not on the
  meter). And separately from placeholders, #5193: ~16% of batch OCR pages in the
  week of 2026-09-20 recorded no tokens and $0 at all.

**5. A brake keyed by a word no worker reads** (#5492). The pause
(`processing_control.paused_phases`) had two vocabularies that did not overlap.
The documented one (`'ocr'`, `'images'` — pipeline docs, the system map,
emergency-stop callers) was read by no live worker; the numbers the orchestrator
read (`2`, `8`) were read by no worker outside it; and the chained batch lane, the
main translation lane, read no pause at all — not even the global flag. The
emergency-stop route accepted any array without validating it, and never reached
the chained lane's `translate_batch_runs`. A pause for `['ocr']` returned success
and stopped nothing. Separately, the global `paused: true` is bypassed for every
book inside a selective-unpause scope — 29 scopes were set on 2026-10-01 — so
the flag alone did not stop the scoped work either. Until #5492 the dial
(`set-dial.mjs` to 0) was the only brake that reached every paid lane.
**Tell:** a pause that returns success while the call count keeps climbing.
Fixed by one vocabulary (`scripts/lib/pause.mjs`, steps of
`pipeline-next-step.md` plus `embeddings`; legacy names and numbers are aliases,
anything else is logged as `UNKNOWN` every cycle), a step pause that no scope
bypasses, a check on every spender's spending path in `spend-perimeter.mjs`, and
an emergency stop that validates keys, sets every key, and parks open
`translate_batch_runs` (`phase: parked`, prior phase kept for `?resume`).

> **A brake is a belief until it has been seen stopping something.** The perimeter
> proves each lane ASKS; only a drill — pause one key, watch that step's call count
> freeze in `gemini_usage`, unpause — proves the answer is obeyed.

## Judgment, which no check asserts

- **Batch API unless the caller says realtime (#5244).** A hand-run OCR job goes through
  `scripts/batch/bulk-reocr-local.mjs`, which prices each job at submit on Supabase
  `gemini_usage` so the dial sees it; `realtime-ocr.mjs` (~2×) needs `--realtime`.
- **Presence of a guard is not coverage by it.** The first version of
  `spend-perimeter.mjs` passed `translate-worker` because the *file* mentioned
  `budgetAllowsDispatch` — in a helper off the spending path. Hours later that
  worker drained a queue through the ceiling. Check the **path**, not the file.
- **Translation has TWO dispatchers — orchestrator Phase 4 and `translate-worker`
  `selfDispatch()` — and a routing rule must be applied to both (#5429).** #5411 sent
  priority < 90 to the chained Batch lane in Phase 4 only; self-dispatch kept feeding
  realtime at ~4× the price until #5430 gave it the same floor (`LANE_FILTER`) and #5431
  made it skip books with an open run (`scripts/workers/lib/self-dispatch-lane.mjs`). **Tell:** a routing flip whose per-page
  bill does not move (split `gemini_usage` by endpoint: `hetzner/translate-worker` vs
  `hetzner/translate-batch-chained`).
- **A per-call cost is a rate, not an amount.** "Preview OCR is not free… ~$2.73"
  was written three weeks before the same code cost $392. Multiply by the
  acquisition rate before calling something negligible.
- **Verify a relight by watching the CALL COUNT freeze, not the dollar figure.**
  Dollars keep climbing after the ceiling as batch accounting catches up; a
  frozen call count is what proves dispatch actually stopped.
- **Silence is not proof a watcher is working.** A monitor that only reports
  movement looks identical when the line is quiet and when the monitor is dead.
  Positive-control it against a live query before trusting six hours of calm.

## Known holes, deliberately

- **Traffic-driven Vercel routes are outside the dial by construction** — chat,
  ask, explain, identify, ai-expand, transliterate, detect-split,
  contribute/process. No live route in `src/` reads `processing_control` at all.
  Measured ~$1.61/day against ~$75/day of gateable pipeline spend; it scales with
  visitors and bots, not with the pipeline.
- `cron-caller.mjs` → `/api/cron/social-post` → `tweet-generator` (Gemini),
  fixed-rate 8/day.
- **`cost_usd` is COMPUTED, never billed** (#3576 open). Billed ran ~3x computed
  on runaway-heavy days, and ~110 rows/day carry no `cost_usd` at all — the guard
  prints that count every cycle. **A $5 computed dial is not a $5 invoice.**
  Treat the ceiling as a strong brake, not an accounting system.
- **Phase 2's cross-book pool routes every small book to flash-lite regardless of
  script** — the defect #4436 fixed for preview only. See `language-fields.md`
  for why that matters on non-Latin scripts.
