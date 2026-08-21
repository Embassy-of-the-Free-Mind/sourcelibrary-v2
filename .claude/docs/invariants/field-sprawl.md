# A sweep records a ROW, not a COLUMN

**Read this when:** Writing a maintenance sweep or import that updates `books` or `pages`; adding a field to any Mongo collection; changing `scripts/lib/book-docs.mjs`, `scripts/lib/sweep-log.mjs`, or `scripts/audit/field-sprawl.mjs`; or deciding whether the `books` schema validator should move to `error` mode.

*Written 2026-08-14 after #3969 families 1 and 2. See the issue for the full measurement history.*

---

## The rule

**A sweep records a ROW in a log collection keyed to the book, never a new FIELD on the book.**

Use `recordSweepAction(db, { sweep, book_id, action, detail })` from `scripts/lib/sweep-log.mjs`. It writes to `sweep_log`, stamped with the script name. Deliberately *not* `audit_log` — that one feeds the user-facing book history timeline, so writing there lets a bulk sweep actuate something readers see.

Build import documents with `makeBookDoc()` / `makePageDoc()` from `scripts/lib/book-docs.mjs`. Unknown keys throw; retired keys throw with the incident that retired them.

## Why this is correctness, not tidiness

**A query against a field that exists but is 2%-populated returns a confident, well-formed, WRONG answer.** It does not error and does not return null — it returns a small clean number that reads like a finding.

`books` reached **477 top-level fields with only 17 on ≥99% of documents**, ~140 written by a single sweep and then abandoned. Compare `books_warehouse`, the newest book collection: 129 fields, 25 core. The difference is not complexity; it is accretion.

## The lesson that cost the most: consolidation without enforcement is a treadmill

PR #2085 (2026-05-27) fully consolidated the tenant family — 45K books and 6.4M pages cleaned, writers stripped from `src/`, readers migrated, canonical field declared. It explicitly left the "one-shot historical import scripts" alone as already-run.

**Those scripts are the standard route for 429-prone sources and are reused constantly.** Within three months the field was back on 20,010 books and 4,156,480 pages (#3983 stripped 62 write sites across 36 scripts; the data was re-cleaned 2026-08-13/14).

So: **a cleanup is not done when the data is clean. It is done when something standing prevents the regrowth.** The four layers, strongest first:

1. **The DB refuses it.** `$jsonSchema` + `additionalProperties: false` on `books`. Installing it needs `dbAdmin`; the app credential is `readWriteAnyDatabase` and cannot run `collMod` — that privilege split is what makes it a boundary rather than a convention. Generate with `field-sprawl.mjs --emit-validator` (full scan only — a sampled validator rejects legitimate writes to ~80 rare fields).
2. **The easy path is the correct path.** The constructors above. One hand-rolled literal per script is why one bug shipped 62 times.
3. **CI notices drift.** `field-sprawl-watch.yml`, weekly. `--max-fields` ratchets DOWN after each consolidation; `--forbid` lists retired names and fails on reappearance.
4. **This document.** Weakest layer; the other three exist because it is.

## Adding a legitimate field

Adding a field is meant to be deliberate, not blocked. The path:

1. Add it to `BOOK_FIELDS` / `PAGE_FIELDS` in `scripts/lib/book-docs.mjs` (in its comment-grouped section).
2. If the validator is installed in `error` mode, re-emit and reinstall it — `field-sprawl.mjs --collection books --emit-validator <file>`, then `scripts/output/install-books-validator.mjs` with a dbAdmin credential. In `warn` mode nothing is required; the write succeeds and is logged.
3. Ask once whether it should be a field at all. If it records *what a job did*, it is a row (`sweep_log`). If it describes *what the book is*, it is a field.

## The tooling trap that nearly deleted live fields

**`git grep -E "\bfield\b"` matches NOTHING in this repo and exits 1.** BSD ERE
has no `\b`. Verified 2026-08-17: that pattern finds nothing in
`src/lib/types/book.ts`, a file that plainly contains `pages_count`; `git grep
-P` finds it.

This is the worst possible failure for an audit, because **a silent false
negative is indistinguishable from "nothing references this field"** — the exact
conclusion a deletion decision rests on. Two independent reader surveys used it
and both produced orphan lists containing live fields. Re-checking 61 candidates
with `-P` removed six that were genuinely read (`free_tier`, `material`,
`last_updated`, `cover`, `translator`, `archived_reason`).

**Use `git grep -P` for any word-boundary search here, and never accept an empty
result as evidence without a positive control** — run the same pattern against a
string you know exists first. A probe that has only ever returned "nothing" has
not been shown to work.

Related: a reader can also hide where no grep will look —
- **read only by a cron.** `photo` is read solely by `sync-books-catalog.mjs`,
  feeding public listing thumbnails through Supabase. It passes any `src/`-only
  search as unused.
- **read dynamically.** `book[someVar]` cannot be found by name. Measured: none
  in `src/`, and the `scripts/` cases all iterate lists they define themselves.

## Deleting a field safely

The property to test is not "nothing reads it" — that is what grep just failed
to establish. It is **reversibility**:

1. Write the restore path FIRST (`scripts/maintenance/restore-orphan-book-fields.mjs`),
   and have it fill only fields that are currently ABSENT so it can never
   clobber a newer value.
2. Preserve every removed value as a `sweep_log` row keyed to the book, before
   unsetting anything.
3. Prove the round-trip on a canary batch: snapshot → delete → verify gone →
   restore → verify **byte-identical**.
4. Only then run the full deletion, and verify residual counts independently
   rather than trusting the script's own report.

Done this way a deletion is an experiment, not a decision. The 2026-08-17 run
removed 3,467 instances of 50 fields from 2,120 books on exactly this basis.

## Merging columns is only safe while they AGREE

This doc is about one concept spread across N **columns**. The other half is what
those columns *say*, and a consolidation that assumes they say the same thing
loses data silently. Measured on the imprint family, 2026-08-18
(`scripts/audit/imprint-reconciliation.mjs`, #4043): **2,533** books carry two or
more place fields, only 1,634 agree once case and catalogue apparatus are
normalised, and **539 land in the `disjoint` bucket**. Of 916 books holding both
printer fields, **151** agree.

**But `disjoint` is a verdict about strings, not about bibliography, and reading
it as one overstates the conflict roughly twofold.** Classified 2026-08-18,
those 539 are: ~10% a *no-place marker against a city* (`s.l. (Germany)` vs
`Danzig`), **≥40% an exonym or orthographic variant** (`Roma`/`Rome`,
`Nürnberg`/`Nuremberg`, `Strassburg`/`Strasbourg`, `z.p.`/`n.p.`), and at most
~50% genuinely different places — a ceiling, because the residue still visibly
contains exonyms the edit distance missed (`Venezia`/`Venice`). Only that last
bucket needs a person. **Before sizing a review queue off a normaliser's
output, classify what the disagreements ARE**: a queue of 539 that is really
~270 sends someone to adjudicate Rome against Roma.

**Some of that disagreement is knowledge, not error.** *De occulta philosophia*
holds `[Cologne]` in one field and `Lyon` in another — a fictitious imprint and
its true printing; others read `s.l. (Germany)` against `[Halle? Helmstedt?]`,
two sources hedging differently about an unsigned book. Picking a winner deletes
the most interesting bibliography we hold. So: measure the disagreement shapes
(identical-after-normalising / containment / partial overlap / disjoint) before
choosing a canonical field, and check whether the conflict encodes a distinction
worth keeping — *stated* vs *established* vs *conjectural* — rather than one
value being wrong. Normalisation for comparison must never be written back.

**A field's tier does not tell you the value's ROLE, so tier precedence is not a
merge rule.** The obvious hypothesis — catalogue beats OCR beats import — is
falsified in the destructive direction on 54 measured books: the *catalogue*
field holds `s.l. (Germany)` (a true statement that the title page names no
place) while the *import* field holds `Danzig`, `Prague`, `Frankfurt`,
`Amsterdam`, `Eichstätt`. Catalogue-wins overwrites a real city with "place
unknown". The same field also carries plainly established values (`Roma`,
`Strasbourg`), so the role is a property of the **value's own shape** — `s.l.` /
`n.p.` / `z.p.` and `[…?]` mark *stated-absent* and *conjectural*; a bare
place-name marks an assertion — and never of the column it sits in. Read the
value, not the field name.

Rule of thumb for routing: **fields that merely duplicate a fact belong to #3969;
fields that disagree about one belong to #4043.**

## Three problems look identical from a distance — measure which one you have

"The author field is a mess" covered three different defects with three different
costs, and reading them as one wasted most of a session. Establish which shape you
are in **before** planning any work, because only the first needs a person at all.

1. **Value drift** — the columns disagree, and resolving them needs domain
   knowledge. The imprint family: 2,533 books with two or more place fields, 1,634
   agreeing. Expensive; the residue cannot be automated (#4043).
2. **Column drift with a decided winner** — the columns *agree*, and the canonical
   one is already documented; only the migration is unfinished. `author_id` vs
   `author_entity_id` sampled **3,000/3,000 in agreement**, with 8,595 books
   carrying only the transitional key and 43 files still referencing it. Cheap and
   purely mechanical — no adjudication, no queue, no review.
3. **A scoping bug wearing drift's clothes** — the field is fine and a population
   was never scanned. 69,245 books carry an author string and *neither* key,
   because the thesaurus builder and the link backfill were scoped to
   `visible: true` while imports land hidden by invariant (#3769).

**The cheap test that separates them: where two fields are both present, do they
agree?** Perfect agreement means (2) — finish the migration. Real disagreement
means (1) — measure the shapes first. And always compare the linked population
against the one you measured independently; a gap that large is (3), and no amount
of column work touches it.

Sizing them against each other is the whole point: here the consolidation was
8,595 books and the coverage gap was 69,245 — seven times larger, and invisible to
anyone reasoning about field names.

## The near-duplicate pass cannot see an independently-named family

`FAMILIES` is not a convenience — it is the only way some families surface. The
automatic pass compares field NAMES (edit distance + token subset), so it caught
`archive_reason` vs `archived_reason` and even the false friend `published` vs
`publisher`, while never flagging `publication_place` / `place_of_publication` /
`place_published` / `place`, which are the same concept named four ways by four
writers. If you consolidate a family, **declare it in `FAMILIES` first**; if you
suspect one, do not wait for the detector to nominate it.

## A concept can live in a collection AND an embedded field of the same name

`field_provenance` is both: a standalone collection holding **58** rows, and
`books.field_provenance` on **69,778** books (~134,488 stamps, 81 writers, 164
key shapes — #3471). Measuring the collection and reporting on "the provenance
layer" produced a confident, exactly-backwards diagnosis in one session: *never
populated* instead of *heavily used and drifted*. A small count from the wrong
container is indistinguishable from an unfinished backfill.

Before quoting coverage for any concept, check both shapes —
`countDocuments({ <name>: { $exists: true } })` on `books` as well as the
collection — and say which one you measured.

## Traps that each cost a round

- **Gap ratio does not rank danger.** `deleted_reason` and `deletion_reason` are a perfect duplicate on the same 15 books.
- **Sampling undercounts fields by ~80 on `books`**, and a 200K-document `$sample` estimated a pages residue at 1.4M when the exact walk found **4.16M**. Anything deciding what to keep or delete must use exact counts.
- **The validator binds only the top level.** A free-form object field (`metadata`, 60 sub-keys; `translation_verification`, 48) is an unguarded floor below it. The watch carries `--max-nested` for this.
- **A restore path is a writer.** `POST /api/books/restore/[id]` spreads the drifted 260-field `deleted_books` shape back into `books`, which both re-pollutes retired fields and would 500 under `error` mode (#3997 — blocks the flip).
- **Hour-scale Mongo jobs belong on Hetzner.** A residential connection drops sustained TLS flows; the 4.16M-row walk died three times locally and completed there.

## Verifying

```
node --env-file=.env.production.local scripts/audit/field-sprawl.mjs --collection books
node --env-file=.env.production.local scripts/audit/field-sprawl.mjs --collection books --forbid tenant_id,hide_reason
```

Exit 1 means a ceiling was exceeded or a retired field came back. **The response is to find the writer and strip it — never to raise the ceiling.**
