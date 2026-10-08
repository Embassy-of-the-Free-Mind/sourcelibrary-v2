## 2026-10-07 · Re-translating held BL Kangyur pages on the #4523 chained lane: no better than the English readers already have; worth it only where there is none (#4523, step C)
<!-- PRIOR ART: 2026-09-25 engine A/B (#4742: flash vs lite vs MITRA against 84000, single pages) and 2026-10-03 Tengyur chained-vs-single (#5497). This reuses #5497's run-arms.mjs (arm A = the chained lane's own request builders, now with --arms/--tag) and #4742's blind judge kit unchanged, on the HELD BL Kangyur books, and compares against the English those books already serve. -->

**Question.** Before the 1,434 held British Library Tibetan books go through the #4523 chained run: on Kangyur
manuscripts whose served read matches Derge, how faithful is the chained lane's English against 84000, and is it
better than the English the pages carry now?

**A fact that reframes the decision** (`english_state.mjs`, read-only, 2026-10-07). Across the held set:

| stratum | books | pages | English made from the CURRENT read | readable, no English | marked unreadable |
|---|---|---|---|---|---|
| Kangyur | 213 | 94,576 | 81,647 | 12,179 | 750 |
| Nyingma tantras | 95 | 38,974 | 33,096 | 5,262 | 616 |
| terma / biography | 133 | 23,560 | 11,713 | 1,524 | 10,323 |
| other | 993 | 117,643 | 42,359 | 7,475 | 67,809 |
| **all** | **1,434** | **274,753** | **168,815** | **26,440** | **79,498** |

**No held page carries English made from an older read** (0 pages whose `translation.updated_at` precedes
`ocr.updated_at`). 99.98% of the stored English is `gemini-3-flash-preview`, prompt v13: the same model and prompt
as the chained lane, already run on the Yigdzin/Woodblock read (29 Sep – 3 Oct on the pilot books).

**Design.**
- **Books.** 10 Kangyur-stratum books across 8 published 84000 texts and 3 monasteries (Toh 8 ×2, 9, 94 ×2,
  556/557, 142/144, 219/556, 114, 44-31). Chosen from the 09-11 concordance where the served Yigdzin read scored
  ≥ 0.9 against Derge. Ten consecutive pages per book, plus the page before as an unscored lead-in.
- **Fresh Derge alignment** (`kanjur_align.py`, unchanged) of the 109 served pages: median ≥ 0.9 on 94, 0.73–0.90
  on 15 (most on the Woodblock-served Tshamdrak book). All 100 scored pages fall in a published 84000 text.
- **Translation.** `scripts/eval/tengyur-ref/run-arms.mjs --arms A --tag tib-bl-pilot-4523`: the chained lane's
  own `planBlocks` / block prompt / `PAGE_BREAK_SCOPED` / drift and health checks, `gemini-3-flash-preview`,
  prompt v13 (the Tsongkhapa run's), Batch API. **Output to files only; no page was written.** 6 rounds; lead-in
  singles needed two retries. **Estimate $0.26** (lane estimator; $0.23 at the measured $0.0021/page). **Actual
  $0.160** (110 pages, $0.0015/page), metered to `gemini_usage` as type `eval`.
- **Judge.** `scripts/eval/tibetan-mt-ab/` (JUDGE-PROMPT.md, build-judge-packet.mjs, score.mjs) unchanged:
  blind Opus + Sonnet on subscription, page image + served OCR + 84000 reference sides (extract-84000-refs.py;
  CC BY-NC-ND, judge input only, never committed). Candidates: **pilot** vs **current** (the English stored
  now; "[no English is stored]" on 6 pages). 3 pages per book, so 30 pages; 4 same-arm pairs; 1 positive control.

**Controls.**
- Same-arm pairs: 4/4 ties for both judges.
- Positive control (84000's own English as a candidate): **failed twice, then passed. Both failures were the
  reference's fault, and the judges were right.** Attempt 1 used a 3-side window on a page whose two leaves
  are not consecutive: both judges scored it 2/5, with invention + omission. Attempt 2 used a cut that still
  bridged the gap between the leaves: Opus 3/5, naming the gap passage (it read the leaf break off the image);
  Sonnet 5/5, so Sonnet missed the gap. Attempt 3 used an exact-span cut: **Opus 5/5, Sonnet 5/5.** This is the
  same three-attempt history as #4742.
- Judge agreement: fidelity within one point 98%, exact 67%; same first place 93%.

**Result** (`results/tibetan-bl-evidence-2026-10-07/C-pilot/judge-results.json`; mean fidelity, wins = ranked
strictly above the other candidate).

| pages | judge | pilot mean (≥ 4) | current mean (≥ 4) | pilot better / worse / tie |
|---|---|---|---|---|
| 23 with stored English | Opus | 4.17 (20/23) | 4.22 (21/23) | 7 / 8 / 8 |
| 23 with stored English | Sonnet | 4.00 (18/23) | 4.13 (22/23) | 7 / 7 / 9 |
| all 29 (6 with no English) | Opus | 4.07 | 3.55 | 13 / 8 / 8 |
| all 29 | Sonnet | 3.86 | 3.48 | 13 / 7 / 9 |

- **Pilot-only defects, confirmed in the judges' reasons:**
  - wrong speaker: the Four Great Kings' vow is given to the Buddha (Toh 114, p.113);
  - a protective wish is reversed: "may someone create obstacles" (Toh 8, p.206);
  - an invented closing clause (Toh 114, p.116);
  - an invented note about "scribal additions" (Toh 9, p.253);
  - a wrong buddha name, "Ratnaketu" for gser dang rin po che'i 'byung gnas (Golden Light, p.587; shared with
    current).

  The current English has 0 inversions.
- **By eye (5 pilot pages, read from image + source + 84000):**
  - Good Eon p.383: pass. Line ends match both leaves, and the names and numbers match 84000. The prophecy is
    rendered in the past tense.
  - Ten Bhūmis p.271: pass. The non-consecutive lower leaf is marked with a leaf break.
  - Golden Light p.579: pass. This page is Woodblock-served with no current English. The pilot reads through
    the OCR's misreadings to "I was that prince".
  - 25,000-line PP p.251: pass. It reproduces a scribal repetition that really is in the source.
  - 100,000-line PP p.149: pass, and equivalent to the current English (same span). The current English is
    longer only because of a `<meta>` carry-over, notes and a summary.

**Consequences.**
1. **Re-translating the 168,815 pages that already carry flash-v13 English buys nothing measurable.** n = 23 is
   small, but the direction is flat-to-worse and the pilot added the only inversions. Do not spend ~$350 on it.
2. **The value is in the 26,440 readable pages with no English**: 12,179 Kangyur, 5,262 Nyingma, 7,475 other,
   1,524 terma. Translating them costs about $40–55 at $0.0015–0.0021/page, with pilot-quality English (fidelity
   ≥ 4 on most pages). That is the translation decision.
3. 79,498 pages (29%; 58% of "other") are marked unreadable. No translation helps them; they need a better read.
