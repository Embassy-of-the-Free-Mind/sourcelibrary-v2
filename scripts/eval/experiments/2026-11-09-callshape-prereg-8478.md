---
stage: ocr
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 80
n_pages: 800
verdict: "Preregistration only; results land in a later commit."
status: informational
decision: "None yet. The rule in §6 decides which call shape the standing book check (paired-fifths-check) uses."
feeds: judge
superseded_by: null
issue: [8478, 8405]
router_evidence: "none — no route compared"
defect_rates: "none — judge findings and verifier confirmations on 80 books, not corpus defect rates"
---
## 2026-11-09 · Book check call shape: 10 pages in one call, or one call per pair, against the 15-call reference. Preregistration (#8478)

PRIOR ART:
- `2026-11-08-paired-fifths-prereg-8405.md` / `-results-8405.md`: the 15-call paired check (10 page calls + 5 join calls, Opus) on the #7866 books. Its verdicts are the reference arm R here, unchanged. They were copied off l7a to R2 (`cold/l7a/eval-8478/paired-fifths-8405.tar.zst`) for this run.
- `scripts/eval/methods/paired-fifths-check.md`: the standing method v1 this test may change (a follow-up PR, not here).
- `scripts/eval/paired-fifths-8405/run.mjs`: `joinPrompt`, `plantCarry`, `imageFor`, the wrong-leaf donor rule and the controls are imported, not restated.

### 1. Question
Derek (2026-11-09): "why not 10 pages on sonnet and opus as a test in one call? I think we want to surface more issues... can then have a second call to review? ... at least one call for each of the 2 pages, like so 5 calls". Does a judge that sees a whole pair, or all ten pages, find more true issues per book than the 15-call reference, and at what cost?

### 2. Frame
The #8405 frame (`frame.json`, 160 books, pairs from the #7866 anchors by `pairsFromAnchors`). Eligible: books whose 5 pairs are all complete (137) and that are complete in R. A book is dropped when any of its 10 pages' served text (OCR `data` or translation `data`) differs from the text #8405 saved at frame time (the #8425 containment and realign repairs), compared by content hash. Seeded order (`SEED.books = 84781`): the first 80 surviving books are the study books. Control books are drawn from the remaining eligible books (`SEED.controls = 84782`).

### 3. Arms (same books, same 10 pages, same 5 breaks)
- **R**: the #8405 verdicts. Pages: the #7866 page judge (transcription only, one image), anchors from `book_checks`, partners and stale anchors from `verdicts.jsonl`. Breaks: join judge v1.
- **B10-opus / B10-sonnet**: one `claude -p` call per book with all 10 images (`p01.jpg` … `p10.jpg` in reading order), every transcription and English, judging every page and the 5 breaks.
- **P5-opus / P5-sonnet**: one call per pair (5 a book), both images and both texts, judging both pages and the break.
- **V**: one Opus call per book with the 10 images and texts and the union of every arm's findings for that book (R's included), shuffled, with no arm named. It marks each finding `confirmed` / `rejected`, `serious` true/false, and `same_as` (an earlier finding id describing the same defect), so that findings are counted once across arms.

**Prompts.** The batched prompts are built from the existing ones, not restated: the page questions and taxonomy are cut from route-judge `judgePrompt` (its "Questions" block), the break rules from `joinPrompt` v1 (its "Judge the BREAK" block; v1 because R used v1). They ask for the same fields: per page `accept`, `fidelity` (both about the transcription, as the page judge), `defects` (`class`, `quote`, `severity`, `what`, plus `layer`), `reader_note`, and `en_accept`; per break `join` and `defects` (`kind`, `layer`, `page`, `quote`, `material`). The batched arms read the English of every page, which R's page judge does not. V's standard is the join judge v2 rule of the standing method: a sentence finished across the break with nothing lost and nothing repeated is not a defect.

**Calls.** `claude -p` through `opusCall` (route-judge-6740/judge.mjs) with `--model opus` or `--model sonnet`, subscription (team@), concurrency 3, `usage` tokens recorded per call. Units run in seeded order, a study book's V only after its four arms, so a partial run is whole books. Cap 2,000 calls. No new unit starts when team@ is at weekly ≥ 95% or 5-hour ≥ 85% (the brief's thresholds, read through the lane-judge meter; a hit limit stops at once).

### 4. Controls (every arm)
30 control books, 10 per kind, each with ONE planted defect at a seeded pair, judged by all four arms (B10: the whole book, P5: the planted pair) and by V:
- **carry_over**: `plantCarry` (#8405): the last sentence of A's English prepended to B's English. Caught: a material `carry_over` or `duplicated` defect at that break.
- **wrong_leaf**: page B's transcription and English replaced by a donor page's (another book, same language when one exists; the #8405 donor rule), image unchanged. Caught: `wrong_leaf` on B at the break, or a page-B defect of class `I1`, or page B at fidelity 1.
- **page_defect**: one English page with a numeral changed (a seeded number on the page, +7) or, with no numeral, a negation flipped (`not`/`never` removed, else `not` inserted after the first `is`/`was`/`are`/`were`). Caught: a defect on that page with layer `english` and severity `misleads` or `wrong_text` whose quote or note contains the planted token.
An arm is **invalid below 9/10 on any control kind**. R was not re-run: its #8405 controls (10/10 carry-over, 10/10 wrong-leaf, join judge) stand, and R has no page_defect control (its page judge does not read the English). V's catch is reported as the share of raised planted findings it confirms.

### 5. Measures, per arm
- Control catch per kind.
- **Findings** a book: page defects of severity `misleads` or `wrong_text`, and material break defects (any kind). Cosmetic defects are not findings.
- **Confirmed** findings a book (V `confirmed`), **confirmed serious** (V `confirmed` and `serious`), counted as distinct defects (by `same_as` clusters).
- **Confirmed recall vs the union**: the arm's confirmed clusters / all confirmed clusters in the book.
- **Precision**: confirmed / raised.
- **Book verdict agreement with R**: the #8405 paired rule (`pairedPagesBad` on the transcription accept/fidelity/`wrong_text` page rule, or any `joinFails`), arm vs R.
- **Cost**: calls a book, `usage` tokens (input incl. cache, output), climits weekly delta over the run.
- **By eye** (the runner, both scans opened): 10 V-confirmed findings raised only by a batched arm, 10 V-rejected findings.

### 6. Decision rule
Cost order, cheapest first: B10-sonnet, B10-opus, P5-sonnet, P5-opus (calls a book, then Sonnet before Opus), then R (15 Opus).
1. **Adopt the cheapest arm that is valid on controls AND finds at least as many V-confirmed serious findings per book as R, with precision no worse than R's by more than 10 points.**
2. Else, if a valid batched arm finds at least as many V-confirmed serious findings per book as R but its precision is more than 10 points below R's, **the standing check becomes the cheapest such arm + V**.
3. Otherwise **R stays**.
Too few books (under 40 study books complete in all arms and V) or V invalid on its own controls (it confirms under 9/10 of the planted defects raised) → no decision. The point estimates decide; book-bootstrap 95% intervals are reported beside them.

Nothing is written to `book_checks` or to pages. Pages found invented or off-leaf with the image open are contained per `containment-on-finding.md`.

### 7. Amendment (2026-11-09 ~19:25Z, before any result was read; 1 of 110 units judged, a control smoke unit)
Two corrections from Derek on #8478 (comments 19:07Z and 19:14Z) reached the job after §1–6 were committed. They replace §6 and narrow §5. No prompt, arm, control or frame changes: the runner already records `layer` per finding and `usage` per call, so both are scoring changes.

**Scope (like-for-like).** R's page judge reads the transcription only and the English only at breaks. So the decision is taken on **OCR findings**: page defects with layer `transcription`, and material break defects (any layer). **Translation findings** (page defects with layer `english`: mistranslation, omission, added text mid-page) are reported beside it as their own V-confirmed measure, with their own rate per quota; R has none by construction. Translation yield may justify a shape on its own, but it does not enter rule 1–3.

**Primary measure: V-confirmed serious OCR findings per unit of quota**, not per book. Quota per arm = the run's climits weekly delta (team@, % of a week) × the arm's share of the run's price-weighted tokens (input 1×, cache creation 1.25×, cache read 0.1×, output 5× input; Sonnet weighted 0.6× Opus, the list-price ratio). R's quota is priced the same way from its #8405 `usage` rows. Reported per arm: confirmed serious OCR findings per book (recall), books per 1% of a week, and their product; and each arm's point on the recall-per-book vs books-per-week frontier. Other team@ use during the run inflates the delta; it is reported, and the token shares stand regardless.

**Decision rule (replaces §6).**
1. An arm is eligible if valid on controls (≥ 9/10 every kind).
2. Precision floor: an eligible arm whose precision on OCR findings is more than 10 points below R's must be paired with V, and V's per-book cost is added to its quota.
3. **Adopt the eligible arm (with V if rule 2 requires) with the most V-confirmed serious OCR findings per 1% of a week**, provided it beats R on that measure. A cheap arm that finds 70% of R's findings per book at a fifth of the quota wins.
4. Otherwise R stays.
The §6 "no decision" conditions stand (under 40 complete study books, or V confirming under 9/10 of the planted defects raised). The per-book rule of §6 is reported beside it for comparison, not used.

Checks: none. This is a test; nothing is written to `book_checks`.
