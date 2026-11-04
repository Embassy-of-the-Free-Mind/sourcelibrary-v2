# Preregistration: does the Opus-vs-Flash OCR gap survive into the English? (#5274, second test)

Written 2026-11-04, committed before any translation in this test is read. Derek's inbox note to job
zh-translation-paired-5274, 2026-11-04 11:04Z. Eval only: nothing is written to a page.

## Question

On the ditto pilot (PR #8062), the blind Opus judge called 12/60 Opus-corrected transcriptions misleading against 46/60
Flash-low ones, while Kanripo CER was 3.7% vs 5.6%. #7611 found only 17% of confirmed OCR errors leave the reader
wrong (not on Chinese). When each transcription is translated the same way, does the English differ by as much? This
decides the OCR correction route for ~20,000 ditto pages and 93,277 Siku pages.

## Pages and sources (`fetch.mjs`, `run.mjs`, seed 52741)

- The pilot's zero-丨 pages (60: 30 at one page per call, 30 at ten per call; 佩文韻府 / 駢字類编 / 韻府拾遺, reference
  works), with all three stored texts: **P** the Paddle draft the pilot corrected, **O** the pilot's Opus correction,
  **Fl** its Flash-low correction. Texts come from the R2 candidate-reads the pilot kept, and P from the page or its
  page_revisions snapshot. No new correction.
- The budget is ~120 translation calls, so 40 pages: 20 drawn from each per-call set, seeded, among pages with all
  three texts. The 10 keep pages are left out (the decision is about zero-丨 pages).
- Flash-medium correction: not landed at the draw (it runs 2026-11-05 10:15Z), so not an arm.
- Siku prose: added only if stored Flash and Opus corrections exist for 20 Siku prose pages; checked at the draw.

## Arms

**tP, tO, tFl**: `gemini-3.8-flash-low` through agy translates each source text, one page per call, translate-core's
single-page prompt with no previous-page English and no neighbouring OCR (the same prompt for all three), on
`.agy-james` / `.agy-milo` above the floors (weekly 35% or the lane reserve, 5-hour 25%).

## Judges (each blind to the arm, order seeded, ids hashed)

- **J-Opus**: Opus through `claude -p` with the scan. The prompt is judge.mjs's `judgePrompt` for a translation, but
  the TRANSCRIPTION block is replaced by "read the page image": showing each arm's own transcription would reveal
  the arm (Opus and Flash restore the 丨 marks, Paddle does not). Each defect also gets a `kind`: `meaning`, `name`,
  `number` or `other`.
- **J-Flash**: the same prompt through agy with the image. Derek asked for Flash **medium**; the second and third agy
  logins are held to flash-low and root's pool is under its floor (10% of its week), so J-Flash is
  `gemini-3.8-flash-low`. This is a substitution, reported as such.
- Controls for each judge: 10 swaps (this page's image, another page's tO English; caught = not accepted and fidelity
  ≤ 2, need 9/10) and 10 retests (within one fidelity point on 9/10).

Opus calls: 120 items + 20 controls = 140 (the job's two tests together stay under the first test's 400).

## Measures (each judge, and their agreement)

Accepted k/n; pages with wrong meaning (a `wrong_text` defect); pages with a name or number defect (misleads or
wrong_text, kind name / number); major defects (misleads + wrong_text) per 1,000 English words (`words7824`); paired
gained / lost tO vs tFl, tO vs tP, tFl vs tP (exact McNemar). Agreement: accept agreement and Cohen's kappa between
judges per arm and pooled.

**Cause trace.** For each major J-Opus defect, a text-only agy Flash-low call is given the defect's English quote, the
arm's source transcription and the page's Kanripo WYG leaf (`ocr.qa_screen.pb`, the pilot's alignment) and returns the
source span the English renders and the Kanripo span at that place. The defect is a **source misread** when the two
spans differ in a character that changes the sense, else a **translator** error. Kanripo is another edition, so a
difference that the image does not support is checked by eye on a sample; at least 5 traces are opened with the scan.

## Decision rule

- **Opus** for ditto/Siku correction if tO accepts ≥ 6 more of the 40 pages than tFl on J-Opus (15 pp) with McNemar
  p < 0.05, or tO has ≥ 4 fewer wrong-meaning pages.
- **Flash** if tO − tFl accepted is within ±3 pages on both judges and wrong-meaning pages differ by ≤ 2 (the OCR gap does
  not survive into the English at the size a reader sees), at the quota per 1,000 pages each costs.
- **Opus only for a named class** if the gap is concentrated: ≥ 75% of tFl's extra major defects fall on one class
  (names, numbers, or the per-call 10 set, or headword/ditto spans) — then Opus for that class, Flash for the rest.
- Otherwise undecided, reported as such, with the default left to Derek.
- These are 佩文韻府-family reference pages: what the result says about Siku prose and print is limited, and the
  write-up says so.
