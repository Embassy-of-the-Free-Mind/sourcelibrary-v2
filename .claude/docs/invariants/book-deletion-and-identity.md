# Removing a book, and concluding one is missing

**Read this when:** removing a document from `books`; writing a sweep that
deletes, merges, or replaces book records; or investigating a report that a book
has **vanished**.

Materialized 2026-08-31 (#4450). Companion to
[`../preservation-policy.md`](../preservation-policy.md), which governs whether a
deletion should happen at all; this file governs how it happens and how you tell
that one did.

---

## The two rules

**1. `deleteBookArchived()` is the only way to remove a book.**
`deleted_books` *is* the recovery path — `POST /api/books/restore/[id]` reads
nothing else. A delete that skips it is unrecoverable **by design** and silent:
nothing errors, no alarm fires, and the only way anyone finds out is a reader
hitting a dead URL.

- `src/lib/delete-book.ts` — `deleteBookArchived()`, `purgeBookUnarchived()`,
  `findBookByEitherKey()`
- `scripts/lib/delete-book.mjs` — the mirror for scripts (same arrangement as
  `src/lib/r2-key.ts` / `scripts/lib/r2-key.mjs`; keep them in step by hand)

The helper archives the book **and its pages**, re-reads the archive row, and
only then deletes. If the archive is not readable it throws and leaves the book
in place. `db.collection('books').deleteOne(...)` is the thing you don't call —
a convention five scripts follow and one doesn't is not a guard.

`purgeBookUnarchived()` exists for the deliberate, operator-confirmed permanent
delete. It is named that way so an unrecoverable path cannot read like an
ordinary `deleteOne` to the next person grepping.

`moveToWarehouse()` in `src/lib/warehouse.ts` is the one bare `books.deleteOne`
that is **not** a deletion — the record survives in `books_warehouse`. It now
re-reads the warehouse copy before deleting, for the same reason.

**2. A book has TWO keys. Look it up by both.**
Importers mint them together — `{ _id: oid, id: oid.toHexString() }` — so `id`
and `_id` normally agree. But a record that is **re-created** (restore,
re-import, a recovery sweep) keeps its `id` and gets a **new `_id`**.

Measured 2026-08-31: **16,343 books** are in that state, 14.6% of the corpus,
concentrated on the days a recovery ran (5,000 on 2026-04-20, 2,051 on
2026-03-24, 1,593 on 2026-04-12 …).

`src/app/api/books/restore/[id]/route.ts` does this on purpose —
`// Restore book (generate new _id to avoid conflicts)` — and deletes the ledger
row on success, which is why a re-created book leaves no trace in
`deleted_books`. It is not a bug in that route; it is a fact about the corpus
that every *reader* has to know.

But **don't blame the restore route for the 16,343.** It stamps `restored_at`
and `restored_from` on everything it writes, and only **15** books carry
`restored_at` (all 2026-05-12). The rest were re-created by bulk recovery
scripts and re-imports that preserved `created_at`, slug and pages while minting
a fresh `_id`. The mechanism class is what matters — *any* path that re-creates a
book document breaks every `_id`-keyed reference to it — not which script ran.

---

## The tell — and why this needs a doc

A book whose `_id` was re-minted is **invisible to an `_id`-only lookup while
being alive, visible, fully paginated, and serving readers at its URL.** It
reads as deletion without being one.

That is exactly how **#4450** was filed: five books were reported "vanished from
`books`, no `deleted_books` row, readers were on the pages." Every one of them
was present the whole time — findable by `id`, four of them `visible: true`,
all five with their complete page runs (352 / 246 / 520 / 1068 / 1046 pages).
The lookup that declared them missing used `_id`. The absent ledger row was not
evidence of a ledgerless delete; there had been no delete.

The shape generalises: **a missing thing is not a missing behaviour.** Before
reporting a record as lost, query it by every key it has, and check
`books_warehouse` and `deleted_books` too. `findBookByEitherKey()` does all of
this; use it rather than hand-rolling a lookup.

---

## The standing check

`scripts/audit/books-delete-ledger-gap.mjs` — read-only, exits 1 on a real gap.

It resolves every stored book reference that outlives the record —
`entities.books[]`, `collections.sample_books[]`, `feedback.page`, and Supabase
`books_catalog` — against **all** the keys, and reports three populations
separately because they need opposite responses:

| population | meaning | response |
|---|---|---|
| `live but _id-churned` | resolves by `id`, dead by `_id` | the record is fine, the *reader* of it is wrong |
| `in deleted_books` | genuinely deleted, ledgered | recoverable via the restore route |
| `UNRESOLVED` | no book under either key, no ledger row | possible real loss — investigate |

Baseline, 2026-08-31: **0 unresolved** across 3,652,622 references.
387,029 `entities.books[]` references and 16,413 Supabase catalog rows are
`_id`-churned; 9,166 entity references point at properly ledgered deletions.

Two things it deliberately does **not** do:

- **Shortlinks are not covered.** `/q/…` codes are stateless — encoded in
  `src/lib/shortlinks.ts`, never stored — so there is no set to enumerate.
  Don't add a "shortlinks" lane expecting to find one.
- **It does not fail on churn.** 16k records carry it historically; failing on
  it would make the audit useless on its first run.

**It confirms before it fails.** The first run reported 19 unresolved Supabase
rows — all of which existed in Mongo, all imported during the twenty minutes the
sweep was running. The key space is a snapshot; an active importer inserts books
after the `books` cursor has passed and before Supabase is read. Every candidate
is now re-checked individually against Mongo before being called a loss. Any
audit that reads a large corpus while writers are live needs this pass, or it
cries loss whenever an import is running and nobody trusts it again.
