# Needs map: Found

**Purpose:** a reader who comes looking finds the right book, page and quote.
**Built:** 2026-10-11 by job `needs-found-6359`, part of #6359 step 2. Read-only, $0.
Window: the 30 days 2026-09-11 → 2026-10-11 unless a line says otherwise. Live books =
`visible: true && pages_count > 0` on `bookstore` (n = 42,300). Sources: `analytics_events`
(`search_query`, `book_read`, `page_read`, `shortlink_visit`), `search_queries`,
`analytics_pageviews`, `mcp_tool_calls`, `feedback`, Supabase `bph_works`, `gh`.
Ranked queue: `found.json` next to this file.

## 1. The number

**Reach: 17,033 of 42,300 live books (40.3%) were opened by at least one human reader in the
last 30 days** (2026-09-11 → 2026-10-11). 90 days: 20,091 (47.5%).

- **How measured:** distinct `book_id` in `analytics_events` `book_read` + `page_read`, with
  `traffic_class: 'human'`, resolved to live books by `_id` or `id`. 466 opened ids were not live.
  Every door counts: Google, site search, collections, shortlinks, AI clients. Each item in
  section 4 moves this number.
- **Where the gap is.** Reach by translation rung (30 d):

  | rung | live books | opened | share |
  |---|---|---|---|
  | readable | 7,505 | 5,589 | 74% |
  | complete | 11,995 | 8,177 | 68% |
  | translating | 1,274 | 695 | 55% |
  | transcribing | 11,718 | 2,114 | 18% |
  | **transcribed** (OCR done, no English) | **9,546** | **377** | **3.9%** |

  A book with text but no English is almost never found. Semantic search only embeds English
  (#5729), and most of these books have non-Latin titles that English search cannot match (#4390).
- **Companion: site search → read.** Of 19,695 distinct browser searches on sourcelibrary.org
  (global + unified, one per IP and query, 2,490 IPs), **56.3% were followed by a book or page read
  from the same IP within 30 minutes**. The rate is 63.1% inside a book (n = 2,531) and 55.6% in
  the catalogue tab (n = 5,804). The zero-result rate is 0.5% in site search and **35.5% in the
  catalogue tab**. The method is at the end of this file.
- **How to catch it being gamed.**
  1. *Classifier.* `traffic_class: 'human'` is not clean. **5,289 of 45,816 "human" search events
     (11.5%) carry non-browser user agents**: `SourceLibrary-MCP/4.3` (2,796), `node` (1,978),
     `SourceLibrary-MCP/4.2` (405), Python, Playwright. That is 18.7% of global search. `book_read`
     and `page_read` store no user agent, so a crawler labelled human inflates reach and nobody can
     see it. Outside check: the Cloudflare edge crawl detector (PR #6423, hourly) counts book pages
     per client per hour from Cloudflare's side. If reach rises while edge-observed human clients
     stay flat, the rise is bots.
  2. *Relevance.* Reach can rise through SEO while search gets worse. Pair the number with the
     fixed site-search recall eval (`scripts/eval/search-recall/run.mjs`: 30 name/concept queries
     plus the 42-query nav suite). Its last runs were 2026-10-06 against local and preview builds,
     and it is not scheduled.
  3. *By eye.* Each week, read the top 20 zero-result and low-result queries (section 4 has this
     week's).
- **Other doors, same window:** search-engine-referred pageviews **15,451 of 429,231 (3.6%)**:
  Google 9,382, Bing 2,482, DuckDuckGo 2,092, others under 400. `analytics_pageviews` has no traffic
  class, so this count is unfiltered. AI-assistant referrals: ChatGPT 2,872, Copilot 286. Shortlinks:
  **724 human visits to 99 codes**. 14 visits (1.9%) resolved to no target page. 713 arrive "direct",
  meaning pasted citations. MCP: `get_quote` 1,464, `search_concept` 1,272, `search_library` 1,258
  calls. Indexable pages: 393,916 of 19.1M after #3755 phase 1 (2026-09-24).

## 2. Asked

- **"I hit a 404 on: The Secret Teachings of All Ages not found"** (feedback 2026-10-07). The
  catalogue tab logged "the secret teachings of all" as a zero result 6 times from 2 IPs.
  `check-holdings` (2026-10-11) shows that the record titled *The Secret Teachings of All Ages* is
  **hidden**, and the visible copy is catalogued under its subtitle ("An encyclopedic outline of
  masonic, hermetic, cabbalistic…"). No issue yet.
- **"How do I search within the illustrations of BPH only?"** (feedback 2026-09-26) → #5954.
- **"Where do I find Rudolf Steiner and anthroposophy?"** (feedback 2026-08-17). In the catalogue
  tab, the *Anthroposophy* subject returns 0 books in the "on Source Library" view (see section 4).
- **"Export a search selection: all books with JRR in a field"** (partner feedback 2026-08-12).
  BPH catalogue export exists (`/api/catalog/bph/export`). The Kloss parity request is #1884.
- **AI-client reports** (feedback, 2026-08-07 → 09-28; 87 of 551 rows match search/find/missing/404).
  They report that non-Western scientific holdings are under-discoverable through MCP
  (2026-08-30), ask for author-level diversity (#3895), and report a snippet-vs-`get_quote` page
  off-by-one (#3941).
- **Queries readers typed that returned nothing, for books we hold** (human class, 30 d):
  *Clavicula Salomonis* (8), *De occulta philosophia* (6), *Heptameron*, *Steganographia*, *Arbatel*
  and *Monas hieroglyphica* returned zero **on bhutan.sourcelibrary.org**: 107 of 128 global
  searches there (84%) found nothing, from 8 IPs. In the main catalogue tab, *astrology*
  (18 IPs), *Buddhism* (10), *Sufism* (8), *grail* (7) and *catharism* (8) returned zero. All of these
  are held (`check-holdings`, 2026-10-11).
- **Derek, 2026-10-10 (#5729):** switch on the untranslated-pages lane once its index is live and
  both verification commands pass.
- **Derek, 2026-10-10 (#6221):** approved the re-embed window ($65–95 + compute). It is running.
- **Partner reading room (BPH):** on 2026-10-10, BPH's own search answered "no results" for
  *alchemy* for about 45 minutes (#6426).

## 3. In motion

Finishing these ranks above starting new work.

- **#6221 re-embed window**, job `embed-window-6221` (running, heartbeat live). 1,230,844 stale or
  empty page vectors in 16,101 books. Estimate ≈ $67 against a $95 stop. The #6270 withdrawal is
  done: 152,987 archived-page rows moved to `embedding_withheld`, with 0 still served (2026-10-11).
  #6270 items 1 and 3 remain.
- **#5729 untranslated lane:** the code is merged (#6151 partial HNSW index + RPC, #6211 lane behind a
  flag, #6192 GA model). On 2026-10-10 the index was not built in production and
  `match_semantic_untranslated` did not exist. The flag stays off until it does.
- **#6175 page-vector truth:** repair PRs are merged. Derek's close decisions remain. The weekly
  sample cron (#6197) was approved 2026-10-10.
- **#6173 concept lane:** merged (#6268, #6269). On partner hosts the first call for a new query
  can fail closed: a cold 633 MB index takes 1.6–3.5 s against a 3 s limit.
- **SEO and crawl:** #6398 (/work JSON-LD shipped in #6408; /auth indexability and Googlebot
  logging are still open). The crawl register and edge detector shipped (#6423, #6437, #6463).
  #2266: the hub graph reached 40,412 of 40,412 books on 2026-10-04. Cold TTFB (~3 s p50) and GSC
  re-validation remain.
- **#4291 printed-page citations:** the backfill over 96,197 books started 2026-10-04 (Hetzner,
  resumable). It fixes the quoted page number readers cite.
- **Search ranking issues with defaults taken (2026-10-07), each owing a small follow-up:**
  #5905 (split the concept-query gap into its own issue, then close), #5888 (Drebbel/Kuffler merge
  waits on a `merged_into` read redirect), #5945 (two small PRs: typeahead prefixes stop counting
  toward the anonymous 5-per-hour wall, and name matches are still returned at the wall).
- **#5950** name chooser: Bacon was cleared 2026-10-10; the Scaliger proposals are next (job
  `decisions-data`).
- **Open PR #6086** (Librarian compare_traditions): labelled `blocked`.

## 4. Found, not fixed

No owner unless an issue is named.

- **Catalogue tab: 8 of 20 subject options show nothing in the "on Source Library" view.**
  The tab is `BphCatalogBrowser` on `/search` and the main-host catalogue. Supabase `bph_works`
  (2026-10-11), `keywords = <option> AND sl_book_id IS NOT NULL`: anthroposophy 0, astrology 0,
  Sufism 0, Buddhism 0, Judaica 0, grail 0, catharism 0, reference 0; magic 1, gnosis 2,
  history of religion 4, tarot 6. All of them have hundreds of catalogue records (astrology 136,
  Sufism 416, Buddhism 289, catharism 299). **35.5% of distinct catalogue searches return zero**
  (2,062 / 5,804 browser searches). The rate stays between 15% and 45% every day, and only 8 zero
  results were for a query and filter set that returned books at another time. So this is structural,
  not an outage. Many of those subjects exist in the main library without an `sl_book_id` link. No issue.
- **Books with text but no English are effectively invisible:** 377 of 9,546 opened in 30 days
  (#5729, #4390). Readable's map (#6506) counts the same 9,546 books as a translation backlog. Here
  they count as a findability hole, and #5729 closes it without translating them.
- **The search telemetry counts MCP and script calls as human** (11.5% of human search events;
  `SourceLibrary-MCP`, `node`). Every "human searches" figure built on `analytics_events` inherits
  this. `classifyRequest()` in `src/lib/analytics-ingest.ts` decides the class. No issue.
- **Bhutan reading room:** 84% zero-result in site search (107/128), 57% in unified search (60/94).
  Readers there type Western grimoire titles that the main library holds, and the zero state does not
  say they are on a scoped shelf. Small n (8–11 IPs). No issue. Tenant-lockdown policy governs any
  link out.
- **Translated pages that say the query nearly word for word return "No strong matches"** (#5853,
  2026-10-04: Fludd p.57, Bodhicaryāvatāra p.13). The cause has not been diagnosed.
- **Within a work, the oldest copy represents it, not the readable one** (#5975). The map does
  the same (oldest first, 200 per pin).
- **Collections: 294 of 325 are reachable only by search or cross-link** (#4339, measured
  2026-08-29). PR #4343 fixed the breadcrumbs. Nobody has re-measured since.
- **Entity layer:** 773K single-book entity pages are thin (#4297, #4321). The predicate shipped in
  #4327. The timeline and enrichment decisions are open.
- **Search indexes:** `<meta>` wrappers rank in `pages_search` (#2236). Artwork search is a
  1.2 s collection scan (#4820). Agent tools: `search_translations` has no ranking (#3700) and no
  author or work diversity (#3895). Snippet page vs `get_quote` page may be off by one (#3941).
- **/search is the top rageclick surface** (#3401: 218 clicks from 51 users). The likely shared cause,
  the browser-translation DOM crash (#3409), was closed. Nobody has re-measured whether the
  rageclicks went with it.
- **The first title readers asked for by name 404s:** *The Secret Teachings of All Ages* (section 2).
  The titled record is hidden and the visible copy carries the subtitle as its title. No issue.

## How these numbers were made

All reads, no writes. Mongo through `node --env-file=.env.production.local`; Supabase through
the service key with `head: true` counts only. The scripts are throwaway and live in the job's
scratch directory. Their logic:

- *Reach:* `distinct('book_id', {event: {$in: ['book_read','page_read']}, traffic_class: 'human', timestamp ≥ now−30d})`
  ∩ live books (by `_id` or `id`), grouped by `translation_state.rung`.
- *Search → read:* `search_query` events, human class, `host: 'sourcelibrary.org'`, user agent not
  matching `/MCP|node|python|curl|axios|undici|bot|playwright|headless/i`, deduped on IP + lowercased
  query + source. A hit is a `book_read` or `page_read` from the same IP within 30 minutes after the
  search. IP-level matching overstates for shared NATs and understates for readers who open a book
  in a new network session.
- *Zero results:* `results_count === 0` on the same deduped set.
