---
stage: translation
measure: none
languages: []
scripts: []
canons: []
n_books: 22925
n_pages: 5184671
verdict: "A read-time repair changes 72,191 of 5.18M served translation pages (1.39%, 9,002 books); by-eye precision was 37/37 to 40/40 per class."
status: adopted
decision: "repairLeakedMarkup runs in the reader, stripEditorialWrappers and the EPUB/HTML export; the stored-text (A2) apply is proposed, not run"
superseded_by: null
issue: 5700
---
## 2026-10-06 · How many served translation pages carry each class of leaked markup, and which can a read-time rule fix? (#5700 A1(c))

PRIOR ART: `2026-10-03-quality-census-backfill-sizes-5700.md` sized leaked markup on one page per book, by the classes the A2 stored-text cleanup then fixed (`2026-10-04-a2-cleanup-applied-5700.md`: empty and orphan tags, printed centre markers). This run counts the classes the 2026-10-06 random spot check (#5914) found afterwards, on every page, and counts them with the repair itself.

**Question.** For each class of raw markup a reader met in the English (entities, doubled terms, a tag through a word, `#`, the continuity `<meta>`): how many served pages carry it, and is a deterministic read-time rule clean enough to ship?

**Design.** `measure: count` plus by-eye precision; no model, $0, no writes. Script: `scripts/audit/leaked-markup-census.mjs`. Population: every translated page (`page_number ≥ 0`) of every live translated book (`visible`, `pages_count > 0`, `pages_translated > 0`): **22,925 books, 5,184,671 pages, exact**. The fixable classes are counted by `repairLeakedMarkup(text, { fired })` (`scripts/lib/leaked-markup.mjs`), the function the reader, `stripEditorialWrappers` and the EPUB/HTML export now call, so the count is the number of pages the fix changes. By eye: a seeded draw from a reservoir of excerpts per class, before and after.

**Result.** The repair changes **72,191 pages (1.39%) in 9,002 books (39% of live translated books)**. The classes a reader of the web page met (every row but `entity` and `hash_close`) are on at most 31,234 pages, in 6,593 books.

| class | example (stored text) | pages | books | by eye |
|---|---|---:|---:|---|
| `hash_close` | `### BOOK THREE ###` | 21,290 | 1,550 | 39/39 |
| `entity` | `&nbsp;&nbsp;&nbsp;&nbsp;Then, at the signal` | 20,466 | 4,690 | deterministic |
| `dup_term` | `the Vedas <term>Vedas</term>` | 13,771 | 3,634 | 40/40 |
| `hash` | `BOOK THREE ###`, `25 ### That the cause` | 9,435 | 2,494 | 37/37 (3 excerpts showed another rule) |
| `meta_label` | `<meta>continues from previous page: ` + the page, never closed | 5,919 | 1,616 | 40/40 |
| `break_tag` | `</leaf-break/>`, `</column-break>` | 1,330 | 583 | 12/12 |
| `tag_attr` | `<note original: "figuram">An astrological chart…</note>` | 765 | 418 | 40/40 |
| `meta_attr` | `<meta type="catchword">fore</meta>` | 12 | 8 | 8/8 |
| `stutter` | `two inches <gloss>in</gloss>ches` | 2 | 2 | 2/2 after two fixes (below) |

Pages overlap, so the rows sum to more than the total. Numbers are from the second full pass, run on the code that ships.

What each one looked like to a reader before:
- `hash_close`: a valid closing sequence, so the reader never showed it. The quote API, snippets and the EPUB strip only the opening hashes and printed `BOOK THREE ###`. Found by the local by-eye check after the first pass.
- `entity`: the reader's Markdown already decoded these. The quote API, snippets, `/text`, the PDF and the EPUB printed `&nbsp;` as six characters. 1,279,711 entities in all; `&nbsp;` is nearly all of them (verse indents, table spacing).
- `dup_term`: the word twice, the second in a purple chip. With notes off, twice in plain text.
- `meta_label`: the reader pairs `<meta>…</meta>`; with no closer the tag fell away and "continues from previous page:" stood as the page's first words. The words after the label are the page's own text in all 40 read, so only the opener and the label go.
- `break_tag`: printed as the literal text `</leaf-break/>`, and the leaf seam or column break was lost.
- `tag_attr`: printed as literal `<note original: "…">`.
- `meta_attr`: the catchword or signature printed as body text.

Counted and left alone:

| class | pages | why not here |
|---|---:|---|
| closed continuity `<meta>` holding ≥ 8 words (`continuityMeta`, #5305) | 90,273 (1.74%) | The reader hides it, so it is not a leak; whether the hidden words are this page's text is the #5305 question and needs the previous page. |
| a tag outside the vocabulary (`<italic>`, `<center>`, `<quote>`, `<foreign>`, `<person>`, …) | 43,603 (0.84%) | The reader unwraps it and keeps the words. Mapping `<italic>` to emphasis is a formatting gain, not a leak fix. |
| a note-family tag inside a word (`al<unclear>ter</unclear>ation`, `<insert>H</insert>ere`) | 4,621 | Transcription: an uncertain syllable, a drop capital. |
| another `#` in a line | 3,846 | On the sample these are the source's: `C#`, `F#`, `# 2`, shelf marks. |
| an entity the rule does not decode | 166 | `&lt;`/`&gt;` (decoding makes a tag) and unknown names. |

**The Tengyur `#`.** No live book is titled Derge Tengyur or Kangyur, so the Esukhia note points are not in the served population today. `stripHashMarks` (`tengyur-draft-repairs-5497.mjs`) removes them from stored text with revision rows. A read-time rule for `#` inside a line would also strip the sharps above, so there is none.

**What the by-eye read changed (before any number above was final).**
- `stutter` read 3 of 4: on a papyrus read letter by letter (`<unclear>k</unclear>ai <unclear>a</unclear>i`) it deleted a real word. A repeated word must now follow a space or opening punctuation, never `>`. Same guard on `dup_term`; 13,799 → 13,771 pages. The rule then lost `<unclear>` and `<insert>` altogether: they mark what is on the page, and the helper also sees transcriptions (4 → 2 pages).
- A non-continuity `<meta>` nothing closes was to be closed at its paragraph's end. Both sample hits were pages where the model printed its own instructions (`` `<meta>` `` in backticks). Rule dropped.
- `<meta catchword="Return"/>`: rewritten as an opener it would pair with the next `</meta>` and hide the text between. A self-closing `<meta/>` is now removed.
- `<note original: "无羊"> refers to King Xuan…` has no closer. The attribute becomes the whole note; the sentence stays body text.

**Checks.** `tests/unit/leaked-markup.test.ts`: the strings from the two books the spot check named (*Song Celestial* 699065e7726f64800c10c689 pp. 13 and 23, *Satchakranirupanam* 6991d8938c1030b12444bfdb p. 12) and one real page per rule, through the function, the reader (`NotesRenderer` rendered to HTML), `stripEditorialWrappers` and its scripts twin, and the EPUB/HTML export. The repair is idempotent and linear on a junk page.

**Replicated?** Two full passes of the count, the second after the rule changes above; the classes whose rule did not change returned the same numbers (`entity`, `meta_label`, `break_tag`, `tag_attr`, `meta_attr` and all five watch classes). The by-eye read is not replicated: each by-eye sample is one draw (0/40 bounds a fault rate at about 7%).

**Proposed, not run: the same repair on stored text (A2).** The search snippet column and the embeddings were written from stored text, and the native apps read it raw, so they still carry these. `--apply` through `repairTranslationText` with one `page_revisions` row per page (as `cleanup-a2-5700` did) would cover the 72,191 pages. `entity` should keep the reader form (no-break spaces) there. Snippet rewrite costs 235 ms a row on the live search table.

**Artifact.** `scripts/lib/leaked-markup.mjs`, `scripts/audit/leaked-markup-census.mjs` (`--summary`, `--books-file`), `tests/unit/leaked-markup.test.ts`.
