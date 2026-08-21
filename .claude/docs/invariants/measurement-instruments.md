# A metric is a claim about an instrument before it is a claim about readers

**Read this when:** Quoting any usage number, building an analytics read path, adding an alarm or health probe, adding a search/analytics write path, answering "how many readers…", or building any RANKED or RELATED list a reader will read as meaningful (connections, recommendations, "see also").

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

**The write-time filter passes residential proxies, so even the "clean" instrument carries a fleet slice (2026-08-09).** A JS-executing crawler fleet ran Jul 10–Aug 6 2026 (PostHog: CN/SG/HK desktop `$direct`, ~1 pageview/visitor, 15K→42K/day) and its residential-proxy exits in BR/FR/DE/MX/US sailed through `classifyRequest()` as human — Mongo's own country-by-day shows BR 3,030→269 and FR 1,642→~0 across the Aug 6→7 boundary when the fleet left. Consequences:

- **The fleet leaving reads as a traffic cliff, and the fleet running reads as growth.** The "Aug 7 collapse" (20K→6K Mongo pageviews/day, DAU 4,372→~950) was contamination draining, not audience loss; every *referred* source (Google, Instagram, EFM, HN) was flat through the boundary. Referrer-stability across a step change is the cheap discriminator between "audience event" and "fleet event".
- **Geo diversity is not evidence of humanity.** Many-countries-many-IPs is exactly what a residential proxy network produces; it defeats both per-IP caps and country-based reasoning. The fleet signature is behavioral: desktop + no referrer + one pageview per fingerprint at volume.
- **Any Jul-10–Aug-6 window number (MAU, DAU, pageviews, country mix) is inflated** — quote post-Aug-7 baselines or segment out the direct/1-hit slice first. The two-instrument rule above still held: PostHog vs Mongo cross-check is what isolated the fleet in minutes.

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
- **Before trusting a rollup, find the thing that WRITES it — and check every reader guards on age.** `system_config.dashboard_snapshot` was recomputed only by `POST /api/admin/dashboard`; nothing ever called POST — no cron entry, and no refresh button despite the 202 branch telling the operator to press one. It served its **2026-04-01** value for 138 days (13,713 books against a real 22,069, page totals off by half), and because `/contribute` and `/developers/pipeline` read the same document, the frozen numbers were **public**, not merely internal (#4010). A snapshot has no way to report that it is not being written; it just keeps answering. Two habits: a rollup gets its writer in the same PR that creates it, and a reader renders `null`/a live count rather than a stale figure — `readFreshDashboardSnapshot()` in `src/lib/dashboard-snapshot.ts` is the shape (refuse past a max age, log the age). The 2026-08-06 audit had already written exactly this guard into `/api/analytics/usage` and left the *other* five readers unguarded and the snapshot still writerless — **guarding one call site is not fixing the defect**, the same lesson the R2 key bug taught twice in one week (`Data Protection`, CLAUDE.md).
- **Comparing "already processed" against "not yet processed" measures the processing ORDER, not the processing.** A sweep that walks the corpus in any non-random order splits it into two populations that differ in whatever it sorted by — and the difference reads as the sweep's effect. On 2026-08-17 the provenance bake's marked images were 30% larger than its unmarked ones, which was reported as the mark inflating storage by 1.30× — ~3 TB and ~$45/month forever — with a proposal to drop JPEG quality to claw it back. Wrong, and the fix would have degraded the archive for nothing: the bake does **bigger books first**, marked images average 1778×2121 px against 1378×1962, and normalising to bytes-per-megapixel gives **0.87×** — marked files are slightly *more* compressed. A controlled before/after on the *same* image put the watermark's true cost at **0.7%**. The tell is available for free: whenever the two groups are "done" and "not done", ask what ordered the work, and normalise by whatever that was. Where you can, take the before and the after from one object rather than from two populations — here that meant pulling an unmarked object and marking it locally, which is both cheaper and decisive.
- **Re-derive a paginated total; never trust a `.limit()` on supabase-js.** The same dashboard's 30-day cost asked `.limit(50000)` and got the silent 1,000-row cap, so it summed 1,000 of 18,298 rows and published `pages_translated_30d: 1000` — the cap constant wearing a metric's clothes, and a 37× understatement of spend ($38.37 vs $1,431.94). The tell is a metric that equals a round number in the code. Paginate with `.range()` and carry a `truncated` flag so a capped read is labelled a floor, not a total.
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

## An output that cannot vary with its input is reporting nothing — and a plausible list hides it best

The `/encyclopedia/[name]` **Connections** panel showed "other entities that appear in
the same books as X". It found entities sharing a book with the subject, sorted them by
their **global** `book_count`, took the top 20 — and only THEN computed the shared-book
overlap. The corpus's most frequent entities (Rome 6,242 books, Egypt 6,103, Aristotle
4,834, Plato 4,464 …) share a book with essentially every subject, so the limit always
ate the same twenty. Measured 2026-08-21: Active Intellect (248 books), Philosopher's
Stone (89), Kabbalah (496), Rosicrucian (14) and Mercury (825) returned an **identical
list, in identical order**. The panel had shipped long enough to be indexed, and was
caught by a reader asking "are these legit?" (#4109 removed it; #4111 rebuilds it).

- **The failure is upstream of the numbers.** A sort + limit that runs before the
  subject-specific measure doesn't merely rank badly — it makes the output stop
  depending on the input at all. Compute the per-subject measure BEFORE the limit.
- **Rank by association, not frequency.** Lift or PMI — shared books over what chance
  predicts from each item's own base rate — with a support floor. Raw co-occurrence in a
  corpus with a heavy head is a popularity readout wearing a relevance label.
- **It fails in the most expensive direction: plausible.** An empty panel gets reported
  in a day; twenty famous, on-topic-looking names read as insight. Same family as *an
  activity count is not a quality metric* and *an empty set is not disagreement* below —
  a signal that cannot move is not a weak signal, it is not a signal.
- **No single-subject check can see it.** The guard is a test that two different inputs
  produce different outputs. One that asserts only "the panel renders for X" passes for
  the entire life of the bug — see `tests-that-are-not-guards.md`.

## An activity count is not a quality metric, and "carrying" is not "depending"

2026-08-12 (#3894, #3945). An attribution workstream ran for a day reporting
**"records corrected"** — 28, then 63, then 142. Every number was true and none
was a measurement: no denominator, no baseline, and **structurally unable to
come back negative**. When a real metric was finally built
(`scripts/audit/attribution-health.mjs`, `.claude/docs/attribution-health.md`),
its first act was to score those same 142 corrections as a **net regression**:
35 records up a tier, **42 down**. Correcting a byline had cleared `author_id`
wherever the right person had no thesaurus doc, trading a *wrong but reachable*
attribution for a *right but unreachable* one. The activity count concealed that
completely — it could only ever go up.

**If a number cannot fall, it is a report of effort, not of quality.** Before
quoting progress, ask what would make this number get worse, and if there is no
answer, build the one that can.

Three numbers from that single workstream were wrong before they were caught,
each by the same mechanism — a plausible count taken without its denominator:

- **"1,526 books at risk"** if unsafe author-name variants stopped being matched
  on. The count was books whose `author` *equalled* such a variant. But a book
  with an explicit `author_id` reaches its author by foreign key and does not
  care what the variant says; only a book with **no** `author_id` depends on the
  string. True figure: **zero**. **Carrying a value is not depending on it** —
  measure the dependency, never the co-occurrence.
- **"6,025 unusable author strings"** (16% of the visible corpus) from a test
  asking whether the author string opens some book's title. It flagged every
  author whose name heads their own book. `author-attribution.mjs` has carried
  the guard against exactly this since #3434; omitting it reproduced the bug the
  guard exists to prevent. True figure after that guard **and** after excluding
  artworks — where the "author" is the artist and titles conventionally open
  with the artist's name — was **68**.
- **"142 records corrected"**, above.

**Scope is part of the instrument.** That artwork case is not a detail: 3,606 of
the 3,674 remaining "defects" were `resource_type`-bearing records with a
different identity model. A metric over a mixed corpus measures the mixture.
State the population in the script's own output, as the OCR loop does
(`ocr-quality-measurement-loop.md`), so the denominator travels with the number.

**Corollary for repairs that clear a field.** Nulling a foreign key to avoid a
wrong link is the right call — but it is a *cost*, and it will not appear in any
count of records fixed. Emit it: this run should have reported "22 bylines
corrected, 22 author pages lost" from the start.

## A model used as a judge or a screen is an instrument — validate it on the exact task, with seeded positives

Added 2026-08-13 from the Suda–SOL benchmark (#3884; handoff
`.claude/handoffs/2026-08-13-suda-benchmark-verification.md`). Three published
findings were retracted in one session, all the same shape as the analytics
failures above: **the instrument failed silently, in the direction that
flattered the conclusion.**

- **A cheap judge that cannot do the task answers "clean", not "I can't."**
  `gemini-3.1-flash-lite` scored κ=0.107 against cross-family gold labels,
  calling 47/49 entries faithful where 21 had catalogued errors — zero false
  positives, ~90% misses. We first read this as same-family leniency and
  published that. It was **task collapse**: the packet asked it to locate one
  entry's translation inside a full page *and then* grade it. Given focused
  Greek+translation pairs the same model detects 6/7 known issue-entries **in
  its own family's output**. A format change swung recall from ~10% to ~85%
  with no error, no warning, and no drop in confidence.
- **Validate on the format you will deploy, not a nearby one.** The categorical
  census was blessed on per-entry packets and then run page-grouped (mean 23.8
  entries/call). Scored against the 49 gold entries it already covered, it
  missed **all three** known events and added a false positive; verifying its
  66 recitation flags gave **3% precision**.
- **Use seeded positives, not just spot agreement.** Twelve entries with an
  injected translation-vs-Greek contradiction measured sensitivity directly:
  4/12 page-grouped, 5/12 single-entry. Agreement on a handful of easy cases
  (2/2, which is what we had) is not evidence of sensitivity.
- **A screen generates candidates; a verified sample generates rates.** Never
  quote a screen's clean-rate. Rates come from a sample judged by an instrument
  validated on that task, with intervals.
- **Sampling design is part of the instrument.** Our first gold set was
  stratified toward long narrative entries — right for *finding* failure modes,
  invalid as a rate. Uniform resampling moved "fully faithful" 57% → 77% and
  surfaced major errors (2%) the stratified pass reported as zero. If a number
  will be quoted as a rate, draw uniformly and say so.
- **Anchoring is testable, so test it rather than arguing about it.** Half of a
  150-entry sample was judged with the reference translation visible, half
  without, randomized: verdicts identical (17/75 each, z=0.00) — the objection
  was answered in the same run that produced the rates, for free. (Blind judges
  did catalogue 62 discrete faults vs 41: seeing the answer reduces granular
  scrutiny without changing the verdict.)

**The meta-rule, and the expensive one:** when a result flatters a suspicion —
about a rival vendor's model, about someone else's scholarship, about your own
pipeline being fine — that is the result to attack with a control first. Every
retraction this session was predicted by an adversarial self-critique pass that
cost nothing; running the controls it named cost about four cents.

## A detector that cannot run must go RED, never file a finding

Discovered 2026-08-19 by reading the *body* of four open issues that everyone had
been reading by title. **#3572, #3862, #4009** ("Image/text misalignment found in
weekly sample", three consecutive Mondays) and **#4023** ("Field sprawl breach on
books") were not findings. Each fenced payload was the script's own error:

```
MONGODB_URI not set — source .env.production.local first
```

`gh secret list` on this repo returns four secrets — `CF_ZONE_ID`,
`CLOUDFLARE_API_TOKEN`, `CRON_SECRET`, `HETZNER_SSH_KEY` — and **no
`MONGODB_URI`**. All three DB-backed scheduled detectors had therefore run blind
since the day they were added: the weekly image/text alignment sample (the
standing detector for #3368-class archiver drift), the weekly `books` field-sprawl
census (the ratchet half of #3969), and the daily feedback-symptom clustering.
Zero measurements, across weeks, while the backlog carried four issues asserting
the corpus was broken. Restoration is #4071; the exit-code fix is #4072.

**Both failure directions were live at once, which is why nothing caught it:**

- **Loudly wrong.** `bulk-archive-alignment.mjs` exited `1` for "found
  misalignment" *and* for "no MONGODB_URI", and the workflow files a finding issue
  on `1`. `field-sprawl-watch.yml` filed on `fired != '0'`, sweeping its script's
  correct exit `2` into the finding branch. Four false issues.
- **Silently wrong.** `feedback-symptom-clusters.mjs` exits `2` and its job files
  only on `1` — green every day since July, never having clustered a report. This
  is the direction that leaves no trace at all, and it is why "could not run" must
  be red rather than merely "not a finding".

`set +e` (needed to capture the code) meant every run reported **success** in the
Actions UI, so the filed issues were the only signal and they pointed at the
corpus instead of at the harness.

**The rule.** Every detector gets a three-value exit contract, and the caller
reads all three:

| code | meaning | caller |
|---|---|---|
| `0` | ran, clean | pass |
| `1` | ran, **found something** | file the finding |
| `2` | **could not run** | fail the job RED |

- **Never branch a finding on `!= 0`.** That is the single line that turned an
  infrastructure failure into three weeks of fabricated corpus findings.
- **An uncaught throw is `2`, not `1`.** A crash is an instrument failure; only a
  measurement can be a finding.
- **A job that swallows the exit code must re-raise it.** If you need `set +e`,
  add an explicit step that fails on any code outside `{0,1}` and names the
  missing input in the annotation.
- **Verify a detector by making it fail.** The only proof the wiring works is
  running it with the input removed and seeing red. A green scheduled run proves
  nothing about a detector whose failure mode is silence.

**Diagnostic tell for the next person:** an auto-filed issue whose fenced block is
an *error message* rather than a *measurement*. Read the body before believing the
title — and when a watchdog has filed the same title on a regular cadence with no
one acting on it, suspect the watchdog before the corpus.

Related: the same self-referential shape as the error reporter that reported its
own failures (#4045/#4047), and the inverse of "absence is not failure — no silent
skips" (#3740): here the failure was not silent, it was *disguised as a finding*.
