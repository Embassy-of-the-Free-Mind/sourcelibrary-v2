# Fabricated entity page citations + two tenant leaks — 2026-07-26/27

Started from one footer-feedback line on `/encyclopedia/Matthiolus`: **"What is this page about? Real?"**

Answer: not real. Ended with four PRs merged, two invariants in CLAUDE.md, three issues open, and a corpus repair sweep still running.

---

## 1. The bug (#3361 → PR #3363, #3371)

`/encyclopedia/[name]` rendered `p. N` links next to every entity. Those page numbers were invented.

The index extractor asks Gemini which people/places/concepts appear in a **~50k-char batch** and gets back **bare name lists** — only `quotes` come back with a `page`. The code filled that hole by crediting **every page in the batch's range** with **every entity in it**.

**Measured, not assumed:**

| | |
|---|---|
| sampled entity-book pairs | 30 (person entities with a `wikidata_id`, `book_count >= 2`) |
| claimed page attributions | 415 |
| pages actually containing the name | 91 = **21.9%** (upper bound — loose stems) |
| pairs with zero real hits | 3/30 |
| corpus sweep, claims dropped | **~80%** |

Worked example — `Matthiolus` in *Raphael Explaining the Art of Medicine*:

- `entities` claimed pp. **47–58**
- `books.index.vocabulary` claimed pp. **23, 51**
- actual text (all 157 pages scanned) names him on pp. **44 and 100**

Three derivations, none agreeing. Every rendered link went to a page that never mentions him. Same family as the #2232 misquote: a fabricated citation on a public surface.

### The fix

Precision is now **structural, not statistical**: a page number can only exist where that page's OCR or translation text matched. No match in the batch → **section precision** (`pages: []` + `page_range`), rendered "discussed in pp. X–Y".

**FOUR writers maintain `entities.books[]`.** This is the thing to remember:

1. `scripts/workers/enrich-worker.mjs` (Phase 6)
2. `scripts/batch/batch-generate-indexes.mjs`
3. `src/app/api/entities/route.ts` (rebuild from `book.index`)
4. `src/app/api/books/[id]/index/route.ts` ← **missed in the first pass**

#3361 auto-closed when #3363 merged while writer 4 was still live; it would have regenerated fabricated citations book by book, silently undoing the sweep. Found by tracing consumers, not by re-reading the diff. **A closed issue is not proof the class is gone.**

Also fixed: `$addToSet` on a whole book subdocument appended a duplicate entry per re-index (Matthiolus: 162 entries / 117 distinct books, which is why the hero count contradicted its own "Appears in N Books" heading). And `total_mentions` summed smeared arrays — hence "10,700 total mentions".

**Blast radius is wider than the encyclopedia:** the same index feeds `/api/search/index`, `/api/search/unified`, `/api/explore/map`, the reader-facing book index, and the book/author/artist/collection pages.

### Matcher design (two rounds — the first was wrong)

First attempt matched **every** token of a name. Live data killed it:

- `Saint Perpetua` → fired on "saint" in a liturgical calendar
- `James Smart` → "smartly uibrated"
- `Marcus Aurelius Antoninus` → his mother **Aurelia** (stem collision)
- aliases from `entity_aliases` → "the philosopher", "Confessor" matched half the corpus

Now: **only the single most distinctive token** (longest after stoplisting honorifics), substring-stemmed at ≥7 chars, word-boundary below that. **Aliases excluded entirely.** Recall loss degrades to section precision, which is safe.

Twins: `scripts/lib/entity-page-match.mjs` (writers 1–2) and `src/lib/entity-page-match.ts` (writer 4). Parity pinned by 17 cases in `tests/unit/entity-page-attribution.test.ts`.

---

## 2. Tenant leaks (#3364 → PR #3367; #3370 → PR #3374)

Found while checking whether a new query needed tenant scoping. **Pre-existing.**

`bph.sourcelibrary.org` served `/encyclopedia`, `/explore/*`, `/ngrams`, `/libraries` as the **full global page**. `/encyclopedia/Matthiolus` on the BPH host linked **121 books, 102 not BPH holdings**. `/api/entities` returned byte-identical results on both hosts.

Then (#3370, Derek's call) Source Library's institutional pages: `/about`, `/vision`, `/census`, `/research`, `/blog`, `/contribute`, `/support`, `/sponsors`. `/about` alone hardcodes a figure linking Maier's *Atalanta Fugiens* plus four `/q/` shortlinks to non-tenant books.

**Kept reachable** (`TENANT_REACHABLE_INSTITUTIONAL_PATHS`): `/terms`, `/privacy`, `/dmca`, `/licensing`, `/developers`, `/in-memoriam`. Rights notices must serve on any host, and four of those sit in the crawler-readable allow-lists the three-layer AI-access gate depends on — blocking per-host would make that layer inconsistent.

Blocked in **`src/proxy.ts`**, not the pages: these routes are ISR and reading `headers()` would force dynamic rendering. Same reasoning as the book-page redirects already there.

**Audit result: 102 foreign books → 0.**

### Two things I got wrong here

- **I claimed this needed a tenant-aware footer. It doesn't.** `ConditionalFooter` / `ConditionalSiteHeader` already strip global chrome post-hydration on tenant hosts. `/explore` and `/libraries` had been linked-but-404 in server HTML since #3367 with no user-visible effect. Links persist in prerendered HTML (crawlers see 404s), but no non-tenant content is served.
- #3367 added a **bespoke hostname hook** to `SiteHeader` when `useEmbedContext` already existed and handled it better. Removed in #3374.

---

## 3. Verification traps (the expensive lessons)

**You cannot test tenant behaviour on a Vercel preview.** Curling a preview with `Host: bph.sourcelibrary.org` makes Vercel's router resolve the Host to the **production** deployment for that domain. This produced a convincing false negative on a *correct* build — every blocked path answered 200, including a real BPH landing page at `/`, which is exactly what made it look trustworthy. Call `proxy()` directly in a unit test, then confirm on the real subdomain after deploy. (Now in CLAUDE.md.)

**A hostname check cannot see a content leak.** #3364 sat undetected because the hrefs are *relative* — every link resolved on-subdomain while the page listed other libraries' books. `scripts/audit-bph-leaks.mjs` now resolves every `/book/<id>` against `books.tenantId`, seeds the blocked paths, and reports **NOT RUN** rather than passing without `MONGODB_URI`.

**Byte-length comparison is a bad instrument.** It scored `/encyclopedia/Matthiolus` as "differs" between hosts while the page served all 117 global books.

**My validation oracle was weaker than the thing it validated.** The strict substring check lacked diacritic and j/v folding, so it scored `Gérard`/`gerard` and `Ariston`/`aristo` as misses. On hand review the matcher was right 6/7 times. The reported 87% precision is a floor.

---

## 4. The repair sweep — STILL RUNNING

`scripts/maintenance/repair-entity-page-attribution.mjs` — re-runnable, **no Gemini cost**, pure string matching over stored text.

**State at handoff:** ~3,946 books done. Resume with:

```
cd .claude/worktrees/fix+entity-page-attribution
set -a; source .env.production.local; set +a
node scripts/maintenance/repair-entity-page-attribution.mjs --apply --resume-from 69a5eae5d507939f0352d3c8
```

Read the real resume point from the **last line** of `scripts/output/repair-entity-page-attribution-progress.jsonl` (gitignored; snapshot in the session scratchpad). Rate ~1,180 books/hour against 19,582 indexed → ~13h remaining. **Nothing depends on it finishing** — the read path demotes un-swept rows to section precision, so production is already correct.

### Four failure modes, all scale- or duration-dependent

Validated on 25 books, then broke four times at corpus scale:

1. **Non-idempotent** — a section entry has an empty `pages` array, and the window fell back to whole-book scanning, so a second pass *added* 8% more citations. Window now comes from `pages`, else `page_range`, else skip.
2. **I/O-bound** — 0.3% CPU, <1 book/min, because each book pulled the entire `books` array of every referencing entity (~900 entities/book) and shipped it back to recount. Now `$filter`-projected reads and an aggregation-pipeline update; 6+ min → 6.5s on an 882-entity book.
3. **`CursorNotFound`** — a cursor over 19.6K books died mid-sweep; each batch takes far longer than Mongo's 10-min idle timeout. Replaced with keyset pagination.
4. **DNS on sleep/wake** — `getaddrinfo ENOTFOUND` killed the overnight run. Retry set now covers DNS; 10 attempts, 60s cap ≈ 8 min tolerance.

**Known residue:** ~8 books were processed by both the pre- and post-fix passes, so their pages came from whole-book scanning. Windows unrecoverable (those books' `index` docs carry no people/places/concepts). Text-verified, so not fabricated — the risk is homonym conflation. 0.04% of the corpus. Documented on #3361.

**Do not run this during a prod deploy** — see #3373 below.

---

## 5. Merged

| PR | What |
|---|---|
| #3363 | Verified attribution; read-path demotion; works-block on the entity page; author-page pill relabel |
| #3367 | 404 corpus-wide surfaces on tenant hosts; audit book-ownership check |
| #3371 | Fourth writer; TS twin + 17 parity cases; **CLAUDE.md entity-attribution invariant** |
| #3372 | **CLAUDE.md tenant invariant** + both verification traps |
| #3374 | Institutional pages blocked; legal carve-out; removed my duplicate hook |

All deployed to production and verified there. Feedback item `6a6553991bea89b3a6e94279` marked addressed (written directly rather than via the admin route, which auto-emails the submitter).

## 6. Open

- **#3373 — `/explore` prerender fragility.** It counts 1,017,740 `entities` docs at build time with `maxTimeMS: 25000`. Under write contention from the sweep it timed out and **failed the whole production build**. Recommend precomputing the counts like `homepage_stats`. Note this is the *prescribed* behaviour biting: throwing beats caching an empty render (#2973), so the fix belongs in the query. A CLAUDE.md note is already in flight from another session (`worktree-docs+entities-sweep-deploy-note`).
- **#3376 — soft 404.** `/gallery/image/<nonexistent>` returns HTTP 200 with the not-found body. Indexable, unreportable; `not_found_reports` can't see it. Check `/artwork/[id]` for the same shape.
- **Recall re-extraction — needs a spend decision.** The real cure is putting `page` in the people/places/concepts contract the way `quotes` has it. Estimates disagree: **bottom-up ~$224** (19,582 books, 4.89M translated pages, ~195K batches, `gemini-3.1-flash-lite` at $0.075/$0.30 per M) vs **~$521 top-down** from `gemini_usage`, which I don't trust (3,572 index calls averaging 224K input tokens each, ~15× what a 50k-char batch should be). **Next step: calibrate on ~20 books** for pennies, then decide.
- **Is `/encyclopedia` worth investing in?** (#89 called it a data dump.) Undecided. Worth answering before spending on the re-extraction — though that spend mostly holds its value anyway, given the blast radius above.
- **`/blog` in the tenant block list** is the most debatable entry — editorial rather than institutional. One-line removal.
