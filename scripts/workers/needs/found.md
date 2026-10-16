# Needs map: Found

**Purpose:** a reader who comes looking finds the right book, page and quote.
**Built:** 2026-10-11 by job `needs-found-6359`. **Refreshed:** 2026-10-16 by job
`needs-refresh-found-6359`, part of #6359. Read-only, $0.
Window: the 30 days 2026-09-16 → 2026-10-16 unless a line says otherwise. Live books =
`visible: true && pages_count > 0` on `bookstore` (n = 42,357). Sources: `analytics_events`
(`search_query`, `book_read`, `page_read`, `shortlink_visit`), `books.human_read_count` (#6809),
Supabase `bph_works`, and `gh` issue and PR comments (box landings are read from those).
Ranked queue: `found.json` next to this file.

## 1. The number

**Reach: 2,990 of 42,357 live books (7.1%) had at least one human reading visit in the last
30 days** (2026-09-16 → 2026-10-16). Same rule over the map's first window (09-11 → 10-11): 2,849.
That is 8,017 reading visits now against 7,780 then.

- **The definition changed this week, so the 10-11 headline does not compare.** On 10-11 the map
  counted any `book_read` or `page_read` with `traffic_class: 'human'`: 17,033 books (40.3%). Under that
  rule today it would be 18,499 (43.7%). #6809 (merged 2026-10-16) built `books.human_read_count` on
  `scripts/lib/human-read-fingerprints.json`: a visit counts at the **second** human read event for
  the same book from the same /24 within 60 minutes, after dropping pool user agents (Lightpanda; a
  Windows rotation over Chrome 103–124) and any /24 that read 20 or more books that UTC day. The old
  number was mostly proxy-pool traffic that sends one request per address. This map now uses the
  #6809 rule, the same one that drives "popular" and the sitemap.
- **Readership weight.** 5,428 live books have `human_read_count > 0`, 21,967 visits since
  2026-07-29. 989 have 5 or more. Rank work by the visits it touches, not by book count.
- **Where the gap is.** Reach by translation rung (30 d, #6809 rule; old rule in brackets):

  | rung | live books | reached | share | visits | [old rule] |
  |---|---|---|---|---|---|
  | complete | 11,837 | 1,751 | 14.8% | 5,027 | [8,231] |
  | readable | 7,721 | 902 | 11.7% | 2,280 | [5,992] |
  | translating | 1,994 | 114 | 5.7% | 176 | [1,266] |
  | transcribing | 11,001 | 183 | 1.7% | 454 | [2,074] |
  | **transcribed** (OCR done, no English) | **9,613** | **19** | **0.2%** | **29** | [873] |

  Books with text but no English are still almost never read: 19 of 9,613. Their whole
  `human_read_count` since July is 67 visits, 0.3% of the total. The untranslated search lane (#5729)
  has been on since 10-13 and has not moved this yet. It times out on about a quarter of searches
  (section 3).
- **Companion: site search → read.** Of 19,878 distinct browser searches on sourcelibrary.org
  (global + unified, one per IP and query, 2,525 IPs), **54.3% were followed by a book or page read
  from the same IP within 30 minutes** (56.3% on 10-11). Zero-result rate: 0.3% global, 0.9% unified,
  7.2% inside a book, **36.1% in the catalogue tab** (2,081 / 5,765), 23.7% in BPH's catalogue (n = 389).
- **How to catch it being gamed.**
  1. *Classifier.* **5,682 of 47,435 "human" search events (12.0%) carry tool user agents**:
     `SourceLibrary-MCP/4.3` (3,174), `node` (2,107), Python-urllib. `classifyRequest()` has not
     changed. Correction to 10-11: read events **do** carry a user agent (519,399 of 519,399 in the
     window), and that is what made the #6809 rule possible. Outside checks: the Cloudflare edge crawl
     detector (#6423), and per-crawler history once PR #6591 (#4309, `tier:hold`) merges.
  2. *Relevance.* Reach can rise through SEO while search gets worse. Pair it with the fixed recall
     eval (`scripts/eval/search-recall/run.mjs`, 30 queries + 42-query nav suite). It has not been run
     against prod since 2026-10-06, and it is not scheduled. Two changes this week wait on it: the
     multi-word passage flag (#5853) and the untranslated lane's effect (#5729).
  3. *By eye.* Each week, read the top zero-result queries (section 2 has this week's).
- **Other doors:** shortlinks had **854 human visits to 91 codes** (724 / 99 on 10-11). The
  sitemap now gives priority 0.85 to the 989 books with `human_read_count ≥ 5` (#6809).

## 2. Asked

- **"How do I search within the illustrations of BPH only?"** (feedback 2026-09-26) → #5954.
- **"Where do I find Rudolf Steiner and anthroposophy?"** (feedback 2026-08-17). In the catalogue
  tab, *anthroposophy* still returns 0 books in the "on Source Library" view: 916 catalogue records,
  0 linked to a book (2026-10-16). Five IPs typed it and got nothing in 30 days.
- **"I hit a 404 on: The Secret Teachings of All Ages not found"** (feedback 2026-10-07). The record
  with that title is hidden under `rights_review_4809` (#4809). The visible copy (Hall 1928, 370
  pages) is still titled by its subtitle, *An encyclopedic outline of masonic…*, and readers do reach
  it: `human_read_count` 52. No issue for the title.
- **AI-client reports:** author-level diversity (#3895) shipped in PR #6610. The issue is still open.
  The snippet-vs-`get_quote` off-by-one (#3941) did not reproduce on 2026-10-11, and the one real
  defect found then (Agrippa 1550 p.623) was parked by #6221 on 10-16.
- **Queries readers typed that returned nothing, for things we hold** (human class, 30 d, distinct
  IPs). Catalogue tab: *astrology* 16, *grail* 11, *reference* 10, *catharism* 9, *buddhism* 8,
  *grimoire* 7, *anthroposophy* 5, *sufism* 5. Site search: *drebbel* 4, *kuffler* 2 (#5888). Bhutan
  room: *agrippa de occulta philosophia*, *grimorium verum*, *rosicrucian brotherhood* (2 each).
- **Derek, 2026-10-10 (#5729):** switch on the untranslated lane once the index is live. It went on
  2026-10-13.
- **Partner reading room (BPH):** the empty-search episode of 2026-10-10 (#6426) got a fix on 10-11
  (PR #6521). Nobody has posted a probe since, and the issue is open.

## 3. In motion

Finishing these ranks above starting new work.

- **#5729 untranslated lane: on since 2026-10-13, but it times out.** From production logs (10-16):
  21–28% of `/api/search` calls that reach the lane fail at the 4 s abort, and a failed search
  answers at a p50 of 4.4 s against 2.6–3.1 s for one that succeeds. The page-level semantic route
  fails on 60 of 100 calls. The issue names three options: a longer abort, `pg_prewarm`, or not
  making the English answer wait on this lane. None is taken.
- **#6821 / #2049 in-RAM page-vector service** (PR #6825 merged 10-16). `/api/search` p50 is
  2.6 s, p90 4.4 s, p99 7.9 s (7 days to 10-16; it was 849 ms p50 in May). `match_semantic` costs
  about 1.1 s per new query vector, read from disk. The service on l7a holds all 7,631,047 vectors
  (e4m3). Its bootstrap started at 15:00 UTC on 10-16, with the build expected to finish 17:30–18:00
  UTC, and then phase 2 (`vector-search-2`) posts recall and latency to #6821. Not yet wired into the
  app.
- **#6221 page vectors:** 36,422 rows that served withheld English or no text were parked on 10-16
  (PR #6806). 0 of them still serve a vector, and the undo is recorded. **#6270:** the
  archiving-writer helper and the weekly gate are in PR #6687, `tier:hold`, CI green, waiting on
  Derek.
- **#5853 near-verbatim misses:** `match_semantic` now runs at ef_search 100 (PR #6811, applied to
  prod 10-16). Plain multi-word passage search on the All tab is built but off behind
  `NEXT_PUBLIC_SEARCH_PASSAGES_MULTIWORD`, until the recall eval is run. Fludd p.57 needs a lexical
  lane, which nobody has started.
- **#6426 BPH empty search:** PR #6521 (10-11) answers a closed scope as 503/404 `scope:closed`,
  retries once, and makes the purity audit fail on an empty tenant arm.
- **Merged this week, issue still open:** #3401 (PR #6646 hides filters a lane ignores; rageclicks
  not re-measured, needs a PostHog read key), #6613 (PR #6671: a degraded answer is no longer
  edge-cached), #3895 (PR #6610). **Closed:** #5975 (PR #6642, the readable edition represents its
  work), #5905 (its concept half split to #6645), #3700 (PR #6611), #6175.
- **Two `tier:auto` PRs stalled since 10-12 on `test=CANCELLED`:** #6522 (noindex /auth, #6398) and
  #6614 (absolute `search_within_book` score, #3699). Neither merges until its checks re-run.
- **SEO and crawl:** #6591 (per-crawler `bot_reads`, #4309) and #6517 (feed autodiscovery, #3968) are
  open on `tier:hold`. #3755 phase 2 has not moved since 2026-09-24.
- **#4291 printed-page citations:** the backfill job is running. Its `--summarize` counts are
  still not posted (10-12).
- **#5950** name chooser: Scaliger was cleared on 10-12.

## 4. Found, not fixed

No owner unless an issue is named.

- **The untranslated lane makes every search slower when it fails** (#5729, above). A quarter of
  site searches wait out the 4 s abort. This is the cost of the one lane meant to reach the
  0.2%-reached rung.
- **Catalogue tab: 8 of 20 subject options still show nothing in the "on Source Library" view.**
  Supabase `bph_works`, `keywords ILIKE %option%` (the route's own filter) and
  `sl_book_id IS NOT NULL`, 2026-10-16: anthroposophy 0 of 916, Sufism 0 of 429, Buddhism 0 of 295,
  Judaica 0 of 288, grail 0 of 306, catharism 0 of 301, reference 0 of 1,217, astrology 1 of 165;
  magic 2, gnosis 2, history of religion 4, tarot 6. **36.1% of distinct catalogue searches return
  zero.** No issue.
- **Search telemetry counts MCP and script calls as human:** 12.0% of human-class search events
  (11.5% on 10-11). `classifyRequest()` in `src/lib/analytics-ingest.ts`. Reach is now protected by
  #6809's rule, but every search figure is not. No issue.
- **Concept queries in modern words miss period wording** (#6645): recall@10 0.23 on the concept
  subset against 0.43 overall. "Self-regulating oven" scores 0.00.
- **Name variants:** *drebbel* returned zero results to 4 IPs and *kuffler* to 2 in 30 days (#5888,
  waiting on a `merged_into` read redirect).
- **Bhutan reading room:** 65% zero in site search (78/120) and 65% in unified (55/85), from 13–16
  IPs. It was 84% on 10-11. Readers type Western grimoire titles the main library holds. No issue;
  tenant-lockdown governs any link out.
- **Non-Latin titles are dark to English search** (#4390). On 10-12 the spare lane found that what
  remains needs two decisions: a review process for generated titles, and `english_title` vs
  `display_title`.
- **The Secret Teachings of All Ages:** the visible copy carries its subtitle as its title (section 2).
- **Collections reachability** (#4339): the mechanical fixes are in. What remains is an IA product
  call (spare lane, 10-12).
- **Entity layer** (#4297, #4321): common nouns with a Wikidata id (Axis, 38 books) pass the
  published predicate. The fix needs a stoplist decision (spare lane, 10-12).
- **Search indexes:** `<meta>` wrappers rank in `pages_search` (#2236). Artwork search is a
  collection scan (#4820). Search within one library's illustrations (#5954).

## How these numbers were made

All reads, no writes. Mongo through `node --env-file=.env.production.local`; Supabase through
`SUPABASE_DB_URL` in a read-only session, counts only. The scripts are throwaway and stay in the job's
scratch directory. Their logic:

- *Reach:* `book_read` + `page_read`, `traffic_class: 'human'`, 2026-09-11 → 10-16, walked in time
  order with the rule in `scripts/lib/human-read-fingerprints.json` (the same walk as
  `scripts/maintenance/rebuild-human-read-count-5048.mjs`). The broad /24-day set is computed over
  this window only. Counted visits are bucketed by window and resolved to live books by `_id` or `id`,
  then grouped by `translation_state.rung`. The old rule is distinct `book_id` over the same events.
- *Search → read:* `search_query`, human class, `host: 'sourcelibrary.org'`, `source` global or
  unified, user agent not matching `/MCP|node|python|curl|axios|undici|bot|playwright|headless|lightpanda/i`,
  deduped on host + IP + lowercased query + source. A hit is a `book_read` or `page_read` from the
  same IP within 30 minutes after. IP matching overstates for shared NATs and understates for readers
  who change networks.
- *Zero results:* `results_count === 0` on the same deduped set, per host and source.
