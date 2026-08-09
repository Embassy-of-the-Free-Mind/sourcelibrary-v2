# Pipeline v2, built and relit — and the canary that fired on night one (2026-08-08)

**Purpose first:** ~18,000 archived books, 1,400 loop-quarantined manuscripts, and a
queue of reader requests were waiting on a pipeline that had been paused since June and
was unsafe to restart. Tonight's arc made restarting safe, restarted it, and proved the
safety machinery on live fire.

## What shipped (all merged to main)

- **#3729** translate-core — the one door (routing/prompts/revisions/counters), Malay
  routing bug, job_id arity bug, dead orchestrator writer removed.
- **#3743** edge cases into the door — one skip list, blank-OCR rule, human-edit guard.
- **#3744** the budget dial — `daily_budget_usd`, default-closed, ObjectId-range spend.
- **#3761/#3779/#3790** the monitoring surface — `/platform/admin/line`, nightly
  `stage-coverage-snapshot` (04:15, live), probes with positive controls (which caught
  two real probe defects on day one: unindexed control findOne, then mongo.mjs's
  hardcoded 30s `socketTimeoutMS` killing the 19M-page counts — fixed via
  `socketTimeoutMs` opt).
- **#3767** bulk-JP2 text-shift repair script (archiver fix verified already present).
  NOT yet run — dry-run + apply is a follow-up.
- **#3768/#3771** priority ordering (`processing_priority` leads every paid sort),
  boarding scripts, health checks extracted, stall-timeout rollout, docs.
- **#3773** the TS-side door — human-edit guard in Lambda/routes/collectors + batch
  route dedup (409 on pending duplicate jobs).
- **#3789** the worker health gate (see canary below).
- **#3791** docs corrected: the line was never dismantled.

Also: Gemini keys regenerated on all three machines (fingerprint-verified end-to-end);
issues #3725/#3734/#3737 closed; #3749/#3750/#3751/#3756 filed and largely executed.

## The relight

Scope-cleared (7 stale June selective-unpause scopes were strangling candidate
selection), `paused: false`, dial $5/day. **The scheduler was on the crontab all
along** — "the loop is absent" came from grepping the crontab for words the scheduler
line doesn't contain. Boarded: 64 reader-request books (priority 100), ~179
Derek-cohort books (90), 1,372 re-enrolled quarantine books (20 Kloss takedowns + 1
dirty correctly refused).

## The canary

First cohort through = the loop-prone manuscripts. Flash looped on **42% of fresh
pages** (211k chars from a 20k OCR). The dial contained spend (<$3 of damage); the
spot-check caught it in under an hour; `fix-translation-loops` (two-gate) cleaned the
writes; the cohort was re-held, **#3789** gave the worker a health gate (refuse
collapsed/runaway, stamp `translation.health_blocked`, no spin loop), and the cohort
was re-released into the guarded worker. Eight manuscripts (Ge'ez, Syriac, Georgian,
Tibetan) finished translation with full provenance and clean counters before the
ceiling tripped at $5.71 — the overshoot bounded and logged, as designed.

**Follow-ups:** ~310 borderline long-but-varied fresh pages spared by the conservative
gate need the benchmark lane; run the #3767 repair (59 shift+1 books, 20
reader-visible); author-resolver coverage is 69% with no standing worker (on #3756);
page-level hi-res re-archive has no cron; enrollment-window books (6,874) await a
boarding decision; watch tomorrow's 04:15 snapshot and the first `[spend-guard]`
DISPATCH cycle after the UTC reset.

**Human-readable layers:** the explainer ("The pipeline, as it should be") and the
incident record ("How the pipeline actually failed", 89 incidents / 10 classes /
v2 scorecard) — private artifacts, ask Derek for links; `/platform/admin/line` for
the live numbers.

CLAUDE.md check: up — nothing new unconditional (the health-gate/dial invariants live
in pipeline-ops + the v2 architecture doc); down — the pipeline-ops "Where Everything
Runs" reality note was corrected this session (#3791).
