## 2026-10-04 · Which of the $0 translation cleanups (A2/A3) are safe to apply, and what did applying them change? (#5700)

PRIOR ART: `2026-10-03-quality-census-backfill-sizes-5700.md` sized the classes on one page per book and listed the fixes without applying them. `scripts/lib/translation-text-repair.mjs` (`repairTranslationText`) is the guarded door for an edit to stored translation text (#5624, #5644); `fix-unclosed-note-tags.mjs` and `tengyur-draft-repairs-5497.mjs` use it for a named page list. No script walked the corpus with these classes, and none had a by-eye gate per class.

**Question.** For each cleanup class the census proposed: is the deterministic rule at least 98% clean by eye ((a), (c)) or 95% ((b))? Apply the ones that are; say why the others are not.

**Design.** `measure: count` plus by-eye precision; no model, $0. Script: `scripts/maintenance/translation-cleanup-a2-5700.mjs`, one pure function per class, 31 unit tests on excerpts of real pages. Detectors are the census's own (`scripts/eval/lib/quality-census-detectors.mjs`, moved out of the score script) and `verifyQuote()`.
- **Dry run**: every live translated book, book by book: 21,245 books, 4,939,007 translated pages read.
- **Gate**: 40 seeded pages per class, before/after rendered through the reader's `NotesRenderer`. A rule that failed was tightened and re-judged on a FRESH seed, never on the sample that exposed the fault.
- **Writes**: `translation.data` + `translation.content_hash`, one `page_revisions` row per page (source `cleanup-a2-5700`, the replaced text, before and after hash). `translation.updated_at` is not moved. Human-edited pages are skipped (1 found).

**Result.** Three classes passed and were applied to **277,832 pages in 14,931 books (5.6% of translated pages)**; every write succeeded, none raced.

| class | what it does | by eye | pages | edits | applied |
|---|---|---|---|---|---|
| `a_initial` | `<note>` that only describes a decorative initial → `<meta>` (page-info panel) | **40/40** (65 notes) | 172,737 | 274,069 notes | yes |
| `c_tags` | tag faults repaired by deleting tags only: `<margin></margin>text</margin>` rejoined, empty pairs and orphan closers dropped | **40/40** fresh sample (first sample: 35/40, see below) | 99,556 | 179,434 tags | yes |
| `c_visible` | centre markers the reader printed: `->### HEAD ###<-`, `<-HEAD->`, `.-<`, a second `->` in one block, a `->` nothing closes | **40/40** fresh sample (first sample: 39/40) | 10,442 | 13,982 | yes |
| `a_scan` | scan-condition `<note>` → `<meta>` | **≈ 29/40** | 8,269 | 8,687 notes | **no** |
| `b_original` | drop an `original: "…"` clause whose quote is not on the page | **≈ 27/40** | 12,221 (strict rule) | 16,907 clauses | **no** |

Why the two failed:
- **`a_scan`**: the detector fires on notes the reader needs. Of 40: lead-ins to the text that follows ("The following lines are written upside down…"), truncation notices ("The word is cut off at the page break; the catchword indicates 'dies'"), content ("stained with homicide"), a gloss. Moving those to the info panel leaves the reading text unexplained.
- **`b_original`**, two separate faults:
  1. `absent` from `verifyQuote()` is not absent. On the A1 draw, 302 of 940 `absent` quotes (32%) are on the page under a looser fold: a word broken across lines (`e= lementa`, `equi/ noctiali`), u/v and i/j, a mark of abbreviation (`melãcholicus`), a tag or bold marker inside the word, a long s read as f. Many more are romanisations of a word the page prints in its own script. The 173K-page census figure is mostly this.
  2. A strict guard (Latin-script pages only, no word of the quote on the page or either neighbour, transcription ≥ 400 characters) leaves 12,221 pages, and there the quote really is absent: 62 of the 63 quotes on the 40 sampled pages, all of them on the first 20 pages (the miss: `Phyisck` for `Phyſick`). But deleting it is wrong about a third of the time. The note is usually a gloss or citation with the wrong label: `*Omnes utriusque sexus* <note>original: "All of both sexes"…`, `<note>original: "1 Corinthians 13:12."</note>`, the English meanings in an Irish dictionary. On English-original books it is the source-language term (`tamas`, `hegemonikon`). The fix those want is a relabel, and telling the cases apart needs a reader.

What the first samples caught in the two (c) rules (both fixed before any write):
- `c_tags`: the sanitizer "repairs" a nested note by closing the outer note early, so the rest of an AI note becomes body text (2 of 40); and an `<unclear>` inside a rejoined `<margin>` loses its "?" in the reader (4 of 40). The rule now accepts only a pure deletion of tag tokens, and rejoins only plain-text spans.
- `c_visible`: removing a `->` whose `<-` was three paragraphs on stranded the `<-` (1 of 40). The reader pairs a `->` with the next `<-` anywhere in the page; the rule now reads it the same way.

Left alone on purpose:
- `[Blank page — no translatable content]`: the pipeline's own marker. `page-counts` reads it, and an empty translation would be picked up for retranslation. The fix is in the reader.
- 143,649 pages with a tag fault the deletion-only rule refuses: rejoin across a blank line or around other tags (77,775), tags outside the vocabulary such as `<italic>`/`<center>` (39,087: they carry formatting to map, not delete), a closer that has to be placed (20,940), other (5,847).
- Other brackets, `<header>`/`<page-num>` echoes, `translations.<iso>` editions.

**Checks.** Pilot of 2,982 pages first; 5 fetched from `https://sourcelibrary.org/api/pages/<id>` and `/book/<id>?page=N`: API text clean, the reader's English pane no longer shows the note. After the full run: 400 random written pages each hold the text their revision row's `after_content_hash` names. `--undo` restores a page byte-identically (proved on one pilot page, then re-applied). A second full scan after the run finds `a_initial` on 0 pages, `c_tags` on 2 and `c_visible` on 13: all already-written pages where a doubled marker wants a second pass. Left.

**What reacts downstream.**
- Nothing retranslates or re-embeds: `translation.updated_at` is unchanged, and that is what the translate worker, `embed-gemini` and the `sync-pages-content` cron key on.
- Supabase `pages` mirror: refreshed by `--resync` (233,788 rows updated; on a 2,985-page sample every mirror row now equals Mongo, and 459 pages (15%) have no mirror row at all, which predates this run). The search snippet column (`page_translations.translation`) was NOT rewritten: measured 235 ms/row against 4 ms/row for `pages` (each update re-inserts the row under the HNSW index), so ≈ 11 hours of index churn on the live search table for the 173K initial-note pages. It still holds the note text. `--resync --snippets` does it when wanted.
- Published editions: 137 touched books have an edition (4,598 changed pages). `edition-reader` serves the revision row's text for a versioned URL, so those editions still read as published and report the live page as newer.
- `page_revisions` consumers: the label matches `MAINTENANCE_RE`, so the OCR/translation agreement stack excludes these rows (pinned by a test).
- Rows keyed to the old `translation.content_hash` (`note_claims`, #5647) no longer match the changed pages.

**Replicated?** No. One run. Each passing class has one clean 40-page sample; that bounds the fault rate at about 7% (95% upper bound for 0/40), not at 2%.

**Artifact.** `scripts/maintenance/translation-cleanup-a2-5700.mjs` (`--scan`, `--review`, `--apply`, `--resync`, `--undo`), `tests/unit/translation-cleanup-a2-5700.test.ts`, `scripts/eval/results/a2-cleanup-2026-10/summary.json`. Undo key: `page_revisions.source = 'cleanup-a2-5700'`.
