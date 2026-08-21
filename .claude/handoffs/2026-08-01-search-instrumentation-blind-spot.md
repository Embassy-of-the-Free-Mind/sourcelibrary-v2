# A whole search box recorded nothing for four months — 2026-08-01

Started as "write a reading report for EFM." Became an instrumentation
postmortem, because three claims in the draft report were wrong and each was
wrong in the same direction: **the instrument was broken and the broken reading
was the flattering, tidy one.**

## What was reported, and what was true

| Draft claim | Reality |
|---|---|
| "The BPH reading room has 474 pageviews" | 474 is the **staff catalogue** on `bph.sourcelibrary.org`. The reading room readers use is `/embed/bph`, embedded in the EFM site: **93,179 views** |
| "Of 93,179 views, **exactly four** were searches" | Counted pageviews of a `/search` *page*. Actual measurable BPH searches: **644** |
| "This 441-term list is the main site only" | That log records **neither host nor tenant**. An unknown share is BPH |

Only the first was caught before publishing. The second and third were caught by
Derek pushing back — "huh??" and "so all those search terms are from
sourcelibrary, not bph?"

## Root cause

Six search entry points, each built at a different time, each hand-rolling its
own `analytics_events` insert. **Five logged; one logged nothing at all** — and
the silent one is `/api/catalog/bph`, the reading room's front-page catalogue
search, the first thing a visitor sees.

The five that did log had drifted apart: `/api/search/unified` stored `country`,
the book-search routes didn't, and **none stored `host`**. All 94,442 stored
search events are `host: null`, so reading-room searches could not be separated
from main-site searches even retroactively.

`search_queries` (the other search log) had neither host nor tenant. And a
partner subdomain's `/search?q=…` is rewritten by `proxy.ts` to
`/embed/<tenant>/search`, which **re-exports the main site's `SearchPage`** and
lands in `/api/search` — indistinguishable from a main-site search. That route's
own comment cites `?q=boehme`, `?q=rosicrucian`, `?q=Hartmann` arriving that way.

Compounding it: `analytics_pageviews.path` **strips query strings** (0 of 926K
stored paths contain `?`), so any URL-param search is invisible there too.

## Shipped

- **#3484 (merged, deployed, verified live)** — `src/lib/search-event-log.ts` is
  now the single writer for `search_query` events. Runs every event through
  `classifyRequest()` so `traffic_class` / `user_agent` / `host` are stored at
  write time. All six routes go through it. The catalogue route logs only when a
  query or advanced field is present and only at `offset === 0`, so browsing and
  pagination don't inflate the numerator.
- **#3488 (OPEN — green, mergeable, NOT deployed)** — `search_queries` records
  `tenant_id` / `tenant_slug` / `host`, derived inside the writer so a caller
  cannot forget; `/api/search` passes its `tenantId` (it had resolved the value
  to scope its own query and then not logged it — a hole in #3484's first pass).

**Next session: merge #3488, then `npm run deploy:prod` from `main`.**

## Verified in production

Within hours of the #3484 deploy, a real reader in Spain:

```
Jacobo → Jacobo grimberg → Jacobo Grinberg → Syntergic theory
```

Four consecutive searches, all **0 results** — a reader refining a spelling then
reaching for the theory's name. A genuine acquisition signal that the search box
would have swallowed silently the day before.

## Deploy notes worth keeping

- `deploy:prod` died with `ETIMEDOUT` mid-poll and its self-check reported
  `HTTP 000000`. `vercel inspect` showed prod still on the **pre-merge** build
  while the new deployment was **still Building** — the CLI had only lost its
  connection. Re-running immediately would have discarded a build minutes from
  finishing. This is the mirror image of the EPIPE case already in CLAUDE.md:
  **on any `deploy:prod` failure, inspect before deciding — it may have shipped,
  or it may still be shipping.**
- The script crashed before printing its PURGED line, so purge + warm were run
  by hand: `TOKEN OK`, `PURGED`, then warm (501 pages, 0 failures). Confirmed a
  book page's CSS chunk returns 200 — the actual test for stale-HTML/dead-CSS.
- `gh pr merge --delete-branch` fails with `fatal: 'main' is already checked out`
  when worktrees exist. **The merge still lands** — only local cleanup fails.
  Verify with `gh pr view --json state` rather than trusting the exit code.

## The test lesson (new, and it happened twice)

Both source-shape guards written this session initially **passed with the code
they guarded deleted**:

1. `toContain('hasSearchTerm')` + `toContain('offset === 0')` — both tokens
   appear elsewhere in that file.
2. `toMatch(/tenantId/)` on the `logSearchEvent({…})` call body — satisfied by
   the **explanatory comment** sitting directly above `tenantId,`.

Both were caught only by running the negative control: delete the thing, confirm
the test goes red. Fixes were to assert a composite string positioned *before*
the call, and to strip comments before matching.

## Files

- `src/lib/search-event-log.ts` (new), `src/lib/search-log.ts`
- `src/app/api/catalog/bph/route.ts` (was uninstrumented)
- `src/app/api/search/{route,unified/route,index/route}.ts`
- `src/app/api/books/[id]/search/route.ts` + `[tenant]` twin
- `tests/unit/search-event-instrumentation.test.ts` (new, 17 tests)

Report for EFM: `https://claude.ai/code/artifact/314b5471-be69-4f60-9248-e4ace65e8988`
(private; corrected three times as each instrument failure was found).
