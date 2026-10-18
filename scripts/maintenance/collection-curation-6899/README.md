# Collection curation, 2026-10-18 (#6899)

Evidence for the writes made by `../curate-collection-highlights.mjs` and `../audit-collection-membership.mjs`.

- `highlight-changes.jsonl.gz`: one row per collection whose `highlighted_books` changed. It holds the full
  `before` and `after` lists, the dropped entries with a reason (`hidden`, `not-a-member`, `hidden-duplicate`
  moved to its keeper, `repeat`, `no-such-book`), and the Opus START HERE verdict. There are three runs: step 1,
  then the two re-runs after the untags.
- `untag-log.jsonl.gz`: every stray untag, written BEFORE the write. Each row holds the book id, the slug, the
  title, Opus's reason, and the book's `collections` before the change. About 90 rows were no-ops: the same
  book had already been untagged in the other pass.
- `borderline.jsonl.gz`: the members Opus called borderline. They are listed only; nothing was applied.
- `per-collection.json`: members judged, strays and borderline per visible collection (books and artworks).

To undo one untag: `$addToSet` the slug back onto `books.collections` and bump `updated_at`. Then run
`scripts/workers/sync-books-catalog.mjs` and revalidate `/collections/<slug>`. Sweep_log rows are under
`collection-highlights-2026-10-18` and `collection-membership-audit-2026-10-18`.
