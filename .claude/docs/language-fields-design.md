# Language fields: codes canonical, one vocabulary, label derived

PRIOR ART: .claude/docs/invariants/language-fields.md — the invariant doc; it owns the incidents, the edition-vs-source rule and the evidence ranking, and it already made the normaliser singular (PR #4700), but it has no canonical form, no single writer, no named views and no standing audit. src/lib/language-normalize.ts + scripts/lib/language-normalize.mjs — the pinned twin this design EXTENDS (no new `language.mjs`). #4711 — the closed-vocabulary proposal (plan only, never signed off); its five points are steps 1, 4, 5 and 7 below. #3893 (Supabase rows), #4089 (bilingual read path), #4117 (page-tag detector), #4654 (no safe automatic repair) each fixed or scoped one slice. Sibling design: `.claude/docs/translation-state.md` (#3402), same shape.

**Read this when:** adding a language filter, facet, count or badge; routing OCR or translation by language; writing `language`, `languages`, `original_language` or anything derived from them; adding a language list or map anywhere in the repo; or mapping between an edition language and a UI locale.

**Status:** design, 2026-09-30. Tracking issue #5304, umbrella #5302; the migration steps are the issues linked from #5304. Until step 4 lands, the stored fields under "What is there today" are what exists, and the invariant doc's rules stay binding as written.

---

## Who reads a language, and what breaks their trust

1. **A reader browsing or filtering by language** (`/languages`, search facets, the language pill on a card, collection filters). `English`, `English.`, `English and Hebrew` and `Irish/English` must be one filter value and one facet row, not four. A facet built on the raw string is a list of 230 values for 139 languages.
2. **The pipeline choosing an engine.** OCR routing keys on the label through an allowlist; a wrong value costs money and produces confident nonsense (Malay in Jawi script garbled on lite; Syriac filed as Hebrew, #4766).
3. **A scholar or funder asking "how many languages, which ones".** The homepage number comes from one tokeniser; `/api/languages`, the platform stats and the BPH stats each use another. On 2026-09-30 the homepage tokeniser counts **117** live languages and the pinned normaliser counts **139** over the same 230 labels.
4. **Detectors and the evidence lane.** The page-level `<language>` tag is the only signal at page grain (Syriac mixed pages, #4883; the 1.6% record-vs-pages contradictions in the invariant doc) and nothing reconciles it with the book.

One vocabulary serves all four. Surfaces may choose **which view** to show. They may not tokenise the label themselves.

## What is there today (measured 2026-09-30, `bookstore.books`, live = `visible: true && pages_count > 0`)

| | all | live |
|---|---:|---:|
| books | 117,152 | 42,009 |
| distinct `language` strings | 491 | 230 |
| label parses to one language | 90,767 | 41,650 |
| label parses to two or more | 782 | 262 |
| label parses to none (`Unknown`, `auto-detect`, `Multiple`, `und`, `zxx`, `Visual`) | 25,603 | 97 |
| `languages[]` **missing** | 68,299 | **23,865** |
| `languages[]` empty | 24,389 | 86 |
| `languages[]` with more than one entry | 271 | 246 |
| `languages[0]` ≠ raw `language` | 904 | 841 |
| `original_language` present | 8,528 | 3,179 |
| …and a different language from the edition | 1,069 | 795 |

Every one of the 24,767 elements stored in `languages[]` is a **name** (`"Latin"`), none a code. The array is missing on 57% of live books: the "45,675 books" in the invariant doc were counted before the corpus doubled.

The pinned normaliser has one real defect, and it is the reason a vocabulary has to be **closed**: anything it does not recognise is title-cased into a language. Over the live labels that yields `E` (8 books), `Ne` (6), `And Judeo` (5), `And Aramaic` (4), `Anglo` + `Saxon` (3, from `Anglo-Saxon` split on the hyphen), `Multiple (hebrew`, `Some Hebrew`, `Text On Maps In Latin`, `Latin. French. English`, `Lb`, `Am`, `An`, `Den`, `Roa`: about 22 junk atoms on at most 46 live books. Small, but every one of them is a facet row and a stats count.

## The canonical form

**Two ordered arrays of ISO 639-3 codes on `books`. The display string is derived from them.**

| field | meaning | example: Ficino's Latin *De mysteriis* | example: a facing-page Greek–Latin Aldine |
|---|---|---|---|
| `languages[]` | the EDITION's languages, as printed on these leaves. First = principal. Never empty on a text book. | `['lat']` | `['grc', 'lat']` |
| `source_languages[]` | the language(s) the work was composed in, when the edition is a translation. Empty = the edition is in its own source language. | `['grc']` | `[]` |
| `language` | display string, **derived**: `displayLabel(languages, 'en')` | `Latin` | `Greek and Latin` |
| `original_language` | display string, **derived** from `source_languages[]` during migration; removed in step 8 | `Greek` | — |

Rules of the form:

- **Bare three-letter codes, lower case, no script subtag.** Codes are what Mongo filters on (`{ languages: 'lat' }`, indexable, exact) and what Supabase mirrors. A script subtag (`msa-Arab`) would break every equality query for a distinction almost no surface needs. The routing problem it would solve is handled by the vocabulary instead (see `routing_lane` below).
- **`zxx` = no linguistic content** (artwork, plates). **`und` = undetermined**, and it is a queue, not a value: a live text book on `und` shows up in the audit. `mul` is never stored; list the languages.
- **Order is meaning.** `languages[0]` is the language a reader would say the book is "in". Ordering the rest follows the invariant doc (measured page share); the principal language is a curatorial call and the page tags are evidence that something is missing, never that the order is backwards (the Popol Vuh rule).
- **The edition-vs-source rule is unchanged, now structural.** An English translation of Li Po is `languages: ['eng'], source_languages: ['lzh']`. The 547-book near-miss happened because one scalar was asked to carry both answers; two arrays cannot be confused by a sweep that reads the field name. The `text_role` gate still applies to any write that moves a code between the two arrays.
- **Codes may be finer than the comparison policy.** The normaliser's policy that Ancient and Modern Greek are one language (and Classical and modern Chinese, and the Koine/Attic variants) stays a policy of **comparison**: `grc` and `ell` share a family, `zho` and `lzh` share a family, and every "same language?" question goes through the family. Stored codes default to the historical form this corpus is made of: `Greek` → `grc`, `Chinese` → `zho` unless catalogued Classical (`lzh`). Distinct languages stay distinct codes: `ang` Old English, `enm` Middle English, `gmh` Middle High German, `fro` Old French, `chu` Church Slavonic, `ota` Ottoman Turkish, `jrb` Judeo-Arabic.
- **A code outside the vocabulary cannot be written.** If the vocabulary does not know a language, the fix is a PR that adds a row, never a free-text value.

`language_multi`, `language_raw` (the normaliser sweep's idempotence guard, live) and `field_provenance.language` stay as they are. No other language column is added. Net field effect after step 8: `source_languages` in, `original_language` out.

## One vocabulary, one normaliser

Extend the pinned twin (`src/lib/language-normalize.ts` ↔ `scripts/lib/language-normalize.mjs`). Do not add a sixth file.

**The table.** One row per language, the single source every map in the repo is generated from:

```
{ code: 'grc', name: 'Greek', family: 'Greek', script: 'Grek',
  bcp47: 'grc', iso1: null, marc: ['gre', 'grc'], aliases: ['ancient greek', 'attic', 'koine', 'hellenistic', ...],
  lite_ocr: false, ambiguous_script: false }
```

- `name` is the English display name and the only spelling `displayLabel(…, 'en')` emits. Localised display names come from `Intl.DisplayNames` keyed on `bcp47`, falling back to `name` (historical stages have no CLDR name).
- `script` is the **default** ISO 15924 script. `ambiguous_script: true` marks languages whose holdings are regularly in more than one script (Malay: Latin and Jawi; Sanskrit: Devanagari, Tibetan, Sharada, Grantha, romanised; Ottoman Turkish vs Turkish; Javanese; Yiddish transliterations). These can never be in the lite allowlist; the router cannot know the script from the code.
- `lite_ocr: true` is the OCR allowlist, now a column of the table instead of a hand-kept set in `translate-core.mjs` and `ai-models.ts`. The measured per-language verdicts (#5090, `scripts/eval/per-language-suitability.mjs`) update this column by PR.
- `marc` and `aliases` absorb every private map listed in the inventory (`LANG_MAP` in six importers, `LANG_CODES` in three IIIF/DTS routes, `LANGUAGE_NORMALIZATION` in `/api/languages`, `ALIAS` in `lang-tally.mjs`, `LANG_ISO` in the eval scripts, `SOURCE_LANGUAGE_ALIASES`).

**The functions** (both twins, parity-tested):

| function | returns | replaces |
|---|---|---|
| `toLanguageCodes(raw)` | `{ codes: string[], unresolved: string[] }` — ordered, de-duplicated; unrecognised fragments go to `unresolved`, never into `codes` | `parseLanguageField`'s title-case fallthrough |
| `languageCode(token)` | one code or `null` | `normalizeLanguageToken` (kept as `languageName(languageCode(t))` for callers that want a name) |
| `languageName(code, locale = 'en')` | display name | `displayLanguage`, `CODE_TO_NAME`, `CODE3_TO_NAME`, `LANGUAGE_NAMES_ES`, `TARGET_LANGUAGE_NAMES` |
| `languageFamily(code)` / `sameLanguage(a, b)` | family code / boolean — normalise first, then compare families | `languageFamily`, `sameLanguageFamily`, `sameLanguage` on names |
| `toBcp47(code)` / `fromLocale(locale)` | `'la'` ↔ `'lat'` | `languageToBcp47` in `language-code.ts`, `LANG_CODES` in the IIIF/DTS routes, `scholarly-typst.mjs` `LANG_CODES` |
| `displayLabel(codes, locale = 'en')` | `'Greek and Latin'` | hand-written compound labels |

The existing split rules carry over from `parseLanguageField` (`,` `;` `/` ` and ` ` & `, hyphen only when every half resolves; never split `N/A`), plus two cases the measurement found: `. ` between capitalised names (`Latin. French. English`) and a leading `and ` fragment (`Hebrew, and Judeo-Arabic`). The OCR page tag goes through the same `toLanguageCodes`; its extra noise (`sanskrit (transliterated)`, bare `de`, `None`) is already in the alias and placeholder sets.

## One writer

- **`languageFieldsPatch(codes, { sourceCodes, provenance })`** in the twin returns the complete `$set` fragment: `languages`, `language` (= `displayLabel(codes)`), `language_multi` (= `codes.length > 1`), `source_languages`, `original_language` (derived, until step 8), and the `field_provenance.language` entry in the typed shape `resolve-language.ts` defines. It throws on an empty array for a text book, on a code outside the vocabulary, and on `mul`.
- **Every book-creating path calls it.** Today 82 files create books (`insertBookIfNew`, `books.insertOne/insertMany`); **6** of them run the language through the resolver or normaliser, plus the 11 `/api/import/*` routes that go through `resolveLanguage`. The import door is `resolveLanguage` (TS) and `resolveIaLanguage` (mjs): both end in `languageFieldsPatch`, and `insertBookIfNew` rejects a document whose language fields were not produced by it (the patch stamps `field_provenance.language.writer: 'languageFieldsPatch'`, and the gate checks the stamp — the same "the check runs where the value is written" pattern as `assertBookScopedKey`).
- **Corrections are proposals.** The detector lane (`detect-book-languages.mjs`, `detect-language-from-pages.mjs`, `relabel-bilingual-edition.mjs`, `language-review-triage.mjs`) may write a proposal row; a change to a live book's codes goes through `languageFieldsPatch` **with a `sweep_log` row per book** (`field-sprawl.md`). The two-instrument rule from #4781 stays: a public language write needs the page-tag aggregation and the sampler to agree, and a spot-check by reading interior pages.
- **A sweeping test enforces it.** `tests/unit/language-single-writer.test.ts` greps the tree for a `$set` that names `language`, `languages`, `source_languages` or `original_language` outside the patch function and an explicit allowlist of legacy sweeps (26 files write one of these fields inline today; the allowlist shrinks as each is migrated, and a new entry needs a reason).

## Named views

Every consumer asks one of these by name. Each is a function of the codes, exported from both twins; the Mongo-side filters are exported next to them so a query and a JS test cannot drift (the `NATIVE_EDITION_LANGUAGE` pattern, generalised).

| view | definition | replaces |
|---|---|---|
| **`primary_language`** | `languages[0]` | reading `language` as a single value |
| **`display_label(locale)`** | `displayLabel(languages, locale)` | the stored free text |
| **`english_original`** | `languages[0] === 'eng'` (not `enm`, not `ang`: Middle and Old English are not readable in English without help) | translation-state's `english_original` rule on the label, `ENGLISH_LANGS` in two FT screens, `ENGLISH_LANGUAGES` in `first-translation/candidate.ts` |
| **`native_edition(locale)`** | `languages` contains `fromLocale(locale)` — e.g. `{ languages: 'spa' }` for `/es` | `NATIVE_EDITION_LANGUAGE` regex in `localized.ts` and its mjs twin, and the copy in `localize-metadata.mjs` |
| **`latin_script`** | every code in `languages` has default script `Latn` and is not `ambiguous_script` | `LATIN_SCRIPT_LANGUAGES` as a script test, `NON_LATIN_LANGUAGES` in `pipeline-orchestrator.mjs` and `batch-transliterate.mjs`, `NON_LATIN_SCRIPT_NAMES` |
| **`routing_lane(phase)`** | OCR: lite iff every code has `lite_ocr` (and the BPH carve-out, and `OCR_LITE_ONLY` as today); translation: flash iff BPH or `bod` in `languages`, else lite | `getOcrModelForBook`, `getModelForBook`, `getTranslateModelForBook`, `isTibetanBook` |
| **`distinct_languages_for_stats`** | distinct codes over `languages[]` of live books, excluding `zxx`/`und`; historical stages counted as distinct languages (they are distinct codes) | `countDistinctLanguages` (both copies), `$addToSet: '$language'` in platform/BPH/libraries stats |
| **`facet_value`** | each code in `languages[]` is one facet row (a Greek–Latin edition appears under both) | `/api/languages` `normalizeLanguage`, the search `languages=` param that queries `language` |
| **`bcp47(code)`** | the HTML `lang` attribute, IIIF/DTS language, citation language | `language-code.ts`, route-local `LANG_CODES` |

**Routing does not change policy.** The split between OCR and translation is deliberate (`ai-models.md`); `routing_lane` reproduces it exactly, and the parity test pins old-vs-new on every row of the table before the old functions are deleted. The one behavioural difference is intended and measured: today the OCR router matches the **whole label** against the allowlist, so a compound label whose parts are all lite-safe (`Latin-German`, `English.`, `Latin/English`) routes to full flash. That is 106 books (103 live). Under `routing_lane` they route lite. It only bites when `OCR_LITE_ONLY=0`, which is not the case today (default ON, the $5/day dial), and it is a routing change, so step 3 is on the hold list.

Rule 5 of the invariant doc ("routing reads the per-page tag, never `languages[0]`") describes a target, not the code: both routers read `books.language` today. Per-page routing is the next step after this one and needs the page tag normalised through the same vocabulary, which is what step 7's audit does first.

### Which surface reads which view

| surface | today | becomes |
|---|---|---|
| language pill on cards, book page metadata, `/book` JSON-LD `inLanguage` | stored `language` string; `displayLanguage` | `display_label(locale)`; `inLanguage` from `bcp47` |
| `/languages` page and `/api/languages` | Supabase `books_catalog.language` through a private 12-language `normalizeLanguage` | `facet_value` over `books_catalog.language_codes` |
| search filter `?languages=` (`/api/search`, `/api/search/semantic`, MCP `list_books`/`search_library`) | scalar `language` with `expandLanguages` | `{ languages: { $in: codes } }` via `toLanguageCodes(param)` |
| homepage `languageCount`, `/about/by-the-numbers`, `/census` | `countDistinctLanguages` on distinct `language` | `distinct_languages_for_stats` |
| platform stats, BPH `/stats`, `/api/libraries` | raw `$addToSet: '$language'` (counts `Latin` and `latin` twice) | `distinct_languages_for_stats` |
| OCR routing (batch orchestrator, Lambda `getModelForBook`) | exact label ∈ `LATIN_SCRIPT_LANGUAGES` | `routing_lane('ocr')` |
| translation routing | BPH or `isTibetanBook` (label prefix) | `routing_lane('translation')` |
| translation-state `english_original` (#5284) | label equals / starts with English | `english_original` view |
| `/es` native editions, `sync-es-collection.mjs`, `embed-page-texts.mjs` | `NATIVE_EDITION_LANGUAGE` regex (two copies + one in `localize-metadata.mjs`) | `native_edition('es')` |
| first-translation screens, `prior-translation-check.mjs` SOURCE_LANG guard | label; `original_language` preferred (#4654) | `source_languages[]` then `primary_language` |
| HTML `lang`, IIIF manifest/canvas language, DTS, DOI citation blocks | `language-code.ts`, three `LANG_CODES` copies, `edition-citation-language.mjs` | `bcp47` (the citation twin keeps its own parity test until step 6 folds it in) |
| Supabase `books_catalog` | `language` text (1,068 rows of raw codes, #3893) | adds `language_codes text[]`, synced by `sync-books-catalog.mjs` |
| spend page, ops `lang-tally.mjs` `langKey()` | first token of the label, own `ALIAS` map | `primary_language` → `languageName` (the ops script imports the mjs twin by path) |
| eval and analysis scripts (`LANG_ISO`, `LANG`, `CODE` maps, ~20 files) | private maps | import the table; not blocking — they are measurement scripts, migrated when next touched |

`localized` metadata maps (`../i18n.md`) and `pages.translations.<lang>` keep **BCP-47 short locale keys** (`es`). A locale is a UI and URL concept; an edition language is a code in `languages[]`. They meet only through `toBcp47`/`fromLocale`, never by string comparison.

## Freshness

| value | source | staleness |
|---|---|---|
| `languages[]`, `language`, `source_languages[]` | written together by `languageFieldsPatch` at import or correction | none: the label cannot lag the codes, because they are one `$set` |
| Supabase `language_codes` | `sync-books-catalog.mjs` | its existing cadence |
| homepage `languageCount` | `homepage_stats`, recomputed by `update-homepage-stats.mjs` / `prewarm-browse.mjs` | ≤ 24 h |
| routing | read from the book at job creation | a relabel takes effect on the next job |
| page `<language>` tags | written by OCR; normalised at read by the audit and detectors | never stored normalised; the raw tag is evidence |

## The audit

`scripts/audit/language-fields-audit.mjs`, weekly on Hetzner, off the local corpus mirror where it can be (`--mirror`, as `detect-book-languages.mjs` does), exit 1 = FAIL, one deduplicated GitHub issue on FAIL (`measurement-instruments.md` rules for scheduled detectors). It is the `language-vocabulary.mjs` detector #4711 proposed, plus three checks.

1. **Vocabulary.** Every code in `languages[]` and `source_languages[]` is in the table. FAIL on any live book.
2. **Derivation.** `language === displayLabel(languages)` and `languages[0]` exists, on every live text book. FAIL above 0 after step 8; reported as a count before it.
3. **Coverage.** Live text books with `languages` missing, empty, `['und']` or `['zxx']` while `content_type` is not artwork. Reported per class; FAIL on a rise week over week.
4. **Record vs pages.** For books with ≥ 20 tagged pages, the share of pages whose normalised `<language>` tag has the family of `languages[0]`. Books under 50% are listed (the 347 record-vs-pages class, #4117), **grouped so the biggest cluster is looked at first** (the hanmun rule: `kor` records on `lzh` pages are correct). A review queue, never a patch, never FAIL on its own.
5. **Allowlist drift.** Recompute `routing_lane` for every row of the table and every distinct live `languages` tuple against the deleted-in-step-3 legacy functions, while they exist; afterwards, against the `ocr.model` actually recorded on a sample of 200 recent pages (a page on lite whose book routes flash = drift).
6. **Positive control, every run:** inject one out-of-vocabulary code and one label/codes mismatch into an in-memory copy of a sampled book; the run must flag both or it reports `probe_broken`, never PASS.
7. **Negative control, recorded once in the step-7 PR:** stamp a bad code on one hidden test book, watch the audit go red, restore. A guard that has never been red is decoration (`tests-that-are-not-guards.md`).

## Migration, in independently mergeable steps

Each is a GitHub issue linked from #5304: #5330, #5332, #5333, #5334, #5335, #5336, #5337, #5338 (steps 1–8 in order). Vocabulary first, then readers of the label, then the writer, then data, then readers of the codes, then the audit, then derivation.

1. **Vocabulary and code API** in the pinned twin: the table, `toLanguageCodes`, `languageCode`, `languageName`, `toBcp47`/`fromLocale`, `displayLabel`, the closed-vocabulary fix (no title-case fallthrough), and a parity test that imports **every** copy listed in the inventory and asserts it agrees with the table on its own vocabulary (the `translate-core-parity` lesson: enumerate every copy, import every copy). No behaviour change for callers.
2. **Tokenisers onto the normaliser** (no data change): `countDistinctLanguages` (both twins), `/api/languages` `normalizeLanguage`, `$addToSet: '$language'` stats, `displayLanguage`, `language-code.ts`, route-local `LANG_CODES`, `NATIVE_EDITION_LANGUAGE` (three copies), `ENGLISH_LANGS` screens, `lang-tally.mjs` `langKey`. Each keeps its output shape; the parity test from step 1 goes green on each as it moves. The homepage language count will change (117 → the vocabulary's count): the new number and the old go in the PR.
3. **Routing view.** `routing_lane` over codes, `lite_ocr` column, `ambiguous_script` set, `isTibetanBook` folded in; old-vs-new pinned over every table row and every distinct live label, the 103 compound-label books listed as the intended delta. On the hold list (routing is money).
4. **One writer.** `languageFieldsPatch`, the `resolveLanguage` / `resolveIaLanguage` / `insertBookIfNew` gate, the sweeping single-writer test with its legacy allowlist, `source_languages` in `books-known-fields.json` and `book-docs.mjs`. New books get codes from this step on; nothing existing is rewritten.
5. **Backfill codes** (data write, waits for Derek): `languages[]` names → codes on the 24,464 books that carry the array; fill it on the 68,299 that do not (23,865 live) from `toLanguageCodes(language)`; `source_languages[]` from `original_language` (8,528). One `sweep_log` row per book; `language_raw` preserved; books whose label yields `unresolved` fragments go to `['und']` plus the review list, never a guess. The label itself is **not** rewritten in this step.
6. **Readers on codes.** Search `languages=` and facets, `/languages`, MCP filters, Supabase `books_catalog.language_codes` (migration + sync + rebuild; closes #3893), first-translation `source_languages`, `native_edition`, the translation-state `english_original` input (#5284). Depends on 5.
7. **Audit** as above, plus the Hetzner crontab line, with the negative control recorded. Absorbs #4711's detector and gives #4117's detector its standing home.
8. **Derive the label.** The writer stops accepting free text; `language` is always `displayLabel(languages)`; one sweep rewrites the live labels that differ (the 262 compound and ~46 junk-atom books first, listed and checked by eye) — public metadata, waits for Derek. `original_language` becomes read-only derived, then is retired once `git grep` finds no reader; the `$unset` is a deletion and waits for Derek.

## Decisions Derek owns (defaults in bold)

1. **Canonical form = ISO 639-3 codes in `languages[]` (edition) and `source_languages[]` (source); `language` derived. No script subtag stored; languages whose holdings span scripts never route to lite.**
2. **Historical stages count as distinct languages in "N languages"** (Old English, Middle High German, Classical Chinese each count once), matching the display policy; comparison still treats them as one family. Alternative: count families (smaller number).
3. **`english_original` means Modern English (`eng`) only**; Middle and Old English books are not "readable in English" on the translation-state ladder.
4. **Backfill `languages[]` codes corpus-wide (step 5) once the writer (step 4) is on main**, with sweep-log rows; no label rewrite in that step.
5. **Rewrite the compound and junk labels to the derived form (step 8) only after the audit has been green once**, the list checked by eye first.
6. **Accept the routing delta** (103 live compound-label books move to lite OCR when script-aware routing is next switched on).

## Do not

- Do not add a language list, map or regex anywhere. Add a row to the table. The inventory below is the cost of not having one.
- Do not compare two languages by string. `sameLanguage(a, b)`, which normalises and compares families.
- Do not write `language` by hand, and do not write `languages` without `language` in the same `$set` (a stale array keeps an old value matching in filters, #3942). Use `languageFieldsPatch`.
- Do not route on `language`. Read `routing_lane(phase)`.
- Do not read `pages.ocr.language` as a detection; it is the request parameter (invariant doc).
- Do not relabel toward `source_languages` without the `text_role` gate, and do not treat the page tags' top language as a replacement for `languages[0]` (hanmun, Latin editions of Greek authors, the Popol Vuh).

---

## Inventory (git grep, `origin/main` a1c513c68, 2026-09-30)

Scale: `original_language` appears in 182 files (634 lines), a `languages` field in 181 (375), `language` as a key or property in ~1,040 (3,898, many of them pages, translations and locales rather than books). The table lists what has to **move**: every normaliser, vocabulary, tokeniser, allowlist and writer, and the readers grouped by surface. Measurement scripts under `scripts/eval/`, `scripts/analysis/` and `scripts/_archived/` with private maps (~25 files) are listed as a class; they move when next touched.

Reproduce: `git grep -l -P "\boriginal_language\b" -- src scripts tests ':!*.md' ':!*.json'`; vocabularies: `git grep -n -P "^\s*(export\s+)?(const|let)\s+[A-Z0-9_]*(LANG|LANGUAGE|ISO|CODE|SCRIPT)[A-Z0-9_]*\s*(:\s*[^=]+)?=\s*(new (Set|Map)|\{|\[)" -- src scripts`.

### Normalisers and vocabularies (the things that become the table)

| file | what it holds | step | becomes |
|---|---|---|---|
| `src/lib/language-normalize.ts` ↔ `scripts/lib/language-normalize.mjs` | `CODE2`, `CODE3`, `SYNONYM`, `FAMILY`, `DISTINCT_VARIANTS`; `normalizeLanguageToken`, `parseLanguageField` (17 importers) | 1 | **the table and the code API**; name functions kept as wrappers |
| `src/lib/language-utils.ts` | `CODE_TO_NAME`, `CODE3_TO_NAME`, `displayLanguage`, `sameLanguage`, `expandLanguages` | 2 | `languageName`, `sameLanguage` on codes; `expandLanguages` → `toLanguageCodes` |
| `src/lib/language-canonical.ts` ↔ `scripts/lib/language-count.mjs` | own atomiser + junk list; `countDistinctLanguages`, `isSingleRealLanguage` (homepage count, `books-catalog.ts`) | 2 | `distinct_languages_for_stats` |
| `src/lib/language-code.ts` | name → BCP-47 for `lang=` attributes, `NOT_A_LANGUAGE` | 2 | `toBcp47` |
| `src/app/api/languages/route.ts` | `LANGUAGE_NORMALIZATION` (12 languages), `CANONICAL_LANGUAGES`, `normalizeLanguage` | 2 | `facet_value` |
| `src/lib/types/ai-models.ts` ↔ `scripts/lib/translate-core.mjs` | `LATIN_SCRIPT_LANGUAGES` (names + 2- and 3-letter codes), `isLatinScriptLanguage`, `isTibetanBook` | 3 | `lite_ocr` column, `routing_lane` |
| `scripts/lib/ocr-routing.mjs` | imports the allowlist (no copy of its own) | 3 | `routing_lane('ocr')` |
| `scripts/workers/pipeline-orchestrator.mjs` | `NON_LATIN_LANGUAGES` set | 3 | `latin_script` |
| `scripts/batch/batch-transliterate.mjs` | `NON_LATIN_LANGUAGES` list (regex query) | 2 | `latin_script` + code query |
| `src/lib/non-latin-scripts.ts` | `NON_LATIN_SCRIPT_NAMES` | 2 | table `script` column |
| `src/lib/localized.ts` ↔ `scripts/lib/native-edition-language.mjs`; copy in `scripts/maintenance/localize-metadata.mjs` | `NATIVE_EDITION_LANGUAGE` regex | 2 | `native_edition(locale)` |
| `src/lib/first-translation/candidate.ts`; `scripts/audit/ft-source-language-screen.mjs`; `scripts/audit/ft-translator-as-author-screen.mjs` | `ENGLISH_LANGUAGES` / `ENGLISH_LANGS` | 2 | `english_original` |
| `src/lib/first-translation/source-language-match.ts` ↔ `scripts/lib/source-language-match.mjs` | `LANGUAGE_ALIASES`, `canonicalLanguage` | 2 | `languageCode` + `sameLanguage` |
| `scripts/lib/translation-catalog-record.mjs` | `KNOWN_SOURCE_LANGUAGES`, `SOURCE_LANGUAGE_ALIASES` | 2 | table |
| `scripts/lib/edition-citation-language.mjs` ↔ `src/lib/edition-language.ts` | `PLACEHOLDER_LANGS`; citation language pair (own parity test) | 6 | `bcp47` + `source_languages`; parity test kept until folded |
| `scripts/lib/scholarly-typst.mjs`; `src/app/api/dts/collection/route.ts`; `src/app/api/iiif/[id]/manifest/route.ts`; `src/app/api/iiif/[id]/canvas/[pageNumber]/[type]/route.ts` | four `LANG_CODES` maps | 2 | `toBcp47` |
| `src/lib/book-i18n.ts` (`LANGUAGE_NAMES_ES`); `src/lib/page-translations.ts` (`TARGET_LANGUAGE_NAMES`); `src/lib/embassy/librarian.ts` (`LANG_NAMES`) | localised language names | 2 | `languageName(code, locale)` |
| `src/lib/prompts.ts` | `LANGUAGE_OCR_PROMPT_NAMES`, `LANGUAGE_TRANSLATION_PROMPT_NAMES` | 2 | keyed by code; prompt text unchanged |
| `src/lib/processing-priority.ts` (`LANGUAGE_SCORES`); `src/lib/semantic-alignment.ts` (`LANGUAGE_THRESHOLDS`); `src/lib/transcription-reliability.ts` (`UNREADABLE_LANGUAGES`); `src/lib/types/language.ts` (`RTL_LANGUAGES`) | per-language policy keyed by name | 2 | keyed by code (policy values unchanged) |
| `scripts/lib/ngram-normalize.mjs` ↔ `src/lib/ngram-normalize.ts` | `ORIGINAL_LANGUAGE_CORPUS` | 2 | keyed by code |
| `scripts/lib/page-language.mjs`; `scripts/lib/language-content-classify.mjs`; `scripts/audit/language-script-confusion.mjs`; `scripts/maintenance/detect-language-mislabels.mjs`; `scripts/audit/ft-english-badged-classify.mjs` | script census `SCRIPTS`, `SCRIPT_LANGUAGE`, `LANG_SCRIPTS`, `RELIABLE_CATALOGUE_LANGS` | 7 | table `script` column for the language→script direction; the Unicode-range census stays (it is evidence, not vocabulary) |
| `scripts/lib/ia-language.mjs`; `scripts/iiif-discovery/sources/ia-language.mjs`; `scripts/iiif-discovery/lib/iiif-metadata.mjs` | IA/IIIF signals, `LANGUAGE_PRESETS`, `LANGUAGE_MAP` | 4 | `toLanguageCodes` + table `marc`/`aliases` |
| `scripts/maintenance/normalize-language-tags.mjs` (`CODE`); `scripts/enrichment/normalize-languages.mjs` (`LANGUAGE_MAP`); `scripts/maintenance/backfill-language-from-ocr.mjs` (`LANG_CANON`); `scripts/maintenance/audit-language-provenance.mjs` (`ISO`); `scripts/maintenance/fix-imported-languages.ts` | sweep-local vocabularies | 5 | retired; step 5's backfill uses the table |
| importer maps: `scripts/import/harvest-istc.mjs`, `scripts/import/batch-import-istc-bsb.mjs`, `scripts/workers/erara-import-queue.mjs`, `scripts/works-catalog/ingest-bdrc.mjs`, `scripts/migration/enrich-bph-from-csv.mjs`, `scripts/batch/batch-mint-doi.mjs`, `scripts/import/kloss-enrich.mjs` | `LANG_MAP` / `LANG_MARKERS` (MARC → name) | 4 | table `marc` column |
| `scripts/export/training-pairs.mjs`; `scripts/lib/holdings-resolver.mjs` | inline splitters of a language string | 2 | `toLanguageCodes` |
| `scripts/enrichment/backfill-facets-phase1.mjs` (`LANGUAGE_TO_REGION`); `scripts/enrichment/geocode-origin-by-tradition.mjs` | language → region | 2 | keyed by code |
| `~/sourcelibrary-ops/costs/spend-dashboard/lang-tally.mjs` (private repo) | `langKey()` first-token split + `ALIAS` | 2 | `primary_language` via the mjs twin |
| display-only colour and ordering maps: `TimelineClient.tsx`, `ConstellationCanvas.tsx`, `BookConstellationViz.tsx`, `ConceptDiffusionViz.tsx`, `TranslationLagViz.tsx`, `PassageComparison.tsx` (`SCRIPT_FONTS`) | keyed by display name | 6 | keyed by code; low priority |
| static copy: `/about/by-the-numbers`, `/blog/2000-first-translations`, `/blog/worlds-largest-collection`, `/research/*`, `VolunteerForm`, `PipelineConfig` | hard-coded language lists | — | left alone (dated copy or UI choices); by-the-numbers reads the view in step 2 |
| eval/analysis maps (~25 files: `LANG_ISO`, `LANG`, `CODE`, `TESS_LANG`, `WESTERN_LANGS`, `CANDIDATE_LANGS`…) | measurement scripts | — | import the table when next touched |

### Writers of `language` / `languages` / `original_language`

| writer | what it writes | step | becomes |
|---|---|---|---|
| `src/lib/resolve-language.ts` (11 `/api/import/*` routes) | `language` + `field_provenance.language` | 4 | ends in `languageFieldsPatch` |
| `scripts/lib/ia-language.mjs` (`resolveIaLanguage`) | same, plain node | 4 | same |
| `insertBookIfNew` / `acquisitionGate()` and the other ~76 book-creating scripts (`*-direct.mjs`, IIIF sources, `scripts/import/*`) | whatever the script passes | 4 | gate rejects language fields not produced by the patch |
| `scripts/maintenance/normalize-language-tags.mjs` | `languages[]` names, `language_multi`, `language_raw` | 5 | superseded by the step-5 backfill |
| `scripts/maintenance/relabel-bilingual-edition.mjs`, `detect-language-from-pages.mjs`, `detect-language-mislabels.mjs`, `fix-language-mistags.mjs`, `audit-language-mismatch.mjs`, `backfill-language-from-ocr.mjs`, `backfill-language-provenance.mjs`, `normalize-language-provenance-shape.mjs`, `classify-language-mismatch-content.mjs`, `detect-language-untagged-ocr.mjs`, `apply-greek-relabel.mjs`, `repair-wellcome-work-id-and-language.mjs`, `scripts/audit/language-review-triage.mjs`, `scripts/audit/language-vs-ocr.mjs`, `scripts/enrichment/normalize-languages.mjs` | correction sweeps, inline `$set` | 4 | `languageFieldsPatch` + `sweep_log`; single-writer test allowlist until migrated |
| `scripts/workers/translate-worker.mjs` | `language` on translation records (5 inline writes; check each is a page/translation field, not `books.language`) | 4 | audited in step 4; book writes, if any, through the patch |
| `scripts/maintenance/sync-es-collection.mjs` | collection membership derived from the label (the #4141 un-tagging writer) | 6 | `native_edition('es')` |
| collection setup scripts (`setup-cannabis-collection.mjs`, `expand-cannabis-collection.mjs`, `finish-cannabis-acq.mjs`, `setup-1041-collections.mjs`, `fix-1041-subcollections.mjs`, `seed-timeline-filters.mjs`, `backfill-chinese-holdings.mjs`) | `language` filter values on collections/works | 6 | code filters |
| `scripts/sync-books-catalog.mjs`, `rebuild-books-catalog.mjs` → Supabase `books_catalog.language` | mirror | 6 | adds `language_codes` |
| `works` catalogue (`scripts/works-catalog/*`, 14 files read/write `original_language`) | work-level source language | 6 | `source_languages` codes on works too; the work is where the composition language belongs (`work-identity.md`) |

### Readers, by surface

| surface | files | step |
|---|---|---|
| search and facets | `src/app/api/search/route.ts`, `src/app/api/search/semantic/route.ts`, `src/app/api/mcp/route.ts`, `src/app/api/languages/route.ts`, `src/lib/books-catalog.ts` | 6 |
| stats and counts | `scripts/maintenance/update-homepage-stats.mjs`, `src/app/api/platform/stats/route.ts`, `src/app/api/embed/bph/stats/route.ts`, `src/app/api/libraries/route.ts`, `src/app/api/admin/canon/route.ts`, `src/app/api/books/distributions/route.ts`, `src/app/api/editor/collections/route.ts` | 2 |
| routing | `ocr-routing.mjs`, `ai-models.ts`, `translate-core.mjs`, `pipeline-orchestrator.mjs`, the Lambda sink | 3 |
| book page, cards, reader | `displayLanguage` / `language-code.ts` callers, `edition-language.ts`, `TranslatedSiblingNotice`; JSON-LD `inLanguage` in the reader page, `HomePageSchema.tsx` and `/work/[id]` emits the free-text name (`"Latin"`) where schema.org expects a BCP-47 code | 2, 6 |
| first translation | `src/lib/first-translation/*` (6 files read `original_language`), `scripts/workers/prior-translation-check.mjs` | 6 |
| i18n / `/es` | `src/lib/localized.ts`, `src/app/es/**` (8 files read `languages`), `embed-page-texts.mjs`, `es-translate-worker.mjs` | 2, 6 |
| citation / export | `edition-language.ts`, `edition-citation-language.mjs`, `scholarly-typst.mjs`, IIIF and DTS routes, dataset API (`/api/dataset/v1/*` permission check by language) | 2, 6 |
| detectors and evidence | `detect-book-languages.mjs`, `page-language.mjs`, `language-content-classify.mjs`, `language-review-triage.mjs`, `source-column.mjs`, `ia-ocr-gate.mjs`, `page-integrity.mjs`, `detect-fabricated-ocr.mjs` (already import the normaliser) | 7 |
