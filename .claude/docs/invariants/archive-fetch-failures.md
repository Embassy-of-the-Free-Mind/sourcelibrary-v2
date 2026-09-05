# Archive fetching — a failure is a claim about the source

**Read this when:** Writing or debugging an archiver / importer: `scripts/lib/fetch-stall-timeout.mjs`, `scripts/**/archive-*.mjs`, anything writing `archived_photo`, or triaging a book that "failed to fetch".

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

Lessons from acquiring Thibault's *Académie de l'Espée* (2026-08-01). Full
postmortem: `.claude/handoffs/2026-08-01-thibault-acquisition-and-archive-failure-classes.md`.
Three failure classes, one shape: an archiver's error handling encoded a guess
about the source as a durable fact, and every one of them failed *silently, in
the direction that looks like success*.

- **A total-duration fetch timeout is a file-size limit wearing a clock's
  costume.** Aborting 60s after a fetch *starts* fires on the LARGEST page in a
  book — always the foldout, the map, the plate — while ordinary text pages sail
  through. It cost **42 of 45 double-page engravings** on one book, and the book
  still reported hundreds of archived pages, so nothing looked wrong. Use
  `fetchWithStallTimeout()` (`scripts/lib/fetch-stall-timeout.mjs`), which
  re-arms per chunk so size stops mattering. **Never "fix" this by requesting a
  smaller IIIF size** — that is the #3186 mistake and is doubly destructive on
  exactly the wide plates it destroys. **Tell:** failures cluster on the widest
  canvases; a lone fetch of the failing page succeeds. The abort surfaces as
  `This operation was aborted`, which reads as rate limiting — backing the
  request rate off makes it strictly worse, because the constraint is
  per-request duration, not requests per second.
- **HTTP 403 may be a rights refusal, not a block — never auto-retry it.** 88%
  of this corpus's failure markers are Internet Archive, and they resolve to
  `access-restricted-item: true` / `inlibrary` books: IA **correctly refusing to
  serve in-copyright material**. Clearing such a marker re-queues a fetch that
  must never succeed, and if one did we would mirror copyrighted pages into R2.
  `classifyArchiveFailure()` treats bare 403 as `unknown` (reported, never
  auto-cleared); `--include-403` is an explicit opt-in for a caller who has
  confirmed the books are public domain. Check the IA item's
  `access-restricted-item` before assuming a 403 is transient.
- **Never write an error you did not attribute into `archived_photo`.** The
  field doubles as the archiver's work queue, so any `failed:` string hides the
  page from every future run — and a catch-all handler writes *our* failures
  there too: a Mongo DNS blip and an R2 clock-skew error each permanently hid a
  perfectly readable page. An infrastructure error says nothing about the
  source. (Same class as the Data Protection rule in `CLAUDE.md`: a bad write erases its
  own repair path.)
- **Recovery must never be gated on the SPEND allowlist.** Phase 8.5 rolls a
  stuck `*_submitted` status back, which submits nothing and costs nothing — but
  it was confined to the selective-unpause scope (160 books of ~99.7K) and
  skipped entirely on a paused run, so 8 books sat stuck 10–23 days and were
  repaired by hand. Corollary of "the pause is a SPEND control": gate the phases
  that spend, never the bookkeeping that heals.
- **Sampling the head of a collection samples insertion order, not the
  population.** A 2,500-page sample read 92.9% retryable; the full 14,123 read
  69.2%. Validate a corpus sweep at corpus scale — and note that a *silent*
  long-running script reads as a hang (two full scans were killed before
  emitting a line). The fix is a heartbeat, not an index: indexing
  `archived_photo` would add ~1.5 GB to a hot collection to serve a rare sweep.

---

## A fast failure is the expensive one (2026-09-04, #4588)

Three rounds of diagnosis went into "the archiver completes ~0 books per run:
0.08 pages/s, ~58% page failures, 12,433 books parked at `archiving`", and the
first two were wrong. The measurements that settled it took four minutes. What
they found:

| host | what it answered | verdict |
|---|---|---|
| `iiif.archive.org` | **400 "Invalid size" in 0.2s**, some 504 after 60s | our URL is invalid; it can never work |
| `gallica.bnf.fr` | **429 in 0.08s, to every request** | serves 200s in ~1s when the archiver is idle |
| `api.digitale-sammlungen.de` | **200 in 0.3s, 8 of 8** | perfectly healthy |

Three different failures, one number. And **60% of the parked backlog was on the
healthy host** (bsb 4,623 + mdz 2,936 books) — it was starved behind the other
two, not slow.

### The rules that follow

- **The IIIF size keyword belongs to the API VERSION, not the host.** Image API
  3.0 removed `full`; the v3 spelling is `max`, and a v3 service answers
  `/full/full/` with `400 Bad Request — Invalid size`. 223,328 unarchived pages
  sat on `iiif.archive.org/image/iiif/3/`, and the corpus held *both* spellings
  against the same host — so the endpoint read as intermittently flaky rather
  than as systematically misaddressed. `upgradeToFullRes` now keys on `/iiif/3/`
  in the path. Counter-example that keeps the rule honest: `dl.ndl.go.jp` is
  excluded, because it 500s on `max` and wants `full`.
- **A 400 and a timeout are not the same fact, and a run that records neither
  is not measuring anything.** `noteFailure` counted only 401/403/429 and
  dropped every other error, so the log said `617 failed` for a week without
  once naming a status. Archivers now print a per-host table of ok/fail/status
  every run. This is the general rule in `measurement-instruments.md`, and the
  cost of not having it here was three wrong diagnoses.
- **A cumulative average cannot report a cliff.** The heartbeat's `pages/s` was
  computed over the whole run, so a collapse from 53 pages/min to 5 rendered as
  a smooth drift from 0.86 to 0.15 — which reads as gradual decay. Rate
  counters on a long run must be windowed.
- **A rate that does not vary with the counterparty is a fact about US.** The
  flat 0.08 pages/s across different hosts was the tell that the limiter was
  innocent; a per-host rate limiter cannot produce a number that ignores which
  host it is talking to.

### The scheduling rule, which is the actual fix

**A barrier turns one blocked source into a global stall.** Both loops in
`archive-acquired.ts` were `for (i += N) { await Promise.all(slice) }`. A slice
does not advance until its slowest member finishes, and the members that
finished early sit idle — so a slice holding one book on a refusing host runs at
that book's speed with most of its capacity parked. Measured: a run archived 53
pages/min for four minutes, completed its one healthy book at minute 5, then
held seven of eight slots for 45 minutes on books that could not fetch a single
page. **Use a worker pool with a shared cursor, never a sliced `Promise.all`,
for any sweep whose items have wildly unequal cost** — and pair it with a
per-host circuit breaker (`scripts/lib/host-breaker.mjs`), or the pool refills
its freed slots and hands them straight back to the host that emptied them.

Corollary, and the reason the breaker is half-open: **a breaker that never
re-tests is the same half-a-control-loop mistake as a backoff with no recovery**
(#4396 → #4559). It just fails in the safe direction, so nobody notices. Writing
the recovery test found that a failed probe left the original trip timestamp in
place, which turned the breaker back into no breaker after one cooldown.

### And the write that would have become destructive

A book that archived **zero** pages was marked `archived: true` and dropped from
the queue for good, with the truth demoted to a note (`partial:0/424`) that
nothing reads. That line had been unreachable only because the run was always
killed at the 50-minute ceiling first. **Fixing a throughput bug makes the code
after it reachable — audit that code in the same PR**, or the fix ships the
latent one.
