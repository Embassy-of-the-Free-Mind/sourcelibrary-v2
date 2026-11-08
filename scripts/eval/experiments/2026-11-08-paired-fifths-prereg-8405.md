---
stage: ocr
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 160
n_pages: 800
verdict: "Preregistration only; results land in a later commit."
status: informational
decision: "None yet. The rule in §5 decides whether the standing Opus QA reads 10 paired pages a book or stays at 5."
feeds: figure
superseded_by: null
issue: [8405, 7866, 8399]
router_evidence: "none — no route compared"
defect_rates: "none — the bad-page and bad-book rules of #7866 are reused; no rate is quoted from this run"
---
## 2026-11-08 · Two adjacent pages from each fifth: does the paired check find bad books the 5-page check misses? Preregistration (#8405)

PRIOR ART:
- `2026-10-31-confidence-validation-7866.md`: 160 books, 5 pages each (one from each fifth), blind Opus; ICC 0.38, so 5 pages give reliability 0.75. Its 800 verdicts are in `book_checks` (method `judged-pages`, run `confidence-validation-7866`) and are reused as the anchors here.
- #8399 (session sourcelibrary-b3): in 30 h, 77 of 6,195 agy translations opened with English already on the previous page. Per-page judges cannot see that; this run adds a judge of the break. Its census function `openingEcho` (`scripts/lib/neighbour-guard.mjs`, PR #8409) picks the census stratum.
- `src/lib/paired-fifths.ts` / `scripts/lib/paired-fifths.mjs`: the shared draw. Here `pairsFromAnchors` adds to each #7866 anchor the next page, else the previous one.

### 1. Question
Derek (2026-11-08): "maybe we should have 10 page checks, 2 pages next to each other across each 5th of the book", for both the volunteer shift and the Opus QA, "and test". The shift's reading costs us nothing, but pairs double the Opus QA's reading. The question is whether the extra pages and the five joins turn enough books from good to bad to be worth that.

### 2. Frame
The 160 books of #7866, with its 5 anchors each. For each anchor, the partner is the next page if it passes `eligiblePage` (#7866) and is not another anchor, else the previous page. An anchor with neither stays single. An anchor whose OCR `updated_at` has changed since its check (or is later than the check) is judged again. Books are judged in a seeded order (`SEED.books = 84051`), so a run that stops is still whole books.

**Census stratum** (outside every book-level number): breaks in the same books, not in any pair, where `openingEcho` flags page n's opening English as already on n-1. Up to 40 are drawn with `SEED.census = 84053`. It measures the detector's precision, the share of flagged breaks the join judge fails, for #8399.

### 3. Readers
- **Page judge:** the #7866 judge unchanged (`judgeAbsolute`: route-judge-6740 `judgePrompt`, OCR task, Opus via `claude -p`, page image in the workspace), on the partner pages and the stale anchors.
- **Join judge (new):** Opus via `claude -p` with both scans (`a.jpg`, `b.jpg`), both transcriptions and both English texts (`joinPrompt` in `run.mjs`). Defects are `carry_over | duplicated | dropped | wrong_leaf | other`, each with its layer, its page (the direction) and `material`. Catchwords, running heads and signatures are not defects.
- **Controls (join judge):** 10 carry-over plants (B's English opens with the last sentence of A's English) and 10 wrong-leaf plants (B's texts replaced by a page of another book, same language when one exists), on random-set breaks. The judge is **valid** when each kind has ≥ 8 judged and ≥ 0.80 caught: carry-over as a material `carry_over`/`duplicated`, wrong-leaf as `wrong_leaf` on page B.
- **Smoke, 2026-11-08 (laptop, not part of the run):** one page (fidelity 5, accepted), one random join (clean, quoting both sides of the seam), and one carry-over control (caught: `carry_over`, English, page B, the planted sentence quoted).

### 4. Rules
- Bad page (#7866): not accepted, or any `wrong_text` defect.
- Book bad on its anchors (#7866): ≥ 2 bad of ≥ 4 judged.
- Book bad on its 10 pages: ≥ 4 bad of ≥ 8 judged (the same share).
- Join fails: any material `carry_over`, `duplicated`, `dropped` or `wrong_leaf`.
- **Book bad, paired:** bad on its 10 pages, or any of its joins fails.
- A book counts only when all of its partners, joins and anchors are judged.

### 5. Decision (fixed now)
With valid controls and ≥ 80 complete books: if ≥ 5% of complete books are **good on the anchors and bad paired**, the standing Opus QA moves to paired-fifths. Otherwise it stays at 5 pages, and pairs are used only in the volunteer shift (already built, #8405).

### 6. Also reported (no decision rides on them)
- Flips split by cause (joins only, partner pages only), and bad-to-good flips.
- Breaks by kind: `call_boundary` vs `in_call` vs `unknown`, from `translation.engine.run.read_call` (#8399), with failure counts and the direction (which page holds the misplaced text).
- Reliability of the 10-page grade: the split-half correlation of the anchors' and partners' bad-page shares across books, Spearman–Brown stepped up to 10 pages. This treats pair-mates as independent halves, so it is an upper bound.
- Census precision.

### 7. Budget
About 800 partner pages, 800 joins, the stale anchors (3 of 20 in a 4-book frame), 20 controls and up to 40 census breaks: ~1,700 Opus calls on the subscriptions, capped at 1,800 (`CALL_BUDGET`), behind the lane-judge pace guard (weekly 85%, 5-hour 95%). No API spend.

### 8. Run
`node --env-file=… scripts/eval/paired-fifths-8405/run.mjs frame`, then `… judge` (resumable), then `… analyze` → `scripts/eval/paired-fifths-8405/results/score.json`. Nothing writes to Mongo.
