# Spanish editions — from 4 books to 103, and the /es surfaces to read them (2026-08-20)

## Where things stand
- **103 books / 38,572 pages** carry a Spanish edition in `pages.translations.es` (4 books / 2,237 pages at the start of the day). Spend ≈ $73 at flash-lite list price, realtime ≈ $0.0016–0.0024/page.
- Surfaces, all merged and verified on production: `/es` band → `/es/collections` + `/es/collections/[id]` → `/es/book/[id]` (thin twin) → `/es/book/[id]/page/[pageId]` (reader twin, prefix kept on page turns). PRs #4079, #4086, #4093, #4094.
- Metadata: `books.localized = { es: { title, summary, chapters[] } }`, `collections.localized.es` — one language-keyed map per record, read via `src/lib/localized.ts`, written by `scripts/maintenance/localize-metadata.mjs`. Rules in `.claude/docs/i18n.md` (routed from CLAUDE.md).
- Worker `scripts/workers/es-translate-worker.mjs`: `--top`, `--book`, `--order=pages`, `--pages=@report`, `--strict`, `--ignore-pause` (the #3826 pause is the OCR relight; this pivot only reads finished English).
- Audit→repair loop: `scripts/audit/es-edition-quality.mjs --out=r.json` → worker `--strict --pages=@r.json`. Last run 388/38,572 flagged (1.0%), 28 severe → 27 repaired. 24 pages remain English (guard refusals).
- Publish pass after any run: localize-metadata → `sync-es-collection.mjs` → bump `updated_at` + `sync-books-catalog.mjs` → `POST /api/admin/revalidate` → Cloudflare purge of the four URLs.

## What was learned
1. **A downstream guard is an upstream detector.** The Spanish length guard refused 31 pages; on inspection most were pages whose *English* translation is a runaway (60K–190K chars from ≤3K of OCR — loops and non-repeating run-ons). Filed as #4098 with the 21-page repair list; the detector should become a standing audit.
2. **Audit checks must be relative to the source page.** The first audit measured absolutes (repetition, English share) and flagged 462 pages — every severe sample was a false positive (table repetition the English also has, quoted lemmas in errata). Relative to the English: 130, all real.
3. **Sort before limit changes the SET, not the order.** `--order=pages` applied before `limit(TOP)` made the "top-50 remainder" translate the 50 shortest books in the library. Select by the ranking criterion, then order the run.
4. **Twin routes: segment config must be a literal.** `export { revalidate } from '…'` fails the Turbopack build; `preferredRegion` likewise. Re-export the component, restate the config.
5. **Field declarations live in two files.** `book-docs.mjs` AND `scripts/lib/books-known-fields.json` — the field-write lint reads the latter.
6. **The collection grid is Supabase.** Tagging books in Mongo needs `updated_at` bumped + `sync-books-catalog.mjs`, then ISR revalidation + edge purge, or the page shows "0 books" (memory: `lesson_collection_grid_supabase_sync`).

## Open
- **#4082 phase 2** — `/es/book/[id]` must BE the English page in Spanish (same `BookInfo`, `lang` prop, strings extracted). A separate session (`es-book-parity` worktree) has started on it.
- **#4095** — findability: Supabase sibling table `page_texts(page_id, lang, …)`, `embed-gemini --lang`, `/api/search lang=es`, MCP `lang`, exports. Separate session.
- **#4098** — runaway English pages (detector + `translate-worker --pages` repair mode + write-path guard).
- Maya acquisitions (hidden, OCR submitted): Ximénez Popol Vuh ms `6a87106327fd08cecf145caa`, Scherzer 1857 `6a871012e4a1289bccee2c58`, Chilam Balam de Kaua `6a87102131598d129803de7b`, Brinton 1882 `6a87102c31598d129803deba`; Means `69e41fc14fc48a88423e098b`. Need English translation (line paused) → QA → visible → Spanish worker.
- Proposed, not built: native-speaker `spanish-edition` review queue on the volunteer review system; a curated Spanish collection around Ficino/Neoplatonism + the codices.
