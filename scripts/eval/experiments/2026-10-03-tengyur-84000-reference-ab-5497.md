---
stage: translation
measure: judged_vs_reference
languages: [bo]
scripts: [Tibt]
canons: [derge-tengyur]
n_books: null
n_pages: 113
verdict: "Against 84000, one page per request matches the chained lane on fidelity (4.54 vs 4.48) and cuts wrong-span sides from 15 to 1 of 113; seams come from 8-page blocks."
status: adopted
decision: "Full Tengyur draft runs one page per request, no context (PR #5717)"
superseded_by: null
issue: [5497, 5704, 5717]
---
## 2026-10-03 · Tengyur draft English against 84000's published translations: the chained lane (neighbour context, 8-page blocks) vs one page per request with no context (#5497)
<!-- PRIOR ART: 2026-10-03-tengyur-pilot-translation-quality-5497.md (PR #5676: same pilot lane, but only n = 2 pages had an 84000 reference; it found seams on 16/40 and reversals on 4/40, by source-only judges); scripts/eval/tibetan-mt-ab/ (the 84000-referenced blind judge, reused here as a two-candidate packet). Neither compared lane SHAPES against a human reference. -->

**Question.** Before the ~$200 full Derge Tengyur draft: against a real human reference, is the
chained lane (what the pilot ran) better or worse than translating each page on its own? The
Esukhia e-text gives every page an exact source, so neighbour context may buy nothing and may be
the cause of the pilot's page-seam shifts.

**Design.**
- **Reference.** 84000 lists **16** published Tengyur texts (Toh > 1108) on 2026-10-03: 888 folio
  sides. The 84000 reader API (`graphql.84000.co`) returns each passage's English with folio mentions
  and its aligned Derge Tibetan with `[F.n.x]` markers. Each side was cut on both and matched to our
  page by volume + `ocr.text_edition.folio`. A side was **kept** only if 84000's Tibetan cut and our
  e-text cover each other at ≥ 70% (bag of syllables) and the English cut has a sane length
  (0.4–1.6 words per syllable, after removing the Hevajra root verses that 84000 interleaves into
  Toh 1183/1189). Result: **864 kept**. 24 dropped: 14 sides shared with a text 84000 did not publish,
  8 sides with no English folio mention (Toh 4378, 4410, 4413), and 2 with an off length.
  - Toh 3808 is 582 of the 864 sides, so the judged sample is stratified.
  - 84000's English is CC BY-NC-ND. It was used as judge input only and is not committed or written
    to pages.
- **Arms** (same pages, `gemini-3-flash-preview`, prompt v13 checked from the DB, Batch API, outputs
  to files only).
  - **A** is the chained lane, built from its own functions: `planBlocks` 8-page blocks, each seeded
    with the arm's own previous translation plus the OCR either side (`PAGE_BREAK_SCOPED`), and
    single-page fallback for any pages a block failed to return. Toh 3808 was cut into 8 chains, each
    opened by an unscored lead-in page, so every first block is seeded as it would be mid-volume.
  - **B** is one page per request, with no previous translation and no adjacent OCR.
  - Envelope `tengyur-ref-5497` ($5, lane-restricted, books held throughout), since closed.
  - **Spend $2.88** over 24 rounds: A $1.39 ($0.0016/page), B $1.49 ($0.0017/page).
- **Judges.** Two blind Opus judges (8 subagent instances) over 113 sides: Toh 3808 50, 1183 25,
  1189 25, plus all 13 sides of the small texts. Each item gave the Tibetan, 84000's cut with its
  neighbouring sentences, A and B in random order, and allowed a TIE (`tengyur-ref/JUDGE-PROMPT.md`).
  - Scored per candidate: fidelity 1–5, omissions, typed inventions (#5274/#5676 typing), inversions
    with quotes, and span (does the English cover the side's text, start to end?).
  - Controls (15 items) were mixed in: wrong-page, planted reversal, duplicate.
  - Ten pages were read by eye: `results/tengyur-ref-2026-10/by-eye.md`.

**Result.** Controls 30/30: wrong page ≤ 2 on 10/10, planted reversal flagged and ranked below on
10/10, duplicate tied with the same grade on 10/10. The judges agreed within one grade on 113/113
pages for each arm (exact: A 87, B 90).

| per arm, 113 sides | A chained | B no context |
|---|---|---|
| fidelity median / mean (two-judge mean) | 4.5 / 4.48 | 4.5 / 4.54 |
| sides ≥ 4 | 109 = 96.5% (CI 91–99) | 112 = 99.1% (CI 95–100) |
| **span wrong: both judges / either** | **15 / 24** | **1 / 4** |
| omission (judgements, of 226) | 35 (15.5%) | 8 (3.5%) |
| reversed statement, pages (either / both judges) | 7 / 4 = 6.2 per 100 | 5 / 3 = 4.4 per 100 |
| invention judgements: boundary · added fact · gloss | 23 · 10 · 14 | 4 · 9 · 53 |
| `<gloss>` / `<note>` per page (all 864 sides) | 1.3 / 1.7 | 4.8 / 2.9 |

- **Preference** (226 judgements): tie 125, B 54, A 47. Both judges agreed on tie 52, B 22, A 16.
  Fidelity differs by A − B = −0.07 (sign test p = 1.0), so the arms are not separable on fidelity.
- **By text**, preference judgements A / B:
  - Toh 3808 (Perfection of Wisdom commentary, running prose): **17 / 36**, span errors 29 / 2,
    omissions 24 / 0.
  - Toh 1183 (Hevajra commentary, lemma + gloss): **16 / 4**. B's speculative glosses and edge slips
    lose it these pages.
  - Toh 1189: 11 / 8.
  - Small texts: 3 / 6.
- **Where A's seams come from.** All 15 of A's both-judges span errors are on pages translated inside a
  multi-page block, not on its first page: **15/84**. There were **0/10** on block-first pages and
  **0/19** on single-page fallbacks, which had the same seed and neighbour OCR. The defect is the
  8-page block (the model re-divides the text across its `<translation page=N>` tags), not the
  context itself.
- **Lane mechanics.** 21 of 111 A blocks came back as one merged page and were discarded as
  `short-block`, sending 168 pages to single-page fallback. One block (Toh 3808 pp. 357–364) did this
  twice in a row. A third time would have parked the whole run in production.
- **Reversals, checked by eye.**
  - A only, 4, all confirmed: v93 p134 "do not fail to reside" for མི་གནས; p108 "internal" for ཕྱི
    (outer) emptiness; v47 p382 "beauty will be attained" for mdze(s) thebs, leprosy; v93 p570 Maitreya
    made the recipient.
  - B only, 1 confirmed: v3 p108 "do not belong to the city" for གྲོང་ཁྱེར་མ་ལགས, an ambiguous parse.
    1 more (P080) was flagged by one judge and not read.
  - Both arms, 3: the same reversed reason clause on v93 p573, and the vocative "Lord" made the speaker
    on two sūtra quotations.

**Consequences.**
1. **Run the full Tengyur one page per request (arm B), not on the chained lane.** Fidelity is the same.
   The page beside the woodblock carries the right span on 112/113 sides vs 98/113 (both-judges count),
   and the sides with an omission drop from 12 to 1. Eternity's reviewers read page by page, and a
   clause on the wrong page is the defect they would trip on most. Cost is about $0.0017 per page, so
   **≈ $220** for 128,369 pages, against ≈ $192 chained at the pilot's rate ($205 at this test's, which includes the fallbacks).
2. B's cost is noise in the notes: 4.8 glosses per page, many of them guesses ("likely a reference
   to…"), and edge slips where a word is split across the page (v3 p115 "the syllable 'Ba'"). These
   cost B the Hevajra commentary. A single-page request that carries the adjacent OCR only (A's
   fallback pages had it: 0/19 span errors) might keep B's spans and fix the edge words. It is
   **untested**: this run had n = 19 such pages, not a comparison.
3. Reversals remain at about 4–6 per 100 pages in either arm. Two of the shapes are the model
   "repairing" logic that looks backwards (v93 p134, p573), and one is speaker confusion in sūtra
   quotations. That still makes the English an unreviewed machine draft for the scholars.
4. The pilot's estimate of 1 in 10 pages reversed (#5676, 4/40, source-only judges) is not contradicted:
   this run has 5–7 in 113 by either judge.

**Replicated?** Partly.
- Two independent judges with 30/30 controls; within one grade on every page.
- The span result is large (15 vs 1) and its mechanism is located: block pages only.
- The fidelity comparison is a null: n = 113, 45 discordant pages.
- Toh 3808 is one text and is half the sample.
- The 84000 folio cut is 84000's own phrase-level placement; judges were told it can be off by a
  clause, and they had the neighbouring English.

**Artifact.** `scripts/eval/results/tengyur-ref-2026-10/`:
- `reference-summary.json` and `reference-drops.json`: per text, kept and dropped sides with reasons.
- `judge/`: key, plants, sample, verdicts J1/J2, `scores.json`.
- `arms/run.json`: rounds, jobs, cost, block outcomes, strike log. `arms/judged-pages.jsonl`: A and B
  English of the judged sides.
- `by-eye.md`.

All 864 × 2 outputs are on Hetzner in `/root/tref/arms/`. Scripts are in `scripts/eval/tengyur-ref/`.
No writes to `pages` or `books`, and the Tengyur books stay held and hidden.
