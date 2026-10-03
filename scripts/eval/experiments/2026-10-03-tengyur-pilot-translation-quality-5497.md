## 2026-10-03 · Is the Tengyur pilot English good enough to run on all 213 volumes? (#5497)
<!-- PRIOR ART: 2026-10-02-note-facts-full-tibetan-run-5624.md (note-fact method, reused for part D); scripts/eval/tibetan-mt-ab/ (the 84000-referenced judge, reused for part B); 2026-10-02-what-the-judge-calls-invention-5274.md (invention typing, reused in part C). None of them covers the Tengyur pilot or a source that is a verified e-text rather than OCR. -->

**Question.** The pilot translated 1,269 Derge Tengyur pages (5 volumes, one per section) with `gemini-3-flash-preview`, chained Batch, prompt v13, for $1.90. Derek decides whether to spend about $190 on all 128,369 pages with text. Is the draft good enough, and what has to be fixed first?

**Design.** Read-only, $0 model spend (Opus subagents on the subscription; no Gemini). Pages selected by `translation.model` + `translation.updated_at ≥ 2026-10-02T21:00Z` on the 5 books: 1,269 pages (v113 324, v33 300, v174 300, v96 241, v157 104), the count the pilot reported. The source for every page is `ocr.data`, the Esukhia public-domain Derge e-text aligned to the folio.
- **A. Mechanical, all 1,269 pages** (`tengyur-pilot-qa/mechanical.mjs`, reusing `page-integrity.mjs` / `ocr-loop-guard.mjs`). Checks: English/source length ratio (English words per Tibetan syllable, outliers against each volume's median), Tibetan script left in the English, loops and repeated blocks, Esukhia markup leaks, `<note>` count and balance. Every flag was read by eye before it was counted.
- **B. 84000 reference.** 84000's TEI repo lists 3 published Tengyur texts (Toh 3156, 3808, 3990). Only **Toh 3990** (Vasubandhu, *Explanation of the Sūtra on the Four Factors*, v113 ff. 66a–66b) is in the pilot, so **n = 2 pages** (p130 from {D3990} on, and p131). The existing judge (`tibetan-mt-ab/JUDGE-PROMPT.md`, adapted for an e-text source) ran with two blinded Opus judges in opposite page order. Each page carried three candidates: the pilot English, a copy with one planted reversal, and a byte-identical duplicate. TIE was allowed.
- **C. Source-grounded fidelity, 40 pages** (8 per volume, seed 5497, pages with ≥ 60 syllables; `build-packet-c.py`, `JUDGE-PROMPT-C.md`).
  - Each item is the page image, the Tibetan e-text, the neighbouring sides' edge lines (to type boundary moves) and the English.
  - Two blinded Opus judges (A, B) read all items in their own shuffle, each split over two agent instances.
  - Scored: fidelity 1–5 or `cant_tell`, omission, invention (typed boundary / unreadable fill / added fact / gloss), inversion with quotes, and markup handling.
  - **Controls, read first:**
    - 5 wrong-page negatives: the English of a page ≥ 30 pages away.
    - 5 planted meaning changes on sample pages: 4 reversals and 1 added fact ("on Vulture Peak").
    - 5 duplicates, each placed in the other half from its original.
- **D. Note facts, 40 notes.** The #5624 method and classes, unchanged. The sample is stratified by volume (seed 5497) from the 255 notes that make a checkable claim: Sanskrit equivalents, identifications, attributions. v157 has only 2 such notes; its 2,870 notes are mostly lemma transliterations. Two Opus verifiers each checked 22 rows, 2 of which were planted wrong claims. A verdict of correct, wrong or partly-wrong requires a URL fetched in the session.

**Result.**

*Controls passed.*
- C negatives: 10/10 scored ≤ 2.
- C plants: 10/10 caught, each judge quoting the planted sentence.
- C duplicates: 8/10 got the same grade (both misses ±1) and 9/10 the same inversion flag.
- B plants: 4/4 ranked below the real English. B duplicates: 4/4 tied with the real English.
- D seeds: 4/4 caught.

| part | measure | result |
|---|---|---|
| A (1,269 pp) | empty / truncated English | **0** (one flag was a one-line title side, cleared) |
| A | length-ratio outliers (< 0.5× or > 2× volume median) | 4 low, 0 high. All 4 are **seam shifts**: the previous page's English ran on through the first half of this page (moved, not lost) |
| A | Tibetan script outside notes | 2 pages, one stray syllable inside a Wylie title (`byེད་པ་`) |
| A | repetition loops | **0** (20 repeated blocks are quoted verses and refrains) |
| A | Esukhia `#` leaked | **12 pages**, as `#…#` pseudo-emphasis (out of 10,369 `#` points) |
| A | correction pairs leaked | 0 of 274 |
| A | `{D####}` text openings carried into the English | 10 of 32. 10 more get a heading; **12 lose the boundary** |
| A | unclosed `<note>` (translation swallowed into a note) | **5 pages**, despite the #5644 write-time repair. Re-running `sanitizeTranslationTags` fixes all 5 |
| A | notes per page | 2,870 in all, median 1, mean 2.3; v157 mean 6.4 (Wylie lemma notes) |
| B (n = 2, 84000) | fidelity of the pilot English | judge 1: 4, 5. Judge 2: 5, 5. No omission, invention or inversion |
| C (40 pp) | median fidelity (A / B) | 4 / 4. Exact agreement 28/40, within one grade 40/40 |
| C | share ≥ 4 (mean of the two judges) | **33/40 = 82.5%** (Wilson 95% CI 68–91%). By volume: v113 8/8, v33 7/8, v96 7/8, v157 7/8, **v174 4/8** |
| C | pages with a reversed statement | **4/40** (96 p5, 96 p6, 96 p115, 157 p26). 2 were flagged by both judges, 2 by one; all 4 confirmed by the author against the Tibetan. **3 of the 4 are in v96 (Madhyamaka verse)** |
| C | seam: clause on the wrong side of the page break | **16/40** (boundary run-on 10 pages; omission 8 pages, mostly the side's opening or closing half-line) |
| C | invention other than boundary | 3 small items (2 glosses, 1 added "If the mind does not regard something as 'mine'"); 0 unreadable fill |
| D (40 notes) | verdicts | 32 correct, **1 wrong** (D35 ཤེད་ལས་སྐྱེས་པ = manuja given as "puruṣa"), **1 partly-wrong** (D27 the Himalayans as "a school of Tibetan … logic" in Dignāga), 4 unverifiable, 2 no-claim. Wrong or partly wrong on **2 of the 38 notes with a claim (5%)**, in line with #5624's 6.6% |

**The ten worst pages (part A):**
1. v113 p284: 18 `#` leaked.
2. Unclosed notes: v33 p89, v96 p212, v174 p212, v174 p214, v174 p218.
3. Seam shifts: v96 p35, v113 p122, p230, p150.

**Inversions, quoted:**
- **v157 p26 (f. 14a):** སྔར་བསླབ་པའི་གཞི་མ་བཅས ("the basis of training had *not* yet been laid down") is rendered "Having previously established the foundation of training … therefore, the foundation of training was established previously". The page's own gloss says the rules "had not been spoken".
- **v96 p115 (f. 58b):** ཆོས་ཀྱི་ངོ་བོ་ཉིད་མེད་པའི་དངོས་པོ་ནི་མེད་དོ ("there is no entity *lacking* the own-nature of dharmas") is rendered "An entity *with* a personal inherent nature does not exist".
- **v96 p5 (f. 3a):** MMK 2.22, "because motion does not exist prior to the goer"; the Tibetan says the goer does not exist prior to the going.
- **v96 p6 (f. 3b):** MMK 3.5, "without the act of seeing, the viewer does not exist"; the Tibetan says there is no seer *not* separated from seeing.

**Consequences.**
1. The draft is draft-grade. The two pages that can be checked against 84000 score 4–5. Four in five sampled pages have at most minor slips. There are no loops, no truncation and no invented passages.
2. Three defects can be repaired deterministically at $0, after the run, with no retranslation:
   - strip `#` from the English, or from the text sent to the model;
   - re-insert `{D####}` text openings from the source;
   - re-run the existing `<note>` repair on unbalanced pages.
   The `<note>` gap needs a look in its own right: the lane calls the repair, yet 5 pages were stored unrepaired.
3. Two defects are inherent at this price and belong to the scholars' review:
   - **About 1 page in 10 carries a reversed statement**, clustered in terse Madhyamaka verse.
   - **About 2 pages in 5 have a clause on the wrong side of the page break** (the #5305/#5103 seam class). On the four gross cases the clause is moved, not lost.
   The English should be labelled an unreviewed machine draft.
4. Pramāṇa (v174) is the weakest section, at 4 of 8 pages ≥ 4. It is a literal crib of compressed verse: usable by a specialist, not a general reader.

**Replicated?** Partly. C uses two independent judges with controls; their agreement is within one grade on 40/40 pages. B is n = 2 and decides nothing on its own. Every inversion and every wrong or partly-wrong note was read by the author against the Tibetan. One judge instance (B, half 1) used 18 tool calls for 28 items, so it probably skipped some images. The source is a verified e-text, so the image matters less here than it would over OCR.

**Artifact.** `scripts/eval/results/tengyur-pilot-qa-2026-10/`:
- `mechanical.json`: part A, per-page flags.
- `scores.json`: parts B–D.
- `c/`: key, plants, sample, verdicts A and B.
- `b/`: key and verdicts. The 84000 reference is CC BY-NC-ND and is not committed; it is rebuilt from `84000/data-tei` `translations/tengyur/publications/113-010_toh3990…xml`.
- `d/`: sample, inputs, verdicts, seed key, author adjudication.

Scripts are in `scripts/eval/tengyur-pilot-qa/`.

Cost: $0 (subscription subagents; no Gemini). No writes to `pages` or `books`; the 5 books stay held and hidden.
