# Making Greek names searchable — the staged index change

**Status: STAGED, NOT APPLIED.** The data is written; the index change is not.
Applying it touches live search for every user, so it is deliberately a separate,
explicit act.

## The problem, measured

2026-08-06, against production:

- **1,151 Greek-language live books. Zero** carry Greek script in `title`,
  `display_title`, `english_title`, `original_title` or `author`. The only 20
  exceptions are the literal placeholder `[Greek: Omilia]`.
- **4,825 records in the `authors` thesaurus. Zero** Greek name forms — though
  Plato carries 17 Latin/English variants and Aristotle 23.
- So `Πλάτων` → 0 results, `Ἀριστοτέλης` → 0, while `Platonis` → 63 and
  `Aristotelis` → 141.

This is not a search failure. Greek *inside* the books is findable — the `pages`
index maps `ocr`, and the OCR carries real Greek (`ἀρετή` → 16 passages, `ψυχή`
→ 13, `λόγος` → 20). The books are Greek; the catalogue cards are entirely Latin
and English. A classicist's first instinct is to search in Greek, and the
catalogue answers with silence.

## What is already done

`scripts/maintenance/backfill-name-forms.mjs --apply` writes `name_forms` (an
array of Greek forms) onto **1,091 classical books**, sourced from
`src/lib/classical-name-forms.ts`. Reversible with `--unset --apply`.

That write is inert on its own: `books_search` is `dynamic: false`, so an
unmapped field is invisible to search.

## The change

Two edits to the `books_search` definition. **Preserve everything else exactly** —
`updateSearchIndex` replaces the whole document, so a partial definition silently
drops the other twelve mapped fields. A backup of the current definition should be
taken first.

**1. Add an analyzer.** The existing `standard_diacritic` is standard tokenizer +
`lowercase` + `asciiFolding`. ASCII folding maps only *Latin* accented
characters; Greek passes through untouched. Under it `Πλάτων` matches and
`πλατων` does not — which is worse than not shipping, because it works for
whoever tests it with a copy-pasted polytonic string and fails for every real
user.

```json
{
  "name": "greek_folding",
  "tokenizer": { "type": "standard" },
  "tokenFilters": [{ "type": "icuFolding" }, { "type": "lowercase" }]
}
```

**2. Map the field.**

```json
"name_forms": [
  { "type": "string", "analyzer": "greek_folding", "searchAnalyzer": "greek_folding" }
]
```

Then add `name_forms` to the `should` clauses in
`src/lib/atlas-search.ts` — boost around 5, matching `author`, since a name form
is an author signal.

## Verification

`node scripts/audit/greek-name-search.mjs` — expected to fail on every row now,
and to pass on all seven after. The unaccented and uppercase rows are the real
test: they are what `icuFolding` buys and `asciiFolding` cannot.

## Proven before staging

Run on a throwaway index `books_search_greek_test` on 2026-08-06 over 414 books:
`Πλάτων`, `πλατων` and `ΠΛΑΤΩΝ` all returned Plato; `Ἀριστοτέλης` and
`αριστοτελης` both returned Aristotle. Build took ~2.5 minutes over 19K books.
The test index was dropped and the test field removed afterwards.

## Risk

- `updateSearchIndex` rebuilds. **Confirm Atlas keeps serving the previous
  generation during the rebuild before running this in the day** — the ~2.5
  minute build above was for a new index, not a replacement, so it is not
  evidence either way.
- Recovery is to re-apply the backed-up definition.
- The data write is independent and already reversible.

## Not in scope

- **Greek work titles** (`Ἠθικὰ Νικομάχεια`, `Πολιτεία`). Same mechanism, larger
  curation job, and the Perseus catalog cannot supply them — its labels are
  English (`label-eng`).
- Arabic and Hebrew name forms. The corpus holds both; the same argument applies
  and `icuFolding` handles them too.
- The list in `classical-name-forms.ts` **wants review by someone who reads
  Greek** before being treated as authoritative.
