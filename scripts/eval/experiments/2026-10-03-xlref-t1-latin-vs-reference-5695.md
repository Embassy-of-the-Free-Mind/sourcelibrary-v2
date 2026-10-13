---
stage: translation
measure: judged_vs_reference
languages: [la]
scripts: [Latn]
canons: []
n_books: 71
n_pages: 71
verdict: "Served Latin English scores 4.16/5 (incunabula 3.55, OCR-bound); Flash beats Lite by +0.22 beyond the A-vs-A floor; context and negation check do not."
status: undecided
decision: "PENDING Derek in DECISIONS.md (default: keep lite until the dial rises)"
superseded_by: null
issue: 5695
---
## 2026-10-03 · How faithful is our served Latin English against published human translations, and which lever helps? (#5695 T1)

**Question.** For Latin 1450–1800 (1.57M of our 1.87M translated Latin pages), against a public-domain English translation of the same passage: how faithful is what readers see, what goes wrong, and which cheap lever fixes it?

**Design.** 71 pages, one per book, from a seeded draw (`xlref-t1/draw-pages.mjs`; the first page in a fixed random order that a public-domain translation covers), span-aligned by hand to 71 PD references (EEBO-TCP, Gutenberg, Wikisource, archive.org; all open, all stored). Period: 10 incunabula / 23 16th c. / 31 17th c. / 7 18th c. (corpus weights 18 / 43 / 29 / 10%). 22 canonical, 49 non-canonical. Harness `translation-vs-reference/` (two blind Opus judges, gate passed in all three packets; fidelity κ 0.79 / 0.92 / 0.79). measure = judged against a human reference, not accuracy. Arms via `xlref-t1/arms.mjs` (production call shape: v13, previous-page translation, scoped page-break devices, thinking 0, temperature default). Envelope `xlref-t1`: $2.12 of $8.

**Result (fidelity 1–5, mean [95% CI], n = 71 unless stated).**

| arm | fidelity | ≤ 3 | reversals /100 pp | $/page (Batch) |
|---|---|---|---|---|
| served (37 flash-era, 34 lite) | 4.16 [3.96–4.34] | 11% | 11.3 [5.8–20.7] | — |
| production today ×2 (lite; X1 noise floor) | 4.08 / 4.10; A−B = −0.02 [−0.16, +0.13] | 14% / 17% | 11.3 / 14.1 | 0.0010 |
| flash, thinking 0 | 4.30 [4.15–4.44]; vs lite **+0.22 [+0.06, +0.37]**, p = 0.004 | 7% | 7.0 | 0.0019 |
| flash, budget 2048 (billed 0 thinking tokens: a flash A-vs-A) | 4.33; vs flash-0 +0.04 [−0.09, +0.16] | 6% | 7.0 | 0.0019 |
| flash, dynamic thinking (3,145 thinking tokens/page) | vs flash-0 **+0.18 [+0.04, +0.32]**, p = 0.04 | — | 4.2 vs 5.6 | 0.0067 |
| lite, no neighbour context | 4.19; vs lite +0.11 [−0.05, +0.28] (inside the floor); boundary leaks 7% vs 23% | 13% | 12.7 | 0.0008 |
| negation check (lite) + flash fix (42/71 flagged) | vs lite −0.04 [−0.23, +0.14] on the 37 changed pages; reversals 8 vs 7 | — | — | +0.0012 |
| lite on corrected transcription (n = 10) | vs lite **+0.70 [+0.15, +1.35]** | — | — | — |
| Opus ceiling (X3, n = 20) | 4.85 [4.6–5.0]; vs lite +0.98, vs flash +0.80 | 1/20 | 5 | not a candidate |

- **Period is the stratum that matters:** incunabula 3.55 [3.0–4.1] (lite today 3.20, flash 3.95); 1500s 4.26; 1600s 4.24; 1700s n = 7, not reported. Style: early-modern refs 4.21, literal 4.16. Canonical 3.95 vs non-canonical 4.26 — the gap is the incunabula (canonical non-incunable 4.18, n = 14): no recitation inflation visible.
- **Cause, image opened (10 pages scored ≤ 3 + 10 random):** low pages — translation 5, OCR abbreviations/misread 3, page seam/pairing 2; on 6 of the 10 the OCR or the page pairing carried some-to-all of the error. Random pages: 0 of 10 had an OCR-caused error. The OCR-caused failures are all incunabula (Cicero 1465: 48 of ~190 words wrong; Aquinas 1484: ~270 of ~900). With the transcription corrected by eye, Aquinas goes 2.5 → 5 and Cicero 2 → 3 (lite) / 4 (flash) on the same model.
- **Six dimensions (one Opus judge, served vs reference):** ours fidelity 4.16 · readability 3.87 · register 3.68 · terminology 3.85 · ambiguity 4.23 · transparency 3.92; references readability 4.10 · register 4.73 · terminology 4.08 · ambiguity 4.27 · transparency 3.17. Stance: ours literal 50 / balanced 20 / free 1; references literal 14 / balanced 38 / free 19. At 190 places where the two disagree on meaning the judge sided with ours 75 times, the reference 72, both defensible 38.

**Conclusion.** Served Latin is faithful on print after 1500 (≈ 4.25) and weak on incunabula (3.55), where the OCR of abbreviations, not the translator, is the first cause. Flash beats lite by more than the noise floor; dynamic thinking adds a little at 3.5× the cost; the negation check and dropping context do not clear the floor. The Opus ceiling says ≈ 0.8 of headroom remains at any price.

**Instrument notes.** `thinkingBudget: 2048` on `gemini-3-flash-preview` billed 0 thinking tokens on 71/71 pages — a budget is a cap the model may leave unused; an arm labelled "thinking" must be checked against `thoughtsTokenCount`. The image check found three page↔text pairing defects in 20 pages (OCR of another leaf, a spread OCR'd against a single-page image, served English of the previous page).

Results: `scripts/eval/results/xlref-t1-2026-10/` (`rows.jsonl` one row per page × arm with licences; `summary.json`; `gallery.md`; raw arm outputs under `arms/`).
