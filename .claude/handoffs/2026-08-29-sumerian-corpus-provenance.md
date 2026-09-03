# Sumerian corpus editions: provenance, witness images, collection grid — 2026-08-29

Session: `corpus-provenance` worktree. All work MERGED and DEPLOYED (PR #4352, squash
`0e0a8a04`), prod verified. Issue #4350 closed by the PR; #4351 (copyright) closed by ops
action.

## What shipped (PR #4352)

356 of 378 visible `sumerian-mesopotamian` books are ETCSL corpus text editions
(`ocr.source:'corpus'`, `ocr.model:'etcsl-corpus'`) with ZERO page images; the ETCSL
English is the corpus editors' **human scholarly translation**, not AI. Three surfaces
lied about them:

1. **`PagesGrid.tsx`** shimmer-forever for imageless pages → static text-page card, or
   CDLI witness-tablet photos cycled across cards (`fallbackImages` prop from the book
   page; subtitle names them as witnesses via `textEditionWitnesses`).
2. **Reader2C scan pane** (desktop + mobile) → witness photo stands in, header "Tablet
   witness", caption bar (designation · museum · CDLI link · "text follows the ETCSL
   edition — not read from this photograph"), carousel across witnesses. Zoom tiers:
   1600px at rest, 4000px past 1.5× (`srcOverride`/`nativeSrcOverride` on `ScanViewer`),
   lightbox enabled for witness pages. `cdli.earth` added to the `/api/image` proxy
   allowlist (originals are ~24MB; never serve raw).
3. **Info panel "How this page was made"** → corpus branch on all three rows + notices
   (`src/lib/text-provenance.ts` — registry: `etcsl-corpus`, `oraec-corpus`, generic
   `*-corpus` fallback). `'corpus'` added to the `ContentSource` union. Corpus chip on
   the translation pane. All strings en + es.
4. **`CollectionAllBooks`** — new `all_books_default_view` collection-doc field
   overrides the >200-books list default. Set to `'grid'` on `sumerian-mesopotamian` +
   its 4 genre subs (which already held 366/377 books — organization existed, just
   rendered as a text table).

## Ops actions (prod data, no PR)

- **Copyright hide** — `inannas-descent-to-the-netherworld-a-centennial-survey`
  (modern scholarly work, reader feedback): Mongo `visible:false + hidden:true`,
  `hidden_reason: 'copyright — … (#4351)'`, 57 `gallery_images` rows
  `book_visible:false`, Supabase `books_catalog` direct update, ISR revalidate (7
  paths) + CF purge. Verified 404. Swept the other 377 books: only Thompson's *Epic of
  Gilgamish* (1930) — US-PD since 2026-01-01, left live.
- **Sub-collection card covers** — moved/added a cuneiform image to
  `featured_images[0]` on `myths-epics` (Yale Gilgamesh tablet), `divine-hymns`
  (tablet photo), `wisdom-debate-literature` (Sun-god Tablet of Nabu-apla-iddina, from
  Rogers 1912, PD). Machine-picked bookplates/Greek vases were fronting Mesopotamian
  genre cards.
- The three 2026-08-29 feedback rows marked `read` (not `addressed` — that path
  emails).

## Open threads

- **ATF ground truth unused** (#4350 comment): single-tablet CDLI books (e.g. BAM
  6,555) are genuinely AI-read from the photo; scholarly ATF sits in
  `books.metadata.atf_ground_truth`. Surfacing it (comparison pane or preferred text)
  would answer "was this really read from the image?" with evidence.
- **99 Sumerian books have no cover and no photo-bearing witnesses** — typographic
  cards, acceptable.
- **Stranded worktrees** (reaper kept for real uncommitted work, no live session):
  `feat+corpus-dataset` (blog page + corpus data), `feat-lexicon-lookup`
  (lexicon output). Need commit-or-discard by a human.

## Gotchas learned

- Preview deployments 403 book content to anonymous curl — send
  `Authorization: Bearer $CRON_SECRET` (also in private memory).
- `/api/admin/revalidate` auth header is `x-revalidate-secret`; prod accepts
  `$CRON_SECRET` as its value.
- `books_catalog` key column is `id` (not `book_id`).
