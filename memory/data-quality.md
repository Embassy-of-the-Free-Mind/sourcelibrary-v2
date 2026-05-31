# Data Quality

Known data issues, maintenance patterns, and quality rules. For thumbnail fixes, see `.claude/docs/thumbnails.md`.

## Current Issues

For current data-quality issues, run `gh issue list --label data-quality --state open` — pinning specific issue numbers here goes stale fast (the four originally listed here — #215, #182, #148, #251 — are all closed as of April 2026).

Tracked under the auto-memory entry [[project-stale-bph-issues-2026-05]] (snapshot 2026-05-15): seven BPH-specific issues where PRs shipped partial fixes but issue bodies read as done — verify residual work before closing.

## id vs _id Distinction (CRITICAL)

App uses `book.id` (not `_id`) for all lookups. Pages' `book_id` matches `book.id`. ~1,186 old books have `id !== _id`. Always use `book.id` in queries. Issues: #215, #218.

## Page Count Caches

`pages_count`, `pages_ocr`, `pages_translated` on books are performance caches. Source of truth: `pages` collection. `translation_percent` is never stored — computed at read time. The old `sync-page-counts` cron has been archived; the endpoint now lives at `/api/admin/sync-page-counts` for manual reruns. Counter sync is the responsibility of any worker that writes to `pages` (see pipeline-ops.md "Critical Rules" — Hetzner workers must call counter sync helpers).

## Data Provenance Rule

ALL enrichment must write `field_provenance`: source, method, confidence, date on every metadata write. No silent writes. Issue #362.

**Record the source's claimed VALUE, not just the writing stage.** `field_provenance.<field>` must store *what each source actually returned* (a `claims: [{source, value}]` array), not only `{source:'import', provider:'internet_archive'}`. Otherwise a wrong value wears a trustworthy badge and nothing can detect that the stored value contradicts its own cited source. **When two source signals disagree, surface the conflict** (`<field>_review: true` + record both claims) instead of silently picking one via a precedence rule. See `src/lib/resolve-language.ts` for the reference pattern. Issues #2184/#2185.

## Lessons Learned

- **Translation tag sanitization (2026-03-15):** Sanitizer fixes unclosed/malformed XML tags in translations. Backfilled.
- **Cover selection algorithm (2026-03-19):** Covers now picked by `detected_images.gallery_quality` score, not just `page_type`. 810 books backfilled.
- **Semantic alignment scoring (2026-03-23):** Embedding-based OCR↔translation quality measurement. Per-page cosine similarity, flag threshold 0.82. Issue #340.
- **Never store `/api/image?url=` as `book.thumbnail` (2026-03-10):** Crashes SSR. Store direct http(s) URLs only.
- **Import language precedence: source beats caller (2026-05-30):** All six import routes set `language` from caller input first, ignoring the source's own metadata — so a caller's "Latin" (the *work* language) overrode IA's `metadata.language:rus` (the scanned *manifestation* = a Russian translation). `language` conflated work-vs-manifestation (FRBR). Fix: `resolveLanguage()` (`src/lib/resolve-language.ts`) lets empirical source signals win the manifestation language; caller becomes `original_language`; conflicts set `language_review`. PR #2198 (boundary) + #2211 (backfilled 11,135 records). Issues #2184/#2185.
- **Don't auto-flip catalogued language from page-OCR (2026-05-30):** page `<lang>` tags have false positives — facsimiles & critical text-editions OCR their Latin/English *apparatus* not the original (Book of Kells, Codex Alexandrinus, Septuagint), and Devanagari serves both Sanskrit and Hindi so Gemini mis-tags Sanskrit as Hindi. The audit (`scripts/maintenance/audit-language-provenance.mjs`, whole-book sampling) + `backfill-language-provenance.mjs` flag candidates; display flips need human triage (`--flip-display` is opt-in). Of 93 flagged, only 32 were confidently corrected; 61 held.
