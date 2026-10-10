---
stage: translation
measure: count
languages: []
scripts: []
canons: []
n_books: 9244
n_pages: 72880
verdict: "The read-time leaked-markup repair was applied to the stored English of 72,880 pages in 9,244 books; on 300 sampled pages the reader output is identical before and after."
status: adopted
decision: "applied to Mongo and the Supabase pages mirror with page_revisions undo rows; search snippet column left out (Derek, 2026-10-10, #5700)"
superseded_by: null
issue: 5700
---
## 2026-10-10 · What did applying the read-time leaked-markup repair to stored translations change? (#5700 A2)

PRIOR ART: `2026-10-06-leaked-markup-census-5700.md` measured the leak classes and shipped the read-time rule (`scripts/lib/leaked-markup.mjs`, #5933); it proposed this stored-text run and did not make it. `2026-10-04-a2-cleanup-applied-5700.md` and `2026-10-06-term-definition-cleanup-applied-5901.md` are the procedure followed here (scan, reader-rendered check, apply through `repairTranslationText`, resync, undo), and their script gains one class.

**Question.** The reader, the quote surfaces and the exports repair leaked markup at read time since #5933. The search snippet column, the embeddings and the native apps read stored text and still carried it. Does the same function, applied to stored text, leave the reader's output unchanged, and how many pages does it change?

**Design.** `measure: count`; no model, $0.
- **One rule, one copy.** Class `e_leak` of `scripts/maintenance/translation-cleanup-a2-5700.mjs` calls `repairLeakedMarkup(text)` in its reader form: `&nbsp;` becomes a no-break space, not a collapsed space.
- **Scan**: every translated page (`page_number ≥ 0`) of every live translated book: 23,256 books, 5,389,013 pages.
- **Check before the write**: 300 seeded candidate pages rendered through `NotesRenderer`, stored text against repaired text.
- **Writes**: `translation.data` + `translation.content_hash`, one `page_revisions` row first (source `cleanup-markup-5700`, the replaced text, both hashes). `translation.updated_at` not moved, so no worker reacts. Human-edited pages skipped (1).

**Result.**

| | pages | books |
|---|---:|---:|
| changed by the repair | 72,880 (1.35%) | 9,244 |
| census of 2026-10-06, same rule | 72,191 | 9,002 |

The 689 extra pages are translations written since the census (331 more live translated books).

| rule | pages |
|---|---:|
| `hash_close` | 21,286 |
| `entity` | 20,547 |
| `dup_term` | 14,270 |
| `hash` | 9,415 |
| `meta_label` | 6,008 |
| `break_tag` | 1,343 |
| `tag_attr` | 798 |
| `meta_attr` | 12 |
| `stutter` | 2 |

Pages overlap. 1,351,773 single repairs in all, nearly all of them `&nbsp;`.

- **Reader output: identical on 300 of 300** sampled pages, before against after. Expected, since the reader already applied the rule; it confirms the stored form and the read-time form agree.
- **Applied**: 72,880 written, 0 skipped, 0 errors. 72,880 `page_revisions` rows.
- **Supabase `pages` mirror**: 66,449 of the pages have a mirror row; 66,447 were rewritten and a 3,037-page sample of them equals Mongo on every row found (2,767 of 2,767). The other 6,431 pages have no row in the mirror.
- **Not written**: the `translation` column of `page_translations` (the search snippet), by decision. It still carries the old text; at 235 ms a row it is a separate run. Embedding vectors are not recomputed.

**Undo.** `node scripts/maintenance/translation-cleanup-a2-5700.mjs --undo --classes e_leak --dir <dir with applied.jsonl>` restores each page that still holds the text this run wrote. `applied.jsonl` is on the cloudlayer box under `/data/scratch/sl/jobs/decisions-data/markup/`; without it, `--ids` takes page ids from `page_revisions` rows with source `cleanup-markup-5700`.

**Replicated?** No second run. The by-eye precision of each rule is the census's (one draw per rule). The 300-page render check is one seeded draw.

**Artifact.** `scripts/maintenance/translation-cleanup-a2-5700.mjs` (class `e_leak`).
