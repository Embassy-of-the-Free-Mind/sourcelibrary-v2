# The Spanish collection pages were English because the store was empty — 2026-08-21

Reported by Derek as "not all the collection pages have been translated to spanish
e.g. /es/collections/secret-societies", then two follow-ups from the same visit.
All three had one cause: the Spanish surfaces were built with correct fallbacks and
nothing was put behind them.

PRs: **#4159** (the fix), **#4177** (the two doc lessons).

## What was actually wrong

**Not the code.** `collections.localized.es`, `localizedCollection()`, and the
labelled-English fallback prescribed by `.claude/docs/i18n.md` rule 4 were all
correct and working. `collections.localized.es` had been written for **1 of 325**
visible collections, because `scripts/maintenance/localize-metadata.mjs` only
accepted `--collection=<slug>` — one per invocation — so it had been run once, for
`en-espanol`, and never again.

That is the whole bug, and it is invisible by design: a good fallback renders
something plausible, so the surface never errors, never logs, and never appears in
any check. An empty store and a complete one produce the same *shape* of page.

Two more of the same family in the same visit:
- The `/es` homepage collection grid showed a bare `1644 libros` because nobody
  passed it a Spanish per-collection count.
- The header's Librarian link went to `/librarian` (English) though `/es/librarian`
  exists and `LOCALIZED_PATHS` already knew about it — the nav localized
  `/collections` with a hand-written ternary and left every other href alone.

## What shipped (#4159, merged `c570bd74`, verified live)

| surface | before | after |
|---|---|---|
| `/es/collections/<slug>` intro | English + "disponible en inglés" on ~all | Spanish on all 325, 0 falling back |
| `/es` grid card | `1644 libros` | `1644 libros · 27 en español` |
| header "Librarian" on `/es` | `/librarian` | `/es/librarian` |

**Script.** `localize-metadata.mjs` gained `--all-collections`,
`--collections-with-editions` (collections holding a book readable in the language,
plus their parents — a parent left untranslated puts an English breadcrumb over a
localized branch), `--slugs=`, `--limit=`, and 4-way concurrency. A description is
written only if its length lands within 0.6×–2.2× of the source, so a model that
summarises instead of translating leaves the honest labelled English in place.

**Nav.** Hrefs are now written in canonical English form and run through
`localePath` (registry-guarded: twinned paths get the prefix, untwinned ones are
returned untouched). `activePrefix` moves with the href or the Spanish nav
highlights nothing. The tenant global-only filter now tests `canonicalPath(href)` —
`/es/explore` is the same global-only surface as `/explore`.

**Counts.** `getLocalizedCollectionCounts(lang)` in `home-data.ts`, off the shared
`localizedEditionFilter`, so the homepage card and `/es/collections` cannot
disagree about the same collection.

## Numbers

- Run 1 (reachable set): 134 written, 0 failed.
- Run 2 (the rest, after Derek approved): 191 written, 0 failed.
- Final: **325/325 visible collections localized, 0 intros falling back.**
- 297 are servable on `/es`; **28 are `collection_type: visual_art`**, which
  `/es/collections/[id]` deliberately 404s — those got copy nothing renders yet.
  Scoping miss on my part, worth ~a third of a cent.
- Total spend ≈ **$0.03** (gemini-3.1-flash-lite).

## Three things worth carrying forward

**1. A write count is not a result.** The first bulk pass reported 134/134 success
with **19 names still in English** ("Signs in the Sky", "Sacred Plants & Ritual
Intoxication"). Every one of them "succeeded". Auditing output against input
(identical-to-source, length ratio) caught it; a firmer prompt — *a collection name
is a shelf label, translate it unless a Spanish library would print that exact
string* — fixed 14, and the 5 remaining identical are correct (Corpus Hermeticum,
Falsafa, Maya, Drama, Yoga). Second run needed no repair: 16 identical, all proper
nouns.

**2. Hand-curated values must be SEEDED into the store the read path prefers.**
`ES_COLLECTION_NAMES` (22 hand-written Spanish names) would have been silently
downgraded by the bulk run, because `spanishCopy()` prefers `localized.es.name`
once it exists. The script reads them out of the TS source and writes them
verbatim rather than duplicating the list.

**3. No deploy or purge is owed for this.** DB-only; `/es/collections/*` is not
under the 24h CDN rule (that source is `/collections/:path*`, English only) and
serves `max-age=0, must-revalidate`. ISR `revalidate = 3600` picks it up within the
hour.

## Two process lessons — both are now docs (#4177)

**A missing CI run usually means CONFLICTING.** After pushing a fix, three
consecutive pushes produced *no* Actions runs. CLAUDE.md already had an entry from
#4120 describing this symptom and the fix that works ("merge origin/main and
push") but not why. The why: GitHub builds a `pull_request` run against the
**merge** commit, so a conflicting PR queues nothing at all — no failure, no
annotation, just a check list shorter than a healthy PR's. Diagnosis is one
command: `gh pr view <n> --json mergeable`. Edited that entry in place rather than
writing the incident up a second time.

**A source guard can be too STRICT, and it fails in the direction that looks
responsible.** `tests/unit/tenant-global-paths.test.ts` required the literal
`!isGlobalOnlyNavHref(child.href)`. Wrapping the argument in `canonicalPath` —
which *strengthens* exactly what the guard protects — turned it red. A too-strict
guard reads as a real regression, so the honest response is to revert a correct
fix. Widened it to require `child.href` inside the call; added the mirror-failure
section to `invariants/tests-that-are-not-guards.md`, which until now covered only
guards too weak to fail.

## Files touched

- `scripts/maintenance/localize-metadata.mjs` — bulk modes, selector, prompt, validation
- `src/components/layout/SiteHeader.tsx` — `localePath` on all nav hrefs
- `src/lib/home-data.ts` — `getLocalizedCollectionCounts`, `HomeData.localizedCollectionCounts`
- `src/components/home/HomeView.tsx` — `countLabel`
- `src/lib/home-i18n.ts` — `inThisLanguage`
- `src/app/es/collections/page.tsx` — intro line no longer promises English-only
- `src/app/es/page.tsx`, `HomeView.tsx` — stale comments claiming `/es` stores a
  reading-language preference (#4112 removed it; rule 6 forbids reintroducing it)
- `tests/unit/tenant-global-paths.test.ts` — guard widened
- `.claude/docs/i18n.md` rule 2 — fill rate, bulk mode, output check, seeding
- `CLAUDE.md` + `invariants/tests-that-are-not-guards.md` (#4177)

## Still open

- **#4166** — `books_catalog` has no `pages_translated_es`, so homepage rails see a
  book *written* in Spanish but not one *translated* into it. The writer is the
  dangerous half (#4120/#4141).
- **#4146** — natives unfindable in Spanish search; Scherzer has zero `page_texts`
  `lang=es` rows because the composer reads `translations.es`, empty for a native
  edition.
- **#4119** — the translation backlog; `/es/search` needs the search page's chrome
  localized first.
- The 28 `visual_art` collections now hold Spanish copy that no `/es` route
  renders. Harmless, and ready if a Spanish gallery surface ever appears.
