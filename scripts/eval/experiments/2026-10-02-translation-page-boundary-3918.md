---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 1800
n_pages: 1800
verdict: "2.44% (1.83-3.27) of served translated pages carry or lose text across a page boundary, in every lane (chained Batch 1.6%, pre-fix realtime 2.7%); about 116K pages corpus-wide."
status: informational
decision: null
superseded_by: null
issue: 3918
---
## 2026-10-02 · How many served translations carry text from the adjacent page, and which lane writes it? 2.4% of pages, every lane (#3918)

PRIOR ART: 2026-10-02-what-the-judge-calls-invention-5274.md (the 13 confirmed positives used here); `scripts/audit/translation-bridging.mjs` (#5305, any bridging, P 0.25) and `translation-page-boundaries.mjs` (#5026 LEAK / #5021 DRIFT, mirror-only). This entry measures one defect, text that belongs to a neighbouring page, with lane provenance.

- **Question.** The #5274 audit's page-boundary inventions (13 of 311 served pages confirmed against the adjacent page's OCR) hint at a corpus defect. How common is it, does the Batch block lane cause it, and did the page-break fix (#5103, `PAGE_BREAK_SCOPED`, live 2026-09-26) reduce it?
- **Instrument.** `scripts/audit/translation-page-boundary.mjs`. It costs $0, reads Mongo only, and uses no model. It runs six signals per page N, each refused when the two sources share a run (a refrain or formula, compared on folded words, or on characters for Han/kana):
  - **dupNext / dupPrev:** N's English and a neighbour's English share a run of ≥ 8 normalised words, within 60 words of both facing edges, or ≥ 40 words anywhere.
  - **carried:** N+1's source opens mid-sentence, its English opens fresh, and N's English closes. This is `detectBlockDrift` steps 1–4, plus N's English/source ratio at ≥ 1.15× its neighbours' ratio. block-drift's own step 5 (`absorbedShare`) scored 0.04–0.30 on three real multi-sentence imports, so it is not used.
  - **ocrNext:** N's English tail reproduces N+1's source head verbatim (English sources).
  - **anchorsNext / anchorsPrev:** ≥ 2 numerals or names from the neighbour's source edge appear in N's English edge but not in N's own source.
- **Calibration** (`--calibrate`): the 311 audited pages; the 13 confirmed are positives and 297 are negatives (0b1479907c, unconfirmed, is left out).
  - **any**: flags 11, P 0.55, R 0.46 (6/13; majors 5/8).
  - Three of the 5 "false" flags (c8ca92cbf6, a827fdf979, 0f39191f66) are real boundary defects on the neighbour page, which the judge never saw. Read at pair level, precision is 9/11.
  - Missed: sub-clause completions (7c34ba73d6, 545f9fcf4b, 61d9ea9855, 8ad1bca178 hyphen), an import inside `<meta>` (018aef589b), a caseless-script page (52e056e34f) and an apparatus list ending on ";" (bbad675645).
  - Signal by signal: dup P 0.57 R 0.31; carried P 0.80 R 0.31; ocrNext 1/1; anchorsNext 1/2. The thresholds were set on these 13 pages before the corpus run.
- **Corpus design.** 1,800 served books (`visible`, `pages_count > 0`, `pages_translated > 1`), one translated page per book, drawn uniformly among pages with a translated neighbour. Two `$sample` draws were merged after the first run was interrupted, and the resume never re-draws a book.
  - Lane comes from `translation.engine.call_site` (#4613, 2026-09-28 on), else a chained-run queue, else `batch_jobs.page_ids`, else **realtime-unattributed**. That last group means the realtime worker, which sends 8-page blocks since 2026-03-28, or an older script. No provenance says which.
  - The seam Batch lane (`translate-batch-seam`) has only ever run as a shadow (44 runs, 2026-09-24), so it has no served pages to measure.
- **Verification.** All 79 corpus flags were read against both pages' OCR and English (text, not images): **44 real, 27 false, 8 unclear**. Corpus precision is 0.56.
  - The false flags are liturgical, sūtra and legal refrains where the source repeats in spelling variants the guard missed (u/v, ETCSL transliteration), facing-translation editions (Loeb, Irish/English Heptads), index page numbers, and blank-page descriptions.
  - By signal (real/flagged): dupNext 15/24, dupPrev 20/33, carried 5/9, ocrNext 5/6, anchorsNext 3/9, anchorsPrev 1/3.
- **Result (verified rates, Wilson 95%).**

| stratum | n | screen | verified |
|---|---:|---:|---:|
| **all served translated pages** | 1,800 | 4.39% | **2.44% (1.83–3.27)**; page-weighted 2.71% |
| realtime-unattributed (pre-provenance; block worker since Mar) | 1,380 | 4.93% | 2.68% (1.95–3.67) |
| batch-chained (Lite/Flash Batch, scoped page-break, 2026-09-29 →) | 375 | 2.67% | 1.60% (0.74–3.45) |
| batch-route (`batch-translate-async`, single-page) | 41 | 2.44% | 2.44% (0.43–12.6) |
| realtime-worker with provenance (after 09-28) | 4 | 0 | 0 (0–49) |
| before 2026-09-26 | 1,417 | 4.87% | 2.68% (1.96–3.66) |
| after 2026-09-26 | 383 | 2.61% | 1.57% (0.72–3.38) |
| gemini-3-flash-preview | 633 | 3.48% | 1.26% (0.64–2.47) |
| gemini-3.1-flash-lite (GA + preview) | 1,133 | 4.94% | 3.18% |
| translated 2026-02 (before multi-page batching, #501) | 145 | 4.83% | 1.38% (0.38–4.89) |

- **Read, plainly.**
  - About one served page in 40 shares misplaced text with a neighbour. The page either carries the next or previous page's text, or loses its own text to the neighbour. The neighbour imports more often than page N does: dupPrev carries the most real flags.
  - **No lane is clean.** The chained Batch lane, which runs with the scoped page-break fix, still produces it at 1.6%. That is lower than the pre-fix realtime pages (2.7%), but the difference is not significant (z = 1.2).
  - "After the fix" is almost entirely that one lane: the realtime worker contributed only 8 post-fix pages. So this sample cannot say whether #5103 helped the realtime worker.
  - Flash-lite carries it about 2.5× as often as Flash (z = 2.5). This is confounded with language and era.
  - Single-page pages from Feb 2026 also show it (2/145), so block translation is not the only mechanism. Previous-page context is enough.
- **Projection.** 2.44% (1.83–3.27) of 4,766,476 served translated pages ≈ **116K pages (87K–156K)** sit at a defective boundary. A repair re-translates both pages of each defective boundary. A page is counted when either of its two boundaries is defective, so the re-translation set is about the same size. This is a lower bound: the screen's recall on the audit positives is 0.46, and the misses are mostly sub-clause completions.
  - At the measured Lite Batch cost of $0.00056/page (#4681), that is **≈ $65 ($49–$87)**. At the chained lane's auto-approval of $0.0012/page it is ≈ $140 ($104–$187). Doubling for recall gives ≈ $130–$280.
  - A full list needs the screen run over every page (at $0, but it is a corpus scan), followed by hand or judge verification, since precision is 0.56.
- **Not done.** Nothing was repaired and no prompt was changed. Read-only. $0.
- *Replicated?* No. One draw, one reader, text only. The calibration positives are one typist's (#5622).
- **Artifact.** `scripts/audit/translation-page-boundary.mjs` (`--calibrate`, `--sample=N --seed=S`). The 44 verified flags (book:page) are on #3918.
