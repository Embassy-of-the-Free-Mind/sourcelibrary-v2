# The search term became the author (#3434)

**Date:** 2026-07-31 · **PR:** #3482 (merged) · **Follow-up filed:** #3483

## What happened

#3434 reported two things: 10 catalogues misattributed to Heinrich Khunrath, and a
"wider class" of work titles sitting in `books.author` (`Theatrum Chemicum`,
`Rosarium Philosophorum`, …). They are not two problems. They are one import run.

On 2026-03-14 a BSB acquisition imported 1,353 books and **stamped its search term
into `books.author`.** The values are the proof — they are not names anyone writes:

```
Albertus Secrets      Fludd Medicina        Kircher Oedipus     Kircher Ars Magna
Kircher Musurgia      Kircher Mundus        John Dee Monas      Kabbala Denudata
Iamblichus De Mysteriis
```

Every one is `<author surname> <work keyword>` — a query. And the books wearing them
are overwhelmingly **bookseller and library catalogues**, because a full-text search
for a title matches every catalogue that *lists a copy of it*. Catalogues are the
highest-recall false positive for a title search, so they dominate the wrong results.

That single mechanism explains all the surface forms at once:

| author string | what it landed on |
|---|---|
| `Heinrich Khunrath` | 14 catalogues + periodicals, 1751–1810 (he died 1605) |
| `Iamblichus De Mysteriis` | 5 bookseller/library catalogues |
| `Kircher Oedipus` | German literary periodicals (*Der teutsche Merkur*, *Morgenblatt für gebildete Stände*) |
| `Confessio Fraternitatis` | 16 editions of the **Augsburg Confession** — keyword collision on "Confessio" |
| `Splendor Solis` | *Aureum Vellus* editions |

Corrections to the issue's numbers: **14** Khunrath records, not 10; and **four**
authors, not one — Gerhard Dorn ×2 (d. 1584, on 1797/1806 auction catalogues), Elias
Ashmole (d. 1692, 1809 bookshop catalogue), Robert Fludd (d. 1637, 1765 auction
catalogue). The extra three were found by the new detector, not by the issue.

## Why three existing pieces of machinery all missed it

This is the interesting part, and the reason it survived four months.

1. **`qa-author-date-anachronisms.mjs` tests the BIRTH side only** — books published
   *before* the author was born. This class is the death side (Khunrath d. 1605,
   catalogue 1762). Invisible there by construction.

2. **`quarantine-non-person-authors.mjs` fixes the `authors` THESAURUS and never
   touches `books.author`.** A book keeps rendering "by Theatrum Chemicum" after its
   author doc is quarantined. Worse, its safety interlock — which is *correct* —
   refuses to touch anchored real people, so **Khunrath can never be caught there**:
   he is a real person with a VIAF id who genuinely wrote other books we hold.

3. **`author-date-window.mjs` deliberately refuses to exclude on the death side**, and
   documents why: "a book printed long AFTER death is fine (reprints/translations)."
   That reasoning is *right* — Boethius alone carries 55 posthumous editions. Adding a
   naive death check would flag every reprint in the corpus.

So the blind spot was not an oversight in any one of them. Each was correct in its own
frame, and the class fell in the gap between the three.

## The fix, and the shape of it

`posthumousMisattributionLikely()` uses the death side **only in combination with the
genre of the containing book.** A catalogue is not an edition of anything, so a
long-dead author on one is evidence of *mention*, not authorship. Both conditions are
required. `authorshipPlausible` semantics are untouched.

Genre alone is not sufficient either — **a person can legitimately compile a
catalogue.** An earlier draft of the audit flagged Guanzelli (who compiled the *Index
librorum expurgandorum*), Bernardus de Lutzemburgo (*Catalogus haereticorum*), and
Eduard Bernard (*Catalogi librorum manuscriptorum Angliae*). All three are real
authors of real reference works. The shipped signature requires the death gap *and*
the genre, and check 2 additionally requires a **title mismatch** (the string names a
work in the corpus, but the books wearing it are different works) — which is what
separates a misattribution from an author whose name simply heads their own book.

### Shipped

- `scripts/audit/author-attribution.mjs` — standing read-only audit. Three checks
  (posthumous reference-genre; work-title-as-author; structural garbage). Exits
  non-zero on findings. **Review queue, never auto-writes.**
- `scripts/maintenance/repair-author-misattribution-3434.mjs` — the 14 verified
  records as a **literal list**, so it cannot widen its own blast radius if detector
  precision changes. Backup + `--revert`. Re-asserts the expected author at write time
  so a hand correction made since verification is never clobbered.
- `posthumousMisattributionLikely()` / `isReferenceGenreTitle()` in
  `scripts/lib/author-date-window.mjs`.
- `tests/unit/author-date-window.test.ts` — 39 behaviour tests. The
  `reprintsNeverFlagged` block fails if anyone collapses the two rules into one
  death-side check. **Verified by breaking the genre gate and watching it go red** —
  a guard nobody has seen fail is not yet a guard.
- 15 further hand-verified work titles added to the quarantine curated list.

### Applied to production

- 14 books cleared (`author`, `author_id`, `author_entity_id`, `normalized_author`
  unset) — verified 14/14, `field_provenance.author` stamped with the reason.
- `books_catalog` synced (14 synced, 0 errors). Byline confirmed gone from the live
  page by curl.
- 9 further work-title author docs quarantined (`is_person:false`: 50 → 59).
- Audit check 1 now returns exactly **1**: *Bibliotheca Fratrum Polonorum* (1668)
  against Socinus (d. 1604) — deliberately excluded as a genuine posthumous collected
  edition. That single residual finding is the reason the audit is a queue, not a
  writer.

**Unset, not replaced.** These are corporate and anonymous imprints — a Frankfurt fair
catalogue was compiled by the fair's booksellers, a Habsburg banned-book list by the
Aulic Commission. Inventing a name would substitute a second fabrication for the
first. All 14 remain **visible**: they are genuine primary sources (the *Catalogus
Librorum a Commissione Aulica Prohibitorum* is a Habsburg censorship record); only the
attribution was wrong.

## Still open

1. **All 14 slugs and all 14 `work_id`s still encode the wrong name** —
   `catalogus-librorum-a-commissione-aulica-prohibitorum-khunrath`,
   `local:a:heinrich-khunrath:books-by-catalog-commission-court-prohibited`. The
   work-identity layer clustered these catalogues under Khunrath as an author-anchored
   work. Renaming public URLs breaks links and SEO; rewriting work-cluster keys
   touches the work-identity invariants. Each needs its own decision — neither was
   done silently.
2. **21 work-title-as-author strings** need a per-string curatorial call: unset
   (`Theatrum Chemicum`, an anonymous compilation) vs. correct to a person
   (`Iamblichus De Mysteriis` → Iamblichus). The audit is the queue.
3. **#3483** — `is_person: false` is read by **nothing** in `src/`. All 59 quarantine
   flags are inert; `/author/theatrum-chemicum` returns HTTP 200 listing 4 books,
   presenting a book title as a person. Needs a design decision (404 / reframe as work
   / drop the person framing) before any code.
4. **The originating importer was never found.** The run is dated and provider-tagged
   (`provider: Bayerische Staatsbibliothek (BSB Munich)`, created 2026-03-14) but no
   script in the repo matches it, and no `iiif_candidates` row survives for those bsb
   ids. **Worth finding before the next provider-search acquisition**, or the class
   recurs on a new corpus.
5. `[object Object]` on 3,297 books (0 visible) — real, not reader-facing.

## Notes for whoever picks this up

- **`field_provenance` has no `author` entry on any of these records.** The
  bibliographic layer is unstamped, exactly as #3471 describes — which is why the
  attribution could not be traced from the data and had to be inferred from the value
  shapes and the `created_at` cluster. The repair script now stamps
  `field_provenance.author` when it clears a value; new writers should do the same.
- **The `authors` collection carries no life dates** — 0 of 4,825 have a birth or
  death year, only `birth_place`/`death_place`. Death years come from
  `entities.wikidata_death_date` via `authors.entity_ids`, and only **1,229 of 3,253**
  entity-linked docs resolve one. So check 1 abstains on roughly two-thirds of the
  corpus. Harvesting life dates into `authors` would widen its reach more than any
  tuning of the detector.
- Interestingly, some dates are sitting in the variant strings already
  (`"Khunrath, Heinrich, 1560-1605; Arndt, Johann"`) — parseable without a network
  call, if someone wants a cheap partial backfill.
