# Search filters must be enforced in every lane

**Read this when:** Adding or changing a search filter, adding a search lane, or indexing a new column into a public search surface.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

Lessons from PRs #3267/#3268/#3269 (the "dates leak" report, 2026-07-19 — three
independent instances of one shape in a single session).

Search fans out into **independent lanes whose results are merged into one list**.
A filter is only as strong as its weakest lane, and the UI's "active filter"
indicator reads page state, not what the query path received — so an unenforced
filter renders as *on* while out-of-range results sit at the top.

- **`/api/search/unified` (All tab):** the book lane is **Supabase
  `books_catalog`** via `searchBooksCatalog()` — NOT Atlas Search. Adding a
  predicate to `BookSearchFilters` (`src/lib/atlas-search.ts`) does nothing for
  it. Other lanes: index, gallery, CLIP-visual, semantic, artwork (semantic +
  lexical), collections.
- **`/api/search` (Books tab):** four lanes — Supabase trigram books, Atlas
  pages, `semanticBookSearch`, `semanticPageSearchGlobal`.
- **`?lang=<iso>` swaps the TEXT store, not the filter.** With `lang=es` the
  keyword page lane becomes Postgres full-text over Supabase `page_texts`
  (`search_page_texts`) instead of Atlas, and the semantic page lane becomes
  `match_page_texts` instead of `match_semantic` — because the Atlas
  `pages_search` index maps `translation.data`/`ocr.data` and cannot see
  `translations.es.data` (#4095). `language` / `languages` /
  `exclude_languages` keep their meaning throughout: they filter the BOOK's
  edition language. `?lang=es&language=Latin` is a coherent query.
  **A localized request also narrows every lane to books that HAVE that
  edition** (`pages_translated_<iso> > 0`) — its result cards link to
  `/es/book/…`, and an `/es` URL for a book with no Spanish pages 307s back to
  English, so an unfiltered hit is a result the reader cannot open.
- **Vector lanes carry no metadata predicate** and their hits merge in as
  book/passage results. They must be post-filtered in JS or they leak past every
  filter. This is the one people miss.
- **`books.published` is FREE TEXT** (`circa 1600`, `[1620]`, `n.d.`, roman
  numerals). Never range-compare it as a string — `$gte: "1600"` is not a year
  comparison. The numeric `year` field is the filterable one, in both Mongo and
  `books_catalog`.
- **"That source has no year/metadata to filter on" is usually false — check the
  data before asserting it.** Index hits are entity→book pairs whose book has a
  year (and the lane already does a books lookup for tenant scoping);
  `gallery_images` denormalizes `book_year` (83% of rows). Both were filterable
  all along. `filterVisibleArtworks()` takes an optional year range folded into
  the books lookup it already performs — one helper covers the gallery,
  CLIP-visual, and artwork lanes.
- **Wire-name mismatches are the recurring failure mode.** `/gallery`'s year
  filter was inert in production because the api-client sent `yearFrom`/`yearTo`
  while `/api/gallery` reads `yearStart`/`yearEnd`. Pinned by
  `tests/unit/search-filter-wire-names.test.ts` — add a case there for any new
  filter.

**Verifying:** a browser always looks fine — results appear and the filter chip
lights up. Proof is a **curl matrix against a deployed preview**: unfiltered vs
filtered vs an impossible range (which must return 0). Check every lane in the
response body, not just the first list. Same discipline as the three-layer
crawler gate (`crawler-access-gate.md`): changing one layer alone is silently defeated by the others.

**A searchable field is a readable field — never index a staff-only column.**
Being able to search a field is a way of reading it: an attacker (or a curious
visitor) can binary-search for the phrase it contains, one query at a time, and
a hit is itself the disclosure. So the public search columns —
`bph_works.search_norm`, `bph_works.search_tsv`, and any successor — must
exclude `internal_remarks`, `exhibition_history`, `price`,
`acquisition_source`/`_date`, the workflow flags, and `modified_by_*` (personal
data). The exclusion list with per-field reasons lives in
`scripts/migration/expand-bph-search-norm.sql`; keep it there rather than
rediscovering it. This is the same shape as the tenant-lockdown rule (`tenant-lockdown.md`) — ask
what a surface *renders*, not only where it *links* — applied to the query side.

**The inverse failure is just as real: a field nobody indexed is a field nobody
can find.** `search_norm` covered 20 of ~40 populated columns, so searching a
shelf location, a donor, a USTC number or a phrase from the remarks returned
nothing — indistinguishable from "we don't hold it", and it took a librarian
telling us in person to surface it (#3481). When adding a column that a human
will later search by, add it to the search column in the same PR, or state why
it is excluded.

**Careful with generated search columns.** They cannot be altered in place —
drop + recreate, which **also drops their indexes** (rebuild
`idx_bph_search_norm_trgm` or every query becomes a seq scan), so wrap the whole
thing in a transaction. And the expression must be IMMUTABLE: `concat_ws` is
STABLE and is rejected (`42P17`), which is why these use `COALESCE(x,'') || ' '`.
`add-bph-diacritic-normalization.sql` shows `concat_ws` and **does not match
deployed reality** — read `pg_get_expr` off the live column, not the migration
file.

---

## Artworks share the `books` collection, so every lane must exclude them (#4415, 2026-08-30)

24,912 of ~110,058 `books_catalog` rows are artworks — museum prints, paintings,
drawings — living in the same collection as texts. **A lane that filters only on
`visible` + `pages_count > 0` serves them as books.** The books lane did exactly
that for 97 rows: searching *stela* returned 8 Met objects with `pages_count: 0`
and pushed the five *Hieroglyphic Texts from Egyptian Stelae* volumes we actually
hold off the page. The **semantic** lane had no gate at all and was serving
`T13 Tarot` — `visible: false` in Mongo — to the public.

Three traps, all of which bit during the fix:

- **Do not filter on "`resource_type` is set."** One live book (*Babad Tanah
  Djawi lan Tanah-Tanah ing Sakiwa-Tengenipoen*) is `content_type: 'text'` with
  `resource_type: 'text'`, and that filter hides it. Use the shared
  `isArtworkRecord()` in `src/lib/artwork-record.ts`: an explicit **non-artwork**
  `content_type` always wins. Keep that record as the negative control — a fix
  that stops returning it is a regression, not a fix.
- **PostgREST `.not(col,'eq',v)` drops NULL rows** to three-valued logic. 19,432
  live books have a NULL `content_type`; a plain negation deletes them from
  results. Use the chained `or` form (`NON_ARTWORK_FILTERS` in
  `src/lib/books-catalog.ts`).
- **A lane check that reads a field the route strips is vacuous.** The first
  "no artworks in the books lane" assertion passed against a response that never
  carries the field. Run the positive control — disable the filter, watch the Met
  stelae come back — or the green check means nothing. See
  `tests-that-are-not-guards.md`.

Corollary for counting, not just serving: any aggregate over `books` inflates
unless it excludes artworks. A naive author query for "William Blake" returns
777 records, of which **776 are prints and drawings**.
