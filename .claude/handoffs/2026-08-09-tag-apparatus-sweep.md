# Tag apparatus sweep: reader fix, embedding leak, census, v13 plan — 2026-08-09

Started from one screenshot ("is this aligned?") of a garbled Vitruvius page and
ended as a full audit of the annotation-tag system. Everything shipped or filed;
one free remediation job still running at session end.

## Shipped

- **#3811 / PR #3813 (merged, deployed):** with Notes off, `preprocessTerms` in
  `NotesRenderer` deleted inline `<term>+<note>` pairs *including the term content* —
  sentences with holes on ~7% of translated pages. Now only whole glossary lines
  (nothing but pairs + separators) are dropped; inline terms unwrap. Regression
  tests use the real Vitruvius page (`6949af986ef4a68b726b8008`) as fixture.
- **#3820 / PR #3821 (merged, deployed):** four surfaces carried private (mostly
  4-tag) strip lists, so `<image-desc>`/`<warning>`/`<scan-quality>` content was
  embedded and stored as quotable snippets. `page-embedding-text.mjs` (the ONE
  composer), `backfill-clean-snippets.mjs`, `librarian-search.ts`, and
  `semantic-alignment.ts` now route through `stripEditorialWrappers`; `lang` alias
  added to `EDITORIAL_WRAPPERS` in both twins. New test:
  `tests/unit/page-embedding-text.test.ts`.
- **Data fix:** page 95 of *Ten Books on Architecture* (1522,
  `6949af986ef4a68b726b7fa9`) re-translated through translate-core (old v2-prompt
  output echoed OCR `**` and a translated `<vocab>` list). ~$0.001, only paid call
  of the session.

## Running at session end

**Snippet re-backfill** (`backfill-clean-snippets.mjs --full --write`, $0, no
Gemini): re-derives all ~104K books' Supabase snippet columns with the fixed
stripper. First attempt died at 5,400 books (transient Atlas DNS `ENOTFOUND`;
11,713 rows already rewritten, zero errors). Relaunched under a bounded retry
wrapper (20 attempts, 60s apart; job is idempotent — restarts fast-scan the clean
prefix). Log:
`/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/fd520055-e283-4581-b10e-972bbd4c2e7f/scratchpad/snippet-backfill.log`
— wrapper script + watch script beside it. **The job's cwd is the
`fix-embedding-tag-leak` worktree, which keeps that worktree occupied until it
finishes; the next `/gnite` reaps it.** If the log's last line is `=== GAVE UP ===`,
relaunch the wrapper; progress is never lost.

## Filed with evidence (ready to pick up)

- **#3822** — DTS document API serves raw annotation tags; only public text
  surface bypassing `stripEditorialWrappers`. Two-line minimal fix; TEI mapping is
  the ideal version.
- **#3825** — Translation prompt v13 plan. Carries the full tag census (20K-page
  random sample per side: ~30 real tags in 3 layers + 60-83 invented junk tags per
  side; `heading`/`footnote`/`caption` are write-only and dead) and the consumer
  sweep (~60 files, five disagreeing strip lists). Five concrete prompt changes;
  process guardrails (seed non-default, scorecard v12-vs-v13 before flipping,
  same-PR consumer check). Comments add: `<del>`/`<foreign>` as vocabulary
  candidates mined from the invented-tag tail, and search-as-fourth-consumer
  (Atlas keyword search indexes raw `translation.data`/`ocr.data`, so fabricated
  `original:` phrases are searchable — field-per-layer indexing is the fix).
- **#3828** — Three-layer quote apparatus (original + romanized + translation).
  Measured: 48.9% of Greek OCR pages (231,401/473,248, 1,125 visible books)
  already have `transliteration.data`. v1 = serve-when-present in the quote route
  + MCP; the ~242K-page backfill is a separate sized decision.

## Deliberately NOT done (cost decisions parked)

- **Vector re-embed** after the snippet fix — paid; measure how many vectors
  materially change first (#3821 body).
- **Greek transliteration backfill** (~242K pages) — paid; #3828 has the numbers.

## Lessons already recorded

- Auto-memory + CLAUDE.md amendment (this PR): the Vercel PR check can stay
  "fail" permanently even when the retry build succeeded — judge by
  `npx vercel ls`, not the check (PR #3813 merged green that way).
- The `<image-desc>` leak was worst exactly where nobody reads yet: untranslated
  books embed OCR as fallback, and OCR carries `<image-desc>` on 18.4% of pages
  vs 1.8% in translations — semantic search is the only discovery path for those
  books, and it was the polluted one.
