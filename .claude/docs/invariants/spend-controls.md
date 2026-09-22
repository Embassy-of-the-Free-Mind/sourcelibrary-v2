# Spend controls — the dial, and the four ways it has failed

**Read this when** you are adding or changing anything that calls Gemini from a
worker, cron, or scheduled job; adding a line to `infrastructure/hetzner-crontab`
or `vercel.json` crons; touching `scripts/lib/spend-guard.mjs`; or asking "why
did the daily budget not hold?"

The dial is `system_config.processing_control.daily_budget_usd`, changed **only**
via `scripts/maintenance/set-dial.mjs` (versioned — it snapshots the prior doc).
Unset/0 means no paid dispatch: default-closed on purpose.

There is a standing check — `scripts/audit/spend-perimeter.mjs`, wired to CI on
changes to workers, the crontab, or `vercel.json`. It fails on an ungated
spending phase, an unclassified schedule, or a worker whose `main()` does not
gate. **If you are adding a spender, that check is what will catch you; this doc
is for the part it cannot check.**

## The four failure modes

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

**4. Committed but unpriced — OPEN.** A batch job writes its usage row at SUBMIT
with `cost_usd: 0`; the true cost lands only when the collector picks it up.
Between submit and collect the spend is invisible, so the dial over-dispatches by
whatever is in flight. Measured 2026-08-31: dial $5, cut off at $5.08 *visible*,
settled at **$6.32** (26% over) once 13 batches / 2,350 pages / $2.87 were
priced. Scales with in-flight batch size.

## Judgment, which no check asserts

- **Presence of a guard is not coverage by it.** The first version of
  `spend-perimeter.mjs` passed `translate-worker` because the *file* mentioned
  `budgetAllowsDispatch` — in a helper off the spending path. Hours later that
  worker drained a queue through the ceiling. Check the **path**, not the file.
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
