# Four archive bugs, one measurement instrument, and ten lost lessons — 2026-08-30

Continuation of `2026-08-30-r2-archive-livelock-and-one-metric.md`. That handoff ended
with two PRs open; this one covers everything merged after, plus the docs-backlog finding.

---

## Merged today

| PR | What |
|---|---|
| #4396 | Per-host rate limiter actually limits; 429 = slow down, not stop |
| #4403 | RECORD/FILE/MASTER — one definition of "archived" (#4239) |
| #4407 | Hetzner deploy watched 2 of the 8 script dirs the box runs |
| #4408 | Behavioural guard for the limiter + refreshed corpus stats |
| #4410 | `upgradeToFullRes` rewrote the ROTATION segment, 404ing every Gallica page |
| #4196 | "A counter cannot tell a dead source from a dead service" (open since 08-21) |
| #4197 | "Search before you build" (open since 08-21) |
| #4422 | Paid back the CLAUDE.md budget after #4197 — demoted two blocks, kept both lessons |
| #4421 | Archiver heartbeat |

Issues filed: **#4404** (R2 growth epic, sequences nine issues), **#4424** (the docs-PR
backlog), plus #4392–#4394, #4395, #4397, #4402 from the earlier half.

## The four archive bugs, and how each was found

1. **The limiter was a barrier.** Counted requests in a 1s window, then *reset* the window
   on wake — so N waiters all fired together. Measured: 60 concurrent callers against a
   nominal 5/s limit emitted **55 requests in one second**. MDZ was throttling a rate we
   never intended to send.
2. **A 429 was treated as a block.** Every run aborted → slept → retried at the identical
   rate. ~10 books/hour against a 3,211-book backlog. 401/403 still abort; 429 now feeds
   the limiter.
3. **Merging didn't deploy.** The Hetzner workflow filtered on `scripts/workers/**` and
   `scripts/crons/**`; the fix lived in `scripts/lib/` and `scripts/catalog-coverage/`.
   The box runs cron out of **eight** directories; the filter covered one, plus one that
   does not exist in this repo. Caught only by checking the box's SHA.
4. **`upgradeToFullRes` ate the rotation segment.** IIIF paths are
   `/{region}/{size}/{rotation}/{quality}`; the Gallica and Vatican rules matched
   `/full/<digits>/` unanchored, so on a URL already sized `full` they rewrote the
   *rotation*: `.../full/full/0/default.jpg` → `.../full/full/full/default.jpg` → 404.
   **The stored URL returned 200 when requested unmodified** — that is what identified the
   caller rather than the source. ~310 books; `digi.vatlib` had the identical rule against
   20,267 untouched candidates.

## Fetchability, sized

Random-sampled one unarchived page per randomly-drawn book, per queue source:

| source | fetchable |
|---|---|
| mdz | 30/30 |
| ia | 30/30 |
| erara | 30/30 |
| iiif | 23/30 (all 7 failures Gallica) |
| gallica | **0/28** — all 404, all our bug |

**The acquired backlog is healthy.** I had earlier flagged "a third may be unfetchable"
from an 8-page sample that turned out to be clustered — retracted.

## The measurement instrument (#4403)

`scripts/lib/archive-coverage.mjs` + `scripts/audit/archive-coverage.mjs` +
`invariants/archive-coverage.md`. Three tiers, never summed: RECORD (claims an R2 URL),
FILE (object exists), MASTER (is the full-res original).

Measured: **"on R2 at all" 78.4% vs "claims a master" 72.6%** — the 5.8% between is
#4194's derivative-only state, and the reason three methods answered one question with
1.48M / 4.03M / 5.18M. Also found **~11% of pages below native resolution (~2.2M)**,
within 5% of #3186's independently-derived 2.1M.

**You cannot classify by R2 key.** `pages/{bookId}/{NNNN}.jpg` is documented in
`src/lib/storage.ts:130` as the "1200px display" variant and in production holds masters
(1361×2517 and 2370×3816 measured). That comment is still wrong — see Open threads.

## The docs-PR backlog (#4424) — the finding that reframes the rest

Thirteen docs/invariants PRs open, oldest 2026-07-21. I test-merged each against
`origin/main` (gh reports `UNKNOWN` for stale PRs) and grepped main for each one's
headline phrases. **Ten are still missing from main entirely.**

Every conflict is on `CLAUDE.md`, because that file was restructured *underneath* the
branches. The conflict says the file moved, not that the lesson is wrong — but CLAUDE.md
is at its word budget, so they cannot be rebased and merged; each needs a tier decision.

**#4196 is the sting**: *"a counter cannot tell a dead source from a dead service — keep
the reason"*, written 2026-08-21, unmerged for nine days. That is exactly the Gallica
investigation. And `acquisition_queue` `import-failed` rows *still* record no reason.

Part of why "the doc existed and it recurred anyway" keeps happening: sometimes the doc
did not exist on `main` — it was in an open PR.

## State at handoff

- **Archiver is fixed, deployed, and observable.** Heartbeat live in production:
  `heartbeat 2.0m | books 0/30 | pages 10 ok, 4 failed | 0.08 pages/s | host gallica.bnf.fr`
- That 0.08 pages/s is #4396's adaptive backoff at full penalty on Gallica, from my own
  diagnostic hammering. **Batch composition dominates throughput** — a Gallica-heavy batch
  crawls while an MDZ batch runs at 2/s. That is the concrete argument for #4397 sharding.
- **MDZ is healthy**: 30/30, avg 433ms, ~0.95 MB/s. The 2/s cap in #4396 is now the binding
  constraint, not their tolerance. Step it up on evidence — 5/s is worth ~2.5×.
- Retry pass: 8,433 `import-failed` rows re-queued, ~260+ re-acquired before I stopped
  tracking. Acquisition is outpacing archiving (`un-archived acquired` 3,211 → 4,005).
- A run left going on the box (`archive-hb.log`, batch 30). Bounded; will finish.

## Open threads

- **The highest-value action is still not code: email BSB/MDZ** for a sanctioned rate.
  MDZ is 73–100% of the fetch gap; at 2/s their share alone is ~23 days, at 5/s ~9. The IA
  precedent (#4361) says institutions relent when you throttle honestly and identify
  yourself.
- **`src/lib/storage.ts:130` is factually wrong** — says the display variant is 1200px; it
  holds masters. My own `invariants/archive-coverage.md` misattributes that claim to
  `r2-storage.md`. Both need a one-line fix.
- `r2-storage.md` coverage stats are 94 days old and contradicted by today's numbers.
- **The CLAUDE.md word budget is shared mutable state across sessions.** #4422 brought it
  to 5,501; another session's merge took it to 5,519 within the hour. Same class as the
  `locus_anchors` lesson demoted in that very PR — two sessions can each spend a shared
  resource believing they own it.
- **A stalled run silently disables the cron.** The 10:45 run held `/tmp/sl-arch-acq.lock`
  for 1h24m; because the cron wraps it in `flock -n`, every subsequent run no-op'd with no
  log line. The heartbeat makes the stall visible, but nothing yet detects a *held lock*.

## Standing constraints

Do not route around a block — three hosts blocked us inside 48 hours in August, and
**Wellcome's trigger was sustained bytes, not rate** (0.4 req/s against a 5/s cap). Never
fix a timeout by requesting a smaller IIIF size (#3186). Never quote coverage without its
tier (`invariants/archive-coverage.md`). The pipeline stays paused; none of this spends AI
budget.
