# Translation state: one ladder, one denominator, named views

PRIOR ART: .claude/docs/invariants/visibility-and-stats.md — owns the homepage stat rule and three incidents, but records per-surface definitions; it has no ladder, no named views and no audit. scripts/lib/page-counts.mjs `computeTranslationMetrics()` — the closest code; it writes three flags from two denominators and cannot express English originals. #3402, #4505, #5063 each fixed one surface.

**Read this when:** counting "translated" books anywhere (homepage, census, emails, collection cards, the spend page, donor pricing), badging a book "Translated" or "Complete", deciding what a book still needs, or writing a stored translation flag.

**Status:** design, 2026-09-30. Tracking issue #3402; the migration steps are the issues linked from it. Until step 1 lands, the stored fields under "Why this exists" are what exists, and every number quoted from them is provisional.

---

## Who reads the number, and what breaks their trust

1. **Derek in front of a funder or board.** One sentence, no caveats, defensible if someone opens the site. Two different numbers in one meeting is the failure.
2. **A reader on a card or a book page**, deciding in seconds whether to open a book. "Translated" must mean *I can read this in English now*. A badge on 25 translated pages of 300 is a broken promise.
3. **Operators** (spend page, backlog pricing, pipeline priority, donor collection pricing). They need "what is left and what does it cost", which only works if "done" means the same thing it means in 1 and 2.

One definition serves all three. Surfaces may pick **which rung** to show. They may not invent one.

## Why this exists

Measured 2026-09-29/30: seven live definitions of "translated book", 11,022 to 19,880 apart on the same corpus, and the counters they read were exact (393-book recount against `pages`). The problem is definitions, not data.

| definition | all | live | used by |
|---|---:|---:|---|
| any translated page | 19,880 | 17,097 | FT pool, author/language stats, BPH stats, platform stats, Supabase `hasTranslation` |
| homepage rule `translated ≥ 0.9·(ocr − blank)` | 19,185 | 16,492 | `homepage_stats.translatedToEnglish` → homepage, /about, /census, broadcast email, `/api/analytics/canon`, `/progress` |
| ≥ 10 translated pages | 18,662 | 16,223 | homepage recent-works rail |
| stored `translation_pct ≥ 50` | 17,241 | 15,274 | book page `hasTranslations` (>50%) |
| stored `over_90_translated` | 16,439 | 14,573 | sync-worker, `/progress` milestones |
| spend page (≥ 90% of translatable pages) | 16,382 | — | /admin/spend, ops `lang-tally.mjs` |
| stored `is_fully_translated` | 12,659 | 11,022 | /contribute, storage-stats cron, `/progress` |

Two of those (the homepage rule and the ≥10 rule) count a book whose only OCR is a 25-page preview as fully readable, because the denominator is *OCR'd* pages (#5063 fixed the stored flags, not the homepage). English originals, readable without any translation, are invisible to every one of them. Live = `visible: true && pages_count > 0`.

## The ladder

One enum per book, computed by **one function**, stored on the book, read by every surface.

```
no_pages → no_text → transcribing → transcribed → translating → readable → complete
```

| rung | rule (all counters are the visible-page counters of #3293) |
|---|---|
| `no_pages` | `pages_count = 0`, or `content_type = 'artwork'`. **Out of every denominator.** |
| `no_text` | `pages_ocr = 0` |
| `transcribing` | `0 < pages_ocr < 0.9 · whole` — includes preview-only books, whether or not their preview is translated (the #5063 shape lands here, never higher) |
| `transcribed` | coverage met, `pages_translated = 0` |
| `translating` | coverage met, `0 < pages_translated < 0.9 · translatable` |
| `readable` | coverage met, `pages_translated ≥ 0.9 · translatable` |
| `complete` | coverage met, `pages_translated ≥ translatable` |

Definitions:

- **whole** = `pages_count − pages_blank`: what a reader expects to find. Always available.
- **translatable** = `pages_translatable` when present (the #4442 recount: never-translated leaf types, text-free illustrations and permanently refused pages removed), else **whole**. The fallback overstates the denominator and so *understates* the rung, which is the safe direction.
- **coverage** = `pages_ocr ≥ 0.9 · whole` (the #5063 clause). A book cannot climb past `transcribing` on a preview.
- **90%** is the existing readable bar (`FIRST_TRANSLATION_READABLE_MIN`, the homepage rule, `over_90_translated`). Not a new primitive. `complete` is 100% of translatable: the last page counts (#4685: ~60% of the pages missing from 90–99% books are real text the pipeline dropped).

Orthogonal boolean: **`english_original`** — the edition's own language is English (`books.language`, per `language-fields.md` the *edition's* language; 2,842 live books carry the exact label `English`, a handful carry compounds such as `English and Hebrew`, which count as English only when English is listed first). An English book is readable at `transcribed`; its "translation" is a modernization the reader sees only for pre-1820 print (#4958), so the rungs above `transcribed` describe modernization progress, not readability.

Stored shape (one field, replacing three):

```
translation_state: {
  rung: 'readable',
  english_original: false,
  translated: 412, translatable: 430, whole: 440, ocr: 440,   // the inputs, so a wrong rung is traceable
  exact: true,          // pages_translatable was present
  version: 1,           // rule version; a bump re-stamps every book on the next sync
  computed_at: ISODate
}
```

Refused pages are a known soft spot: `pages_translatable` removes pages the model permanently refused (recitation/safety), so a book with many refusals can read `complete` while a reader meets holes. Measured shares are small (47 of 7,915 on the Keely shelf; 4/40 in the #4685 never-OCR'd sample) but ~15% on famous English texts, which are readable anyway. Step 1 measures the per-book refused share; if more than a handful of live books exceed 5%, the recount adds `pages_refused` and the reader-facing rungs add it back to the denominator.

## Named views

Views are sets over the ladder. Every headline number is one of these, by name, or it is wrong.

| view | definition | live, 2026-09-30 |
|---|---|---:|
| **`readable_in_english`** | `rung ∈ {readable, complete}` ∪ (`english_original` ∧ `rung ∈ {transcribed, translating}`) | **14,852** |
| `translated_from_other_languages` | `rung ∈ {readable, complete}` ∧ ¬`english_original` | 12,417 |
| `complete` | `rung = complete` | 9,057 |
| `in_progress` | `rung = translating` ∪ (`transcribing` ∧ `pages_translated > 0`) | 2,664 |
| `backlog` | ¬`english_original` ∧ `rung ∈ {no_text, transcribing, transcribed, translating}`; pages remaining = `translatable − translated` per book | ≈ 26,900 books |
| `not_a_text` | `rung = no_pages` | 0 live (24,994 corpus-wide) |

Same views on the whole corpus (hidden included): readable_in_english 17,471 · translated_from_other_languages 13,974 · complete 10,436. Hidden books stay out of every public headline; the site is what a funder checks.

For reference, the current homepage rule gives 16,492 on the same day. The gap is 2,061 preview-only books it counts as readable, less the 421 English originals it cannot see.

### Which surface shows which view

| surface | today | becomes |
|---|---|---|
| homepage stat, /about, /census, broadcast email default | `translatedToEnglish` (homepage rule) | `readable_in_english`, labelled "readable in English" |
| homepage recent-works rail, highlighted books | `pages_translated ≥ 10` / `> 0` | `rung ≥ readable` or `english_original ∧ rung ≥ transcribed` |
| book page `hasTranslations`, reader panels, `TranslatedSiblingNotice` | `translated > count/2`, `< 5%` gates | rung (`readable`/`complete` show the translation as primary; `translating` shows progress) |
| card status line "Translated" (`CollectionBookCard`) | `pages_translated > 0` | `readable_in_english`; below it, "N% translated" from `translationCompleteness()` |
| First-translation badge gate `isTranslationReadable()` | `translated ≥ 0.9·(ocr − blank)` | `rung ∈ {readable, complete}` (adds the coverage clause the gate lacks) |
| `furtherReadingStatus()` | own conjunction of the two bars | rung |
| collections `book_count` | `pages_translated > 0` | `readable_in_english` members; `total_book_count` unchanged |
| /contribute, storage-stats cron, `/progress` milestones | `is_fully_translated` / `over_90_translated` | `complete` / `readable_in_english` |
| `/api/analytics/canon`, BPH `/stats`, platform stats, dataset stats | homepage rule / any page | `readable_in_english` for "readable"; page sums unchanged |
| Supabase `books_catalog` (`browseBooks hasTranslation`) | `pages_translated > 0` | new columns `translation_rung`, `english_original`; filter on rung |
| spend page roadmap, ops `lang-tally.mjs`, donor collection pricing | ≥ 90% of translatable | `backlog` view and its page remainder (becomes a consumer, not a rebuild) |
| MCP `list_books` / `translation_percent` | stored vestigial field | `translation_state.rung` + `translationCompleteness().percent` |

`translationCompleteness()` (`src/lib/translation-completeness.ts`) stays as the *percentage* for a single book: it already uses the same denominator. `translation-percent.ts` (divides by `pages_count`) is superseded by it.

## The single writer

- `computeTranslationState(counts, { language, content_type })` in `scripts/lib/page-counts.mjs`, TS twin in `src/lib/page-counts.ts`, pinned by `tests/unit/page-counts.test.ts` and a parity test that imports both (the `translate-core-parity` lesson: enumerate every copy, import every copy).
- **Written only by `scripts/workers/sync-worker.mjs`**, every 2 h, next to the counters it derives from, in the same `$set`. It replaces the `computeTranslationMetrics()` call; the three legacy flags keep being written from the same inputs until step 7 removes them.
- Job-time writers (batch collectors, realtime translate, split worker) update counters only. They never write `translation_state`. A rung may therefore lag a counter by up to 2 h; the read path shows the percentage live from counters, so nothing a reader sees is more than 2 h behind and the rung never *overstates* (counters drift high, never low — `nearly-finished-translations.mjs` header).
- `pages_translatable` is written by `recount-page-stats.mjs` (#4442). 10,282 live books do not carry it (2026-09-30) despite the 2026-08-31 backfill note in `page-counts.mjs` claiming full coverage; step 8 recounts them. Until then the fallback rule applies and those books can only read *lower*.
- Registry: `translation_state` goes in `scripts/lib/books-known-fields.json` with a doc string in `book-docs.mjs`; the sweep that first stamps it is logged per `field-sprawl.md`. Net effect after step 7: one field in, four out (`is_fully_translated`, `over_90_translated`, `translation_pct`, `translation_percent`).

## Freshness

| number | source | staleness bound |
|---|---|---|
| per-book percentage on a page | counters, computed at render | job latency (minutes) |
| per-book rung / badge | `translation_state` | ≤ 2 h (sync-worker) |
| headline counts | `system_config.homepage_stats`, recomputed 05:00 by `prewarm-browse.mjs` and by `update-homepage-stats.mjs` on demand | ≤ 24 h + 2 h |
| Supabase catalog columns | `sync-books-catalog.mjs` | its existing cadence |
| collection counters | sync-worker collection block | ≤ 2 h |

The homepage stat document carries `updatedAt`; any surface that prints a headline prints it from that document, never from a constant. `FALLBACK_COUNTS` in `home-data.ts` and `site-stats.ts` may remain as outage fallbacks but must be dated in a comment and floored, never rounded up.

## The audit

`scripts/audit/translation-state-audit.mjs`, weekly on Hetzner, exit 1 = FAIL, files/updates one GitHub issue on FAIL (`measurement-instruments.md` rules for scheduled detectors: dedupe on an open issue, never page on a single sample).

1. **Recount a random sample** of 300 live books from `pages` with `buildVisiblePageCountPipeline()`, recompute the rung, compare with the stored one. FAIL above 1% disagreement, and always FAIL on any book whose stored rung is *higher* than the recount's.
2. **Compare every public headline to its named view**, fetched from the read path (`https://sourcelibrary.org/api/...`, `homepage_stats`, Supabase count by rung, `book_count` on 20 random collections, the spend page's `books_90pct_translated`) against a fresh Mongo count of that view. FAIL outside the freshness bound above. This is the check `visibility-and-stats.md` demands: validate a counter against the page that renders it, not the query that wrote it.
3. **Positive control, every run:** perturb one sampled book's stored rung in memory and require the comparator to flag it. A run whose control does not fire reports `probe_broken`, never PASS (`stage-coverage.mjs` convention).
4. **Negative control, recorded once in the PR:** stamp a wrong rung on one hidden test book, run, watch it go red, restore. A guard that has never been red is decoration (`tests-that-are-not-guards.md`).

The audit also carries forward `fully-translated-coverage.mjs` (#5063) as a rule on the new field: `rung ∈ {readable, complete}` with `pages_count > 30` and `pages_translated < 0.5 · pages_count` is a FAIL.

## Migration, in independently mergeable steps

Each is a GitHub issue linked from #3402. Writer first, then readers, then the audit, then deletion.

1. **Writer.** `computeTranslationState()` + tests + parity; sync-worker stamps `translation_state`; registry entry; refused-page share measured and reported in the issue. No reader changes.
2. **Headline readers.** `update-homepage-stats.mjs`, `prewarm-browse.mjs`, `/api/analytics/canon`, `enrichment-snapshot.mjs`, `storage-stats`, `/contribute`, `/census`, `/about` read `readable_in_english`. `homepage_stats.readableInEnglish` added; `translatedToEnglish` kept as an alias for one release. The label change is public copy → Derek.
3. **Book-level readers.** `isTranslationReadable()`, `furtherReadingStatus()`, book page `hasTranslations`, `TranslatedSiblingNotice`, `CollectionBookCard`, reader panels read the rung; `translation-percent.ts` retired in favour of `translation-completeness.ts`.
4. **Mirrors and counters.** Supabase `books_catalog.translation_rung` + `english_original` (migration + `sync-books-catalog.mjs` + `rebuild-books-catalog.mjs`); `browseBooks` filters on rung; collection `book_count` = `readable_in_english`; BPH/platform/dataset stats. *Landed for the catalog and collection counters in #5288:* the view lives once per store — `readableInEnglishMongoFilter()` / `isReadableInEnglish()` in `page-counts.{mjs,ts}`, `READABLE_IN_ENGLISH_OR` in `books-catalog.ts`. The catalog mirror reads the stamp through `catalogTranslationColumns()`, which applies the same rule to the stored counters when a book is unstamped or stamped at an old version (a mirror of the rule, nothing written back). `sync-books-catalog.mjs` also re-syncs on `translation_state.computed_at`, because a state-only stamp does not bump `updated_at`. BPH/platform/dataset stats remain open.
5. **Constants.** `send-user-broadcast.mjs` default, `FALLBACK_COUNTS`, `site-stats.ts` fallback, the vision page and the ops one-pagers read the view or carry a measured-on date. The ops `lang-tally.mjs` / `backlog-tally.mjs` consume `backlog`.
6. **Audit** as above, plus the Hetzner crontab line.
7. **Deprecate and delete.** Registry marks the four legacy fields deprecated; sync-worker stops writing them once `git grep` finds no reader; the `$unset` sweep is a deletion and waits for Derek.
8. **Data hygiene the ladder depends on.** Recount the 10,282 live books without `pages_translatable`; fix the minority `pages_count` writers that count hidden pages (#3293 header of `recount-page-stats.mjs`); backfill `content_type` on live real books (29,642 live books with `pages_count > 0` carry `content_type: null` on 2026-09-30, up from the 7,092 in #3402).

## Decisions Derek owns (defaults in bold)

1. Public headline = **`readable_in_english`, labelled "readable in English", English originals included.** Alternative: `translated_from_other_languages` (12,417), labelled "translated into English".
2. **Bars stay at 90% (readable) and 100% (complete); the reader-facing badge says "Translated" from `readable` and "Complete" only at `complete`.**
3. **Headlines count live books only.** Hidden books appear in operator views.
4. **Retire the four legacy fields after step 7** (a field deletion, hold list).

## The number today

**Nearly 15,000 books are readable in English on sourcelibrary.org: 14,852 on 2026-09-30, counting every live book with at least 90% of its translatable pages translated and at least 90% of the book transcribed, plus English originals at least 90% transcribed. 12,417 of them were translated from other languages.** Provisional until step 1 stamps the field and the audit has been green once. The homepage currently shows 16,488 (2026-09-29 refresh, old rule); the "close to 18,000" figure matches the any-translated-page count (17,097) and is not defensible as "translated".

## Do not

- Do not add a threshold. 90 and 100 are the only bars; a surface that wants "mostly" uses `readable`.
- Do not compute a rung at a call site. Read `translation_state.rung`; if the field is absent, the book is unstamped, not untranslated — show the percentage and no badge.
- Do not divide by `pages_count` or by `pages_ocr − pages_blank` for a book-level claim. The first hides plates (#4442), the second hides unread pages (#5063). See `visibility-and-stats.md` for both incidents.
- Do not backfill the legacy flags. They are read-compatible until step 7 and then gone.
