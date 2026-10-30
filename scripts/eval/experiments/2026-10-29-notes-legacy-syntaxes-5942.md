---
stage: translation
measure: agreement
languages: []
scripts: []
canons: []
n_books: 26933
n_pages: 72188
verdict: "annotation-layer/3 removes every legacy note syntax the reader hides. On a 72,188-page draw (59,387 uniform plus the rare syntaxes sought out), the parser's notes-off text holds the reader's notes-off words wherever the syntax itself decides it: every reader-read [[label:]] syntax on all 1,749 pages carrying one (/2: 0 pages for [[vocabulary:]], [[image:]], [[header:]], [[markup:]] and the bracketed page marks), bracketed image paragraphs 603/603 (/2: 0), interpolations 23,628/23,635 (/2: 993), Summary: lines 25/25 (/2: 1). Round trip holds byte for byte on every page except the 148 whose term definitions are lifted (the same pages as /2). The image-grounded check (107 pages, Opus with the image, Gemini as second reader) found 6 of 49 interpolations to be brackets the SOURCE prints; /3 flags those from the OCR (6/6, 2 false positives) and keeps them with notes off."
status: informational
decision: "annotation-layer/3 replaces /2 before the full notes-layer backfill resumes; the 10,016 pages the paused run wrote are brought to /3 (2,822 rewritten, 7,194 re-stamped)"
superseded_by: null
issue: [5942]
---
## 2026-10-29 · The notes-layer parser and the reader's legacy note syntaxes (#5942)

PRIOR ART: `scripts/eval/notes-layer-5942/` (the parser's first measurement and the storage pilot). Those used a one-page-per-book
draw, which undersamples the early prompt versions. They also compared `reader(data)` with `reader(text)`, which cannot see a syntax the
parser leaves behind, because the reader strips it from both. `scripts/eval/notes-legacy-5942/` adds a page-uniform draw with
targeted top-ups and a direct oracle. Scripts and raw outputs: `scripts/eval/notes-legacy-5942/`, `scripts/eval/results/notes-legacy-5942/`.

**Why.** Derek's session paused the full backfill (`notes-layer-backfill-5942-full-20261029`) at about 9,000 pages. annotation-layer/2
left `[[vocabulary:]]`, `[[image:]]` and the other legacy syntaxes in `translation.text` as if they were book words.

### 1. Inventory

**Where the syntaxes came from.** The prompt history was read with `git log -S` over every prompt file.
- The translation prompt used `[[label: …]]` syntax from 2025-12-12 to 12-27. That is DB translation v0; DB v1 switched to XML on 2025-12-27/28.
- Every bracket page in the corpus carries prompt version `none`, `v1` or `v2` and was written in Jan–Feb 2026, by workers still running
  older prompts.

**No prompt ever asked for these:**
- single `[interpolations]` (banned outright from v7/v8 onward)
- bracketed image paragraphs
- plain `Summary:` lines
- preambles
- "# Title Page" label lines
- free-text Vocabulary sections
- `[[page type:]]` and `[[note:]]` (singular)
- `[[original page:]]`, `[[catchword:]]` and `[[sig:]]`
- `«…»`, `<<…>>`, `{{…}}`, `(Note: …)` and `Translator's note:`

**The draws:**
- **Uniform:** 59,387 pages. A book is drawn with probability ∝ `pages_translated`, then a random page in it. Seed 5942; the books'
  counters give 5,726,305 pages in all.
- **Top-up by scan:** a server-side regex scan of every page whose translation was updated 2026-01-01 – 03-16 found 1,828 pages with
  `[[label:]]`.
- **Top-up by book:** every page of the 72 books where the uniform draw found a rare syntax gave 11,401 more pages.
- **Estimated pages:** uniform share × 5.73M. The estimate is "–" where the uniform draw found none; for those, "found" is the
  whole population in the scanned window.

| syntax | found (conformance n) | est. pages | prompt versions | reader, notes off | /2 conforms* | /3 |
|---|---:|---:|---|---|---:|---|
| `[[notes:]]` / `[[note:]]` | 816 | ~580 | none, v2 | hidden | 815 | commentary note → 816 |
| `[[meta:]]` `[[summary:]]` `[[keywords:]]` | 816 / 802 / 802 | ~580 | none | hidden (panel) | all | page block → all |
| `[[page number:]]` | 607 | ~290 | v2, none | hidden | 607 | page block → 607 |
| `[[language:]]` `[[signature:]]` `[[abbrev:]]` `[[warning:]]` | 35 / 11 / 7 / 1 | – | none, v1, v2 | hidden | all | page block → all |
| `[[vocabulary:]]` | 368 | ~190 | v2, none, v1 | hidden | **0** | vocab page block → 368 |
| `[[image:]]` | 90 | ~190 | v1, none, v2 | hidden | **0** | image note → 90 |
| `[[header:]]` `[[markup:]]` (`[[page type:]]`: none found) | 16 / 11 | – | v2, none | hidden | **0** | page block → all |
| `[[margin:]]` `[[gloss:]]` `[[insert:]]` `[[unclear:]]` `[[term:]]` | 458 / 80 / 12 / 3 / 17 | ~290 | none, v2, v1 | words kept | **0–1** | mark (words stay) → all |
| `[[original page:]]` `[[catchword:]]` `[[sig:]]` `[[vocab:]]` `[[heading:]]` `[[crossed out:]]` | 302 | ~190 | none, v1, v2 | **shown as book text** | (=) | page block / mark: **listed diff** |
| bracketed image paragraph | 603 | ~2,500 | v10, none, v1, 1, v2 | hidden (image-desc) | **0** | image note → 603 |
| single `[interpolation]` | 23,635 | **~1.18M** (20.7%) | all; none 77%, v6 39%, v1/v2 31%, 13 10.5% | dropped | 993 | kept in text under an `interp` mark → 23,628 |
| `[Note: …]` | 94 | ~1,200 | none, v10, 11 | dropped (as interpolation) | 8 | interp → 94 |
| plain `Summary:` line | 25 | ~290 | 13, v10 | hidden | 1 | page block → 25 |
| preamble ("Here is the translation") | 8 | ~390 | v10, 11, 13 | stripped | (=5) | page block (=7) |
| code fence | 2 | – | none | stripped | (=1) | page block (=2) |
| free-text Vocabulary section | 278 | ~2,700 | v2, v5.1, 13 | deletes to page end, **wherever "vocabulary:" stands** | (=13) | own-line heading only: **listed diff** |
| "# Title Page"-style heading | 280 | ~24,000 | v10, v2, 11 | **deletes the label word** ("## INDEX 421" → "421") | (=0) | kept: book headings, **listed diff** |
| `[…]` lacuna | 178 | ~14,000 | all | kept | (=61) | kept, no annotation (=170) |
| `(Note: …)`, `Translator's note:`, `«…»`, `<<…>>`, `→` in a term | 27 / 53 / 27 / 2 / 1 | 1.4k / 3.6k / 2.6k / 0.2k / – | all | **shown as text** | (=) | kept, as the reader does |

\* **"conforms"** is the differential oracle (§3): the reader and the parser disagree on the same words whether or not the syntax is on
the page, so the syntax itself is never why they differ. "(=N)" marks a syntax with no deletion rule; there the count is of whole pages
whose words are equal.

### 2. annotation-layer/3

**Shared rules.** The reader's bracket rules moved to `scripts/lib/legacy-note-syntax.mjs` verbatim (`BRACKETED_PARAGRAPH`,
`looksLikeImageDescription`, `INTERP_PATTERN`, `isLacunaMark`). `NotesRenderer.tsx` imports them; the reader's behaviour is unchanged,
and its tests pass. The parser imports the same rules.

**Passes.** The parser runs its passes in the reader's notes-off order (`extractMetadata` → `cleanOcrArtifacts` → `preprocessBracketTags`).
Each pass runs on the page as the reader sees it at that stage: every earlier removal is cut out, with a map back to the stored offsets.
Nested blocks therefore close as the reader closes them. In `[[margin: Agrypnia [[gloss: by sickness]]]]`, the margin closes at the
first `]]` and the gloss at the second.

**Interpolations** stay in `text`, brackets and all, under an `interp` mark made of two zero-width pieces. `notesOffText(split)` drops
them as the reader does, except those flagged `printed` (see §4). `renderInline` still rebuilds the stored markup byte for byte.

**Where /3 departs from the reader on purpose.** In each case the reader deletes the book's own words or shows the model's as the book's;
each is pinned by a "listed" test:
- **Headings:** the reader drops the word "Index" from 249 of 249 "# Index…" headings in the uniform draw, all of them the book's own.
- **"Vocabulary:" anywhere:** the reader deletes the whole rest of the page. Every page of one Mayan dictionary goes blank under its
  running head "GENERAL VOCABULARY"; on another page it is "**Technical" that is left behind.
- **Invented labels:** `[[original page: 68]]`, `[[catchword:]]` and the other labels no reader rule reads are shown by the reader as
  book text.

### 3. Conformance (the oracle is the reader's own function)

**What is compared.** The oracle is `prepareNotesMarkdown(data, { showNotes: false })`: the exported pure function `NotesRenderer`
renders, empty on a description-only page. It is compared with `notesOffText(splitAnnotations(data))` as bags of words, with no reader
pass over the parser's side.

**The differential check.** The comparison is repeated with the syntax deleted from the page. When the disagreement is the same with
and without the syntax, the syntax is not its cause.

**Totals, 72,188 pages:**
- whole-page equal: 68,348 (/2: 46,562);
- legacy pages equal: 23,232 of 25,354 (/2: 1,446);
- round trip byte for byte: 72,040. The other 148 have their term definitions lifted, the same pages as /2.

**What still differs.** Every remaining whole-page difference also occurs on pages with no legacy syntax. Each is an old, known class:
- a note nested in a margin, which the reader shows as book text;
- an unclosed tag;
- LaTeX the reader rewrites (`\frac`);
- a description-only page, which the reader hides whole;
- the listed headings.

**What /3 changes on non-legacy pages.** Text: none. On the uniform draw, /3 text equals /2 text on every page without a legacy syntax;
the 55 pages whose text changed all carry one. Annotations: interpolations are new annotations.

**Unit tests.** `tests/unit/annotation-layer-legacy.test.ts` has one fixture per syntax (29) against the reader. It also pins the listed
differences and the printed-bracket flag.

### 4. The image-grounded check (Derek's inbox note, 2026-10-29)

**Design.**
- **Draw:** 107 pages, 15 syntaxes, stratified by prompt version, one page per book, seed 5942.
- **Reader:** Opus `claude -p` with the page image (`getPageSource`) and the OCR. It judged each span: printed, model, mixed or unclear.
- **Re-judged spans:** removed spans were judged again on their removed words alone (`--removed-only`). The first prompt marked the
  anchor, and Opus judged the anchor instead.
- **Second reader:** Gemini 3.8 Flash low on 30 pages. It agrees on 37 of 38 kept spans (97%). On removed spans it saw only the first,
  ambiguous prompt, so that figure (52%) is not a measure of agreement.

**Results.** Table: `scripts/eval/results/notes-legacy-5942/spot-report.md`.
- **Interpolations:** 71% model, 14% printed, 14% mixed; 6 of 49 had their brackets printed in the source ("[Σ 392]", "[Fig. 164 :]",
  "[10]"). All 6 stood on pages whose OCR carries bracket runs; none of the model's did.
  - **Rule changed:** given the OCR, /3 flags an interpolation `printed` when the OCR has the same bracketed words, or at least as many
    bracket runs as the translation has interpolations. Against the judge: 6/6 found, 2 false positives (model labels on a page that
    brackets throughout). This is in-sample.
  - Printed interpolations stay with notes off; the reader drops them (reader error, listed).
  - `backfill.mjs` and `rewrite-stale.mjs` now read `ocr.data`.
- **Legacy blocks:** `[[notes:]]` 97% model (32 spans, 0 lost); `[[margin|gloss|term:]]` 6/6 printed, kept.
- **Page blocks:** the 4 "losses" are page numbers and signatures, page furniture removed by design.
- **Bracketed image paragraphs:** 88% model. One printed "[Diagram]" in Richter's Leonardo is removed, as the reader removes it.
- **`Summary:` lines:** 1 of 2 is a manuscript's own summary verse (Kanjur), which both the reader and /3 remove.

**Current (XML) syntax, measured alongside.** Not legacy, and not changed here:
- `<gloss>` marks as printed: 38% are the model's definitions, 5 leaks.
- `<unclear>`: 35% are placeholders ("[illegible — 1 line]"), 9 leaks.
- `<term>`: 19% are model additions (Sanskrit equivalents, transliterations), 5 leaks.
- `<note>`: 18% printed (footnotes, stage directions), 3 losses.
- `<gloss>` after a `<term>`: 97% model, as /2 assumes.

**Leaf check.** Opus judged 5 pages "no" and 13 "partly" on whether the English is this leaf's. I opened 3 of the "no" pages myself and
confirmed them: Ficino's Plato, Boissard and Boethius. Those are **contained** (#7685: books held, pages withheld). The rest are listed
there, flagged and not contained.

### 5. The pages the paused run wrote

`rewrite-stale.mjs` covers the full run and the pilot runs: 10,016 pages, 0 conflicts, 2 with no text.
- **Rewritten:** 2,822 pages. Their text and annotations changed, so each got a new `page_annotations` doc under its own run id and a
  revision row.
- **Re-stamped:** 7,194 pages. Their split was identical, so only `text_from.parser_version` changed, with a revision row and no
  duplicate doc.
- **Run ids:** `notes-legacy-5942-rewrite-20261029`, then `-20261029b` for 4 more pages once the invented labels were added.

**Undo order.** Undo `-b` first, then the first rewrite run, then the full run. `undo.mjs` compare-and-sets on the parser version a row
wrote.

**State after.** All 10,016 pages are current and served from the store. Every anchor slices back to its phrase (114,543) and none is
orphaned. 17,856 repeated phrases resolve to their own place.

**Resume.** `backfill.mjs` skips a page only when `text_from.parser_version` is current, so a resumed run redoes any page that is still
/1–/2. That includes pages translation writers stored under /2 since #7652.

### 6. Step 4: the pilot checks again
- **Stratified draw** (2,364 pages, up to 220 per old prompt version):
  - round trip 2,355 (+9 term-lifted);
  - stored = parser 2,364; orphans 0;
  - anchors 24,622: 0 slice mismatches, 0 unresolved, repeated 6,744/6,744 to their own place;
  - character ledger off on 3 pages, the same as /2.
- **The pilot's 1,000:** round trip 995 (+4); orphans 0; anchors 10,281/10,281; character ledger 0.
