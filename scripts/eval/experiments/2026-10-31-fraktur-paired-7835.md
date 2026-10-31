---
stage: ocr
measure: [judged, accuracy]
languages: [de]
scripts: [Latn]
canons: []
n_books: 440
n_pages: 440
verdict: "Preregistered 2026-10-31, before any face tag, judge call or CER score. Results are not in yet."
status: undecided
decision: "None yet. The German first-read correction and the stored-lite queue route are Derek's (#7835, #7809); this test gives the measured defaults."
superseded_by: null
issue: [7835, 7818, 7701, 6012, 7824, 7809]
router_evidence: "none — preregistration only; the T1/T2 export lands with the results, with no rules.json entry (#7835)"
defect_rates: "none — preregistration only: nothing judged yet; the results add results/defect-rates.json (#7824 unit)"
---
## 2026-10-31 · Fraktur: correct the first read or not, correct or re-read the stored text, and diplomatic accuracy against DTA (#7835)

PRIOR ART:
- `2026-10-31-correction-pass-paired-7818.md` and `scripts/eval/correction-pass-7818/`: the design, the judge driver, `servedCorrection` (checked 320/320 against the lane's own reads), `servedArmc`, `spanSeverity`, `fca`, the pooled defects-per-1,000-words CI and the export through `exportScore`. Imported from its `lib.mjs`, unchanged; its judge loop, Wilcoxon and bootstrap are restated with the same rules (they live in top-level scripts).
- `scripts/eval/route-judge-6740/judge.mjs`: `judgePrompt`, `opusCall`, `parseVerdict`, `clusterCI`, unchanged. `defect-rate.mjs` `words()`: #7824's word count, imported (it is on main now; #7818 had to restate it).
- `2026-10-30-german-cheaper-first-reads-7701.md`: the first-read frame and the Fraktur / Antiqua split (labelled by eye there on 170 pages: 141 Fraktur, 12 Antiqua, 17 other). Here one agy call labels each page and Opus checks 30 (T4).
- `2026-10-06-typed-references-dta-camena-eebo-6012.md` and `scripts/eval/typed-refs-6012/`: the DTA page matches (`kgram-vote-v2`), the typed pages (`tei-pages-v1`, private R2), 35/36 leaves right by eye.
- `scripts/batch/cli-ocr-lane.mjs` / `cli-ocr.mjs`: the live first read (read@4), the #7558 correction (`fc-prompt.mjs` template), the block correction (`--per-call` with `--correct-prompt`, #7701 arm C), the arm-c GPU template (`GPU_TEMPLATE`, hash 0601ef30e816f7a7).
- `.claude/docs/quality-rubric-and-sampling.md` §4.2: the OCR-D level names.

Code: `scripts/eval/fraktur-paired-7835/` (`lib.mjs`, `frame.mjs`, `arms.mjs`, `judge.mjs`, `analyze.mjs`, `writeback.mjs`). The analysis, `analyze.mjs score`, is committed in this PR, before any tag, verdict or CER exists.

**Why.** About 83% of unread German books are Fraktur (141/170, #7701), and 409,596 pages of stored Flash-Lite German text wait in german-lite/print. Three route choices rest on small unpaired samples: correct the first read or not (63/68 without, 43/44 and 20/20 with, on different pages); correct the stored lite text or re-read it (100/117 against 243/280, not paired, not split by face); and how accurate the letters are (every German rate so far is against references that modernise ſ).

### Instrument

- **Judge.** Opus `claude -p --model opus` on this box's subscription, `judgePrompt` (task ocr, language German) unchanged, the page image in the workspace, one text a call, blind to arm. A text identical to one already queued for the page is judged once and stands for every arm that served it. Queue order `makeRng(78355)`, 3 at a time.
- **Noise floor: not rerun.** #7818's test-retest on the same judge, prompt and kind of page (German and French print, 30 items twice): accept κ 0.87 (α 0.87), 29/30. It is reused as this study's A-vs-A floor.
- **Controls.** Wrong-page: 2 per stratum (T1 Fraktur, T1 Antiqua, T2, T3), this page's image with another page's text (`mulberry32(78356)`); passes when not accepted at fidelity ≤ 2. Planted: 4 per test (T1, T2, T3) on accepted texts, kinds B, C, D, E rotating (`plantError`, `makeRng(78357 + test)`), scored by `scorePlant`. The judge is **valid for this study** when every wrong-page control passes and at least 0.80 of plants are caught (the sampler's bar). If not, the judged outcomes are reported as invalid, not as results.
- **Budget.** At most **600** Opus calls (abs + controls + T4 check), counted from the verdict files. Planned: T1 ≤ 180, T2 ≤ 120, T3 ≤ 160, T4 30, controls 20. Pace: stop at weekly ≥ 85% or 5-hour ≥ 95% (the sampler's guard); never probe after a limit. If the plan will not fit, T3 is judged in queue order as far as it goes and the cut is reported.
- **Face tag (T4, and the T1–T3 strata).** One agy call a page (`gemini-3.8-flash-low`, agy's default model, gated workspace, `lib.mjs facePrompt`): fraktur (any blackletter) / antiqua (roman or italic) / mixed (both set substantial body text) / none (no printed body text). One retry on an unparsed reply.

### T4 — how much of the German holdings is Fraktur

- **Frame.** Visible books, `pages_count > 0`, `language` /^German/: 7,682 books (2026-10-31).
- **Draw (`frame.mjs t4-draw`, seed 78354).** Books sorted by id, shuffled; the first 300; in each, one interior page (`isInterior`) with an image, picked from the same stream. Drawn: 300 of 300 tried.
- **Outcome.** Fraktur share = fraktur / (fraktur + antiqua + mixed), pages tagged `none` excluded, with Wilson 95%; also fraktur-or-mixed; by century of the book's year. Opus tags 30 of the tagged pages (`mulberry32(78358)`) with the same question, blind to the agy tag: agreement k/30 and κ on fraktur-vs-not.
- **Weight.** w = fraktur / (fraktur + antiqua) from T4 weights T1's two strata: corpus accept = w · Fraktur + (1 − w) · Antiqua, per arm, reported beside the strata.

### T1 — first reads: read against read + correction, paired

- **Frame.** The first-read lane's German frame: `FIRST_READ_BOOKS`, language /^German/, `firstReadSkip(…, ['deu'])` null: 3,129 books.
- **Draw (`frame.mjs t1-draw`, seed 78351).** Books sorted by id, shuffled. Per book: its unread pages (`UNREAD`); `spreadReason` must be null; one interior unread page with an image, picked from the stream; its **block** is that page and the next 3 unread pages (shifted back at the end of the book; a book with < 4 unread pages is skipped). 450 candidates (462 tried: 8 no interior unread page, 4 short).
- **Strata.** Candidates are tagged in draw order (4 at a time) until 40 Fraktur and 20 Antiqua are found; the strata are the first 40 Fraktur and the first 20 Antiqua in draw order (`frame.mjs select`). Mixed and none are counted, not tested. If the 450 candidates hold fewer than 20 Antiqua, all are taken and n is reported.
- **Arms**, all on the same page, through `cli-ocr.mjs` exactly as the lanes call it, every `apply` a DRY run with `--emit-written` (nothing is written):
  - **(a)** the live route: `read --per-call=4 --model=gemini-3.8-flash-low` on the block, then `apply --lane=agy-first-read-7701 --first-read-only --print-only`. Served text = what apply would write. A refused page serves no text. If the live lane reads the page in between (apply refuses on "has OCR now" / "rewritten after this read"), the read stands as made, and the case is flagged.
  - **(b)** `agy-flash-low@4>agy-flash-low@4-written`: (a)'s served texts of the block's pages as `--draft-file`, `read --correct-prompt=<fc-prompt.mjs template> --lane=agy-first-read-correct-7701 --per-call=4`. Served by `servedCorrection` (apply refuses a draft-file read by design; #7818 §W3).
  - **(c)** the same correction 1 a call, on the judged page only.
  - Reads are not `--fresh`: a kept read of the identical request is reused, as the lanes do.
- **Primary outcome.** Paired accept, **(b) against (a), Fraktur only**: exact McNemar (two-sided binomial on the discordant pairs), α 0.05. An arm with no served text is not accepted.
- **Secondary.** (c) vs (a), (b) vs (c), the Antiqua stratum and all pages; wrong-text pages added / removed; defects per 1,000 words (#7824 `words()`), pooled with a page-bootstrap 95% CI (4,000 resamples) and paired per-page differences (Wilcoxon); made worse by severity (pages with more wrong_text / misleads / cosmetic defects than (a)); agy calls per page and $ per accepted page at #7701's $0.00087 a call.

### T2 — stored Flash-Lite text: correct against re-read, paired

- **Frame.** The #7558 correction lane's German frame (`correctMain`'s book query: visible, idle, no hold, not held; `correctablePages` restated: Flash-Lite OCR, not edited, ≥ 300 characters, not handwritten, interior), less pages in the lane's gex45 ledger (26,911 processed) and pages in `lane_judge_verdicts`: 2,690 books.
- **Draw (`frame.mjs t2-draw`, seed 78352).** Books sorted and shuffled; one eligible page a book from the stream; its block = it and the next 3 pages of the book. 120 candidates (251 tried, 131 with no eligible page). Strata: the first 40 Fraktur in draw order.
- **Arms**, same page:
  - **(a)** the stored lite text.
  - **(b)** the #7558 lane's own correction: `read --correct-prompt=<template> --lane=agy-correct-lite-7558` on the stored draft, `apply --mark-stale` DRY: its real guards. Refused → (a) stands.
  - **(c)** a fresh read, 4 a call, of the block (`read --per-call=4`), `apply` DRY (the 40% shared-words floor against the stored text). Refused → (a) stands.
- **Primary outcome.** Paired accept, **(b) against (c)**, exact McNemar, α 0.05. Secondary as T1, against (a) as well.

### T3 — diplomatic accuracy against DTA

- **Frame.** #6012's DTA same-edition books with a congruent page (our page is one typed page: both edges on its page breaks), ≥ 600 of our letters, whose stored OCR is still Flash-Lite: 87 books with congruent pages, 42 with a lite page (2 more had no typed text at the index).
- **Draw (`frame.mjs t3-draw`, seed 78353).** Books sorted and shuffled; one such page a book; up to 40. Drawn: 40 pages (16th c. 1, 17th 8, 18th 10, 19th 21). All are tagged for face and reported by face. The reference is the typed page's body text (`tei-pages-v1`), notes not included.
- **Arms**, same page: **lite** (stored); **(a)** agy read@4 on the block, served as the plain apply would (`--print-only`, dry; a refused read is missing for that arm and counted); **(b)** (a) then the block correction (T1's (b)); **(c)** arm c: PERO-OCR `pero_eu_cz_print_newspapers_2022-09-26` on gex45 (`pero-draft.py`; `--device=gpu` if the card is under 10% and 2 GB, else the CPU config; the configs differ only in USE_CPU), the same image bytes the judge sees, then agy Flash-low on `GPU_TEMPLATE`, served by `servedArmc` over the stored lite (E3 put-back).
- **Normalisation (`lib.mjs`, fixed here).**
  - Base, both sides: NFC; line-break hyphens (- ¬ ⸗ before a line break) rejoined (layout at every level, §4.3); whitespace collapsed and not scored. OCR: #7818's furniture tags removed with their content (header, page-num, sig, catchword, catch, meta, vocab, summary, keywords, language, script, page-type, scan-quality, columns, warning, note), other tags dropped and their text kept, markdown heading marks, `*`, `_` and `|` dropped. Reference: gap marks ◊ dropped.
  - **Level 2 (diplomatic)**: the base text. Case, punctuation, ſ, ß, the superscript-e umlaut (aͤ, U+0364), ꝛ and ligature code points are kept.
  - **Level 1**: Level 2, then ſ→s, ꝛ→r, ligature code points split, aͤ/oͤ/uͤ → ä/ö/ü, u/v → u and i/j → i in both cases. Abbreviation marks are not resolved (the live prompt expands abbreviations; DTA keeps them: a declared convention difference charged at both levels).
  - **Level 1 + case/punctuation + diacritics**: #7818's `scoreText` (`normalizeForScript` v4 'latin', ß→ss), for continuity with #7818's tables. It is not called Level 1.
  - **CER** over NFC grapheme clusters, windowed (`metrics.mjs windowedErrorRate`: OCR text before and after the page's text is free, interior insertions charged). **FCA** (#7818 A3) at the third level, alongside.
- **Error kinds (`errorKinds`, `nameErrors`; a fixed rule).** A fitting alignment with backtrace over the Level-2 grapheme strings (spaces removed); per aligned reference grapheme:
  - **ſ / s / f**: reference ſ kept, → s, → f, dropped, other; and reference s or f read as ſ. Rates per reference ſ.
  - **umlaut**: reference aͤ/oͤ/uͤ kept, → ä/ö/ü, → the bare vowel, other; reference ä/ö/ü read as the e form.
  - **ligatures**: ligature code points in the reference kept; ligature code points the OCR emits (DTA writes none, so every one is a Level-2 error).
  - **r rotunda**: ꝛ in the reference kept; ꝛ the OCR emits (DTA writes r).
  - **numbers**: edit operations touching a digit on either side, per reference digit.
  - **proper names (approximation)**: a reference word that is capitalised, not sentence-initial, ≥ 3 letters, whose Level-1 key occurs in at most 2 of the 84 typed works of the frame's books; an error when its aligned OCR word (word alignment on Level-1 keys) has another key. German capitalises every noun, so this counts rare capitalised words, names and rare nouns alike. Declared.
  - **capital I/J**: DTA writes the Fraktur I/J capital as J; reference J read as I is counted apart (a Level-2 convention, folded at Level 1).
- **Leaf / edition check.** A page where no arm aligns with the typed page (#7818's fold WER guard, 0.35) is excluded and counted (a leaf or edition that differs).
- **Outcomes.** Per arm: mean Level-2, Level-1 and fold CER, median Level-1 CER, FCA, the error kinds, judge accept. Paired contrasts (a vs lite, b vs a, c vs lite, c vs b) on each CER level: mean difference, page-bootstrap 95% CI, Wilcoxon. **Judge against diff**: on every judged T3 text, the judge's wrong_text against #7818's span rule (`spanSeverity`, A2) as a confusion table, the judge's recall of span-rule wrong-text texts, AUC of accept against Level-1 CER and against span severity, Spearman of the judge's defects per 1,000 words against span severity.

### Analysis (`analyze.mjs score`, committed here)

- Wilson 95% for every k/n; page-bootstrap 95% CIs (`clusterCI`, one page per book) for differences; exact McNemar for paired accept; Wilcoxon signed-rank for paired continuous measures.
- **Supported** = exact McNemar p < 0.05 and gained > lost. Below that the effect and its interval are reported, not "no effect".
- **Decision rule, German first reads (T1, Fraktur primary).**
  - **YES, put the correction back** (b, 4 a call) if the primary is supported and (b) adds no more wrong-text pages than it removes.
  - **NO** if (b) loses more than it gains at p < 0.05, or adds wrong text on ≥ 2 more pages than it removes.
  - Otherwise **NO** (no measured gain at this n; the pass spends agy quota the first reads need). If (c) vs (a) is supported where (b) is not, that is reported as a secondary result for a follow-up test, not as the decision.
- **Decision rule, stored-lite queue (T2).**
  - If (b) vs (c) is supported in either direction, the winner.
  - Otherwise the arm with the lower $ per accepted page, unless it has ≥ 2 more wrong-text pages than the other, in which case the other.
- T3 and T4 decide nothing; they weight and qualify the two rules.

### Write-back (the only production write)

On T1 and T2 pages, only the best judged arm, only where it was accepted and no other arm was judged better:
- **Best** = accepted, then higher fidelity, then fewer wrong_text, misleads and cosmetic defects. Ties go to the cheaper arm (T1: a, b, c; T2: a, c, b).
- T2 pages whose best is the stored text (a) are left alone.
- Written through the lanes' own `cli-ocr.mjs apply --apply` from the arm's read directory, with its guards and provenance (`writeback.mjs`; dry run first):
  - T1 (a): `--lane=agy-first-read-7701 --first-read-only --print-only`;
  - T1 (c): (a) first by the same apply, then the correction re-requested by the lane's own `read --correct-prompt --lane=agy-first-read-correct-7701` on the now-stored draft (the identical request, so the kept read is reused) and applied;
  - T1 (b): a block correction over drafts on disk, which the lane apply cannot take; not written, listed;
  - T2 (b): `--mark-stale=agy-correct-lite-7558`; T2 (c): the plain apply.
- Every page written is listed in the results. T3 and T4 are read-only.

### Seeds

| purpose | seed |
|---|---|
| T1 / T2 / T3 / T4 draws | 78351 / 78352 / 78353 / 78354 |
| judge queue | 78355 |
| wrong-page | 78356 |
| planted | 78357 (+ test index) |
| T4 Opus check | 78358 |
| bootstrap | 7835–7975 |

### Declared deviations from the issue

- The face is tagged by one agy call, not by eye (#7701): ~450 tag calls fit; Opus checks 30 (T4).
- T1's block is the drawn page and the next 3 unread pages, not the live lane's 40-page chunk position.
- T3 is restricted to pages whose stored OCR is Flash-Lite, so every arm runs on every page; that leaves 42 books, 21 of the 40 drawn pages from the 19th century.
- Limits: Claude only via `claude -p` on this box's subscription; Gemini only through agy (flash-low); no paid API call; no cron or routing change.
