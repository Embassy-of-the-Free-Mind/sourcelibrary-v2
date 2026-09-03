# The R2 archiver livelock, and why nobody could say how much was archived — 2026-08-30

Session started from "what remains with acquisitions?" and ended in a rate limiter, a
measurement instrument, and a CI filter that had been silently not deploying.

---

## What shipped

| PR | State | What |
|---|---|---|
| **#4396** | **MERGED** `d4c59486` | Per-host rate limiter actually limits; 429 = slow down, not stop |
| **#4403** | **MERGED** `ba387506` | RECORD/FILE/MASTER — one definition of "archived" (#4239) |
| **#4407** | open | Hetzner deploy watched 2 of the 8 script dirs the box runs |
| **#4408** | open | Behavioural guard for the limiter + refreshed corpus stats |

Issues filed: **#4392** (Trigault duplicate), **#4393** (Langdon OECT I+II in one record),
**#4394** (Sancai Tuhui: 109 unlinked records), **#4395** (the livelock), **#4397** (host
sharding), **#4402** (stall-timeout adoption gap), **#4404** (the epic that sequences it all).

## The three bugs, in the order they were found

**1. The limiter was a barrier, not a limiter.** It counted requests in a 1s window and,
when full, made each waiter sleep *and reset the window*. N waiters all saw a full window,
all slept the same interval, all woke together. Reproduced with the old code's exact
algebra: 60 concurrent callers against a nominal 5/s limit → **5 requests in the first
second, 55 in the next.** MDZ was throttling a rate we never intended to send.

**2. A 429 was treated as a block.** `noteFailure()` counted 401/403/429 alike toward
abort-at-25, so every hourly run aborted → slept → retried at the identical rate. A
livelock: nothing in the loop ever changed the variable causing the failure. Net **~10
books/hour** against a 3,211-book backlog. 401/403 still abort (a rights refusal is not a
rate instruction); 429 now feeds the limiter.

**3. Merging didn't deploy.** The Hetzner workflow filters on `scripts/workers/**` and
`scripts/crons/**`. The fix lived in `scripts/lib/` and `scripts/catalog-coverage/`, so no
run fired and the box kept executing broken code. The box runs cron out of **eight**
script directories; the filter covered one of them plus `scripts/crons/`, **which does not
exist in this repo**. Caught only by checking the box's SHA rather than trusting the merge.

## The measurement problem, which is the real finding

Asked "how many pages lack a master?" and got **1.48M, 4.03M, 5.18M** from three methods
inside one hour. None was wrong — they were different questions wearing one word. I got it
wrong in *both* directions myself: first over-counting by ignoring storage eras, then
under-counting by treating `display_photo` as archived.

`scripts/lib/archive-coverage.mjs` now defines three tiers that are never summed:

| tier | question | measured |
|---|---|---|
| RECORD | does a page doc *claim* an R2 URL? | **78.4%** "on R2 at all" |
| FILE | does the object exist? | (existing variant probe) |
| MASTER | is it the full-res original? | **72.6%** "claims a master" |

The 5.8% between them is #4194's derivative-only state: serves 100% from R2 while the only
full-res copy sits on the source institution's server.

**Why cheap classification is impossible:** you cannot tell master from derivative by R2
key. `r2-storage.md` documents `pages/{bookId}/{NNNN}.jpg` as the "1200px display" variant;
in production it holds **masters** — 1361×2517 from `archive-acquired.ts` (which resizes
nothing), 2370×3816 from the pipeline. Neither is 1200px. So `classifyPageRecord()` returns
`MASTER_OR_DERIVATIVE` and only a dimensional check decides.

Two things the instrument found on first run:
- **~11% of pages sit below native resolution** (~2.2M) — reached by dimensional sampling,
  **within 5% of #3186's independently-derived 2.1M.** Two unrelated methods agreeing.
- **~15% of books flagged archive-incomplete are actually complete.** #4190 measured the
  same counter 4.7× wrong the other way, and `archive-bulk.mjs` still selects work by it.

## Corrections I made to my own work

Worth recording, because each was caught by measuring rather than reasoning:
- Estimated sharding at "~35 pages/s, backlog in ~2 days". **Wrong** — the backlog is
  ~76% MDZ, so sharding buys *isolation*, not throughput. Honest figure is ~5–8 pages/s.
- Reported the backlog as 5.18M pages, "corrected" it to 4.03M by counting `display_photo`,
  then had to correct *that* — #4194 already established derivative-only isn't preserved.
- Hypothesised the `fetchWithStallTimeout` gap explained the MDZ stall. **Tested and it
  didn't** (missing pages are 0.3–1.0 MB, fetch in <1.1s). Filed as #4402 with the
  disproof included so nobody re-derives it.

## State of the world at handoff

- **MDZ is answering 200 in 0.3–1.1s** — the block has lifted, as IA's did within ~2h after
  the #4361 incident. The 2/s in #4396 is deliberately conservative; step it up on evidence.
- **Retry pass ran**: 8,433 `import-failed` rows flipped to pending, ~260+ re-acquired.
  Still draining. Note import-failed rows record **no error reason**, so the pass is blind
  and retries dedup-409s alongside transient failures.
- **Acquisition is outpacing archiving** — `un-archived acquired` rose 3,356 → 3,558 during
  the session. That's the dynamic #4404 exists to fix.
- A verification run of the archiver on new code went **25+ minutes without aborting**
  where old runs died in minutes. It had not emitted its summary line at handoff — the
  script logs only on completion. **Check `/var/log/sourcelibrary/archive-acquired.log` for
  a run ending without `ABORTED` before declaring the fix confirmed.**

## Next

Order is in **#4404**, and it matters: unblock (done) → **measure** (#4403 merged) → **email
BSB** → calibrate the MDZ rate → shard (#4397) → harden (#4402) → drain (#4225).

**The highest-value open action is not code.** MDZ is 73–100% of the outstanding fetch gap;
at 2/s their share alone is ~23 days, at 5/s ~9. They are a public institution with an open
IIIF endpoint and our user-agent already carries a contact address. The IA precedent says
institutions relent when you throttle honestly and identify yourself. Derek's budget
decision was **+$250/mo ≈ 17.9M pages ≈ ~71,500 books** at the measured 0.93 MB/page.

## Standing constraints

Do not route around a block — three hosts blocked us inside 48 hours in August 2026, and
**Wellcome's trigger was sustained bytes, not rate** (measured 0.4 req/s against a 5/s cap).
Never fix a timeout by requesting a smaller IIIF size (#3186). Never quote coverage without
its tier (`invariants/archive-coverage.md`). The pipeline stays paused; none of this spends
AI budget.
