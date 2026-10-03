## 2026-10-03 · Ancient and Byzantine Greek: how faithful is the served English against a published translation, and where do the bad pages start? (#5695 track T2)

<!-- PRIOR ART: 2026-10-03-translation-vs-reference-harness-smoke-5695.md (the harness this run uses, unchanged); 2026-09-30-translation-corpus-audit-how-faithful-is-a-random-served-5274.md (Greek 27/36 faithful, source-grounded, no reference); 2026-10-02-greek-manuscripts-fit-open-edition-5619.md (edition fitting for Greek manuscripts; not repeated here); #3884 Suda/SOL (entry-level gold, n=150, 77.3% faithful; reported, not re-labelled). This is the first page-level score of served Greek against published human translations, with the cause of each bad page read from the image. -->

- **Question.** Against a published human translation of the same passage, how faithful is the English we serve for Greek pages; which errors dominate; and is the cause the OCR or the translation?
- **measure:** judged against a human reference (two blind Opus judges, harness `scripts/eval/translation-vs-reference/`, gate passed 6/6 controls per judge; exact agreement 78%, within one point 100%, weighted κ 0.88). Not accuracy: the judges' own error is bounded only by the controls.
- **Reference set (n = 75 pages, 75 books, 59 translators).**
  - Drawn from 85 candidate books chosen from the census of Greek-tagged visible books with translated pages (1,110 books, 458,930 translated pages: editions of 1800+ 42%, 1450–1599 29%, manuscripts/pre-1450 10%, 1600–1799 10%, undated 8%). One seeded interior page per book; the first candidate page was used for 66 of 75 books (13 pages skipped, each with a recorded reason: 14 "reference does not cover", 4 "not Greek").
  - Sample by edition: print 1800+ 32, print 1600–1799 15, print 1450–1599 15, manuscripts 12, undated print 1. By period of the work: classical/Hellenistic 15, imperial 28, late antique 26, Byzantine 6.
  - Licences: 69 open (public domain: 52 worldwide, 15 US by date, 2 Loebs not renewed per LacusCurtius), 6 private (5 in-copyright, 1 Suda On Line CC BY-NC-SA, which may not be committed here). Style: literal 39, free 18, early-modern 18. Canonical (memorised) texts 9, reported apart.
  - Each cut was checked by script to appear verbatim in the downloaded source file. Judges rated the cut `exact` on 100 of 150 judge-pages, `narrower` 37, `wider` 7, `wrong` 2, can't tell 4.
  - Label check (#4884): of 499 interior pages drawn in these Greek-tagged books, 112 (22%) were mostly not Greek and 110 (22%) were Greek–Latin parallel pages. 6 candidate books had no usable Greek page at all.
  - Excluded by design: books with facing English (Loeb, Scott's Hermetica, Oxyrhynchus). Production translates 8-page blocks, so the reference sits in the translator's context.
- **Served English vs reference (two judges, n = 75).** Mean fidelity **3.64 (CI 3.43–3.84)**, median 4; 22 pages (29%) at ≤ 3. Omission on 45% of pages, a quoted reversal on 12% (6–19%), next/previous-page text on 19%, fluent filling of unreadable source on 17%.

  | stratum | n | fidelity (CI) | pages ≤ 3 |
  |---|---:|---|---:|
  | manuscript | 12 | **2.54** (2.00–3.12) | 75% |
  | print 1450–1599 | 15 | 3.40 (2.93–3.87) | 40% |
  | print 1600–1799 | 15 | 3.93 (3.63–4.23) | 20% |
  | print 1800+ | 32 | 4.02 (3.81–4.20) | 12% |
  | page is Greek only | 57 | 3.48 (3.23–3.72) | 37% |
  | page is Greek + Latin | 18 | 4.14 (3.92–4.36) | 6% |
  | work: classical/Hellenistic | 15 | 3.73 (3.17–4.23) | 27% |
  | work: imperial | 28 | 3.39 (3.02–3.75) | 43% |
  | work: late antique | 26 | 3.83 (3.56–4.08) | 19% |
  | reference literal / free / early-modern | 39 / 18 / 18 | 3.68 / 3.53 / 3.67 | |
  | non-canonical / canonical | 66 / 9 | 3.66 (3.43–3.87) / 3.50 (n < 10) | |

  Byzantine works (n = 6, 3.75) are below the reporting floor. The split that matters is the edition (how hard the page is to read), not the period of the work or the reference style.
- **Cause, with the image opened (22 pages at ≤ 3, plus 10 seeded random others).** One Opus reader per page quoted the image against the OCR and the English; I re-read two of them by eye (Horapollo 1597, Photius MS) and both held.
  - Low pages: **OCR misread 16 of 22 (73%, Wilson 52–87%)**, translation 5 (23%, 10–43%), page seam 1 (5%, 1–22%). No reading-order or label cause.
  - By edition: manuscripts 9/9 OCR; print 1450–1599 6/6 OCR; print 1600–1799 2 translation, 1 OCR; print 1800+ 3 translation, 1 seam.
  - 10 of the 16 OCR pages are "garbled": legible minuscule or ligatured type for which the OCR wrote plausible invented Greek, and the English translated it fluently. 7 of the 17 OCR-caused pages had been read by Flash, 10 by Flash-Lite, so the Greek Flash switch (#5575) does not by itself fix these classes.
  - Random other pages: translation 4, seam 3, none 2, OCR 1. On sound pages the residual errors are the translator's and the seam.
  - 6 of the 32 pages had a place where our English matched the page and the reference followed a different edition or an emendation.
- **Arms (one Opus judge; Gemini spend $0.62 of the $5 cap, metered under `triggeredBy: xlref-t2`).** All fresh arms are one page per request on prompt v13, thinking off, temperature 0.
  - **X1 noise floor:** Lite twice gave byte-identical English on 75/75 pages, so there is no sampling noise at these settings. The judge's own retest noise on the served arm (49 pages, same source) is a mean shift of −0.10, exact agreement 76%, mean absolute difference 0.27.
  - **Corrected transcription (26 image-checked pages, fixed from the image or the open edition):** Lite on the OCR 2.27 → Lite on the corrected text **4.04**, Δ **+1.77 (1.35–2.15)**; pages at ≥ 4 went from 2 to 24 of 26. On the 17 OCR-caused pages 1.76 → 4.06. (On these 26 pages every arm was judged against the corrected text, i.e. fidelity to the page.)
  - **Flash vs Lite (the routing choice: Greek translates on Lite):** Δ **+0.32 (0.16–0.47)**, 40 pages better, 15 worse, sign test p 0.001. Print +0.38 (0.19–0.56); manuscripts 0.00 (−0.25–0.25). Cost per page realtime: Lite $0.00185, Flash $0.00392.
  - **Single page vs the served blocks:** fresh Lite does not beat served on fidelity (served − Lite +0.08, −0.08–0.24; prompt and lane differ, so this is joint), but next/previous-page text falls from 21% of pages to 4%. Flash on a single page still carries it on 16%.
  - **Opus ceiling (10 pages):** +0.7 (0.3–1.1) over Lite and +0.4 (0.1–0.7) over Flash; 0 reversals. It scored 1 on both manuscript pages with invented OCR: a better translator does not repair a wrong transcription.
  - Reversals per 100 pages: served 17, Lite 16, Flash 16, Lite on corrected text 8, Opus 0 (n = 10).
- **More than accuracy (one blind judge, 15 gallery + 15 random pages).** Ours: readability 3.30, register 3.23, terminology 3.63, ambiguity 3.23, transparency 3.43 (fidelity 3.58 on these pages); stance literal 17, balanced 13, free 0. References: readability 4.17, register 4.43, terminology 3.77, ambiguity 2.90, transparency 2.50; stance balanced 14, free 10, literal 6. Ours is the more literal and the more openly annotated text; the published translations read better and keep the genre better. On 27 of 30 pages the two make different defensible choices.
- **Threats.** The reference is one translator's reading (6 of 32 image-checked pages had a point where ours was right to the page). Canonical texts did not score higher (3.50 vs 3.66; n = 9), and on garbled manuscripts of Thucydides and Lucian the English followed the garble, not the famous text. Early-modern references scored the same as literal ones. Span: 37 of 150 judge-pages called the cut narrower than the page; a narrow cut hides, not creates, omissions. References exist for authors with published English; lexica, grammars, commentaries on Aristotle, Galen (Kühn) and most Byzantine historians have none, so those genres are not covered. The cause labels come from one reader per page.
- **Reading.** For Greek the first lever is the transcription, not the translator. Where the OCR is right (print from 1600), the English averages about 4 and the remaining errors are omissions, seams and single-word slips. Where it is wrong (manuscripts and ligatured print before 1600), the English is a fluent translation of Greek that is not on the page, and neither Flash nor Opus recovers it.
- **Files.** `scripts/eval/results/xlref-t2-2026-10/`: `pages.jsonl` (one row per page × arm, licences and reference metadata; private reference text withheld), `summary.json`, `results-served.json`, `results-arms.json`, `cause-by-image.jsonl` (image readings and the corrected transcriptions), `gallery.md`. Tooling: `scripts/eval/translation-vs-reference/t2/`.
- *Replicated?* No. One sample, one page per book.
