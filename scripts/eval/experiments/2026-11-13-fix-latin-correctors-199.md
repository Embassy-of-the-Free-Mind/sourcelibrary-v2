---
stage: ocr
measure: judged
languages: [la]
scripts: [Latn]
canons: []
n_books: 30
n_pages: 30
verdict: "On 30 Latin pages already flagged serious (stored text from 3 Flash, script unknown), both Claude correctors beat the stored text against the image under a judge from the other model family: an Opus correction was better on 26/30 and worse on 0/30 (judge Fable, accepts 4→23), and a Fable correction was better on 27/30 and worse on 0/30 (judge Opus, accepts 5→27). Each judge was used on one arm only, so this does not rank Opus against Fable. In the bulk, 349 pages were written, and the 10-page audit of each wave found 0 worse (38 of 40 judged)."
status: adopted
decision: "Used as the repair route for the measured-bad Latin pages of v3#199 (run ids fix-latin-test-ocr, -w1-, -w2-, -w2b-, -w3-, -w4-, -eye-ocr). The routing tables and current.json are untouched: this repairs pages already flagged bad, it is not a first-read route."
feeds: "route"
landed: scripts/eval/route-judge-6740/results/fix-latin-199/written-page-ids.jsonl
supersedes: []
superseded_by: null
issue: [199]
router_evidence: "none — a repair test on pages a book check had already flagged serious; it binds no router-table cell"
defect_rates: "none — scored with paired-arm.mjs (accept, fidelity and wrong-text per arm, scripts/eval/route-judge-6740/results/fix-latin-199/paired-score.json); no per-1,000-word rates were computed"
---
PRIOR ART: `scripts/eval/error-zoo/repair-pilot/README.md` was the last repair attempt on flagged pages. It stopped before any bulk write. No earlier entry tests Claude correction of flagged Latin pages against a blind judge from the other model family.

## 2026-11-13 · Does an Opus or Fable correction beat the stored text on Latin pages flagged bad? (#199)

**Design (pre-registered on #199 before any model call).** Arms: the stored text; an Opus correction; a Fable correction (`scripts/batch/ocr-convergence/correct.mjs`, one page a call). Pages: 30 pages from 30 books, the largest cell of the worklist (Latin × 3 Flash × script unknown), taken in `book-check-priority.mjs` order. Judges, blind, reading each text against the page image: Fable judged the stored text and the Opus arm, and Opus judged the stored text and the Fable arm. **No model judged its own correction.** Controls: 2 wrong-page items per arm per judge; 5 stored texts judged twice by each judge. Pass rule for a corrector: judged worse than stored on at most 2 pages, and more accepts gained than lost. `paired-arm.mjs check` passed R1–R5 before judging.

**Result.** 136 verdicts, none unparsed.

| arm | judged by | accepted | mean fidelity (1–5) | `wrong_text` defects | better / same / worse than stored | accepts gained / lost | pass |
|---|---|---:|---:|---:|---|---|---|
| stored | Fable | 4 of 30 | 2.90 | 131 | | | |
| stored | Opus | 5 of 30 | 3.23 | 57 | | | |
| Opus correction | Fable | 23 of 30 | 4.23 | 33 | 26 / 4 / **0** | 19 / 0 | pass |
| Fable correction | Opus | 27 of 30 | 4.57 | 2 | 27 / 3 / **0** | 22 / 0 | pass |

- All 8 wrong-page controls were rejected at fidelity 1. The noise floor was 0 accept flips in 5 repeats per judge.
- **The flags were right:** the stored text was accepted on only 4–5 of the 30 flagged pages.
- **Ranking the two correctors:** this test cannot do it. Fable is the harsher judge of the stored arm, which both judges read (2.90 against 3.23; 131 wrong-text defects against 57). The gap between the arms (23 against 27 accepts) falls inside that difference between judges.

**Bulk (same tool, waves of ≤150 pages, priority order).** Each wave's audit drew 10 random writes and judged them blind against the image with the other model family. The judgments are recorded as book checks under method `lane-spot-check`.

| run | corrector | written | audit judge | better / same / worse |
|---|---|---:|---|---|
| fix-latin-test-ocr | Opus 17, Fable 11 | 28 | (the test above) | |
| fix-latin-w1-ocr | Opus | 93 | Fable | 9 / 1 / 0 |
| fix-latin-w2-ocr | Fable | 92 | Opus | 10 / 0 / 0 |
| fix-latin-w3-ocr | Opus | 64 | Fable | 6 / 2 / 0 (8 of 10 judged: a Cloudflare 403 failed 2, and the Fable stop came before they could be re-asked) |
| fix-latin-w4-ocr | Fable | 64 | Opus | 10 / 0 / 0 |
| fix-latin-w2b-ocr | Opus | 3 | not sampled | |
| fix-latin-eye-ocr | Opus 2, Fable 3 | 5 | written after opening the image | |

349 distinct pages were written. The writer's guard refused 111 pages whose correction shares under 40% of its words with the stored text (plus 1 repetition loop). Correctors answered CONTAIN on 6 pages and UNCHANGED on 9. The refusals were not forced. Of the 20 images opened by eye, 2 pages were invented text and are contained (books held); 9 refused pages were right-leaf but garbled and were written by eye.

**What it means for the lane.** The 40% shared-words guard is the binding limit on these pages: about a third of the flagged pages hold stored text that is wrong-leaf or invented, so a correction cannot be checked against it by overlap. Manuscript pages corrected by Opus (51 in `opus-manuscript-awaiting-recheck.jsonl`) need a cross-family re-check, because the Opus judge favours Opus manuscript readings (#7263). `gemini-second-read-page-ids.jsonl` (167 pages) lists the refused, CONTAIN and Opus-manuscript pages for a Gemini read after the pools reset.

**Files.** `scripts/eval/route-judge-6740/results/fix-latin-199/`: the test's key, verdicts, recipe, score and pass rule; `audit-w1…w4/` (the `evidence_path` of the lane-spot-check rows); `written-page-ids.jsonl` (the ledger: every write and its run); `refused-pages.jsonl`, `contain-pages.jsonl`, `unchanged-or-unanswered.jsonl`; and the scratch runners `pj.mjs` (judge runner), `audit.mjs` (wave audit) and `tally.mjs`. Every run can be reverted with `node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id <run> --apply`.
