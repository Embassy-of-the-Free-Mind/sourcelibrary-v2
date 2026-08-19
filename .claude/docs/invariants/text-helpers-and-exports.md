# A text helper is scoped to its consumers, not to its name

**Read this when:** Reusing a text helper on a new surface, building an export (PDF/corpus/`/text`), or touching the OCR `<page-type>` vocabulary.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

Lessons from 2026-08-04 (#3580/#3598/#3620). The handoff this section originally cited
(`2026-08-04-export-surfaces-and-unreachable-page-types.md`) was never written — the
issues above are the record, and the text below is the whole lesson.

`stripEditorialWrappers()` flattens GFM tables (`| 1 | 23 |` → `1  23`). That is
**correct** for the snippet/quote/search surfaces it was written for, and its own
comment says so: *"Only the snippet/quote path routes through here."* Three
surfaces that serve a page's **whole text for reuse** reached for it anyway — the
PDF exporter (added months later), `/api/books/[id]/text` (what AI clients and
licensees read), and `build-corpus-snapshot.mjs` (the distributed dataset).

Flattening keeps every cell **value** and discards the **column** it belonged to.
148 of 366 pages of one manuscript are tables (13,949 cells), and it fails
silently because the output reads as ordinary prose.

- **Before reusing a text helper, read its comment for who it was written for,
  then ask whether your surface is that.** "Serves an excerpt" and "serves the
  artifact" are different contracts. A new consumer of an old helper is the
  moment to check, and nothing else will flag it.
- **Widen behaviour by an opt-IN parameter, never by changing the default.**
  `{ keepTables }` left ~40 existing callers byte-identical; flipping the default
  would have silently changed every snippet in the product.
- **Verify an export by RENDERING it and looking.** Generating a real PDF threw
  immediately (`unsupported number: undefined` — OCR tables are *ragged*, and
  pdfkit dies on any cell past the widest declared row); rasterising then showed
  an Arabic line-indent regression. Neither was visible to a green suite, because
  every fixture was rectangular and single-line. Same discipline as the
  curl-the-served-HTML rule (`rendering-and-seo.md`): a passing test is not a rendered artifact.
- **A value nothing can PRODUCE looks identical to a value nothing needs.**
  `NotesRenderer`'s `DESCRIPTION_ONLY_PAGE_TYPES` handled `cover`,
  `musical-score` and `table`; the OCR prompt's `<page-type>` enum never offered
  them, so all three sat at **zero pages** while the other five carried
  4,927–210,023. Kircher's *Musurgia Universalis* had every engraved-music page
  typed `text` — translated as prose (paid) and rendered without its branch —
  while the OCR's own note read "consists entirely of musical notation". The
  inverse of the `reading_history.referrer` rule (`measurement-instruments.md`); both are invisible from
  either side alone. Pinned by `tests/unit/page-type-vocabulary.test.ts`.
- **A read-time regex cannot recover a distinction the writer never encoded.**
  Four predicates were measured for "blank pages that aren't blank" and "`<note>`
  holding a page description"; three were rejected as worse than useless (they
  caught ProQuest boilerplate, library stamps and `<page-num>17</page-num>`). The
  one that shipped is **definitional, not statistical** — a gloss annotates text,
  so a `<note>` on a page with no body text cannot be one. When no clean
  predicate exists, ship a detector and fix the write side (#3591); do not ship a
  heuristic that strips reader-visible content on a few points of signal.
- **Never buffer a whole book to build one artifact.** Awaiting every page image
  before writing left a "streamed" response silent for the entire fetch (past
  Cloudflare's ~100s window) with every image resident. `streamOrdered()`
  (`src/lib/ordered-stream.ts`) yields in input order with a bounded look-ahead.
  And when an artifact must be truncated, **say so inside the artifact** — a
  partial edition that doesn't admit it is worse than an error.
- **A fix to a duplicated surface is a fix to one copy.** The download route has a
  tenant twin (`/api/[tenant]/books/[id]/download`) that is not parity-tested, and
  every lesson in this file landed on the global copy only. Measured 2026-08-11:
  388 diff lines, with the tenant copy still deleting transcribed `<margin>`
  content under notes-off (#3870, the reader's own #3811 bug), resolving three of
  four image formats from raw `photo` (the uncropped spread on split pages),
  fetching unbounded or serially, buffering the whole zip, awaiting every image
  before writing a byte, running with no `maxDuration`, and labelling a truncated
  facsimile a complete edition. **None of it errors** — a wrong image is a valid
  JPEG, a serial fetch is merely slow until Cloudflare 524s it. Ported and shared
  in #3908/#3914 (`src/lib/notes-off.ts`, `export-markdown-html.ts`,
  `export-page-images.ts`; drift 388 → 175 lines). Before fixing anything here,
  `git grep` for a twin, and prefer *extracting* the rule over patching both — a
  shared module cannot drift, a convention always does. Pinned by
  `tests/unit/notes-off.test.ts` and `tests/unit/download-route-parity.test.ts`,
  whose guards were each verified firing against the pre-fix files.
