---
stage: ocr
measure: judged
languages: [de, en, it, fr, nl, es]
scripts: [Latn]
canons: []
n_books: 30
n_pages: 30
verdict: "On 30 measured-bad pages in living European languages (one per book, 10 untested cells pooled), an Opus correction of the stored text was judged worse on 0/30 and better on 25/30 by Fable (accept 10/30 to 28/30), and a Fable correction worse on 0/28 and better on 23/28 by Opus (accept 9/30 to 27/28). Both judges are Claude models; no cross-family check was run."
status: informational
decision: "No route or table changed. The Opus corrector was used for the fix-euro slice of v3#199: 170 pages written under four run ids, each revertible; 49 manuscript pages await a cross-family re-check."
feeds: repair
supersedes: []
superseded_by: null
issue: [199]
router_evidence: "none — a pooled test of untested euro cells (30 pages, 10 cells); no cell reaches the table n"
defect_rates: "scripts/eval/route-judge-6740/results/fix-euro-199/defect-rates.json"
---
## 2026-11-13 · Do Opus and Fable corrections improve the pages our checks marked bad, in living European languages? (#199)

PRIOR ART: `scripts/eval/error-zoo/repair-pilot/README.md` (#7809: Opus corrects stored Flash-Lite German print, 35 pages, the same `correct.mjs` tool; 28 of its kept corrections were reused here), `2026-10-13-ocr-opus-correct-vs-lane-b-q300-6694.md` (the write-audit stop rule) and `2026-10-28-correction-lane-production-accept-de-fr-7263.md` (the correction lane on German and French print). None tested the cells the router leaves unbound (flash3 drafts with unknown script kind, manuscripts, Dutch, Spanish, Italian, English), and none used Fable as corrector or judge.

**Question.** v3#199: 2,208 pages have been marked serious by a check that read the scan, and almost none were repaired. For the slice "books in a living European language in Latin script", is a Claude correction of the stored text (Opus, or Fable) safe to write on cells the router has not tested?

**Worklist.** Label table rebuilt from Mongo `book_checks` and the audit files on the main box, then `repair-queue.mjs`. After the drops the brief names (text changed since the check, held books, human-edited pages, `cell-test-flash3` writes, the books job fix-feed-8255 is checking by eye), 181 pages in 79 books were flagged serious on served, unchanged text. 41 sat in cells the router binds to Opus (German lite/print, German flash3/print), 4 in cells bound to agy (not run: the pools were spent), 136 in untested cells.

**Design (pre-registered on #199 before any model call).** 30 pages, one per book, drawn across the untested cells (17 German flash3/unknown, 13 from nine other cells). Arms: the stored text; an Opus correction; a Fable correction (`scripts/batch/ocr-convergence/correct.mjs`, one page a call, the page image attached). Judging: `route-judge-6740/judge.mjs`'s prompt, blind, against the image, one page a call, three wrong-page controls per arm, five same-arm repeats per judge. No model judged its own correction: Fable judged the Opus arm, Opus judged the Fable arm, both judged the stored text. Pass rule for a corrector: judged worse than the stored text on at most 2 pages, and more accepts gained than lost.

**Result.** Both correctors pass.

| corrector (judge) | pages | worse | better | same | accepts gained | lost | accept, stored to corrected | wrong-text pages, stored to corrected | mean fidelity |
|---|---:|---:|---:|---:|---:|---:|---|---|---|
| Opus (Fable) | 30 | 0 | 25 | 5 | 18 | 0 | 10/30 to 28/30 | 20 to 2 | 3.13 to 4.63 |
| Fable (Opus) | 28 | 0 | 23 | 5 | 18 | 0 | 9/30 to 27/28 | 17 to 0 | 3.27 to 4.64 |

- Controls: all 12 wrong-page items were rejected at fidelity 1. Repeats: 0 of 10 flipped accept.
- Corrector answers: Opus 29 corrected, 1 UNCHANGED. Fable 24 corrected, 4 UNCHANGED, 2 CONTAIN. Both CONTAIN pages were blank versos whose stored text was invented from show-through; Opus read both as blank.
- The German flash3/unknown cell alone: Opus 0 worse and 14 better of 17; Fable 0 worse and 13 better of 15.
- The two correctors could not be told apart, so the bulk used Opus, as pre-registered.

**What was written.** 177 pages went to a corrector; 170 were written, 5 came back UNCHANGED or with no better read, 2 were left to other jobs (a Coptic plate, a mixed Chinese page).

| run id | pages | what | blind audit of 10 random writes (Fable) |
|---|---:|---|---|
| `fix-euro-test-ocr` | 24 | the test pages' better-judged read (20 Opus, 4 Fable) | the test itself |
| `fix-euro-w1-ocr` | 40 | cells the router binds to Opus | 0 worse, 10 better; accept 4/10 to 10/10 |
| `fix-euro-w2-ocr` | 94 | untested cells, Opus | 0 worse, 7 better, 3 same; accept 1/10 to 6/10 |
| `fix-euro-eye-ocr` | 12 | guard refusals and CONTAIN pages, each opened against its image | checked by the session, not sampled |

- The writer's guards refused 12 reads: 9 for sharing under 40% of their words with the stored text, 1 for letters outside the book's scripts, and the 2 blank-verso reads (the refusal reason for those two was not kept). None was forced. With the image open, 9 were the right leaf with a garbled stored read (8 manuscript leaves, 1 printed page with Coptic folio numerals), 2 were blank versos carrying invented text, and 1 (a Coptic plate) could not be certified and was not written.
- Three pages met the containment rule (the two blank versos; one Spanish page carrying the previous leaf's text). Each book was held, the page's English withheld, a checked read written, and the hold released in the same run.
- Each revert: `node scripts/maintenance/revert-run.mjs --run-id <run id> --apply`.

**Limits.**
- Every judgment here is by a Claude model. 49 of the written pages are manuscript, and the Opus judge favours Opus manuscript readings by about 43 points (#7263); those pages are listed in `manuscript-pages-awaiting-cross-family-recheck.json` and are not settled by this test.
- "Better" is not "clean": 4 of wave 2's 10 audited writes were still not accepted after the correction (equal or better than before, none worse).
- 30 pages over 10 cells is a pooled safety test. It adds no evidence to any single router cell.
- The pages were chosen because a check had already marked them serious, so the stored-text accept rate (10/30) says nothing about the corpus.

### Replicated?

Partly: two correctors each judged by the other model agree, and two blind wave audits (20 pages) found no write worse than what it replaced. Not replicated across model families; `second-read-page-ids.json` orders the 170 written pages for a Gemini second read after the 2026-11-14 pool reset.

**Artifacts.** `scripts/eval/route-judge-6740/results/fix-euro-199/`: `opus-arm-judged-by-fable/` and `fable-arm-judged-by-opus/` (key, recipe, verdicts, paired score), `defect-rates.json` (the same per-arm rates in the shape the lint reads), `audit-w1/`, `audit-w2/`, the two page lists. The wave audits are also in `book_checks` under method `lane-spot-check`.
