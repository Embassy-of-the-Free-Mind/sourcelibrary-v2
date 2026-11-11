# Metadata reviewer brief (#6056, metadata frame)

PRIOR ART: `REVIEWER.md` — the page-text brief (OCR and English against the image). This one checks the
CATALOGUE RECORD against the book's own front matter instead, so it needs different fields and verdicts.

You check the catalogue record of each book in your packet against the book itself: the title page, the
colophon, and the first leaves. A reader on `/book/<id>` or `/author/<slug>`, and anyone citing the record,
trusts the title, author, date and language shown. Your job is to find where the record says something the
book does not.

## Rules
- **Read-only.** Never write to Mongo, R2, GitHub or any API. You may run read-only node queries
  (`node --env-file=/root/sourcelibrary/.env.production.local`) if you need to look something up.
- **Look at the IMAGE.** The packet gives `front[]` (first 10 reader pages) and `back[]` (last 2) with image
  URLs and the first 600 characters of OCR. The OCR helps you find the title page; the verdict comes from the
  image. Fetch an image with
  `node scripts/eval/spot-check/meta-fetch.mjs <image-url> $JOB_SCRATCH/img/<book_id>/<page>.jpg` and open it
  with the Read tool. If the title page is not in the first 10, fetch further pages: their images are at
  `https://images.sourcelibrary.org/archived/<book_id>/<page>.jpg` for most books, or look the page up in
  `pages` (read-only). Open at least the title page (or first leaf, for a manuscript) and the last leaf.
- Do not guess. If the book does not show a field (no date on the title page, a manuscript with no
  colophon), the verdict is `unverifiable`, not `wrong`. Use outside knowledge only to identify a person or
  work the book itself names (e.g. that "Ioannes Picus Mirandulanus" is Giovanni Pico della Mirandola).
- `language` is the language of THIS EDITION's text, not the work's original language
  (`.claude/docs/invariants/language-fields.md`). A Latin translation of Aristotle is `language: Latin`,
  `original_language: Greek`. A Korean book in literary Chinese is not a mislabel.
- Author: the person who wrote the work. A printer, publisher, editor, translator, commentator, praeses or
  dedicatee in the author field is `wrong` (class `printer-as-author`, `editor-as-author`,
  `translator-as-author`, …). For a dissertation, the praeses is conventionally catalogued as author: note
  it, but mark `ok` unless the title page says the respondent wrote it.
- `author_id`: does `/author/<slug>` (see `author_doc.canonical_name` and `wikidata_id`) name the same
  person the book names? A different person with the same name is `wrong` (class `author-id-wrong-person`).
  Missing `author_id` when the author is a clear named person is `missing`.
- Dates: `published` / `year` is this edition's date. `source_work_dates_meta.edition` should be this
  edition's date; `.work` the work's composition date. A composition date shown as the edition date, a
  reprint dated by the first edition, a Hijri / regnal / era year left unconverted, or a misread Roman
  numeral is `wrong`.
- `work_id`: `work_siblings` are the other books sharing this work_id. `same_author_other_works` are books by
  the same author_id in other works. If a sibling is a different work, `wrong` (class `work-overmerged`). If
  another book is plainly the same work (another edition or volume of it) under a different work_id,
  `wrong` (class `work-split`) and name the book id.
- `pages_count` vs `pages_real` (reader pages with page_number > 0): a mismatch above 2% is `wrong`.
- Title: `title` should transcribe or fairly abbreviate the title page. `display_title` is what many
  surfaces show first. Junk (HTML whitespace, a truncated "...", a search string, another book's title) is
  `wrong`.

## Fields to give a verdict on (every book)
`title`, `display_title`, `author`, `author_id`, `translator`, `editor`, `published`, `year`,
`edition_date` (source_work_dates_meta.edition), `work_date` (source_work_dates_meta.work), `place_published`,
`publisher`, `language`, `original_language`, `languages`, `text_role`, `work_id`, `edition_key`,
`categories` (incl. subjects / faceted_tags if present), `pages_count`.

Verdicts: `ok` · `wrong` · `missing` (empty, and the book clearly shows it) · `unverifiable` · `na`
(field not applicable or absent and not shown).

## Output
Write ONE file, `<round>/reviews/packet-<N>.json`:

```json
{ "packet": N, "reviewer": "opus", "books": [
  { "id": "...", "title_page": { "page": 3, "url": "https://sourcelibrary.org/book/<id>?page=3",
      "reads": "short transcription of the title page (or first leaf)" },
    "last_leaf": { "page": 412, "reads": "colophon / imprint if any" },
    "fields": { "author": { "verdict": "wrong", "catalogued": "Manuzio, Aldo",
        "book_shows": "Jean Bodin", "quote": "DEMONOMANIA ... DI GIO. BODINO", "page": 3,
        "class": "printer-as-author", "severity": "serious|minor", "note": "" },
      "title": { "verdict": "ok" } },
    "notes": "anything else a cataloguer should know" } ] }
```

For every `wrong` or `missing` field, fill `catalogued`, `book_shows`, `quote` (what the page says, as
printed), `page`, `class` (short kebab-case; reuse the names above when they fit) and `severity`
(`serious` = a reader is told the wrong person, date, language or work; `minor` = form, spelling,
abbreviation, a missing secondary field). Be exact in quotes. Your verdicts are pooled with others into
defect rates, so be consistent: do not mark something `wrong` that is a matter of cataloguing style.
