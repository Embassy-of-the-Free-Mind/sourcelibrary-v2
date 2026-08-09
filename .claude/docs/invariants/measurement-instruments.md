# A metric is a claim about an instrument before it is a claim about readers

**Read this when:** Quoting any usage number, building an analytics read path, adding an alarm or health probe, adding a search/analytics write path, or answering "how many readers…".

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

## A metric is a claim about an instrument before it is a claim about readers
A usage review on 2026-07-28 produced six findings; **three were instrument failures, not product facts** — and each failed *silently*, in the direction that invited a confident conclusion. Full postmortem: `.claude/handoffs/2026-07-28-instruments-lied-translation-streaming-crash.md`.

- PostHog reported traffic **tripling** over a month when human traffic **fell 4×** — it was counting a headless fleet (204,270 one-hit distinct_ids in 7d; an impossible 50/50 Chrome-Windows/Chrome-Mac split). Those loads never reach `/api/track`, so the server-side classifier never sees them to label.
- "81% of readers read a single page" was a crawler: `analytics_events.page_read` has **no bot filter and stores no user-agent**, so it cannot be classified even retroactively (#3405).
- "Nobody shares" was a **missing button** — the book page, 72% of pageviews, rendered no share control at all (#3410).
- "Exceptions carry no detail" was the **wrong field name**: PostHog's singular `$exception_type`/`$exception_message` are always null; the data is in the plural `$exception_types`/`$exception_values`. That mistake buried a live crash for weeks.

**Before treating a number as a fact about readers, ask what would have to be true of the instrument to produce it.** Concretely:

- **Compare two independent instruments before quoting either.** Mongo (bot-filtered at write time) and PostHog (not) disagreed by *direction*. Where they agreed — multi-pageview users, ~3,200 vs 4,108 — the number was trustworthy; the divergence *was* the finding.
- **Group by path SHAPE, never exact `$pathname`.** Reader URLs are unique per page (`/book/<slug>/page/<id>`), so exact grouping scatters reader traffic over thousands of rows and buries it while `/collections/x` aggregates into one. This alone produced a wrong "the reader is unaffected" conclusion.
- **Report rates, not counts, and exclude bot traffic from every denominator.** Collection pages looked minor by volume and were running at ~0.96 crashes per pageview. A zh-CN "audience" of 200K is one actor.
- **A silently-dropped field is the default failure.** `/api/analytics/event` drops prop keys not on its allowlist — no error, 200 response, field simply absent later. Adding a prop without allowlisting it reproduces the bug inside its own fix.
- **Absence of data is a claim that needs its own evidence.** 88% of crash frames read as unresolvable because **our own bot gate 403s PostHog's symbolicator** (#3422), and Googlebot "vanishing" was bucket opacity, not absent crawling.

Corollary for fixes: **a plausible non-fix is worse than no fix.** PR #3418 applied a real remedy for the wrong failure and was closed rather than merged once the actual cause was found.

**An alarm is an instrument too, and one sample is not an outage (#3478).** `/api/health/auth` emailed "[CRITICAL] Source Library sign-in is broken" off a **single** dropped Atlas TLS handshake at 00:00:01 UTC. Sign-in was fine — a sign-in link went out at 23:27, an account was created at 00:02:24 (two minutes *after* the page), and 2,013 of the preceding 2,016 probes were clean. Everything above about measuring readers applies verbatim to measuring ourselves:

- **Confirm before paging.** A probe that alerts on its first failed sample is reporting its own connection, not the product. `src/lib/health-alerting.ts` `recordFailureStreaks()` requires N consecutive failures, counted **per check** so unrelated single blips never sum to a page, and **fails open** when the streak store is unreachable — a genuine Atlas outage still pages immediately. Match the guard to the cadence: a 10-min probe can afford a 2-probe streak (~20 min to page); an hourly one cannot, and gets `retryWithBackoff()` instead.
- **A retry with no delay is not a retry.** Both routes looped twice back-to-back, so a fault lasting a couple of seconds exhausted every attempt and still read as "after retry" in the alert text.
- **Cron convergence manufactures the fault.** Nine Hetzner schedules align at 00:00 UTC; the resulting pile of cold Vercel functions all dialling Atlas at once is what dropped the handshake, and it took out both DB-touching probes in the same second. Keep probes off `:00`.
- **Word the alert as what was observed.** "Users cannot sign in" was an inference from one probe, and it was false. Say which check failed, how many consecutive probes it has failed, and tell the reader to confirm real user impact — for auth that means recent `users` inserts and `verification_tokens`, never another probe.
- **Get the base rate before believing a pattern.** The Hetzner cron log (`/var/log/sourcelibrary/cron-caller.log*`, 14 days rotated) turns "the DB is flaky" into "3 failures in 2,016 probes, two of them an unrelated Resend outage" in one command.

**The replacement instrument needs the same audit as the one it replaced (#3453).** `reading_history` was the clean twin that rescued the reading-depth question from the scraper fleet — auth-gated, keyed on `user_id`, no crawler can be in it — and it was right about the thing it was checked on (26% of member sessions are 10+ pages, stable across every window and robust to dropping the heaviest accounts). Then it was quoted for two things nobody had checked, and both were wrong:

- **A metric's name is a claim about its denominator.** "Members who came back: 62%" counted `sessions > 1`, and a session is one user + one **book** — so opening a second book in the same sitting scored as a return. The day-based figure is 30.9%, and 61.0% of members have their entire history inside a single hour. Before quoting a rate, say out loud what one row *is*; if the unit isn't the thing the label names, the number is measuring something else. Same trap as grouping by exact `$pathname` above.
- **Auth-gated is not human-gated.** A session excludes anonymous crawlers, not a signed-in account bulk-fetching: 29.5% of member pages arrived faster than 20 pages/minute, and the top 1% of members are 39% of all pages. **Per-session shares survived it and totals did not** — which is the general rule, not a detail of this dataset. A rate whose denominator grows with the contamination is robust; a sum is not.
- **Counting sessions put the weight in the wrong place.** One-page sessions are 43.7% of sessions and **2.8% of pages read**; 10+ page sessions are 26.5% of sessions and **88.3% of pages**. The shallow tail is loud in one denominator and nearly weightless in the other. Report both, or the tail reads as the story.

And **a field nothing writes looks identical to a field nothing needs.** `reading_history.referrer` was accepted by both routes, plumbed through the API client, projected into the GET response — and never sent by the reader, so all 6,659 rows were empty and "how do members reach a book" was unanswerable without one line of client code. Before concluding a signal is absent, check that something is actually emitting it.

## The measurement layer fails silently, and always toward good news
Lessons from the 2026-07-28 usage review (#3399, #3400, #3405, #3408, #3409). Five instruments were checked; four were broken, and not one of them looked broken. A dead cost rollup reads `$0.00`. An unfiltered event stream reads as engagement. A frozen dashboard reads as stable. **Treat a monitoring gap as a defect with a blast radius, not a chore** — every one of these was feeding a decision.

- **Classify traffic at WRITE time, in every collection analytics reads from.** `analytics_pageviews` classified at ingestion and stayed clean; `analytics_events` did not and stored no user-agent, so `page_read` counted a crawler fleet as readers (839,701 events vs 24,577 human book-page views in the same week — 34×) and **could never be cleaned, because the field needed to classify was not stored**. Ingestion is the only point where the evidence exists. `src/lib/analytics-ingest.ts` `classifyRequest()` is the shared entry point; a new analytics write path uses it or it is born contaminated. Stored rows carry `traffic_class` + `user_agent` so the *next* contamination is diagnosable from the data instead of by inference.
- **A crawler-inflated counter spends money, not just pixels.** `books.read_count` sorts "popular" surfaces **and** picks the queue for paid OCR batches (`/api/admin/bulk-ocr-new`, `/api/admin/bulk-reocr` both sort on it). Never increment a counter from an unclassified request.
- **Per-IP limits cannot see a fleet.** ~80 rotating IPs defeat every per-address cap we have; this is the second instance this month (the other being the quote-scrape). Rate caps are a floor, never the filter — which is why the class is *stored* rather than trusted.
- **The pipeline pause is a SPEND control. Never gate bookkeeping on it.** `sync-worker` exited on `processing_control.paused` before its first phase, so the 2026-06-08 pause froze six derived outputs for seven weeks: `gemini_usage_daily`, `system_config.analytics_usage`, `author_slugs`, page counts, collection counts, gallery materialization. And the pause does **not** stop everything that spends (`bulk-reocr-local.mjs` bypasses it) — ~$397 of computed cost ran during that window, including 32,094 pages OCR'd on 2026-07-07, while the dashboard read `$0.00`. Pausing the pipeline must never blind the meter that would show what's bypassing the pause. If a phase spends, gate the phase; never the worker.
- **An alarm nobody reads is not an instrument.** `pipeline-health-alert` emitted `sync_worker_missing` daily — and emailed it — for all seven weeks. It was worded "worker may never have run", which reads as a cron nit rather than "six collections are frozen". Before adding a new alarm, check whether the existing one already fired and was ignored; if so, the fix is the wording or the channel, not another alert.
- **A worker that bails before phase one writes no `cron_runs` record**, so "no record" and "never scheduled" are indistinguishable from the alert. Check the worker's own log on the box before blaming cron.
- **Verify a metric's property names before reporting it missing.** #3409 reported 15,611 exceptions with null `$exception_type`/`$exception_message`. Those are posthog-js's *legacy* singular names — current versions send `$exception_list`, surfaced as `$exception_types`/`$exception_values`, and the data was fully populated. A null on a name you assumed is a query bug until proven otherwise.
- **When an instrument is broken, say so instead of printing a number.** The read paths now report "not measurable, N unclassified events" rather than a plausible histogram. A number that looks authoritative and is wrong is worse than no number — it had already reached the weekly digest.
- **A row written BEFORE the work happens must be closed out after it, by the same key — or it is a permanent zero.** Batch jobs log a `gemini_usage` row at submit time, when no tokens exist yet: `input_tokens: 0, cost_usd: 0.00`. Nothing reconciled them, and `batch-collector` inserted a *second* row with the real numbers, so one meter simultaneously read $0.00 over 376,804 pages of real spend **and** double-counted every completed batch's calls and pages in `dashboard_usage` (#3452). Writers close the placeholder via `completeBatchUsage()` (`scripts/workers/lib/supabase-usage-logger.mjs`), matched on `batch_job_id` + a placeholder status; `scripts/maintenance/reconcile-batch-usage.mjs` is the standing reconciler for every other terminator (ghost sweep, nameless reaper, generation guard) and derives their outcome from `batch_jobs` rather than asking each site to touch the meter. Three traps this class hides behind:
  - **A reconciler that exists is not a reconciler that runs.** `logBatchResult()` in `src/lib/gemini-logger.ts` was written for exactly this job and matched `status = 'pending'` — while the orchestrator writes `'submitted'`, and nothing called it. Two spellings of one state is the same bug as no state; both are now in `PLACEHOLDER_STATUSES` and any sum must exclude them.
  - **Bill per RESPONSE, not per saved page.** Gemini charges for responses we throw away (RECITATION blocks, empty candidates, over-length output, generation-guard drops), so a job where every page was blocked recorded $0.00; and in multi-page mode one response carries one `usageMetadata` for N pages, so per-page attribution multiplied it by N. `sumBatchResponseUsage()` is the shared summer.
  - **`batch_job_id` holds two different identifiers** — `batch_jobs.id` from the orchestrator, the Gemini job name (`batches/v7zl…`) from the older `/api/books/[id]/batch-ocr-async` route. Joining on `id` alone reported 562 of the first 1,000 placeholders as orphans: missing-looking data that was merely keyed differently. Where a join can't resolve, the row is marked `unknown`, never `failed, $0` — an unmeasurable is not a zero.

## Count the search BOXES, not the search logs
Before quoting anything about what users search for, **enumerate the search boxes in the UI and verify each one writes a row.** A log tells you about the boxes that log; it is silent about the ones that don't, and silence reads as "nobody searches."

On 2026-07-31 a partner usage report claimed "of 93,179 views in the BPH reading room, exactly four were searches" and concluded readers there don't search. Both wrong, in two stacked ways (#3484):

- **Wrong instrument.** The 4 came from counting pageviews of a `/search` *page*. Site-wide there were 5,903 such pageviews against 43,980 actual searches — searching mostly never produces a `/search` pageview at all. The tell was available immediately: two numbers that should have been comparable differed 7×. Related: **`analytics_pageviews.path` strips query strings** (0 of 926K stored paths contain `?`), so any URL-param search is invisible there by construction.
- **A whole box was unmeasured.** `/api/catalog/bph` — the reading room's front-page catalogue search, the first thing a visitor sees — had no analytics call of any kind. Four months, zero rows. The BPH searches that *did* exist came from in-book search and the site's unified search: different boxes.

Six search entry points existed, each built at a different time, each hand-rolling its own `analytics_events` insert, so logging was something every new route had to remember — and forgetting produces silence, not an error. The five that logged had also drifted: **none stored `host`**, so all 94,442 rows are `host: null` and cannot be split by surface even retroactively. Same shape as the five `entities.books[]` writers (`entity-page-attribution.md`).

- **`src/lib/search-event-log.ts` is the single writer** for `search_query` events; `src/lib/search-log.ts` is the twin for the `search_queries` latency log. Both derive `host` / tenant / traffic class **inside the writer** from request headers rather than accepting them from callers, so a new surface cannot be born unattributable. A new search route uses them or it is not measured — `tests/unit/search-event-instrumentation.test.ts` pins the route list, and a route added without being listed silently stops being covered.
- **A route that resolves a tenant to scope its query must pass that tenant to the logger.** `/api/search` did the first and not the second, leaving every "global" search unattributable with the answer sitting in scope (#3488).
- **Tenant, not host, is the discriminator.** The reading room is served at `sourcelibrary.org/embed/bph`, so host says "sourcelibrary.org" for both surfaces. Separately, a subdomain's `/search?q=…` is rewritten by `proxy.ts` to `/embed/<tenant>/search`, which **re-exports the main `SearchPage`** and lands in `/api/search` — so a "main site" search list silently contains partner searches unless the row carries a tenant.
- **Don't instrument `/api/search/semantic` with a `search_query` event.** It fires on the same page-load as `/api/search` for one user query; adding one double-counts every search. It logs latency to `search_queries` only, and a guard pins that.

## On serverless, a floating promise is not a write — and it drops COLD starts first
`void writeEntry(...)` is fire-and-*maybe*. Vercel freezes the instance the moment the response is sent, so a telemetry insert still in flight is suspended with it and completes only if a later request happens to thaw that same instance. Measured 2026-08-05 while verifying the MCP handshake log (#3644) against a fresh preview: the row landed **~40s after its request**, carried in on an unrelated later call, and a tool-call row from the same deployment never landed at all.

- **Warm instances usually win the race, which is exactly what hides it.** Production had 20,890 `mcp_tool_calls` rows and looked healthy; nothing about the collection suggests the writes are lossy.
- **The loss is biased, not random.** Cold starts are where the Mongo connect is slowest — and a cold start is disproportionately *the first contact from a client we have never seen*. A log that drops new clients preferentially is the worst possible instrument for counting new clients. Read pre-fix `mcp_tool_calls` volumes as a floor.
- **Hand deferred work to the platform.** Next.js `after()` keeps the function alive until the callback settles; bound it (3s) so a slow Atlas write can't hold the slot, and fall back to a bare call for non-request scopes where `after()` throws. Canonical shapes: `src/lib/mcp-usage.ts`, `src/app/api/track/route.ts` `deferDbWrite()`.
- **Verifying against a cold preview is what surfaced this**, and only because the probe had a positive control — "no row after 12s" was initially read as "the write path doesn't fire," and the truth (it fires late) only appeared on a re-check a minute later. When a probe comes back negative on a deployment that just booted, re-read before concluding; see `lesson_probe_needs_a_positive_control` and `tests-that-are-not-guards.md`.

## "The data is contaminated" and "the number that spends money is contaminated" are different claims
Recorded 2026-08-06 (#3658/#3669), where the second was asserted from the first and was wrong.

A scraper fleet accounted for **43.8% of `page_read` events**. `books.read_count` orders the
paid re-OCR and translation queues. It looked obvious that the fleet had been choosing what we
pay Gemini to transcribe, and that a backfill was owed. It hadn't, and it wasn't.

- **`books.read_count` increments only on `book_read`** (`src/app/api/analytics/track/route.ts`),
  and both fleets deep-linked straight to page URLs — **0 of 3,006 `book_read` events** since
  2026-08-02 came from either. `180.153.197.0` has 18,796 `page_read` and zero `book_read`
  going back to May. The counter was clean the whole time.
- **`pages.read_count` genuinely was ~60% bot — and nothing reads it.** `git grep` finds a
  writer and no consumer. Contamination in a field nobody acts on costs nothing.
- **So: trace the write path from the event to the counter, and the read path from the counter
  to the money, before you cost out a repair.** Which event increments it, and who sorts on it.
  Both are one `git grep` away, and skipping them turns a clean system into an invented backlog.

The general shape: a contamination finding is about a **population**; a spending decision is
about a **specific field**. Getting from one to the other requires showing the population
actually reaches the field. See `lesson_denormalized_counter_definitional_gap` for the
neighbouring error, where a counter gap that looked like staleness was definitional.

## A guard that reads a meter is itself an instrument — point it at the store production writes to
Recorded 2026-08-09. Postmortem: #3843; incident #3826; fix #3835. The $15/day spend dial
(`scripts/lib/spend-guard.mjs`) compared "today's spend" against its budget all day while the
line billed ~$2.3K — because it summed **Mongo** `gemini_usage`, and the logger
(`supabase-usage-logger.mjs`) writes **Supabase** first, falling back to Mongo only on error.
The two stores are mutually exclusive per row; the guard saw the fallback trickle ($9.00) and
green-lit dispatch. The "two stores — sum them" trap was already written down in the cost doc;
what was new is that a *safety control* embodied it.

- **Sum both `gemini_usage` stores, always.** The guard now does; anything else that meters
  spend must too. Neither store alone is ever the number.
- **An unreadable meter stops the line.** The guard fails closed on a Supabase read error or
  pagination overflow — "cannot measure" must be distinguishable from "measured zero", and must
  refuse, not allow. The pre-fix guard's log line printed a confident dollar figure from the
  wrong store; an instrument that cannot report its own blindness will always fail silently.
- **Every path that creates paid work asks the dial.** The incident's only live dispatcher
  (translate-worker selfDispatch) was ungated; gates on "the orchestrator" are not gates on
  spending. Grep for job-insert sites, not for phase names.
- **Test a spend control with a positive control**: spend a known cent, watch the needle move
  in the store production writes to, and cross-check the vendor's own meter (Cloud Monitoring
  hourly buckets — day-aligned queries anchor to the query END time and silently become
  rolling-24h windows). Verified 2026-08-09 for ~$0.05.
