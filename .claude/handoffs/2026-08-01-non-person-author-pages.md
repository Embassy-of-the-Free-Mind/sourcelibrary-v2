# The flag that was written and never read (#3483)

**Date:** 2026-08-01 · **PRs:** #3512, #3516 (both merged) · **Filed:** #3517
**Predecessor:** `.claude/handoffs/2026-07-31-search-term-became-the-author.md` (#3434)

## What was wrong

`quarantine-non-person-authors.mjs` (#2179) had been flagging non-person headings in
the `authors` thesaurus as `is_person: false` for a year — institutions, work titles,
publisher series, cataloguer placeholders. 59 docs carried the flag. **Nothing in
`src/` ever read it.** The script's own doc comment states its purpose as "so author
surfaces exclude them"; that exclusion was never implemented.

So a reader clicking the byline on a volume of *Theatrum Chemicum* landed on **"Works
by Theatrum Chemicum"** — a book presented as its own author, with a portrait slot,
life dates, an "Artist page" link, and a schema.org `Person` node. Also live:
**"Works by S N"**, where `s.n.` is *sine nomine*, the cataloguing abbreviation for an
unnamed publisher.

## The finding that redirected the fix

The obvious reading — "these are mislabelled listings, reframe them as works" — is
wrong, and the work layer already contained the proof.

The 4 books under "Theatrum Chemicum" carry **3 distinct `work_id`s**, correctly,
because they are 3 unrelated works: a 1614 Frankfurt fair catalogue, a genuine
*Theatrum Chemicum* volume six, and two *Deutsches Theatrum Chemicum* editions. They
share nothing but a search string. **There is no work to redirect them to**, so
"reframe as a work page" fails on truth, not on effort.

That split the 59 into three groups, and only one of them was a rendering bug:

| group | count | disposition |
|---|---|---|
| `merged_into` dedup tombstones | 22 | **never broken** — the resolver already follows them to the primary and 301s |
| #3434 search-term contamination | ~19 docs | fix the *data*; the page retires itself |
| legitimate corporate / anonymous headings | ~18 docs | keep the books, drop the person framing |

An author page exists only while books point at it. So clearing a bogus `books.author`
404s the page with no code change at all — which is why half of this was a data fix
with no rendering component.

## What shipped

**Data (#3512, applied to production).** 786 records cleared across two waves —
`repair-work-title-authors-3483.mjs`, backed up and revertible, `field_provenance.author`
stamped. 139 visible. Supabase mirror synced. 22 author pages now resolve to zero books
and 404 in production, verified by curl.

**Rendering (#3512).** `classifyNonPersonAuthor` (`src/lib/non-person-author.ts`) maps
`quarantine_reason` to a kind and suppresses the portrait, life dates, the `fl.` range
(floruit is a person's active years) and the artist link. `AuthorSchema` emits
`Organization` for an institution and **no entity node at all** for a work title or
placeholder, with `CollectionPage` in place of `ProfilePage`.

**Attribution (#3516).** The Corpus Juris books were the one heading clearing would have
got *wrong*: they really are Justinian's codification, and a canonical `justinian-i` doc
(Q41866) already existed. 8 attributed to Justinian I, 5 unset — the *Consuetudines
Feudorum* (medieval Lombard feudal law bound into printed editions centuries later) and
three pieces of apparatus are not his. `/author/justinian-i` now resolves 11 books.

## Three things worth carrying forward

**1. Key a repair on whatever unit was actually verified.** #3434 keyed on book ids
because the *name* was valid and only the pairing was wrong, so each pairing needed
judging. #3483 keys on the author **string**, because the string itself is never a name
(`S.n` is *sine nomine*) — which makes string-matching self-limiting rather than a
widening heuristic.

**2. Enumerating by thesaurus doc is not exhaustive.** A doc-keyed sweep walks
`author_id` ∪ `author_entity_id` ∪ `variants` and silently misses any book whose string
never joined. That gap hid `Kircher Oedipus` (6 periodicals), `Kircher Musurgia`,
`Kircher Mundus` and `AnonymousUnknown author` from a sweep that believed it was
complete. `scripts/audit/author-attribution.mjs`, which scans strings, found all four
afterwards. **The audit was right and the bespoke sweep was wrong.**

**3. A re-runnable repair must MERGE its backup.** These scripts select by "still
wearing the bad value", so a second run sees only newly-found records. An overwriting
backup would have replaced 770 restorable records with 15 and stranded `--revert` for
everything already fixed.

## The originating importer — closed by inference, not by finding the file

The #3434 handoff left this open. It is now answerable without the script.

Isolating just the search-term class (excluding `s.n.`/`s.l.` placeholders, which are
legitimate catalogue values): **108 records, 106 of them BSB**, and the timestamps
collapse to one burst — 9 at 03h, **96 in the single hour of 2026-03-14 08h**, two
stragglers the next morning. Nothing before, nothing after.

`import_candidates` shows BSB harvesting beginning **2026-03-15 12h**, a day *after*,
at ~128K candidates/hour — and the rows that pipeline writes carry the catalogue's real
author (`author: "Kircher, Athanasius"`, proper `Surname, Forename`). The bsb id of a
contaminated book has **no row in `import_candidates` at all**.

So the March 14 run predates the enumerate→dedupe→import loop entirely: a direct
search-and-import that never went through candidates, replaced ~28 hours later. That is
why grepping the repo finds nothing — the code was deleted, not hidden. The current path
structurally reads the catalogue's author, and the standing audit now scans the whole
corpus by string. **Caveat: this is inference from timestamps and field shapes, not a
recovered script.** Deployment logs for 2026-03-14 08:36 UTC would name the process.

## Still open

1. **#3517 — work anchors still encode the bogus names.** `work_id` is minted as
   `local:{a:author_id|n:author-name-slug}:{title-slug}`, so the query got baked into the
   cluster key: `local:a:viridarium-chymicum:garden-illustrious-poets` on a Pico
   anthology. 86 distinct work_ids, 108 work_slugs, 112 book slugs.
   **But only 6 are in the sitemap** (`getWorks()` emits `/work/` only for works with
   ≥2 visible editions) — and **one of those 6 is a false positive**:
   `turba-philosophorum` is the legitimate id, matched only because the bogus string
   shares a word with the real work. So the actionable set is **5**, the clustering in
   all 5 is correct, and only the anchor is wrong.
   Not done here because `git grep` finds **no slug-history or redirect mechanism**
   anywhere in the codebase — renaming an indexed URL is a hard 404, which is a product
   decision, not cleanup.
2. **Prod deploy verification.** The rendering half was deployed at the end of this
   session but **never verified against a live page** — every Vercel preview in the
   session was canceled as superseded or skipped by the ignored-build-step. It is
   currently guarded only by unit tests. Check `/author/british-museum` (no life dates,
   `@type: Organization`) and, more importantly, `/author/athanasius-kircher` as a
   control: `is_person` is absent on 4,766 of 4,825 docs, so a falsy-check regression
   would strip the framing from *every* author rather than the intended ~15.
3. **Four audit findings are correct attributions**, not defects — "Grand Orient"
   (A. E. Waite's pseudonym), "David the Invincible" (the 6th-c. Armenian Neoplatonist),
   "Euthymius, Zigabenus" (the *Panoplia Dogmatike* is genuinely his), and "British
   Museum". The detector flags on title-prefix shape; being flagged is not being wrong.

Audit findings went 23 → 14; work-title strings 21 → 6.

## Note on the guard

`tests/unit/non-person-author.test.ts` asserts behaviour, never source shape: it calls
the classifier, drives the **real resolver against a fake db** (so a future projection
that drops `is_person` fails), and parses the JSON-LD the component emits. All four
guarded lines were verified by breaking them and watching the suite go red, then green
on restore. The page-level suppressions (portrait, life dates, artist link) are **not**
covered — that gap is real and is why item 2 above matters.
