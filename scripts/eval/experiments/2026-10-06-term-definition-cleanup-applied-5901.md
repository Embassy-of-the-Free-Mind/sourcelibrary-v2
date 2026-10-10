---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: null
n_pages: 160
verdict: "After four tightenings the term-definition rule passed 40/40 by eye and moved definitions out of <term> on 207,363 pages in 4,911 books (4.0%); 16 pages later corrected."
status: adopted
decision: "Class d_termdef applied with page_revisions undo rows; the same rule now drives the reader (#5901, #5908)"
superseded_by: null
issue: [5901, 5908]
---
## 2026-10-06 · Can a model's definition stored inside `<term>` be moved to a `<note>` by rule, and what did applying it change? (#5901)

PRIOR ART: `2026-10-04-a2-cleanup-applied-5700.md` — the procedure followed here step for step (scan, 40-page by-eye gate through the reader, pilot, apply through `repairTranslationText`, resync, undo proof), and its script, which gains one class. `src/lib/term-definitions.ts` (#5908) — the rule, written for the reader's display; it had not been run over the corpus, and no stored text was changed by it.

**Question.** `<term>Luna: the alchemical name for silver</term>` serves a model's definition as if it were the translated word, in the API, MCP, exports and search text. Is the reader's rule (`<term>X</term> <note>definition</note>`) at least 39/40 clean by eye on stored pages, and if so what does applying it change? Shape 1 only: a `<gloss>` after a term is not touched (`page_terms`, #4695, indexes those pairs).

**Design.** `measure: count` plus by-eye precision; no model, $0.
- **One rule, one copy.** The rule moved to `scripts/lib/term-definitions.mjs`; `src/lib/term-definitions.ts` re-exports it (as `src/` already imports `scripts/lib/lanes.mjs`). The cleanup is class `d_termdef` of `scripts/maintenance/translation-cleanup-a2-5700.mjs` and calls the same function with one extra guard: a chip inside another annotation span is left, because a `<note>` written there would be nested.
- **Scan**: every live translated book: 22,925 books, 5,184,671 translated pages.
- **Gate**: 40 seeded pages, each definition chip shown as stored, then as `prepareNotesMarkdown` gives the cleaned page with notes on and with notes off. Clean = no head word printed twice, no sentence text lost, no genuine term (title, mantra, reference) split.
- **Writes**: as A2. `translation.data` + `translation.content_hash`, one `page_revisions` row first (source `cleanup-termdef-5901`, the replaced text, both hashes). `translation.updated_at` not moved. Human-edited pages skipped (2).

**Result.** Applied to **207,363 pages in 4,911 books (4.0% of translated pages); 473,124 chips**. Every write succeeded, none raced.

| what the rule did | chips |
|---|---|
| `<term>X: def</term>` → `<term>X</term> <note>def</note>` | 243,655 |
| the sentence already has X → `<note>def</note>` only (for a head `X (Y)`, the half the sentence lacks stays the chip) | 199,002 |
| the head is the model's own label (`original:`, `Latin:`, `original Greek:`) → the whole chip becomes a note | 30,467 |

The rate is 4.0%, above the 2.8% the 800-page draw gave (#5895): that draw's interval reaches about 4%.

| language (books' label) | translated pages | pages written | rate |
|---|---|---|---|
| Latin | 1,866,992 | 64,448 | 3.5% |
| German | 557,641 | 38,612 | 6.9% |
| English | 676,074 | 26,331 | 3.9% |
| French | 278,962 | 17,722 | 6.4% |
| Greek | 440,250 | 16,051 | 3.6% |
| Chinese | 271,807 | 10,073 | 3.7% |
| **Tibetan** | **170,796** | **1** | **0.0%** |

**Tibetan, separately.** The rule is language-blind, and the reader's rule as merged fired on 424 Tibetan pages. Read by eye, nearly all of the 750 chips on those pages were not definitions: they were mantras (`<term>Tadyatha: Hume hume, humela, humila, batiye swaha.</term>`) and titles. With notes off the reader hid the mantra. The guards below leave them alone, so one Tibetan page was written (`<term>original: "byang sems"</term>`).

**The rule needed four tightenings before it passed; each is in the shared file, so the reader changes with it.** A colon inside a chip is often the book's own text. Left untouched now:
- citations (`law: Eum ad quem`, `Code: Concerning the most holy churches`, `Psalm 37: verses 35, 36`), mantras, a title with its subtitle (`Book of Jin: Treatise on Astronomy`), proportions (`EG² : AB² = AC + ac : AC`);
- a chip whose head is new to the sentence and whose "definition" does not read as English gloss (`tenebo statum meum: locum meum tuebor`), has a second label inside, or runs past 60 words;
- a colon inside a bracket or after a semicolon (`God (original: ΘΥ)`, `aplaneis; original: "ἀπλανεῖς"`);
- one head with three different texts on a page: the page's own labels (20 urine-wheel captions `Urine color: …`, a recipe's `Take: A capon…`, Hexapla readings `Symmachus: he bent the knee`).

And the head is recognised as already in the sentence when it differs by quote marks, an English ending (`calcined` / `calcination`) or stands up to three words back (`reception of brothers <term>Reception: …`), but never when the word before the chip leads into it (`— The <term>verutum: …</term>, according to…`). A source-language cognate (`substance` / `substantia`) stays a chip.

**Gate log.** All samples are in `summary.json` with page ids.

| sample | rule | clean | what it showed |
|---|---|---|---|
| preview, 12 pages (seed 11, 150-book test scan) | #5908 rule | – | head printed twice across a plural or a quote mark (`drachms <term>drachm`); fixed before sample 1 |
| 1, seed 5901 | v1 | 39/40 | one doubled head (`five mourning grades Five Mourning Grades (Wufu)`). **Treated as a fail anyway**: a search of 12,000 candidate pages outside the sample found the mantras, citations and titles above, which a 40-page sample does not reach |
| 2, seed 5902 | v2 | **37/40, fail** | `Sanhedrin Sanhedrim`, `reception of brothers Reception`, `calcined calcination` |
| 3, seed 5903 | v3 | 39/40, pass | `<term>aplaneis; original</term>` left as the chip; that shape was then excluded, so the page is no longer touched |
| 4, seed 5903 on the final candidate list (40 other pages) | v4, applied | **40/40** | – |

On all 160 pages the reader's text is the same before and after the rewrite, with notes on and with notes off: the stored text now holds what the reader was already showing.

**One fault was found after the apply and repaired.** The re-scan flagged a page of urine-wheel captions that had been written as notes. The three-different-texts guard was added, and the final rule was then run over the pre-cleanup text of all 207,373 written pages (from their revision rows): 16 pages came out differently. Those 16 were restored with `--undo`; 6 were re-written under the final rule and 10 stay as they were before the job. All 207,363 remaining pages hold exactly what the final rule gives.

**Left alone on purpose.**
- `<term>X</term> <gloss>Y</gloss>` (shape 2): held, #5901 comment of 2026-10-06.
- 3,767 pages with a definition chip inside a `<note>`, `<margin>` or other span.
- Definitions the guards refuse although they are real: a head that is also a citation label (`Chapter: the governing body of a cathedral`), a definition with no joining word (`rock salt: naturally occurring sodium chloride crystals`), a two-word definition (the #5908 floor). The reader still splits none of these, so they print as before.
- 1 page where the first pass changed the context of a later chip, so a second pass would now drop its head. Left, as A2 left 15.

**Checks.**
- Pilot of 3,000 pages first; 5 fetched from `https://sourcelibrary.org/api/pages/<id>`: no `head: definition` chip left, `updated_at` old.
- 400 random written pages: one revision row each, the page holds the text named by `after_content_hash`, `updated_at` equals the row's `original_date`. 400/400.
- `--undo` on one pilot page restored it byte-identically; re-applied to the same hash.
- Other sessions: no `translation-cleanup` process on this box, no claim on #5700 or #5901, and no `cleanup-*` row among the newest 3,000 `page_revisions` rows (90 minutes). **`ps` on Hetzner was not possible: this box has no SSH key for it.**
- Re-scan after the apply and the correction: the class on 1 page (the second-pass page above), 2 human-edited pages, 3,766 pages skipped for a chip inside a span.

**What reacts downstream.**
- Nothing retranslates or re-embeds: `translation.updated_at` is unchanged, which is what the translate worker, `embed-gemini` and the `sync-pages-content` cron key on.
- Supabase `pages` mirror: `--resync` updated 205,717 rows (plus the 16 corrected pages). On a 3,000-page sample 2,978 mirror rows equal Mongo, 0 differ, 22 pages have no mirror row.
- Search snippet column (`page_translations.translation`): NOT rewritten, for A2's reason (each update re-inserts the row under the HNSW index). It still holds the old chip text. `--resync --snippets --dir <run dir>` does it when wanted.
- Published editions: 111 touched books have an edition (7,049 changed pages). `edition-reader` serves the revision row's text for a versioned URL, so those editions still read as published.
- `page_revisions` consumers: the label matches `MAINTENANCE_RE`, so the agreement stack excludes these rows (pinned by a test).
- `note_claims` (#5647): keyed to `translation.content_hash`; it covers 6,385 pages in 883 books and none of them was changed.
- `page_terms` (#4695): built on demand from `translation.data`, no cron. A chip `X: definition` was indexed as the term `X: definition`, or dropped when over 80 characters. On the next build it is the term `X`; where the head was dropped there is no chip. Term + `<gloss>` pairs are unchanged.
- Reader, on merge of this PR: pages not rewritten (later translations, chips inside spans) are shown by the tightened rule. Mantras, citations and captions inside a chip are no longer hidden with notes off.

**Replicated?** No. One run. The final rule has one clean 40-page sample, which bounds the page fault rate at about 7%, and the repeated-label fault was found by the re-scan, not by the gate: 16 pages in 207,373. Other rare shapes of book text inside a chip may remain.

**Artifact.** `scripts/lib/term-definitions.mjs`, `scripts/maintenance/translation-cleanup-a2-5700.mjs` (`--classes d_termdef` on `--scan`, `--review`, `--apply`, `--undo`), `tests/unit/term-definitions.test.ts`, `tests/unit/translation-cleanup-a2-5700.test.ts`, `scripts/eval/results/term-definition-cleanup-2026-10/summary.json`. Undo key: `page_revisions.source = 'cleanup-termdef-5901'` (`--undo --classes d_termdef --dir <run dir>`; it restores the text held by the newest row with that label). The run directory, with the list of written page ids, is `/data/scratch/sl/claude-jobs/termdef` on the cloudlayer job box.
