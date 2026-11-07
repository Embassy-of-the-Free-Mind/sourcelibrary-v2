# Pre-registration: does one per-book brief make page translations better? (#7499 row 6)

PRIOR ART: `scripts/eval/seam-prompt-6742/PREREGISTRATION.md` (arms P/P2/C on the production CLI request, join judge
both orders, A-vs-A floor), `scripts/eval/experiments/2026-10-26-translation-prompt-v19-cognates-4741.md` (a general
rule failed; "per-book glossary, not a general rule"), `scripts/eval/translation-vs-reference/` (the reference judge).
None of them tests a per-book brief.

Committed before any translation arm runs. Job `book-brief-7499`, gex45, 2026-10-27. $0: Claude CLI and agy only.

## Question and reader

Derek and the router (#7499 row 6). Today each page is translated with the prompt and the previous page's English.
Does ONE brief per book, written first and given to every page call, make term renderings more consistent, joins
cleaner or pages more faithful, without the model copying the brief into pages that do not carry it?

## Sample (drawn, seed 7499; `book-brief-7499/select.mjs`, output `results/book-brief-7499/draw.json`)

Candidates are the books with a non-private reference page in the xlref tracks. A book is eligible when it is live
(`visible && pages_count > 0`), and a run of ≥ 15 consecutive pages containing the reference page each has OCR and a
stored translation and is translatable. The window is 12 consecutive pages of the run, containing the reference
page, at a seeded offset, with at least one run page before it.

| stratum | n | books (window) | engine |
|---|---|---|---|
| Latin print | 3 | Erasmus *Enchiridion* 1515 (89–100); Bacon *Novum Organum* (271–282); Cicero *De officiis* (81–92) | Opus, `claude -p` |
| German / vernacular | 2 | *Theologia deutsch* (54–65); Cabeza de Vaca *Naufragios*, Spanish (22–33) | Opus, `claude -p` |
| Greek | 2 | Plato, *Republic/Timaeus/Critias* (364–375); Septuagint with Latin (285–296) | 3.8 Flash, `agy` |
| Hebrew / Arabic | 1 | *al-Rawḍ al-ʿāṭir* (103–114) | 3.8 Flash, `agy` |
| Sanskrit / Chinese with printed commentary | 2 | 莊子旁注 vol. 5 (95–106); 大乘起信論義記 vol. 2 (65–76) | 3.8 Flash, `agy` |

Deviations from the brief, decided before any arm: (1) the commentary stratum is two Chinese books: of the T5
candidates, no Sanskrit book was live with a 15-page run AND a printed commentary (the one that passed an OCR marker,
the Arthaśāstra, matched व्याख्यातः, the text's own verb "explained", and was dropped by tightening the rule).
(2) Spanish is routed as German is (Opus): it is the vernacular stratum's second book.

## Brief (stage `brief`)

Written once per book by Opus (`claude -p --model opus`, sealed, no tools) from: the book's metadata and the
production source-work line; the OCR of the book's first 20 translatable pages **outside the window** (≤ 2,500
characters each), so a brief fact found on a window page is never one the brief copied from that page. ≤ 400 words:
what the work is (no content summary), a glossary of 15–30 recurring terms with one fixed English rendering each,
layout conventions (commentary vs base text, marginalia, verse), and names. Opus also returns a machine key (each
glossary term's printed forms), which is NOT sent to the translator. The briefs are committed before arm B runs.

## Arms (12 pages per book, one chain per arm, in page order)

- **A**: v13 as production composes it. agy books: `cli-translate.mjs read`, i.e. `buildTranslationPrompt` +
  `PAGE_BREAK_SCOPED` + `TRANSLATE_SUFFIX`, one page per call, `gemini-3.8-flash-low` through `gatedTextCall`. Opus
  books: `claude-translate.mjs read`, i.e. `buildBlockTranslationPrompt` + `PAGE_BREAK_SCOPED` + `CALL_SUFFIX`,
  `planBlocks` with 10 pages per call, `--model opus`. The first page is seeded with the stored English of the page
  before the window; every later page or block with the arm's own read, exactly as those scripts seed.
- **B**: A plus the brief, inserted where production's `--instructions-file` line goes (after the built prompt,
  before the suffix), under a header saying it describes the book, is not text of the page, and must not be added to
  a translation.
- **A2**: A again (fresh calls), on 3 books, seeded (`makeRng(74992)`, one Opus book then two agy books, from the
  sorted ids): *Theologia deutsch* (Opus), the Septuagint and 莊子旁注 (agy). The A-vs-A floor.

The default prompt must be v13 (hash `516510147237b6a79d9d3f6e797bba7f`) or the run stops. No read is written to any
page, no kept read is stored, no lane is recorded: the harness calls the builders, not the scripts.

## Measures

1. **Term consistency (primary).** For each glossary term, the window pages whose OCR contains one of its printed forms
   (from the machine key). For each such page and arm, a blind extractor (Opus, it sees only the source page, one
   translation and the term list, never the brief's renderings or the arm) quotes the English used for the term. A
   term's consistency is the share of its occurrence pages that use its modal rendering, after normalising case,
   articles, plurals and italics; terms on ≥ 2 pages count. Book score = mean over its terms; arm score = mean over
   books. **Δ = B − A**, 95% CI by book bootstrap (10,000, mulberry32, seed 7499), beside A2 − A.
   Also reported: the share of A's renderings that already equal the brief's (headroom).
2. **Fidelity, source-grounded (non-inferiority guard).** Every window page, B vs A, blind Opus pairwise judge (the
   `PAGE_JUDGE` of #6742 extended to flag per version: omission, added content, mistranslation), both orders in
   different calls, packs of 5. Win = preferred in both orders. A2 vs A on its 36 pages; 10 byte-identical pairs per
   order as the judge floor. L − W in points with a page-bootstrap CI clustered by book.
3. **Fidelity vs reference** on the 10 reference pages (A, B and, where run, A2): the `translation-vs-reference`
   harness, its gate first. n = 10: reported, not decided on.
4. **Seam defects:** the 11 joins inside each window, the #6742 join judge (`seams-6742/judge-repairs.mjs` JUDGE),
   B vs A and A2 vs A, both orders, 20 identical pairs per order. A version's join is defective when flagged in
   both orders. Per 100 joins, book-bootstrap CI.
5. **Omission pages:** from measure 2, a version flagged with an omission in both orders. Rate per arm, B − A.
6. **Brief invention (the safety guard).** Every B page AND every A page (the control: A never saw the brief) goes to
   a blind Opus checker with the source page, the translation and the brief: list each statement, name, date, number
   or explanation in the translation (body or note) that the source page does not carry and the brief does.
   Rendering a source term with the glossary's English is not invention. **Brief invention = B pages flagged − A pages
   flagged**, per 100 pages; every B flag is quoted in the report.

## Decision rule (one of three, written now)

- **BUILD** if all hold: consistency Δ ≥ +10 points with its CI excluding 0 and Δ above the A2 − A interval's upper
  end; fidelity L − W upper bound ≤ +5 points (B not worse); omission pages B − A ≤ +5 points; brief invention
  ≤ 1 per 100 pages above the A control, with no flagged B fact that a reader would take as the source's.
- **DON'T** if consistency Δ lies inside the A2 − A interval or below +5 points, or brief invention > 3 per 100.
- **TEST-NEXT** otherwise (e.g. a consistency gain with fidelity unresolved at n = 120), naming the next test.

Seams and the reference judge are reported, not decided on (n too small, #6742 showed the join count is noisy).

## Known limits

Opus judges Opus translations on the five Latin and vernacular books (same family; both arms equally). 10 books,
120 pages: a per-stratum effect is exploratory. Glossary coverage of the window is whatever the book's opening
pages yield; terms that never recur in the window cannot show consistency, and the count is reported.

## Spend

$0. Translation: ~120 Opus page reads in ~24 block calls, ~180 agy page calls. Judges: ~250 Opus CLI calls on this
box's subscription (weekly meter 0% at the start). agy: checked before each batch; locked means wait, never the API.
