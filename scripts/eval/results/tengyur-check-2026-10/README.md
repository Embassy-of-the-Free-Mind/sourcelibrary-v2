# Tengyur draft: Step C of #5797. $0 repairs, residue lists, tantra pages read by eye

**Repairs** were applied 2026-10-04 08:36–08:51Z by `scripts/maintenance/tengyur-draft-repairs-5497.mjs --leftovers --apply`.
- Each page got one `page_revisions` row (`issue: 5797`, `source: tengyur-draft-repairs-5497`, before and after `content_hash`). There was no retranslation.
- Scope: 187 books and 110,952 translated pages. v74–79 and v194–213 (job tengyur-finish-5497) were skipped, and so was any book with an open `translate_batch_runs` run (there were none, at scan or at write).

| repair | pages |
|---|---|
| false page-final `<unclear>` → "…" | 16,157 |
| Esukhia correction pairs `{a,b}` (105 resolved to `b`; 40 written `a / b` inside notes about the markup) | 137 |
| `<note original: "…">` closed (the last unbalanced note) | 1 |
| **written** | **16,284** (0 skipped) |

- Mirrors were re-synced for 187 books, and 2,687 `page_translations` rows were updated (the other 13,597 pages are not in that table). A verify dry run afterwards found 0 left in all three classes.
- `repairs-applied.json` holds the counts and the 40 most common gap descriptions.

**Listed, not repaired**
- `unclear-words-listed-not-repaired.json`: 3,432 page-final `<unclear>` tags that wrap English words.
- `residue-listed-not-repaired.json`: from the 05:35Z dump, with the same screens as the #5497 05:53Z verdict.
  - 37 pages with ≥ 20 Tibetan characters outside notes;
  - 82 with body text (≥ 12 words) inside an `original:` note;
  - 241 colophon sides whose English omits the ending.

**By eye:** `by-eye-tantra.md`.
