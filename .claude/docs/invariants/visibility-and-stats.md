# Visibility & stats invariants

**Read this when:** Writing `visible` / `hidden` / `hidden_reason`, touching homepage stats, or reading `is_first_translation` on a render path.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

Lessons from PR #2055 (see `.claude/handoffs/`). The homepage and most public surfaces filter on `visible: true`, but `hidden: true` exists as a parallel flag. When the two disagree, books leak into public counts.

- **`visible` and `hidden` must be opposites.** Every writer that sets `hidden: true` must also set `visible: false` (and vice versa for un-hide). Don't write one without the other. Active writers: `scripts/maintenance/hide-{unarchived-books,efm-duplicates}.mjs`, `scripts/maintenance/set-launch-books.mjs`, `scripts/workers/pipeline-orchestrator.mjs`, `src/app/api/admin/duplicates/route.ts`, `src/app/api/books/[id]/visibility/route.ts`. Historical drift cleaned up by `scripts/maintenance/fix-conflicting-visibility.mjs` — re-run if `db.books.countDocuments({ visible: true, hidden: true })` ever climbs above zero again.
- **Homepage stats live in `system_config.homepage_stats`** (Mongo). Refreshed daily at 05:00 by `scripts/maintenance/prewarm-browse.mjs`, also writable on demand by `scripts/maintenance/update-homepage-stats.mjs`. Both scripts now share the same canonical filters — keep them in sync if you touch either. The canonical filters are:
  - `totalBooks` / `authorCount` / `languageCount`: `visible: true && pages_count > 0` (plus `pages_translated > 0` for authors/languages)
  - `translatedToEnglish`: ≥90% "readable" — `pages_translated >= 0.9 * (pages_ocr - pages_blank)`
  - `artworkCount`: `visible: true && content_type: 'artwork'` — single-object entries (paintings, prints, sculptures, etc.), distinguished from books by being non-sequential. They typically have `pages_count: 0` (image + metadata only) or a handful of non-sequential images of the same object. Don't filter on `resource_type` here — it's a finer-grained sub-category (sculpture, religious, allegory, manuscript-illumination…) that under-counts if used alone.
  - `illustrationCount`: `gallery_images.countDocuments({})`
- **`hidden_reason` is a flip-guard, not a read-gate.** Consumers must gate on `visible` alone — treating the reason field as a state/rights signal silently misfires, and once did on a third of the corpus: ~6.3K `visible: true` books carried a stale `hidden_reason` (`launch_curation` 5.7K, `unprocessed`, `unarchived`, …) left by batch sweeps that flipped `visible` without unsetting the field, and the corpus exporter dropped 6,289 books that way (#3332). **That backlog is cleared** — #3334 swept it and audited the writers; re-measured 2026-07-29, `{visible: true, hidden_reason: {$exists: true, $ne: null}}` returns **0**. The invariant is what still matters, not the backlog: the field's real job is protecting visibility *flips* (never bulk-unhide takedown reasons), and rights-class reasons (`/copyright|takedown|dmca/i`) are the only defensible read-side screen. Corollary of the visible/hidden opposites rule above: any writer setting `visible: true` must `$unset: { hidden_reason }` in the same update (the single-book visibility route already does) — that corollary is the thing keeping the count at zero, so a new writer that skips it reopens the whole class.
- **`is_first_translation: true` ≠ "we have it in English."** It's a bibliographic claim that gets set by batch-flag scripts (e.g. `scripts/_archived/2026-06-ft-cleanup/bulk-flag-tibetan-ft.mjs`) before translation completes. Render gates that show the "First Translation" badge must require translated pages — otherwise readers see a badge on a book they can't read. **`pages_translated > 0` is NOT enough, and the corrected gate is `isTranslationReadable()` (`src/lib/first-translation/derive.ts`)**: measured 2026-08-01, 366 of 5,839 badged books were under half translated and 244 under 10% — one carried an unqualified badge at 18 of 1,071 pages (1.7%), and some carried "First **Complete** Translation" at ~6%. The threshold is the **canonical readable denominator already used by `homepage_stats.translatedToEnglish`** (≥90% of `pages_ocr − pages_blank`); don't invent a second one. Below it, qualify the *label* ("First Translation, in progress") rather than dropping the badge — the bibliographic claim is still true, only the readability implication is false — and keep it out of the `isPublicFirst()` headline. Unknown coverage counts as readable: a book with missing page counts hasn't been *shown* to be thin, and demoting on absent data is the §17 hazard. (#3435, PR #3523.)
- **`visible` is TRI-state — `true` / `false` / **absent** — and `visible: false` is not the complement of `visible: true`.** Measured 2026-08-18 over non-artwork books: **21,979 `true`, 41,889 `false`, and 15,910 with no `visible` field at all**; 1,227 of the field-absent set carry >20 pages of OCR. The read path is safe by construction (every public filter asks for `visible: true`, so absent reads as hidden), but *any query written the other way round is wrong*: a sweep looking for hidden books with `{visible: false}` silently skips 15,910 records, and `{visible: false}` vs `{visible: {$ne: true}}` disagree on exactly that set. This is how a book can be simultaneously absent from the site and invisible to the audit meant to find it. **Write `{visible: {$ne: true}}` when you mean "not public", and `{visible: true}` when you mean "public" — never `{visible: false}`.** Related: the opposites rule above tells writers to set both flags; it cannot fix records written before that rule existed.

- **A materialized snapshot of ids bypasses every visibility field it was built from.** `gallery_collections.image_ids` (type `thematic`) is frozen when the gallery is seeded, so hiding a book afterwards prunes nothing, and the resolve in `/collections/[id]` had no visibility filter at all — while `/api/gallery`, `hero-mosaic`, `books/timeline` and `search/unified` all guard on `gallery_images.book_visible`. That one outlier kept serving **38 images from the Kloss/CMC takedown six weeks after it**, 10 of them on the live `/collections/freemasonry` page, alongside 291 more from ordinarily-hidden books (PR #4056; 329 pruned, standing detector `scripts/audit/gallery-visibility-leak.mjs`). **When you hide something, ask what has already copied its id into a list** — a denormalised flag protects only the surfaces that read it, and a frozen id list reads none of them. Note the same page's *dynamic* fallback query filters `visible: true` correctly, so the guarded and unguarded paths sat ten lines apart and produced different answers for the same collection.
- **`gallery_images.book_visible` drifts in BOTH directions, and only one direction is a leak.** It is denormalised from `books.visible` and refreshed by the sync worker only when a book's **pages** change, so a bare visibility flip never reaches it. Measured 2026-08-18: 1,217 rows claimed `book_visible: true` for a hidden book (art leaking, fixed), and **6,760 claimed `false` for a visible book** (art suppressed that should show, left alone). Repair the leak direction freely; the suppressed direction *publishes* images and is a curation decision, not a data fix. Don't "correct" both in one sweep and call it hygiene.
- **Authored prose inside a collection doc is a takedown surface.** The Kloss takedown swept books, Supabase, `gallery_images.book_visible`, collection `visible` flags, the tenant and code references — but not `description` / `expanded_description` / `highlighted_books` / `featured_images` / `hero_image`, which are hand-written and cite specific books by id. `/collections/freemasonry` therefore stayed live for six weeks naming "the Kloss Library, one of the most important Masonic research collections ever assembled" and linking 13 removed books, every link dead. **Any removal has to grep the authored fields, not just the flags** — a hidden book stops rendering, but a sentence *about* it does not.
- **A card must count what its TARGET page renders, not what the collection holds.** `collections` carries three counters — `book_count` (translated/readable), `total_book_count` (all visible member texts, #3176), `artwork_count` — and nothing ties a counter to the view that consumes it, so a card is free to pick the wrong one. A `collection_type: 'visual_art'` collection renders artworks and *nothing else* (`isArtCollection`), so its book counters describe texts the reader can never reach from it. Until #4106 the sub-collection child cards on `/collections/[id]` showed `total_book_count ?? book_count`, inherited their noun from the **parent** collection, and sorted the grid by `book_count` — so `school-of-athens` advertised **"518 books"** above a page showing **30 works**, and sorted second in Classical Philosophy. Measured across all 284 child cards, **19 art children were mislabelled**; School of Athens was the only over-count and the rest simply vanished (`esoteric-engravers` showing 0 against ~1,600 artworks, `portraits-tradition` 0 against ~1,600). The fix is per-child, not global: `childCardCount()` labels and sorts by the child's own `collection_type`, and `collectionCountLabel()` takes an optional third `collectionType` that drops the text half for `visual_art`. **Before adding a count to any card, open the page it links to and ask which query fills it** — `/collections` and the homepage grids escaped this only because they exclude `visual_art` at the query level, not because they got the counter right. Corollary, still open as a curation call (#4107): the 518 texts tagged `school-of-athens` are legitimate editions that no surface lists, so a counter can also be *honest about data that no page will ever show*. Second instance, 2026-08-30: on a newly built collection `book_count` counted every tagged, visible, paginated member (33) while the grid rendered 32, because the grid is `browseBooks` over Supabase and serves *readable* books — Carey's *Principles of Social Science* (497pp, 300 OCR'd, **0 translated**) is a legitimate member that no page will show. `book_count` is the readable subset, `total_book_count` is the membership; computing the former as "live members" silently overstates it by however many members are untranslated. Caught only by diffing the live grid against Mongo membership after the write, which is the check worth running: **do not validate a counter against the query you just wrote, validate it against the read path**.

## The numerator has to exclude what the denominator excludes (#3747)

`translation_pct` and the ≥90%-readable bar both divide by `pages_ocr − pages_blank`.
Anything that lands in the **numerator** but is subtracted from the **denominator**
pushes the ratio past 100 — and it did, on **6,228 live books, 32% of the public
library**. The Blue Qur'an reported **1000% translated**: 60 pages, 54 of them blank,
over a denominator of 6.

**A blank leaf carries translation text.** The translator writes the literal
placeholder `[Blank page — no translatable content]` onto every one, so the obvious
test — non-empty `translation.data` — counts flyleaves and endpapers as translated
work. Measured 2026-08-08: **87,777** such pages, 99.8% of them under 120 characters.

- **The rule:** a page counts as translated iff it has non-empty `translation.data`
  **and** `page_type !== 'blank'`. Use `isTranslatedPage()` from
  `scripts/lib/page-counts.mjs` (TS twin `src/lib/page-counts.ts`). `hasTranslation()`
  stays literal on purpose — "carries text" and "counts as translated work" are
  different questions, and conflating them is the whole bug.
- **Fix the definition, not the call site.** Writers that run their own query must
  match it: `scripts/workers/sync-worker.mjs` (aggregation) and
  `scripts/batch/realtime-translate.mjs` (`countDocuments`). The batch collectors and
  `translate-core` inherit it from the shared helper. Grep every writer of
  `pages_translated` before calling a fix complete.
- **This recurred after 136 days** because the note recording it stated the naive rule
  ("`pages_translated` = pages with actual `translation.data`") — the memory was not
  merely absent, it was *wrong*, and wrong guidance is trusted. If you correct a rule,
  correct it where it is written down.
- Correcting it lowers headline stats, and that is the correct direction:
  `is_fully_translated` **15,741 → 14,172**. Those 1,569 books had genuinely
  untranslated pages and were clearing the bar on placeholder padding. `sync-worker`
  reconciles every 2h and ignores the pipeline pause, so no backfill is needed.

## `books.published` is free text — never parse or sort it (#3718)

`published` is a catalogue string: `12th century`, `1500–1825`, `14uu`, `[18--]`,
`MDXLIX. [1549]`, `n.d`, `Ur III / Old Babylonian (c. 2100–1600 BCE)`. 2,505 live books
hold a non-plain-year value. The numeric `year` field is populated on **19,012 of
19,465** live books and is what you compute with.

- `parseInt(published)` reads `"12th century"` as the year **12**. Boethius — 31
  witnesses spanning 1150–1900 — advertised its range as **"12 – 1900"**; the Four
  Gospels as "18 – 1100" against a real 550–1750.
- `sort: { published: 1 }` is a **lexical** sort, so `"550"` lands after `"1750"` and
  the oldest witness sorts last in a chronological list.
- Use `editionYear()` (`src/lib/dedup.ts`), `formatYear()` / `formatYearSpan()`
  (`src/lib/format-year.ts`, BCE renders as "1550 BCE"), and `byChronology()`
  (`src/app/work/[id]/page.tsx`). Compute with `year`, **display** `published` — for a
  manuscript "12th century" is more honest than the point estimate 1150 — and filter
  the no-date markers (`Unknown`, `n.d.`, `[date of publication not identified]`).
- **Still unfixed:** `src/app/languages/page.tsx` compares `published` as strings for
  its per-language ranges.
- **A pre-500 date with no publication statement is a composition date, not the
  object's.** Exactly 12 live books match, and all 12 are (Homer −750, Euclid −300
  "palimpsest", Galen 170, Plato −375); `/works` excludes them from span endpoints. The
  discriminator is **not** "published is Unknown" — the Bodleian Gospels manuscripts at
  895/927/950 also lack one and their dates are genuine. The oldest object actually
  held is the 550 CE Bodleian Gospels.

## `isTranslationReadable()` answers "of what we transcribed", not "of the book" (#4653)

The readable bar above divides by `pages_ocr − pages_blank`. That is the right
denominator for the question it was built for — a badged first translation is a
claim about text we hold in transcription — but it is the WRONG one for any
surface that shows a book the pipeline has not finished, and it fails in the
direction that over-claims.

Measured on the 18 books in `forum-of-conscience`'s `further_reading`: the
typical shape is **223 pages, 25 OCR'd, 0 translated**. Translate those 25 and
`translationCoverage()` returns **1.0** — "Translated", fully readable — while
**198 pages have never been transcribed at all**. Nothing in the numerator or
the denominator can see them, because a page awaiting OCR is in neither.

- **The tell:** you are rendering a book selected for NOT being finished —
  an acquisition list, a wishlist, a coverage report, an untranslated-backlog
  surface. On the ordinary public corpus the two denominators nearly agree,
  which is exactly why this stays invisible until a surface deliberately
  populated with unfinished books renders one.
- **The rule:** before saying "Translated", require the transcription to be
  complete too (`pages_ocr >= pages_count`) — a CONJUNCTION with the existing
  bar, never a second competing threshold. `furtherReadingStatus()` in
  `src/lib/further-reading.ts` is the worked example; its negative control lives
  in `tests/unit/further-reading.test.ts`.
- Related: the same asymmetry from the other end — a page awaiting OCR belongs
  in the DENOMINATOR of any corpus-wide translation-completeness figure (#4516).
  One number cannot serve both questions; say which one you measured.
