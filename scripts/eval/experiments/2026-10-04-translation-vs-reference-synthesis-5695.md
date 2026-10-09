## 2026-10-04 · Served English against published human translations in 14 languages: what the five tracks say together (#5695 synthesis)
<!-- PRIOR ART: the five track files this one summarises and does not repeat — 2026-10-03-xlref-t1-latin-vs-reference-5695.md (T1), 2026-10-03-greek-served-english-vs-published-translations-5695-t2.md (T2), 2026-10-03-translation-vs-reference-vernaculars-t3-5695.md (T3), 2026-10-03-translation-vs-reference-t4-hebrew-arabic-persian-5695.md (T4, PR #5735), 2026-10-03-xlref-t5-sanskrit-pali-chinese-vs-reference.md (T5); the harness smoke run 2026-10-03-translation-vs-reference-harness-smoke-5695.md; the detector test 2026-10-03-reference-free-reversal-detectors-5695.md (PR #5748); Tibetan in 2026-10-03-tengyur-84000-reference-ab-5497.md and 2026-10-03-tengyur-quality-arms-5497.md. None of them puts the languages in one table with one set of definitions. -->

**Question.** Across languages: where is the served English good enough to read, where is it not, what causes the bad pages, and which lever is worth paying for?

**Design.** No new model calls. `scripts/eval/results/xlref-synthesis-2026-10/build.mjs` reads each track's per-page rows and recomputes the served-arm figures with one set of definitions, because the tracks' own tables differ slightly (reversals as a mean of judges in T3, as either judge elsewhere).
- **Pages:** 321 served pages with a published human translation of the same passage, one page per book: Latin 71, Greek 75, German/French/Italian/Dutch/Spanish 59, Hebrew/Aramaic/Arabic/Persian 52, Sanskrit/Pali/Chinese 64. 310 references are open and publishable; 11 are private (scores and ≤ 15-word quotes only, #5488).
- **Measure:** judged against a human reference by two blind Opus judges on the shared harness (`translation-vs-reference/`, PR #5702); the wrong-page, planted-change and duplicate controls passed in every packet; weighted κ 0.79–0.92. This is not accuracy: the judges read the transcription, not the page image.
- **Definitions:** fidelity = mean of the two judges, 1–5. Share ≥ 4 with a Wilson 95% interval. A reversal page = either judge quoted a reversed statement. Flash − Lite = paired difference on fresh single-page arms, prompt v13, bootstrap 95%.
- **Cause** comes from each track's image pass (the low pages plus 10 random, the page image opened). **Corrected transcription** = the same model on a transcription fixed by eye, judged against the corrected text.
- Tibetan is #5497's result, quoted, not recomputed.

**Result 1 — served English, per language.**

| language | n | fidelity mean [95% CI] | median | pages ≥ 4 [CI] | reversal pages / 100 [CI] | omission | Flash − Lite [CI] |
|---|---:|---|---:|---|---|---:|---|
| Latin | 71 | 4.16 [3.97, 4.34] | 4 | 86% [76–92] | 11 [6–21] | 28% | +0.22 [0.06, 0.37] |
| Greek | 75 | 3.64 [3.43, 3.85] | 4 | 67% [55–76] | 16 [9–26] | 55% | +0.32 [0.16, 0.48] |
| German | 22 | 4.43 [4.11, 4.70] | 4.5 | 95% [78–99] | 0 [0–15] | 18% | +0.39 [0.18, 0.59] |
| French | 14 | 4.54 [4.25, 4.79] | 4.75 | 93% [69–99] | 0 [0–22] | 7% | −0.18 [−0.36, −0.04] |
| Italian | 10 | 4.25 [4.00, 4.55] | 4 | 90% [60–98] | 10 [2–40] | 20% | +0.35 [−0.05, 0.80] |
| Dutch (n < 10) | 7 | 4.43 | 4 | 7 of 7 | 0 | 0% | +0.21 [−0.29, 0.71] |
| Spanish (n < 10) | 6 | 4.08 | 4.25 | 4 of 6 | 0 | 0% | +0.25 [−0.17, 0.67] |
| Hebrew | 15 | 3.80 [3.43, 4.13] | 4 | 73% [48–89] | 13 [4–38] | 47% | +0.60 [0.27, 0.93] |
| Aramaic (n < 10) | 5 | 3.30 | 3 | 2 of 5 | 1 of 5 | 20% | +0.50 [0.10, 0.90] |
| Arabic | 20 | 3.50 [3.05, 3.93] | 3.75 | 50% [30–70] | 15 [5–36] | 50% | +0.43 [−0.02, 0.80] |
| Persian | 12 | 2.96 [2.46, 3.42] | 3 | 17% [5–45] | 33 [14–61] | 50% | +0.63 [0.33, 0.92] |
| Sanskrit | 27 | 3.50 [3.19, 3.80] | 4 | 52% [34–69] | 11 [4–28] | 70% | +0.38 [0.11, 0.64] |
| Pali | 15 | 3.67 [3.23, 4.07] | 4 | 60% [36–80] | 13 [4–38] | 53% | +0.53 [0.06, 1.16] |
| Chinese | 22 | 3.75 [3.43, 4.07] | 4 | 64% [43–80] | 18 [7–39] | 45% | +0.33 [0.17, 0.50] |
| **all 321** | 321 | 3.86 [3.76, 3.95] | 4 | 71% | 12 [9–17] | | |
| Tibetan (Tengyur, #5497, 84000) | 113 | 4.54 | 4.5 | 99% [95–100] | 4.4 | 3.5% | on Flash already |

- The pooled row is not a corpus mean. Weighted by each track's translated pages (Latin 1.87M, vernaculars 1.08M, Greek 0.46M, Sanskrit/Pali/Chinese 0.26M, Hebrew/Arabic/Persian 0.13M) the mean is about 4.1 and about 82% of pages are ≥ 4, and both are upper bounds: references exist for the better-known works.
- **The stratum matters more than the language.** Latin incunabula 3.55 (n 10) against 4.25 for print after 1500. Greek manuscripts 2.54 (n 12) and print before 1600 3.40 (n 15) against 4.02 for print from 1800 (n 32). Kabbalah and mysticism 3.04, poetry and adab 3.00, against scripture and law 4.00 (T4).
- The Tibetan row is page-exact e-text, not OCR, and one page per request. It is the only non-European language above 4, and the only one with no transcription error to carry.

**Result 2 — why the low pages are low** (page image opened; every page at fidelity ≤ 3 in T2, T4, T5; the 10 lowest in T1 and T3).

| primary cause | Latin | Greek | vernaculars | Heb/Ara/Per | Skt/Pali/Zh | all |
|---|---:|---:|---:|---:|---:|---:|
| OCR misread | 3 | 16 | 1 | 14 | 6 | **40 (47%)** |
| translation, on a correct transcription | 5 | 5 | 7 | 6 | 12 | 35 (41%) |
| page seam, or the page paired with another page's text | 2 | 1 | 2 | 2 | 2 | 9 (11%) |
| reading order | 0 | 0 | 0 | 1 | 0 | 1 (1%) |
| low pages opened | 10 | 22 | 10 | 23 | 20 | 85 |

- OCR is the first cause where the script is hard: Greek 73%, Hebrew/Arabic/Persian 61%, Sanskrit/Pali/Chinese 30%, Latin 30% (all three are incunabula), vernaculars 10% (black-letter Dutch).
- **Corrected transcription, same model:** Greek +1.77 [1.35, 2.15] (26 pages); Hebrew/Arabic/Persian +1.38 [1.08, 1.67] on Lite and +1.47 on Flash (30); Latin +0.70 [0.15, 1.35] (10); Sanskrit/Pali/Chinese +0.65 [0.32, 1.04] (27), about +1.2 on the 9 OCR-caused pages; vernaculars +0.92 on Flash (6). These pages were chosen because they scored low, so this is the effect on affected pages, not a corpus mean. The correction was made by eye; what a real re-read recovers is being measured (job `reocr-lift-5700`, #5700).
- **A stronger translator does not repair a wrong transcription.** Opus scored 1 on both Greek manuscript pages with invented OCR.
- The headline scores are fidelity to the transcription. On the 30 corrected T4 pages the same Lite output scores 3.05 against the OCR and 2.53 against the corrected text.

**Result 3 — the arms.**

| arm | Latin | Greek | vernaculars | Heb/Ara/Per | Skt/Pali/Zh | Tibetan |
|---|---|---|---|---|---|---|
| X1 noise floor (production twice), fidelity difference | −0.02 [−0.16, 0.13] | 0 (identical text 75/75) | −0.03 [−0.15, 0.09] | 0.07 [−0.08, 0.21] | −0.05 [−0.20, 0.13] | +0.07 |
| Flash − Lite | **+0.22** | **+0.32** (print +0.38, manuscripts 0.00) | **+0.21** (German +0.39, French −0.18) | **+0.53** | **+0.40** | — |
| X2 thinking − no thinking (Flash) | +0.18 [0.04, 0.32], cost ×3.5 | not run (trim) | +0.07, inside the floor, ×3.4 | −0.01, ×2.6 | +0.12, inside the floor | added reversals and omissions |
| reversals with thinking | 4.2 vs 5.6 / 100, no difference | — | 5.1 → 1.7, inside the floor | 5 → 13, inside the floor | 6.6 → 2.9, inside the floor | worse |
| negation / role check + fix pass | −0.04, no effect | not run | not run | −0.05, no effect | +0.12, below Flash alone | detector at chance |
| no neighbour-page context (Lite) | +0.11, inside the floor; carried-over text 23% → 7% | fidelity the same; 21% → 4% | **−0.21** [−0.36, −0.07] | +0.04; 21% → 4% | (adding it: +0.01) | wrong-span pages 15 → 1 of 113 |
| X3 Opus ceiling | 4.85 (Lite 4.10, Flash 4.20), 20 pp | +0.7 over Lite, +0.4 over Flash, 10 pp | 4.98 (+0.50 / +0.43), 20 pp | 4.73 (+1.55 over Lite), 20 pp | 4.88 (+1.27 over Lite), 20 pp | +0.5 over Flash, 40 pp |
| reversals, Opus | — | 0 | 0 | 0 | 0 | 0 |

- **X1.** Mean fidelity repeats to within ±0.07. Single pages do not: 12 of 52 Hebrew/Arabic/Persian pages moved a point or more between two identical Lite runs, and the reversal rate swung between 11 and 19 per 100 pages. A difference in reversals smaller than about 8 per 100 pages cannot be read at these sample sizes.
- **X2.** Thinking does not cut reversed statements in any track, and costs 2.6–3.5 times Flash. A `thinkingBudget` of 2048 billed zero thinking tokens on `gemini-3-flash-preview` in four tracks, so a thinking arm must be checked in billed tokens.
- **X3.** Opus with the same prompt and input is the only arm that removes reversals. The judges are also Opus (blind), which may flatter it.
- **Reference-free detectors** (PR #5748, 150 pages): the best one (a direct contradiction check on Flash-Lite) finds 83% [70–91] of the judged reversals, but 18% [15–22] of its flags are reversals and it flags half of all pages. Back-translation adds nothing at 3.4 times the cost. Errors that begin in the OCR are invisible to all three detectors.

**Result 4 — more than accuracy** (one separate Opus judge, 1–5; ours / the reference).

| language (pages) | readability | register and voice | terminology | ambiguity | transparency | stance, ours | stance, reference |
|---|---|---|---|---|---|---|---|
| Latin (71) | 3.87 / 4.10 | 3.68 / 4.73 | 3.85 / 4.08 | 4.23 / 4.27 | 3.92 / 3.17 | literal 50, balanced 20, free 1 | balanced 38, free 19, literal 14 |
| Greek (30) | 3.30 / 4.17 | 3.23 / 4.43 | 3.63 / 3.77 | 3.23 / 2.90 | 3.43 / 2.50 | literal 17, balanced 13 | balanced 14, free 10, literal 6 |
| German (22) | 3.73 / 4.32 | 3.68 / 4.82 | 4.09 / 3.95 | 4.59 / 4.18 | 4.27 / 2.59 | literal 14, balanced 8 | free 11, balanced 10, literal 1 |
| French (14) | 4.14 / 4.57 | 3.93 / 4.86 | 4.64 / 3.79 | 4.86 / 4.07 | 4.36 / 2.71 | literal 9, balanced 5 | balanced 9, free 5 |
| Italian (10) | 3.50 / 4.30 | 3.50 / 4.60 | 3.90 / 3.70 | 4.50 / 4.40 | 4.40 / 2.70 | literal 7, balanced 3 | free 5, balanced 3, literal 2 |
| Hebrew (15) | 3.8 / — | 3.6 / — | 3.7 / — | 3.8 / — | 3.5 / — | literal 10, balanced 5 | — |
| Arabic (20) | 3.6 / — | 3.6 / — | 3.6 / — | 4.0 / — | 3.5 / 2.9 | literal 17, balanced 3 | — |
| Persian (12) | 3.0 / — | 3.2 / — | 3.3 / — | 3.4 / — | 3.3 / — | literal 9, balanced 2, free 1 | — |
| Heb/Ara/Per references (52) | — / 4.1 | — / 4.3 | — / 4.1 | — / 4.0 | — / 3.5 | | literal 17, balanced 21, free 14 |
| Sanskrit (27) | 3.78 / 3.74 | 3.52 / 4.41 | 4.00 / 3.41 | 2.93 / 3.07 | 3.59 / 3.04 | balanced 15, literal 11, free 1 | free 12, balanced 8, literal 7 |
| Pali (15) | 3.53 / 4.73 | 3.87 / 3.73 | 3.87 / 3.27 | 3.27 / 2.80 | 3.53 / 2.27 | literal 12, balanced 3 | free 11, balanced 4 |
| Chinese (22) | 3.23 / 4.23 | 3.27 / 3.95 | 3.45 / 2.82 | 3.32 / 2.36 | 3.73 / 2.64 | literal 18, balanced 4 | free 13, balanced 8, literal 1 |

- The same shape in every language: ours is a literal, annotated crib. It trails the published translations on readability and on voice (register 3.2–3.9 against 3.7–4.9), and it leads on showing its work (transparency 3.3–4.4 against 2.3–3.5).
- Outside Hebrew/Arabic/Persian it keeps terms and open ambiguity at least as well as the human translators. Latin is the exception on terminology (3.85 against 4.08).
- Against early-modern references ours is the more readable (Latin 4.26 against 3.52); against 19th-century ones the less (3.59 against 4.51).
- **The reference is one reading.** Where ours and the reference differ in meaning, the judge sided with ours 75 times and the reference 72 (Latin, 190 places); found ours right on 42 pages and the reference right on 22 (vernaculars); the reference 29 pages, ours 16 (Sanskrit/Pali/Chinese); the reference 94 places, ours 32 (Hebrew/Arabic/Persian).

**Pairs where ours and the reference make different legitimate choices** (both accurate; material for principles, not errors).

| page | the reference chose | ours chose | the question it raises |
|---|---|---|---|
| Erasmus, *Colloquia* [p223](https://sourcelibrary.org/book/69b21c6c429e087c6f8646f6?page=223) | Bailey 1725: racy spoken English ("a Dose of Fuddle") | the Latin word by word, neutral modern English | keep the genre or keep the words? |
| *Asclepius* [p159](https://sourcelibrary.org/book/690989d5cf28baa1b4cae1c9?page=159) | Mead: archaic, hieratic, leaning to the lost Greek | a plain crib of the Latin as printed | translate the work or this printing? |
| *Corpus Hermeticum* X [p64](https://sourcelibrary.org/book/69938e765d28b693146d0f99?page=64) | Mead: "God's Gnosis", "Source" | "the knowledge of God", "beginning" | keep a term of art or translate it? |
| Hero, *Pneumatica* [p348](https://sourcelibrary.org/book/695aa97dbe4023bd34bd6715?page=348) | Greenwood 1851: "a valve or tap" | the Greek term kept and glossed (*smerismatia*) | familiar equivalent or the source's own term? |
| Humboldt, *Kosmos* [p187](https://sourcelibrary.org/book/698fb77b6b95eeda7d2d1eaf?page=187) | Otté: converts the units ("37,000 feet (about seven miles)") | the page's own figures | the reader's convenience or the page's numbers? |
| Boehme, *Signatura rerum* [p194](https://sourcelibrary.org/book/6952603cab34727b1f04647b?page=194) | Law's edition: "the source of anger" for *Zornquall* | "the torment of wrath" | a word that means both: which half to close? |
| Samaritan Pentateuch [p342](https://sourcelibrary.org/book/69920bb1e0a548a13d884da7?page=342) | JPS 1917: biblical idiom, follows the Masoretic division | plain modern wording, follows this page's text | liturgical voice or the witness in hand? |
| *Kashf al-Mahjub* [p228](https://sourcelibrary.org/book/69935b208e28d8f4c5d3c445?page=228) | Nicholson: compresses, drops honorifics, established equivalents | honorifics and transliterated terms kept, with glosses | how much of the source's courtesy belongs in English? |
| 金剛經口訣 [p83](https://sourcelibrary.org/book/6a3c61db40c88a541d8f091d?page=83) | Gemmell 1912: Victorian devotional prose ("Lord Buddha") | the bare paradox and Huineng's comment | domesticate a paradox or leave it bare? |
| Yājñavalkya + Mitākṣarā [p193](https://sourcelibrary.org/book/6a06b0aff12363da8cfdc945?page=193) | Mandlik 1880: root verses only, every supplied word bracketed | the commentary translated, *nyāsa* / *nikṣepa* kept beside the English | is the commentary part of the text? |

T1 flagged 54 of its 71 pages as carrying a legitimate difference of this kind (`xlref-t1-2026-10/dimensions.json`).

**Draft translation principles** (for Derek to edit; not published). Each rests on the pages above or on a measured defect.
1. **The page first.** We translate what this page prints, not the work as it is known elsewhere. A different edition's reading, a familiar verse or a famous passage is never substituted. (Asclepius; Samaritan Pentateuch; the Vatican Zohar transcription that gives famous passages not on the leaf.)
2. **A study translation, and we say so.** Our stance is literal to balanced: a crib a reader can check against the image beside it. A reading translation in the voice of Bailey or Otté is a different product. It is worth making for some books, as a labelled second text, not as a silent change of stance.
3. **Keep the terms.** A term of art stays recognisable: kept or transliterated, glossed once. It is not flattened into an everyday word. (Gnosis; *smerismatia*; *nyāsa*.)
4. **Leave open what the source leaves open.** Where a word carries two senses, keep both or note the other; do not resolve silently. (*Zornquall*.) The human translators resolve silently far more often than we do, and that is the one thing we should not copy from them.
5. **The page's own numbers, names and units.** Never convert, round or modernise in the text. A conversion goes in a note. (Humboldt.)
6. **Show the work.** Anything supplied, corrected or doubted is marked; nothing is added or dropped silently. Our notes are never confused with the book's own notes. A commentary printed on the page is part of the page and is translated in full, not summarised. (Sanskrit: 70% of pages omit something, mostly commentary.)
7. **Doubt travels with the text.** Where the transcription is uncertain, the English says so. A fluent sentence built on a misread word is the worst thing we serve, because nothing on the page warns the reader. (Hariri: "my losing bargain" printed, "the best of my deal" served.)
8. **Voice is the known gap.** Verse should stay verse-like and a comic dialogue should sound spoken. We lose most here (register 3.2–3.9 against 3.7–4.9). It is a goal for the reading stance in #5698, to be measured on these pairs, and never bought at the cost of principles 1–7.
9. **Negation, number and role are checked before style.** The reversals we found are double negatives (*nemini non invidens* → "envying no one"), pleonastic negatives (Galileo's "non veggo che si possa dubitare"), numbers (240 → 440) and who does what to whom. One reversed sentence costs a scholar more than a page of stiff prose.
10. **The reference is a reading, not the truth.** A published translation is how we measure, not what we imitate. Where we differ from it, the page decides.

**Threats.**
- **Judged, not accuracy.** One judge family (Opus); the judges read the transcription, so the headline overstates fidelity to the page wherever the OCR is wrong.
- **Selection.** Published English exists for the better-known works. Commentary-heavy Hebrew, Chinese woodblock before 1800, Latin dissertations, sermons, pamphlets and manuscripts are thin or absent. Every track expects its corpus mean to be lower.
- **Recitation (#5523).** No inflation is visible in Latin or Greek (canonical pages score no higher), none can be in the vernaculars (no canonical page), and it is possible in Hebrew/Arabic/Persian (3.83 against 3.33) and Sanskrit/Pali/Chinese (+0.1 to +0.3).
- **Loose references.** Scores do not differ by reference style in any track.
- **Span.** No reference cut was judged wrong in four tracks, and 2 of 150 judge-pages in Greek. A narrow cut hides omissions.
- **Small strata.** Dutch, Spanish and Aramaic are under 10 pages. The cause shares in Latin and the vernaculars rest on 10 low pages each.
- **Corrected transcriptions are a ceiling**, made by eye on pages picked for being bad.

**Decision.** For Derek, as the numbered digest in the synthesis comment on #5695. Already decided on 2026-10-04: Greek, Hebrew/Aramaic, Arabic, Persian, Sanskrit, Pali and Chinese translate on Flash (PR #5740); Latin and the vernaculars stay on Lite; a real re-read is being measured before any OCR-first backfill (`reocr-lift-5700`).

**Cost.** $0 for this synthesis. The programme spent about $8.05 on Gemini across the five tracks and the detector test ($2.12 + $0.62 + $1.36 + $1.96 + $1.51 + $0.48), against a ceiling of $25. Judges ran on the subscription.

**Artifacts.** `scripts/eval/results/xlref-synthesis-2026-10/` (`build.mjs`, `summary.json`, `served-pages.jsonl`: one row per served page with track, language, stratum, fidelity, reversal, omission). The per-page rows with references and licences stay in each track's directory.
