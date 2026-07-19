# Search filters were displayed but not enforced — 2026-07-19

Purely technical postmortem. No PII, secrets, or business material.

## Trigger

A screenshot of `/search?q=philosopher's+stone` with **Published after 1822 /
Published before 1832** set, the "active filters" dot lit — and a **1559** book
at the top of the results. Reported as "seems like dates leak?"

## What it actually was

Nothing leaked. The dates arrived legitimately: `NgramViewer.tsx:163` opens
`/search` with a ±5-year window around a clicked chart point, and the search page
keeps filters in state + URL across a newly typed query (intended). The bug was
that the range was **rendered as active but never enforced** — in four places,
found one at a time, each hiding behind the previous.

1. **Never sent.** The page's `filters` object, `searchApi.unified()`, and
   `/api/search/unified` all omitted `date_from`/`date_to`. (#3267)
2. **Sent, still ignored.** The unified book lane doesn't use Atlas Search — it
   queries Supabase `books_catalog` via `searchBooksCatalog()`. The
   `BookSearchFilters.yearFrom/yearTo` mapping added in #3267 was dead code for
   the lane that actually renders All-tab results. (#3268)
3. **Wrong field type.** `/api/search` applied `date_from` as a **string**
   comparison against `published`, which is free text (`circa 1600`, `[1620]`,
   `n.d.`, roman numerals). Never a year comparison. Now normalized to numeric
   `year`. (#3268)
4. **Lanes with no predicate.** `semanticBookSearch` and
   `semanticPageSearchGlobal` merge in as book/passage results and carry no
   metadata predicate (vector indexes don't have one). They ignored every filter
   until post-filtered. This was the specific reason a 1559 book survived
   "after 1600" on the Books tab. (#3268)

## The wrong claim, and what checking it turned up

I reported that the Index and Images tabs "have no year to filter on" and
proposed hiding the inputs. Derek asked why not. Both were wrong:

- Index hits are entity→book pairs. The entity has no year; the book does — and
  the lane already builds an allowed-book-id set for tenant scoping, so the
  range rides the same lookup.
- `gallery_images` denormalizes `book_year`: **171,728 of ~206,390** rows (83%).
  A `$match` away. (Not in the `gallery_search` Atlas index mapping, so it can't
  ride in the compound filter — `$match` before `$limit`.)

So the inputs now work on all four tabs instead of being hidden. (#3269)

**And checking surfaced an unrelated live bug:** `/gallery`'s year filter had
been inert in production. `galleryApi.list()` sent `yearFrom`/`yearTo`;
`/api/gallery` reads `yearStart`/`yearEnd`. Verified against prod before
touching anything — `yearFrom=1900&yearTo=1950` returned 1400s. `GalleryClient.tsx`
is the caller, so the public gallery's year range was decorative. (#3269)

## Files changed

- `src/app/search/page.tsx` — pass dates to unified/index/images; dates in the
  client-side unified cache key (editing a date previously hit the same 60s
  cache entry and returned identical results)
- `src/app/api/search/unified/route.ts` — year range threaded to every lane
- `src/app/api/search/route.ts` — one numeric year range for
  `date_from`/`date_to`/`year`/`year_from`/`year_to`; both semantic lanes
  post-filtered
- `src/app/api/search/index/route.ts` — accepts `date_from`/`date_to`; single
  books lookup gates all lanes
- `src/lib/books-catalog.ts` — `searchBooksCatalog()` takes `yearMin`/`yearMax`
- `src/lib/artwork-visibility.ts` — optional year range folded into the books
  lookup it already performs (covers gallery + CLIP-visual + artwork lanes)
- `src/lib/api-client/{search,gallery}.ts` — wire names
- `tests/unit/search-filter-wire-names.test.ts` — new guard

## State

PRs #3267, #3268, #3269 merged. Three prod deploys via `npm run deploy:prod`
(deploy → purge → warm), all verified live:

- `/gallery` 1900–1950 → 1900, 1901, 1901, 1900, 1901, 1902, 1913, 1900
- Index 1600–1700 → in-range books; 1990–1995 → 0
- All tab 1600–1700 → books 1601–1634; all 6 gallery images resolve to books
  dated 1606–1678
- Books tab 1600–1700 → 1620–1700, no 1559

`tsc --noEmit` clean, 568 unit tests pass. Guard test verified to fail when the
gallery fix is reverted (not a vacuous pass).

## Open

- **`search-eval` flakiness.** The `stukeley` test intermittently reports 0 book
  results. It runs against **production**, not the PR — and it failed on #3267
  before any of this code was in prod, then passed on #3268's run. Prod answers
  correctly on demand (3 books, three consecutive runs). It's the fail-soft book
  lane dropping out, most likely the Supabase trigram call from the CI runner.
  Same bug class as this session: a lane returning empty without saying so.
- Collections lane in unified search takes no year range — deliberate,
  collections aren't dated objects.

## CLAUDE.md

Added a "Search filters must be enforced in every lane" invariant. Three
independent instances in one session justified doctrine rather than a handoff
note.
