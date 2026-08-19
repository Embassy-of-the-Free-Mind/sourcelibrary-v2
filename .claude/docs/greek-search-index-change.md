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

## Risk — measured, not assumed

**The rebuild does not take search down.** Tested 2026-08-06 on a throwaway
collection (3,000 docs, its own index), never on `books`: the definition was
updated to add an analyzer and a mapped field, and a query was fired every ~3
seconds throughout. **17 of 17 samples returned results.** Status went
`BUILDING` for ~58s then `READY`, and the newly mapped field was queryable
immediately after. Atlas keeps the previous generation serving while the new one
builds.

Script: `_tmp-index-risk.mjs` pattern — recreate if you want to re-verify on a
future Atlas version rather than trusting this note.

Remaining risks, in order:

1. **`updateSearchIndex` replaces the WHOLE definition.** Omit a field and its
   mapping is silently dropped — `books_search` has twelve. Build the new
   definition programmatically from the live one (read it, add to it, write it
   back); never hand-author it. Assert the field count went 12 → 13, not 12 → 1.
2. **Take a backup of the live definition first.** Recovery is re-applying it,
   and the same no-downtime property makes rollback safe.
3. **Relevance shifts slightly** once `name_forms` joins the `should` clauses,
   because scores renormalise. `name_forms` holds only Greek, so a Latin query
   cannot match it — but re-run the five-query check in
   `scripts/audit/greek-name-search.mjs` plus a Latin regression before and after.
4. The data write is independent and already reversible (`--unset --apply`).

## Not in scope

- **Greek work titles** (`Ἠθικὰ Νικομάχεια`, `Πολιτεία`). Same mechanism, larger
  curation job, and the Perseus catalog cannot supply them — its labels are
  English (`label-eng`).
- Arabic and Hebrew name forms. The corpus holds both; the same argument applies
  and `icuFolding` handles them too.
- The list in `classical-name-forms.ts` **wants review by someone who reads
  Greek** before being treated as authoritative.
