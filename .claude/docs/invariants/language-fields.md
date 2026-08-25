# Language fields — `language`, `original_language`, `languages[]`

**Read this when:** writing or reading any language field on `books`; adding a
language filter or facet; routing OCR/translation by language; writing a
detector or sweep that "fixes" a language; or deciding what a bilingual edition
is tagged. Companion to `edition-identity.md` and `work-identity.md` — this is
the axis between them that nothing else documents.

Measured 2026-08-21 against production `bookstore`, live = `visible: true &&
pages_count > 0` = 22,068.

---

## The three questions, and the one field each

| Question | Field | Example (Ficino's Latin *De mysteriis*) |
|---|---|---|
| What language is **this edition's text**? | `language` | Latin |
| What language was the **work** composed in? | `original_language` | Greek |
| Is this edition **substantially multilingual**? | `languages[]` + `language_multi` | `["Latin","Greek"]` for a facing-page edition |

Conflating the first two is the most expensive mistake in this cluster, and it
has been made repeatedly (#2184, #3261, #3957).

## THE TRAP: `language` is the EDITION's language, not the source's

For a `text_role: modern-translation` or `period-translation` book — an English
translation we host — **`language: English` is correct**. The source lives in
`original_language`.

In June 2026 a "language-mislabel" detector (PR #2806) and a sweep bucket
(PR #2796) both assumed `language: English` + non-English `original_language` =
a mislabel, and proposed relabelling **547 books** to their source languages.
The dry-run caught it: 523 were `modern-translation` and 16 `period-translation`
— *The Works of Li Po*, *The Art of War*, a 1609 Boethius — English editions
with English titles. Applying it would have corrupted ~540 records. Only the 8
rows with `text_role: null` were even worth looking at. Nothing was applied.

**Rule: never derive a language correction without gating on `text_role`.** And
never use "readable + non-English `language`" as a proxy for first-translation
eligibility — that filter excludes English translation editions, which is
precisely what a "first English translation" is.

## `languages[]` already exists. Do not add another array.

Present on 45,675 books (17,857 live), alongside `language_multi`. Written by
`scripts/maintenance/normalize-language-tags.mjs` (#2258, first run 2026-05-31).

It is currently **degenerate and unread**:

| | live |
|---|---|
| `languages` present | 17,857 |
| …singleton arrays | 17,489 |
| …**more than one language** | **245** |
| …empty array | 123 |
| `languages[0] !== language` | 892 |
| missing `languages` entirely | 4,211 |

Two things follow, and both have bitten:

1. **Nothing in `src/` reads it**, and it is absent from `src/lib/types/book.ts`.
   Search filters the scalar — `src/app/api/search/route.ts:172` — *including
   its `languages=` query parameter*. `?languages=Latin` is a parameter named
   `languages` that queries the field `language`. Do not assume the array is
   live because the param exists.
2. **The sweep parses; it cannot detect.** It splits the string already in
   `language`, so `"Greek-Latin"` becomes `["Greek","Latin"]`, but a book tagged
   `"Greek"` that is half Latin stays `["Greek"]`. On the Lascaris pair (#4089)
   it ran and confirmed the wrong answer on both copies.

96 of the 229 distinct live `language` values are list-shaped strings on 262
live books (`"Hebrew and Aramaic"`, `"Sanskrit-English"`, `"Arabic, Ottoman
Turkish, Persian, Latin, Ternate (a Papuan language), French and Dutch."`) —
the workaround for the scalar schema is already in the data.

## Evidence sources, ranked — and one that looks like evidence and isn't

1. **The per-page `<language>` tag inside `pages.ocr.data`** — genuine per-page
   detection by the OCR model, already paid for. The strongest signal we hold.
   On two independently OCR'd copies of the same 1495 Aldine it returned Latin
   178 / Greek 153 and Latin 175 / Greek 151 — near-identical, against two
   different catalogue answers.
2. **`ai_metadata.language` + `ai_metadata.secondary_languages`** — a *candidate
   generator*, never a source of truth (see below). `language` and
   `ai_metadata.language` disagree on 1,560 of the 13,310 live books with both.
3. **`pages.ocr.language`** — **NOT detection.** It is the request parameter:
   `null` or `"auto-detect"`. Anything reading it as an answer is measuring its
   own input. This is a live trap; the name is the whole problem.

## `secondary_languages` means "traces present", not "bilingual"

Its prompt asks for "any other languages present, e.g. Greek quotes in a Latin
text" — which is true of nearly every early modern Latin book. Measured against
the page tags on 40 live books, using "second language on ≥10% of pages" as the
bilingual bar: **11 hit / 26 miss / 3 unevaluable**. Most misses are the field
being correct about its own, weaker question; about 6 are wrong at any threshold
(`Latin + [Greek]` on 100% Latin pages; `Arabic + [German]` with no German).
Recall is also poor — 4 of 33 books *without* the field have a real ≥10% second
language.

Hygiene: 257 books list `Latin` as a secondary of `Latin`, 204 the same for
Greek; 231 distinct uncontrolled values in which "Ancient Greek" and "Greek" are
different languages.

**Use it to generate candidates. Never copy it into `languages[]`.**

## Compare by FAMILY, not by name — or the artifact eats the finding

A language name and a language *identity* are not the same thing, and the gap
between them is where language detectors go wrong. Two measured examples from
the first full run of the detector (#4117, 2026-08-21), both of which produced
confident, wrong headline numbers before they were caught:

1. **Compound catalogue values.** 96 of the 229 distinct live `books.language`
   values are list-shaped strings. Normalising the catalogue value with a
   single-token function makes every one of them match nothing, so they all land
   in "contradicts the catalogue". Comenius's *Orbis Sensualium Pictus*
   (catalogued `Latin/English`, measured English 93% / Latin 91%) is catalogued
   **correctly** and was reported as a mislabel. All five apparent mislabels in
   the first 200-book slice were this artifact. **Parse the catalogue value as a
   list before comparing it to anything.**
2. **Historical stages of one language.** The first full run reported 6,230
   bilingual books; **2,387 of them — 38% — were "Chinese + Classical Chinese"**,
   the OCR model emitting two labels for a single text, page to page. The Korean
   *hanmun* corpus has the same shape and supplied 196 of the 1,053 apparent
   mislabels: Joseon scholarly works catalogued Korean whose pages are Classical
   Chinese, which is what that literature *is*.

`languageFamily()` / `sameLanguageFamily()` in `language-normalize` exist for
case 2. Historical stages stay **distinct as catalogue values** — a reader
looking for Old English does not want modern English — and count as **one
language** when asking whether a book is bilingual. Families today: Chinese
(+ Classical, Literary), English (+ Old, Middle), French (+ Old, Middle),
German (+ Middle High, Old High, Early New High), Hebrew (+ Biblical,
Samaritan), Church Slavonic (+ Old).

**The general rule, worth more than either instance:** when a detector fires and
the output looks like a data problem, suspect the detector's own vocabulary
first. Both of the above read as corpus defects and were defects in the
comparison. Before reporting a rate, take the largest single cluster in your
findings and look at it by hand — an artifact is almost always the *biggest*
group, because it is systematic and the real thing is not.

## A pivot worker will translate a page that is ALREADY in the target language

`es-translate-worker.mjs` selects pages whose `translations.es` is empty and
pivots our English translation into Spanish. It has no way to ask whether the
leaf is already Spanish, so on a bilingual edition it writes machine Spanish over
a source that is sitting on the same page.

Measured 2026-08-25: all three Florentine Codex volumes (`Nahuatl-Spanish`) carry
`pages_translated_es` of 703 / 752 / 992 — **2,121 pages of `ai-pivot-en` Spanish
standing in front of Sahagún's own**. Vol. 2, p. 201, Sahagún on the leaf: *"que
no te ensuberbescas, ni te altiuescas… y baxa la cabeça, y recoge tus braços"*.
Stored as the Spanish edition: *"que no te vuelvas orgulloso, ni te enaltezcas…
y baja la cabeza, y cruza los brazos"*. Both are Spanish; only one is the source.

The reader sees no difference, because a machine paraphrase of a period text
reads as a modernisation of it. `pages.translations.<iso>.source` is the only
thing that distinguishes them — `ai-pivot-en` versus `source-column` — which is
why every surface that tells a reader or an agent where a text came from now
branches on it (`resolveQuoteText`, the MCP tips, `SourceBadge`).

**The general rule: an emptiness check is not a licence.** "This field has no
value" says nothing about whether the value belongs there. Before a worker
generates content for a page, ask whether the page already holds it in another
form — for language, that means the per-page `<language>` tag and, on a
parallel-text leaf, `<column-break/>`. The mechanism for the bilingual case is
`scripts/lib/source-column.mjs`; the measurement that has to pass before it runs
on a new book is `scripts/audit/source-column-separation.mjs`.

Corollary for the catalogue: this whole class is invisible while `books.language`
names one language. The Ximénez Popol Vuh was catalogued `K'iche' Maya` with
Spanish on 96% of its leaves' own page tags. `relabel-bilingual-edition.mjs`
proposes the compound value from those tags and prints its evidence — and keeps
the CATALOGUED language first, because Spanish is tagged slightly more often than
K'iche' there and a share-ordered rule renames the K'iche' Popol Vuh
"Spanish-K'iche'". Which language a bilingual edition principally IS stays a
curatorial judgement; the leaves are evidence that something is MISSING from the
record, never that it is backwards.

## The Korean/hanmun class must never be auto-flipped

A book catalogued `Korean` whose pages are Classical Chinese is not mislabelled.
Provenance, tradition and readership are Korean; the script on the page is
literary Chinese. The same holds for Sanskrit in Tibetan works and for Latin in
early modern vernacular scholarship. These belong in `languages[]` as an
addition, never as a replacement of `language`, and they are the standing reason
the detector's `contradict` bucket is a review queue and not a patch.

## Four vocabularies, none authoritative

- `src/lib/language-utils.ts` — `CODE_TO_NAME` / `CODE3_TO_NAME` / `expandLanguages` (read path)
- `scripts/maintenance/normalize-language-tags.mjs` — `CODE` / `SYNONYM` / `EXTRA` (write path)
- `scripts/iiif-discovery/sources/*.mjs` — per-source import maps
- the OCR `<language>` tag — **no vocabulary at all** (`Ancient Greek`, bare `de`,
  `early new high german`, `sanskrit (transliterated)`, `None`/`none`/`N/A`)

Before adding a fifth, extend `language-utils.ts` and give it an `.mjs` twin
with a parity test, in the shape of `identity-fields.ts` /
`scripts/lib/identity-fields.mjs`. #3893 covers only the Supabase catalog rows.

When splitting a free-text language string, split on `,` `;` and `" and "` —
**not on `/`**, which turns `N/A` into two languages named `n` and `a`.

## The field count is itself the warning

`books` carries **18 live language fields** (5 more already retired), of 423 in
`scripts/lib/books-known-fields.json`: `language`, `languages`, `language_multi`,
`language_raw`, `language_unparsed`, `language_review`, `language_review_detail`,
`language_review_resolved`, `language_source`, `language_detected`,
`language_corrected`, `language_confidence`, `language_relabel`,
`language_verified_content`, `ai_detected_language`, `original_language`,
`source_language_screen`, `_language_backfill`.

This is `field-sprawl.md`'s pattern several times over. **A language sweep
records a ROW, not a new column.** If you need somewhere to put a finding, the
answer is a sweep-log row or an existing flag — not `language_<yourthing>`.

## Rules

1. Never "fix" `language` toward `original_language` without gating on `text_role`.
2. Never read `pages.ocr.language` as a detected language.
3. Never copy `ai_metadata.secondary_languages` into a public or canonical field.
4. `languages[0]` must equal `language`. Order the rest by measured page share.
5. OCR/translation routing reads the **per-page** tag, never `languages[0]` —
   a bilingual page set must not inherit one model choice from a book-level field.
6. New language field ⇒ demote something or use a row. Check the 18 above first.
7. Parse the catalogue value as a **list** and compare by **family** before
   claiming any book disagrees with its own record.
8. Before quoting a rate from a language detector, hand-check its largest
   cluster. Twice now that cluster has been the instrument, not the corpus.

## Widening a language definition: find every WRITER before you ship

`language` is read by surfaces AND derived from by writers, so a change to what
it *means* is not finished when the pages look right.

#4120 widened "has a Spanish edition" from *translated into it*
(`pages_translated_es > 0`) to *in it — by translation **or** by authorship*,
because 67 live books written in Spanish have no pivot counter and never will,
and so were invisible on every /es surface. The read surfaces were updated in one
pass. **Three writers kept the old rule**, and only one of them failed harmlessly:

1. `scripts/maintenance/sync-es-collection.mjs` derives the `en-espanol`
   collection — and **un-tags** anything that stops qualifying. So it did not
   merely fail to add Spanish originals, it **removed them on every run**. Caught
   only by reading the output: the run that tagged two new books removed Scherzer
   in the same pass (#4141).
2. `src/app/es/collections/[id]/page.tsx` split its list on the counter, filing
   native books under "these read in their original language and in English"
   while their card linked into the Spanish reader (#4138).
3. `scripts/workers/embed-page-texts.mjs` selects on the counter, so the 67 books
   have **zero rows** in `page_texts` — visible on /es, unfindable by Spanish
   search (#4146, open). Not a filter fix: the composer reads
   `pages.translations.es`, which is empty for a native edition forever; the
   Spanish text is in `pages.ocr.data`.

**The rule:** after changing what a language predicate means, `git grep` the old
predicate and classify every hit as reader or writer. A writer that also *removes*
membership is the dangerous kind — it converts a stale definition into active
data loss, and it looks like a successful sweep in the log.

**The tell that you are in this case:** a derived collection whose count moves the
wrong way, or a sweep that reports both tags and un-tags in one run.

Corollary for `.mjs` writers: they cannot import the TS predicate, so the pattern
gets duplicated (`NATIVE_EDITION_LANGUAGE` in `src/lib/localized.ts` ↔
`sync-es-collection.mjs`). Both copies carry a note that they change together —
the same arrangement `translate-core.mjs` ↔ `ai-models.ts` already lives with.

## Open issues

#4226 (Florentine Codex: 2,121 pages of pivot Spanish still stand in front of
Sahagún's own — replacing them is a curatorial call, not a technical one) ·
#4146 (native Spanish unfindable in Spanish search) ·
#4089 (read path + ordering rule) · #4117 (detector from page tags) ·
#3893 (one vocabulary) · #3958 (1,519 live books in `language_review` with no
consumer) · #2184 (translations catalogued as the original's language) ·
#3957 / #3261 (`text_role` misclassification, the adjacent axis)
