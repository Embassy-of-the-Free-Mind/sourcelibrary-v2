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
