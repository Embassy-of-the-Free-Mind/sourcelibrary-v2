# Meta-annotation quote leak — "mercury on page 89"

**Date:** 2026-05-30
**Reported by:** Nirmal Patel
**PRs:** #2232 (embed/snippet + librarian), #2233 (keyword surfaces + likes + shared helper + CLAUDE.md invariant)
**Status:** code fix shipped; corpus snippet backfill in progress; paid re-embed deferred pending eval.

## The report

The librarian cited page 89 of Munisvara's *Siddhanta Sarvabhauma, Part Two*
(`book/siddhanta-sarvabhauma-part-2-munisvara`, Mongo id `69907c485f855ec553e73532`)
with the "quote":

> "While the previous page focused on perpetual motion wheels using mercury, this page shifts toward water-driven mechanisms and the construction of the Armillary Sphere (Gola-yantra)…"

…but "mercury" appears nowhere on page 89. The mercury wheel is on **page 88**;
page 89's body is a water-driven armillary sphere.

## Root cause

That sentence is not a quote — it's the AI-written `<meta>` annotation describing
page 89. Page text in `pages.{ocr,translation}.data` is wrapped in editorial
blocks (`<meta>`, `<summary>`, `<keywords>`, `<vocab>`) that describe the page and
often name adjacent-page content. Every text-cleaning path used the classic
`replace(/<[^>]+>/g, '')` — strips the **tag** but keeps the **prose**. So the
description was embedded into the page vector (why "mercury" ranked page 89) and
served as a quotable snippet.

## Why it was bigger than one page / one surface

Search has multiple independent read surfaces, each with its own text cleaner;
fixes don't propagate (see memory `project_search_three_surfaces`). Confirmed live
via MCP after #2232:
- `search_translations` (`/api/search`) and `search_within_book`
  (`/api/books/[id]/search`) still returned meta prose as `snippet_type:"translation"`
  across many books — Siddhanta Shiromani p759, Surya Siddhanta p369/370, etc.
- `/api/likes/{popular,mine}` excerpts: meta sits at the field head, so the
  excerpt *was* the meta description.

## Fix

- **`src/lib/strip-editorial-wrappers.ts`** — single shared helper. Strips
  `<meta>/<summary>/<keywords>/<vocab>` content (paired + orphan), keeps inline
  glosses (`note`/`term`/`margin`).
- Wired into: `embed-gemini.mjs cleanText`, `librarian-search.ts`,
  `semantic-alignment.ts` (#2232); `/api/search`, `/api/books/[id]/search`,
  likes {popular,mine} main+tenant (#2233). `/api/learn` already stripped correctly.
- Unit test: `tests/unit/strip-editorial-wrappers.test.ts`.
- CLAUDE.md: new "Quote & snippet integrity — CRITICAL" invariant.

## Backfill (decoupled, free)

`scripts/maintenance/backfill-clean-snippets.mjs` re-derives the stored
`page_translations.translation` snippet column from Mongo — **zero Gemini calls**,
UPDATE-only (never touches the embedding). Existing rows had tags stripped at
write time, so a read-time re-strip can't recover them; the Mongo re-derive is
required for the **semantic** surface. (Keyword surfaces read Mongo live, so the
code fix alone repairs them — no backfill needed there.)

First `--full` attempt died silently: one find() cursor held open over 4M pages
across slow Supabase writes timed out ("cursor not found"). Hardened to drive
per-book (46K books, sorted, short cursors), restartable via `--after <bookId>`.
Run: `set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-clean-snippets.mjs --full --write`.

## Open / follow-ups

- **Paid re-embed?** ~$170 batch / $340 standard for the translation corpus
  (`gemini-embedding-001`, $0.15/1M std, $0.075/1M batch). Only changes *ranking*
  (a page that matched only via meta words can still rank, but no longer shows
  meta as the quote). **Decide on a retrieval eval, not reflexively.**
- **Atlas index still contains meta** — exclude editorial blocks from the
  `pages` search index so meta-only matches stop ranking at all. Separate change.
- The Munisvara book is already backfilled in prod as the proof case.
