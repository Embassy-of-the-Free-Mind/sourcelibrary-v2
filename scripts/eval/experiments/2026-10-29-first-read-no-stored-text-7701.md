---
stage: ocr
measure: [judged]
languages: [la, de, fr]
scripts: [Latn]
canons: []
n_books: 90
n_pages: 90
verdict: "On pages with no OCR in visible scans-only books, agy 3.8 Flash-low passes the router rule for German (read, then the correction pass: 23/24 written pages accepted, 0/24 wrong text) and French (read only: 24/24, 0/24). It fails for Latin (17/19 written, 1/19 wrong text, over the 4% bar; HOLD)."
status: adopted
decision: "Schedule the first-read lane (cli-ocr-lane.mjs run --cohort=visible-unread) for German with --correct=deu and for French, on both agy pools in place of the two correction-lane cron lines. Latin is not scheduled."
superseded_by: null
issue: [7701, 6740, 7611]
router_evidence: [latin-blank, german-blank, french-blank]
---
PRIOR ART: `scripts/eval/experiments/2026-10-27-flash-low-fresh-vs-lite-7517.md`. It measured the same fresh Flash-low
read (one page a call) on pages that HAD a Flash-Lite draft. It counted a filter cut as not accepted, against Flash-Lite.
This test is the cell that run left out: a page with NO stored text, where the alternative is no text at all. Harness:
`scripts/eval/route-judge-6740/judge.mjs` (new cells `la-blank`, `de-blank`, `fr-blank`). Results:
`scripts/eval/route-judge-6740/results/first-read-7701-2026-10-29/`.

## 2026-10-29 · Can agy Flash-low give a first read to pages with no OCR in visible scans-only books? (#7701)

Derek, 2026-10-29: "I want to focus on books that haven't been OCRd yet." 23,691 visible books serve scans only (6.95M
pages). The lane's frame is `cli-ocr-lane.mjs count --cohort=visible-unread`. It takes visible books held as scans only
(the four scans-only/acquisition holds), on a print route, that are not a manuscript by library, title or date, and are
not a possible unsplit spread. That frame holds 11,538 books with no OCR (2.07M pages, almost all Latin from e-rara) and
1,199 partly read books (355K pages, mostly German). Skipped: 6,673 books are possible unsplit spreads (not
split_checked, no crop data; most Heidelberg, BSB and erara books), and 4,773 are manuscripts.

**Design** (the rule was fixed before judging, `RULE.md`). Each cell takes 30 books, one interior page with no OCR per
book, in a seeded order. Two arms run on the SAME pages:
- **A, a fresh read.** `cli-ocr.mjs read` on the live OCR prompt, as the lane reads it. Latin and German send 4 pages a
  call (the drawn page sits inside a block of its unread neighbours, and only the drawn page is judged). French sends 1.
- **B, read then correct.** A's read, then the #7558 correction pass on it (the fc template, the image, one page a call).
  Its draft came from A's read on disk.

All reads went through `AGY_HOME=.agy-james`. Opus judged every output blind against the image (`claude -p`, the
route-judge prompt). Outputs with identical text shared one verdict. The wrong-page controls passed on all 6 routes.
**Written** means the drawn pages the lane would write: delivered, and past `apply --first-read-only --print-only`
(dry run). A page that is not written stays scans-only, which is today's state.

**Result** (`score.json`, router evidence `evidence/first-read-7701.score.json`):

| cell | arm | all drawn (a cut = not accepted) | wrong text | written | wrong text (written) | agy calls a page |
|---|---|---|---|---|---|---|
| Latin | A @4 | 24/30 | 1/30 | **17/19** | **1/19** | 0.60 |
| | B @4 > correct | 24/30 | 1/30 | 17/19 | 1/19 | 1.60 |
| German | A @4 | 26/30 | 1/30 | 23/24 | 0/24 | 0.55 |
| | B @4 > correct | 26/30 | 1/30 | **23/24** | **0/24** | 1.55 |
| French | A @1 | 24/30 | 1/30 | **24/24** | **0/24** | 1.23 |
| | B > correct | 25/30 | 1/30 | 24/24 | 0/24 | 2.23 |

- **Paired, B against A** on delivered pages: Latin 4 better / 1 worse, German 3 / 2, French 1 / 1. B added no
  wrong-text page in any language.
- **The router's decision** (`router-table/2026-10-29-first-read-7701.md`, print cells; the rule is
  `rules.json` switch/hold):
  - Latin: HOLD.
  - German: switch to `agy-flash-low@4>agy-flash-low-written` (arm B). Arm A has the same k/n, but on 24 pages its
    posterior does not clear P(acc ≥ best − 0.08) ≥ 0.9, because the gate treats the two arms as independent. At a
    0.10 margin A passes and is 2.8x cheaper per accepted page.
  - French: switch to `agy-flash-low-written` (arm A).
- **Latin fails on one page.** In a Latin book, a German legal footnote was transcribed with an English word in place of
  the printed one: "Tuttlingischen **Closed** Flecken" (the print reads "ampts Flecken"). The correction pass kept it.
  Six of the 30 Latin pages were refused by the existing foreign-script guard, which was built for corrections. Five
  carried real Greek quotations and one Hebrew. Under that guard, about 1 Latin page in 5 of humanist print is never
  written.
- **Filter cuts.** Gemini cut 4/30 Latin, 2/30 German and 4/30 French reads before `<<<END>>>`. None of them is written.
- **Arm C** (the correction at 4 pages a call) was not run. `cli-ocr.mjs` refuses `--per-call` with `--correct-prompt`.

**Note.** The decision rule fixed before judging used the written row and agrees with the router on all three cells.
The German and French arm-A reads of this test were applied at 14:56Z (118 pages). Derek's arm-B steer reached the job
inbox at 14:53Z and was read after that apply. Those pages carry the first read only.
