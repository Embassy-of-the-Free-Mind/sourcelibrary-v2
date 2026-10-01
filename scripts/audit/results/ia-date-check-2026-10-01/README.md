# IA date check — results, 2026-10-01 (#5458)

PRIOR ART: none for this question. `scripts/iiif-discovery/classify-candidates.mjs` classifies
the same candidates by collection and script, never by date (searched `scripts/audit`,
`scripts/maintenance`, issues "IA date", `ia_language`, #3307, #2184).

A snapshot. The rules live in `scripts/lib/ia-date-check.mjs` (`ia-date-rules-v3`) and the
runner in `scripts/audit/ia-date-check.mjs`. This directory records what one run found.

**Question.** Of the Internet Archive items we might import as "old", which ones really are old?
"Old" means the scanned object was produced before 1900. Zero AI spend: IA scrape-API metadata
and rules only. Validation was done by eye on page images.

## Files

| file | what |
|---|---|
| `candidates-tables.md` | 1,003,754 `import_candidates` rows (`ia_language`, `discovered`, dated <1900 or undated), by language, provenance and rule |
| `rare-languages.md` | The same rows for the rare languages the acquisition wave (#5457) wants, with old split into pre-1800 and 1800–1899 |
| `validation-labels.jsonl` | 199 items over two rounds: the prediction at draw time, the v3 prediction, and the label **read from image** with its evidence |
| `library-tables.md` | 12,552 books **already in the library** from IA whose free-text `published` reads <1800 |
| `library-books-not-old.tsv` | The 1,678 of those that are not `old`, with reason. Report only; nothing was written to `books` |

## Accuracy, read from image and labelled blind

- **Round 1** (v1, 100 items): modern-vs-old **60/69 = 87%**, which fails the 90% bar. The misses
  traced to four rules: ordinal "Nth edition" read as modern, an ISBN on a CIHM microfiche,
  Shaka/VS-coded DLI Indic years, and DLI pre-1800 dismissal. All four were fixed in v2.
- **Round 2** (99 **new** items): v2 scored **61/68 = 89.7%**. Four of v2's five old→modern misses
  were one family: `ds-legacy-data`, a Digital Scriptorium mirror whose "pages" are screenshots of
  a web catalogue record. That collection holds 5,150 items, and 10 more checked by page hash
  confirm the family (16/16 in all). Adding that one rule gives **v3: 65/68 = 95.6%**, with
  precision **old 30/31**, **modern 35/37**.
- **The `unknown` class really is mixed** (round 2: 8 old, 7 modern, 5 can't-tell).
- **`patron-undated → modern` is a base rate.** It held 25/25 across both rounds. That bucket is
  425K items, mostly Arabic PDF uploads.

## Library books (report only)

10,874 of the 12,552 read `old` (10,863 of them from a library catalogue date). Of the rest:

- **75 are `modern` on hard evidence.** A stated imprint date ≥1900, an ISBN, or a title year: the
  `published` field holds the work's date, not the edition's. Examples are *Kitab al-Hayawan*
  (Cairo 1905), the Loeb Plato (1943) and Galileo's *Two New Sciences* (Macmillan 1914).
- **3 are Digital Scriptorium screenshots** (`ds-legacy-data`; *Ars Notoria* among them). Their page
  images are a web page, not the book.
- **143 are `modern` only by the patron-upload base rate.** Curated books may not share that rate,
  so check those before acting on them.
- **1,460 are `unknown`.** 912 of them are CADAL / Universal Library Chinese scans with no date.
