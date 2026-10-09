## 2026-10-06 · Notes as their own layer, phases 1–2: is the note-free prompt safe on Flash-Lite, and can stored markup be parsed into text + annotations? (#5942)
<!-- PRIOR ART: 2026-10-06-translation-notes-free-5919.md (PR #5926) ran v13 twice against v13-plain on 40 pages, 12 of them on Lite; its runner, scorer and rule are reused here on 40 other pages, all Lite. The #5695 fidelity harness (translation-vs-reference/) is used unchanged. For the parser: src/lib/term-definitions.ts and src/lib/notes-off.ts are called, not rebuilt. -->

**Question.** (1) On pages whose book ships on `gemini-3.1-flash-lite`, is the note-free prompt (`v13-plain`, the in-memory edit of #5919) no less faithful to a human reference than v13? #5919 left this open: its 12 Lite pages scored 0.25 lower. (2) Can a pure function split today's stored translation markup into the book's words and a list of annotations, so that rendering the two reproduces what the reader shows now?

**Preregistered rule for phase 1 (written and pushed before any model output existed; the same P1 and P2 as #5919).**
- **Pages.** 40 pages from 40 books that route to Lite today, with a public published English translation, from the #5695 sets T1 (Latin) and T3 (vernaculars): Latin 16, German 8, French 5, Italian 5, Dutch 3, Spanish 3. Seed 5942. No book that #5919 used. No Tibetan. `scripts/eval/notes-layer/build-lite-sample.mjs`; the pinned draw is `results/notes-layer-2026-10/lite/sample.jsonl`.
- **Arms.** `v13-a`, `v13-b` (the live default row run twice: the noise floor) and `v13-plain` (hash `655488d8ecd524d7f3139fe9aeec50f5`, asserted before spending). Production door, Lite, temperature 1, thinking off, one page per request, no previous-page translation. Runner: `translation-notes-free/run-arms.mjs`, pointed at this sample by environment variables and otherwise unchanged.
- **Instrument.** The #5695 harness unchanged: two blind Opus judges, controls first; the run stops if the gate fails.
- **P1 fidelity (non-inferiority).** Pass when mean(plain) − mean(v13-a) ≥ −max(|v13-b − v13-a|, 0.15) AND the paired bootstrap CI's lower bound is above −0.30.
- **P2 reversals.** Pass when pages with a reversal quoted by either judge in plain ≤ the same count in v13-a + 1.
- **Decision.** P1 and P2 pass → the note-free prompt is cleared for Lite as well as Flash (the switch itself still waits for the notes step, #5942 phase 5). Either fails → the switch is Flash-only, or waits.
- **Reported, not in the rule.** Cost and tokens, tags left in plain, definitions in brackets, text hidden in `<meta>`, by language; and the 12 Lite pages of #5919 beside these 40, never pooled into the rule.
- **Replacement.** A page that fails in any arm after four attempts is dropped from all three arms and named; no redraw.
- **Spend.** Envelope `notes-layer-5942`, cap $2, expected under $1; removed after the run.

**Result, phase 1. P1 and P2 pass on Lite: on these 40 pages the note-free prompt is not less faithful than v13.**

| 40 Lite pages, two blind Opus judges | v13-a | v13-b | v13-plain | plain − v13-a | v13-b − v13-a (floor) |
|---|---:|---:|---:|---:|---:|
| **fidelity** (1–5), mean [CI] | 4.24 [4.03, 4.45] | 4.26 [4.06, 4.45] | 4.38 [4.16, 4.59] | +0.14 [−0.01, +0.30] | +0.03 [−0.14, +0.20] |
| pages with a reversal, either judge | 6 | 3 | 3 | | |
| pages with an omission (mean of two judges) | 11% | 11% | 8% | −4 points [−11, +3] | 0 [−10, +10] |
| output tokens | 603 | 605 | 581 | −4% | 0% |
| cost | $0.00153 | $0.00153 | $0.00142 | −7% | 0% |
| `<note>` / `<gloss>` tags (total) | 30 / 56 | 42 / 45 | 0 / 0 | | |
| single [brackets] (total) | 3 | 5 | 11 | | |

- **P1 passes.** The rule allows plain to sit 0.15 below v13-a with the CI's lower bound above −0.30. Plain is 0.14 above; the lower bound is −0.01. Each judge alone agrees (+0.13 and +0.15). This is "not worse": the interval still includes zero.
- **P2 passes.** Reversal pages: plain 3, v13-a 6 (allowed 7). Two of plain's three are pages every arm reverses (an Italian double negative in Castiglione; quince and scammony swapped in Paracelsus); the third is an Italian page v13-a also reverses.
- **Controls passed for both judges** (wrong page 3/3, planted change 3/3 caught and located, duplicate 3/3 tied). Weighted κ 0.85, exact agreement 85%, never more than 1 apart.
- **By language (exploratory).** Latin, 16 pages: 4.09 / 4.06 / 4.31. Vernaculars, 24 pages: 4.33 / 4.40 / 4.42. No language group falls.
- **The 12 Lite pages of #5919, kept apart.** There: 4.63 / 4.38 / 4.38, plain − v13-a = −0.25 [−0.58, +0.08]. Here, on 40 other pages: +0.14. The earlier fall was the size of v13's own second run on those 12 pages, and it does not repeat.
- **Leakage.** `<note>` 0 and `<gloss>` 0 in plain; no loops, no invented tags, no MAX_TOKENS. Of 11 single brackets, 8 are supplied words as asked and 1 is a letter repair; **2 are a definition after a word** on 2 pages (`<term>seplasiariorum</term> [apothecary-sellers]`, `"Growers" [plants]`). That is 1 page in 20, against 1 in 13 in #5919. The write guard (#5902) is still needed.
- **Body length.** Plain is 0.0% shorter than v13-a in total (v13-b: 0.6% shorter). Text hidden in `<meta>` over 200 characters: one page in v13-a, one in v13-b, none in plain.
- **Invention by kind.** Pages with an `added_fact`: 48% / 50% / 14%. `unreadable_fill`: 15% / 6% / 6%.
- **Cost.** Lite is 7% cheaper per page without the notes instructions ($0.00153 → $0.00142), less than the 11% of the mixed sample because Lite writes fewer notes to begin with (0.75 per page here against 3.1).
- **Spend: $0.179** of the $2 cap, 120 calls, none failed. Envelope `notes-layer-5942` is removed.

**By the preregistered rule.** P1 and P2 pass → the note-free prompt is cleared for Lite as well as Flash. Nothing is switched: the default prompt is unchanged, and the switch waits for the notes step (phase 5).

**Result, phase 2. The parser splits every page of an 800-page draw exactly. Shown through today's reader, text + annotations is byte-identical on 97.9% of pages with notes on and 84.5% with notes off; every other page is listed below, and all but two differ only in whitespace or in a line today's notes-off wrongly deletes.**

`src/lib/translation-layers.ts`: `parseTranslationLayers(markup)` → `{ text, annotations[], pageLevel[] }`, and `renderTranslationLayers`. It calls `separateTermDefinitions`, `preprocessTerms`, `stripAiAnnotations` and `normalizeAnnotationSpans`; it restates none of their rules. `measure`: exact string comparison, no judge.

- **Draw.** 800 pages from 800 live books (visible, with pages, with a translation; Tibetan left out as briefed), seed 5942, one translated page per book. Prompt versions from v1 to v13; 551 pages carry at least one annotation, 2,870 annotations in all (note 1,222; gloss-model 827; original 698; definition 105; image 18).
- **(a) Round trip.** The comparison is `prepareNotesMarkdown(...).processedText`, today's stored string against text + annotations.

| | notes on | notes off |
|---|---:|---:|
| byte-identical | 783 (97.9%) | 676 (84.5%) |
| differs only in whitespace at the start or end of the page | 3 | 112 |
| differs only in a run of three or more blank lines | 13 | 0 |
| differs only in spacing inside a line | 0 | 4 |
| text keeps a line that today's notes-off deletes | 0 | 7 |
| other | 1 | 1 |

  - *Start or end whitespace (115).* Today's reader leaves a stray newline where a first or last note or glossary line was removed; the stored text does not. Markdown renders both the same.
  - *Blank-line runs (13).* The stored text has two newlines where the page had three or more. Same rendering.
  - *Spacing inside a line (4).* A space is left before punctuation where a note sat inside a `<term>` chip or beside a dropped `[bracket]`: "the saints , or". Visible, small, and worth a fix in phase 3.
  - *Lines today's notes-off deletes (7 pages, 0.9%).* A heading or dictionary headword written as a term and its gloss (`# <term>Shui Yang Mei</term> <gloss>Adina rubella</gloss>`) matches the "trailing glossary line" rule, so turning notes off removes the book's own heading, headword or index entry. The parser keeps the word in the text when it appears nowhere else on the page, and lifts only the gloss. This is a defect in today's reader, found here; it needs its own issue.
  - *Other, notes off (1).* Lifting a note from between a term and a printed footnote leaves `<term>…</term> <gloss>footnote</gloss>`, which the reader's "gloss after a term is the model's" rule then hides. A reader of the stored text must not run that rule a second time.
  - *Other, notes on (1).* `normalizeAnnotationSpans` is not idempotent on a numbered line: `<margin>30. 101. 14.</margin>` becomes `30. <margin>101. 14.</margin>`, then `30. 101. <margin>14.</margin>` on a second pass. A reader of the stored text must not normalise it again, or the normaliser needs fixing.
  - The parser reports `exact: false` and falls back to plain notes-off text when it cannot place every annotation. That happened on 0 of 800 pages.
- **(b) Anchors.** Of 2,870 annotations: **2,289 (79.8%) have a phrase found exactly once** in the text; 292 (10.2%) have a phrase found more than once, where the stored offset picks the right one; 289 (10.1%) stand alone with no phrase (a description or note in its own paragraph, a note under a heading); 0 point at a phrase that is not in the text. Among annotations that have a phrase, 88.7% resolve on the phrase alone. A definition is anchored to its term; any other inline note to the 3–12 words before it, as many as it takes to be unique.
- **(c) By eye, 40 pages** (30 with annotations, 10 without; seed 5942; `parser/by-eye.jsonl`).
  - **Annotations at the right phrase: 152 of 153.** The one miss (a note about a seal attached to the last term of the paragraph above) was a parser bug, fixed, with a test.
  - **Text holding only the book's words and page marks: 36 of 40.** The four failures are things the model wrote with no tag that says so: prose about an illustration outside any tag (1 page); a definition in a `<gloss>` after a plain word, not a term, so it reads as a gloss printed on the page (2 pages); a stage direction in single brackets, "[Blank page — no translatable content]" (1 page). The parser cannot see these. They are what the note-free prompt and the write guard are for.
  - One page had the book's printed footnote references inside the model's "original:" notes, so the text lost them. The reverse error, also invisible to a parser.
- **Also measured.** 172 of 800 pages (22%) have single `[brackets]`, the translator's supplied words. They stay in the text; today's notes-off hides them. `<summary>`, `<keywords>` and `<meta>` are machine text on 412 pages and are lifted as page-level blocks, not annotations. Text is 81% of the stored string by length.

**Consumers of `translation.data`** (`consumers.tsv`, from `git grep` on origin/main at 71e2337ef): **342 files, 1,018 lines.** 271 use the words; 71 only test that a translation exists.

| surface | files | in `src/` | use the words | of those, no cleaning helper in the file | after phase 3 |
|---|---:|---:|---:|---:|---|
| pipeline (writers, counters, gates) | 70 | 34 | 40 | 28 | writers add text + annotations in the same write; counters keep testing `translation.data` |
| eval and analysis scripts | 69 | 0 | 62 | 45 | `translation.data`, unchanged: they study the model's output |
| maintenance, migration, import scripts | 63 | 0 | 46 | 42 | unchanged; one that rewrites `data` must re-run the parser |
| exports (EPUB, PDF, text, DTS, IIIF, git) | 28 | 14 | 24 | 15 | text, plus annotations when notes are on |
| admin and other API | 22 | 22 | 18 | 11 | editors keep `data`; displays move to text |
| derived metadata (chapters, index, summaries, entities) | 16 | 6 | 14 | 14 | text |
| reader | 16 | 16 | 14 | 6 | text + annotations through `renderTranslationLayers`, old path as fallback |
| search | 11 | 8 | 11 | 7 | text |
| audit scripts | 11 | 0 | 9 | 9 | unchanged, plus one audit that re-parses `data` and compares |
| embeddings and alignment | 10 | 3 | 8 | 4 | text |
| quotes and share cards | 5 | 3 | 5 | 1 | text only |
| MCP and Librarian | 4 | 4 | 4 | 3 | text; annotations only when asked, labelled as ours |
| tests, other | 17 | 3 | 16 | 12 | unchanged |

Limits: a file that reaches the string through a destructured variable is not found, and writes are not classified (most go through a nested `translation: { data }` object). Two consumers are not code: the Atlas Search index over `translation.data`, and the Supabase copies that embeddings read. "No cleaning helper in the file" is a string check, not proof that notes are shown; it marks where to look first. Fourteen of the sixteen derived-metadata files, which feed chapters, summaries and the book index, have none.

**Field-sprawl review of the phase-3 proposal** (`.claude/docs/invariants/field-sprawl.md`).
1. **`page_annotations` as a collection: right.** Annotations have their own writer (the notes step), their own life (re-run per stance, on demand) and are many to a page: rows, not columns. One amendment: **one document per page and source, not one per annotation**, carrying the hash of the text its offsets refer to. Annotations are read together and are valid only against one text; 3.6 a page would be about 17 million rows otherwise, and a half-written set would be possible. About 82% of pages would have a document (653 of 800 have an annotation or a page-level block).
2. **`translation.text` as a field: right in kind, wrong without guards.** It describes the page, not a job, so by the rule it is a field. But it is a second column for one concept, the page's English, and the invariant doc is about exactly that. Three guards make it safe:
   - register it in `PAGE_FIELDS` (`scripts/lib/book-docs.mjs`) with `translation.text_from`, the content hash of the `data` it was parsed from;
   - **one accessor, checked on the read side**: use `text` only when `text_from` matches the stored `data`; otherwise take the old path. A writer that changes `data` and forgets `text` is then harmless. 133 pipeline and maintenance files name this field and will not all be changed;
   - a CI ratchet on files that read `translation.data` (342 today, a list that may only shrink), so the easy path stops being the unseparated one.
3. **A cheaper shape, for Derek to weigh.** After the prompt switch (phase 5), a new page's `data` is already note-free, so `text` would duplicate it for every new page for good. The alternative is to split the legacy pages in place: `data` becomes the clean text, the raw inline output is kept as a `page_revisions` row, annotations go to `page_annotations`. No new field, and the 342 consumers are right without being touched. Against it: it rewrites the primary text of about 4.9M pages, changes every `content_hash`, and #5942 puts rewriting stored translations out of scope. **Recommended default: the proposal with the three guards and the one-document amendment**; revisit the in-place split once the notes step is live and the parser has run over the whole corpus as an audit.
4. Either way, summary, keywords and meta need a home: they are machine text with no anchor. The parser returns them as `pageLevel`; they belong in the same `page_annotations` document.

**As executed (deviations).**
- Phase 1: the 12 main chunks were judged by 4 subagents, each given 3 chunk files in turn (4 more had judged the gate), to stay within 8 subagents. The judge prompt is unchanged. The runner and scorer of #5926 take the sample, output directory and envelope from environment variables; with none set they behave as before.
- Phase 1: Coptic (#5778) routes to Lite and has public references, but its records carry no source text and the reference translates the Greek. It was left out before the draw.
- Phase 2: the parser returns a third list, `pageLevel`, beyond the `{ text, annotations }` of the issue, and each annotation carries a `layout` (insertion point and the whitespace removed with it) so the inline form rebuilds byte for byte.
- Phase 2: notes off is not reproduced where today's reader deletes a line of the book (7 pages). That was chosen, not missed.
- Phase 2: by-eye verdicts are one reader's (Claude), not blind, on the parser's own output.

**Replicated?** Phase 1 is itself the replication of #5919's open Lite question, on disjoint books: the direction reversed (−0.25 on 12 pages, +0.14 on 40). Phase 2: one draw.

**What it means.**
1. The note-free prompt can be the default on Lite and on Flash once the notes step exists. Fidelity is not what holds it back.
2. Stored translations can be split into text and annotations by a pure function, today, with no model call. The split is exact on every page drawn.
3. A parser moves only what the model tagged. About 1 page in 10 by eye has machine words with no tag, and 1 page in 110 loses a line of the book to today's notes-off. Both are defects of the stored strings and of the reader, not of the split.
4. Phase 3 is a data-model decision, not a research question: the shape is recommended above and posted as one decision row.

**Artifact.**
- `src/lib/translation-layers.ts`, `tests/unit/translation-layers.test.ts` (20 tests)
- `scripts/eval/notes-layer/` (`build-lite-sample.mjs`, `draw-pages.mjs`, `measure-parser.mts`, `by-eye-sheet.mts`, `consumers.py`)
- `scripts/eval/results/notes-layer-2026-10/`: `lite/` (sample, arms, records, mechanical, verdicts, key, results), `parser/` (draw, results, per-page, diffs, by-eye), `consumers.tsv`
