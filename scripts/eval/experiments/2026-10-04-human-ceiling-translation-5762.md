---
stage: translation
measure: judged_vs_reference
languages: [grc, la]
scripts: [Grek, Latn]
canons: []
n_books: 66
n_pages: 66
verdict: "A second published translator scores 4.21 (Greek) / 4.14 (Latin); Flash reaches 87% / 105% of that ceiling, Lite 74% / 98%; the Greek gap is wrong OCR."
status: informational
decision: null
superseded_by: null
issue: 5762
---
## 2026-10-04 · Where does a second published translator land on our fidelity scale, and how much of that do Flash and Lite reach? Greek and Latin (#5762 track 1)

<!-- PRIOR ART: 2026-10-03-xlref-t1-latin-vs-reference-5695.md and 2026-10-03-greek-served-english-vs-published-translations-5695-t2.md (the pages, the first reference, the Flash and Lite arms, the harness; all reused unchanged); 2026-10-01-translation-recitation-pilot-5523.md (two PD translators per work, but word overlap at chapter level, no judge). Neither puts a human translation in the candidate seat. -->

- **Question.** T1/T2 score our English against ONE published translation ("Flash 4.3, Lite 4.1"). What does a second, independent published translator score on the same pages by the same judges, and what share of that do Flash and Lite reach?
- **measure:** judged against a human reference (two blind Opus judges, harness `scripts/eval/translation-vs-reference/`, rubric and prompt unchanged). Not accuracy. The ceiling is one translator judged against another, not the truth.
- **Design.**
  - **Pages.** 73 of the 146 T1/T2 pages had a candidate second public-domain translator (`human-ceiling/make-align-inputs.mjs` lists them). 11 aligner agents cut translation B to each page against the source page, with three logged source↔B anchors per page (start, middle, end), an independence check, and a check that the cut is recoverable from the downloaded file (three-word-run coverage ≥ 0.9; lowest kept 0.94).
  - **Kept: 66 pages, 66 books: Greek 33 (31 + 31 translators), Latin 33 (26 + 29 translators).** Dropped 7: B a revision of A or A's source (Zosimus 1684/1814, Proclus Johnson/Taylor, Plotinus Guthrie via Bouillet), B abridged (Procopius, Holcroft), source page unusable (1), B cut from OCR too dirty to verify (Harvey 1653, Boerhaave/Shaw). 8 kept pairs are `independent: partial` (revision lineages such as Clowes/Potts) and are reported apart. All B texts are open (22 EEBO-TCP, the rest pre-1931 or Gutenberg/CCEL/LacusCurtius).
  - **Two packets, same pages.** Reference A with candidates B, Flash, Lite and A itself; reference B with candidates A, Flash, Lite and B itself. So B vs A, A vs B, Flash vs A, Flash vs B, Lite vs A, Lite vs B, and the reference against itself. Flash and Lite are the T1/T2 single-page prompt-v13 arms (Latin Lite = `prod-A` on 29 pages, `lite-noctx` on the 4 BPH pages that production sends to Flash).
  - **Gate.** Reference-B packet: 6/6 controls per judge. Reference-A packet: the first build (seed 5762) failed, 2 of 3 planted controls caught by each judge. The missed plant changed "though never so great" to "though always so great" inside Kennett's 1683 paraphrase: an idiom, not a reversal (one judge noted the two texts differ only there). I rebuilt the packet with seed 57621 and re-ran the gate blind: 6/6 per judge. The first gate is kept in `gate-first-attempt-refA-seed5762.json`. Judges agree exactly on 81% / 89% of cells, weighted κ 0.89 / 0.93.
- **Result (fidelity 1–5, mean [95% CI], page = book = unit; "human" is the mean of B-vs-A and A-vs-B).**

  | | pages | human vs human | Flash | Lite | reference vs itself | Flash − human | Lite − human | Flash, share of ceiling | Lite, share of ceiling |
  |---|---:|---|---|---|---|---|---|---|---|
  | Greek | 33 | **4.21 [4.09–4.33]** | 3.79 [3.36–4.19] | 3.38 [3.01–3.73] | 4.39 [4.25–4.51] | −0.42 [−0.89, +0.01] | −0.83 [−1.26, −0.43] | **87% [73–100]** | **74% [62–86]** |
  | Greek, OCR sound (21) | 21 | 4.21 [4.08–4.33] | 4.39 [4.05–4.68] | 3.92 [3.62–4.19] | 4.41 | +0.18 [−0.14, +0.49] | −0.30 [−0.63, +0.02] | 106% [95–115] | 91% [81–101] |
  | Greek, OCR wrong (12) | 12 | 4.21 [3.96–4.46] | 2.73 [2.08–3.40] | 2.44 [1.90–3.00] | 4.35 | −1.48 [−2.31, −0.63] | −1.77 [−2.50, −1.02] | 54% [32–79] | 45% [27–66] |
  | Latin | 33 | **4.14 [3.95–4.33]** | 4.30 [4.03–4.54] | 4.08 [3.82–4.30] | 4.27 [4.11–4.43] | +0.16 [−0.16, +0.46] | −0.07 [−0.40, +0.23] | **105% [95–115]** | **98% [88–108]** |
  | Latin, both translators 19th–20th c. | 11 | 4.57 [4.32–4.79] | 4.43 [4.04–4.75] | 3.98 [3.48–4.41] | 4.66 | −0.14 [−0.66, +0.34] | −0.59 [−1.23, −0.04] | 96% [83–110] | 83% [67–99] |
  | Latin, A or B early-modern | 22 | 3.93 [3.72–4.14] | 4.24 [3.89–4.56] | 4.13 [3.83–4.38] | 4.08 | +0.31 [−0.08, +0.68] | +0.19 [−0.14, +0.50] | 111% [98–124] | 107% [95–118] |

  Share of ceiling = (arm − 1) / (human − 1); 1 is the scale's floor. Direction: B vs A 4.04, A vs B 4.32 (A is usually the later, closer translation). Independent-B-only, non-canonical and "human cut judged same span" strata move the Greek share by ≤ 5 points and the Latin share by ≤ 2 (`summary.json`).
  - **The scale tops out near 4.3, not 5.** The reference judged against its own source page scores 4.33 [4.22–4.44]: the judges mark an omission on 42% of reference-vs-itself pages (the published translation, or its cut, leaves out part of the page) and a different extent on 19%. A second translator sits 0.15 below that.
  - **Same mean, different errors.** Per page × judge: humans are marked for omission (46% of pages) and free rewriting; machines for reversals and garble.

    | | human | Flash | Lite | reference vs itself |
    |---|---:|---:|---:|---:|
    | pages at ≤ 3 | 3% | 20% | 24% | 2% |
    | quoted reversal | 3% | 11% | 17% | 2% |
    | omission | 46% | 17% | 28% | 42% |
    | fluent fill of unreadable source | 0% | 18% | 22% | 0% |

    Flash is at or above the human score on 56% of pages, Lite on 48%; Greek 45% / 33%, Latin 67% / 64%.
  - **Flash − Lite on these pages:** Greek +0.41 [0.21–0.61], Latin +0.23 [−0.02, +0.45], as in T2 (+0.32) and T1 (+0.22).
  - **Noise floor.** Duplicate control: 6/6 tied in each packet. Retest of the same arm on the same page against reference A (this run vs T1/T2): mean shift −0.01 (CI ±0.12) in both languages, mean absolute difference 0.28 (Latin) / 0.27 (Greek).
- **Conclusion.** On sound transcriptions Flash is at the level of a second published translator on mean fidelity in both languages (Latin 105% [95–115], Greek print with a correct OCR 106% [95–115]); Lite is at it for Latin (98% [88–108]) and about 0.3 short for Greek (91% [81–101]). Over all Greek pages Flash reaches 87% and Lite 74%, and the gap is the 12 pages where the OCR was wrong. The mean hides a tail: one machine page in five scores ≤ 3 against one human page in thirty, and machines reverse the sense three to five times as often. More money on the translation model buys Greek +0.4 and Latin +0.2; neither closes the tail, which on Greek is the transcription.
- **Threats.**
  - The ceiling is a published translator of 1551–1936 cut to our page, not a professional translating our page today. Early-modern Englishings (27 of 66 B, 21 of them Latin) are loose and score lower, which is why Latin machines look above the ceiling; the 11 Latin pages where both translators are 19th–20th c. give Flash 96%, Lite 83%, with wide intervals.
  - The "OCR sound / wrong" split is not a random split: T2 opened the image on pages that had scored low and corrected the transcription there, so the 12 are selected partly on the outcome.
  - Blindness is imperfect: a human translation in 17th-c. spelling without house tags is recognisable. The judges are told not to guess and the rubric scores meaning, but they can tell.
  - Cut error counts against the human arms: judges saw the human candidate start or end off the page on 21% of judge-pages. The "same span" stratum (37 pages) gives the same shares.
  - Canonical texts are 24 of 66 (Greek 8, Latin 16); the published translations of them are in every model's training data. Non-canonical strata agree within the intervals.
  - 33 pages per language; "share of ceiling" has a ±10–13 point interval. One page per book.
- **Not done.** Sanskrit (Gita) and Chinese (Analects): T5's records are not in the T1/T2 record form on this box and the pairs did not come easily; left out as the brief allows. 50+ pages per language was the aim; 33 each is what the T1/T2 pages afford once revisions and abridgements are excluded.
- **Files.** `scripts/eval/results/human-ceiling-5762-2026-10/translation/`: `summary.json`, `table.md`, `rows.jsonl` (page × reference × arm, with licences), `pairs.json` (translators, independence, anchors, alignment method), `b-cuts.jsonl` (the 66 second translations cut to the page), `dropped.json`, `results-refA.json`, `results-refB.json`, `gate-first-attempt-refA-seed5762.json`. Tooling: `scripts/eval/translation-vs-reference/human-ceiling/`.
- **Spend.** Gemini $0 (the arms are T1/T2's). Judging and alignment by Claude subagents on the subscription.
- *Replicated?* No. One sample; Flash − Lite replicates T1/T2 on a subset of their pages.
