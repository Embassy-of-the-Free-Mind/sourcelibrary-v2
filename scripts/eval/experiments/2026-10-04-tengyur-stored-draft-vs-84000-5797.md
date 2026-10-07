## 2026-10-04 · Tengyur stored draft vs 84000: is the English the library holds as good as the test arm? (#5797)
<!-- PRIOR ART: 2026-10-03-tengyur-84000-reference-ab-5497.md (PR #5704: same 864 aligned sides, same judge prompt and controls, but it scored two TEST arms written to files, not the English stored in pages.translation.data). This re-runs that harness on the stored English, against arm B, over the 113-side sample plus 250 more. -->

**Question.** The draft label's error rate, "about 2–5 reversed statements per 100 pages", comes from arm B of a test run (PR #5704). Does the English actually stored on the pages, which the reader would serve, score the same?

**What is stored.**
- All 854 stored sides in the 864-side 84000 reference set were written by the full run: `gemini-3-flash-preview`, prompt v13, Batch, `scripts/lib/translate-batch-chained.mjs`, `context.mode: none` (one page per request).
  - Job ids: v93 `tbc_mut0mokm_dabfqs`, v4 `tbc_mut5v6f4_9pkcf8`, v3 `tbc_mut5u7c6_jkwmf8`, and one each for v28, v47 and v113 (`stored/stored-provenance.jsonl`).
- **This is arm B's setup, but a fresh sample.** No stored page equals arm B's text byte for byte (0/854), so arm B's verdicts could not be reused. The brief's 20-page self-agreement control was only needed for that case and was not run.
- 10 sides have no stored English: 9 in v207, which is being drafted now (out of scope), and v93 p315, blocked by the health guard as `collapsed`. A reader sees no English on that page.

**Design.**
- PR #5704's harness unchanged: `JUDGE-PROMPT.md`, the same packet shape and the same control shapes (`tengyur-ref/build-packet-stored.py`, `score-stored.py`).
- Candidates: **stored English (S) vs arm B**, blind and in random order.
- Sample: the 104 sides of #5704's 113 that have stored English, plus 250 more drawn by seed 5797, for 354 sides in all.
  - The 250: Toh 3808 +130, Toh 1183 +60, Toh 1189 +60.
  - The brief asked for one page per text, weighted to Madhyamaka and Pramāṇa. That cannot be done here: the 864 reference sides cover only 8 texts, none of them Madhyamaka or Pramāṇa (84000 has published no Tengyur text in those sections). The 250 were therefore spread across the three large texts. Two of them are tantra commentaries, the section the issue says has barely been read.
- Two blind Opus judges, 24 subagent instances (2 × 12 parts of ~31 items), on the subscription. **$0 Gemini.**
- 15 controls mixed in: 5 wrong-page, 4 planted reversal, 6 duplicate (one plant found no sentence to flip and became a duplicate).

**Result.**
- Controls passed **30/30**: wrong page ≤ 2 on 10/10, planted reversal caught on 8/8 (flagged on 7/8, ranked below on 8/8), duplicates tied with the same grade on 12/12.
- Judges agreed within one grade on 354/354 sides for each candidate (exact: S 274, B 266).

| 354 sides | **S, stored** | B, test arm |
|---|---|---|
| **reversed statement, pages, either judge** | **22 = 6.2 per 100 (95% CI 4.1–9.2)** | 22 = 6.2 (4.1–9.2) |
| reversed statement, pages, both judges | 12 = 3.4 per 100 (1.9–5.8) | 11 = 3.1 (1.7–5.5) |
| fidelity, two-judge mean: 5 / 4.5 / 4 / 3.5 / 3 | 126 / 77 / 148 / 3 / 0 | 116 / 83 / 147 / 5 / 3 |
| fidelity mean · sides ≥ 4 | 4.46 · 99.2% (97.5–99.7) | 4.43 · 97.7% (95.6–98.9) |
| wrong page (fidelity ≤ 2) | 0 | 0 |
| span wrong, both judges / either | 2 / 7 | 2 / 5 |
| omission, both judges (sides) | 3 | 9 |
| invention judgements: gloss · added fact · boundary | 76 · 17 · 6 | 81 · 10 · 7 |

- **Preference** (708 judgements): tie 461, S 132, B 115. Mean fidelity S − B = +0.03 (sign test p = 0.20). **Stored and test arm are not separable.** 10 of the 22 reversal pages are reversed in both.
- **Same 104 sides as #5704:**
  - Reversals, either judge: arm B then 5, arm B now 5 (4 of them the same pages), S now 5. That is 4.8 per 100 (CI 2.1–10.8) in all three readings.
  - Arm B's fidelity then and now agrees within 0.5 on 92/104 sides.
- **The 250 new sides:** S 17 reversals (6.8 per 100, 4.3–10.6); B 17.
- **By text, S reversed pages (either judge):** Toh 3808 12/180, Toh 1183 5/85, Toh 1189 5/85, small texts 0/4. The tantra commentaries are not worse than the Prajñāpāramitā commentary.
- **Reversal shapes** among the 22 stored pages (quotes checked against the Tibetan):
  - **Speaker or agent swapped (9).** These include a vocative in a sūtra quotation made into the speaker ("Therefore, Venerable Subhuti said: It is not so" for Śāriputra answering Subhūti) and a motive given to the wrong party.
  - **Negation or antonym on the page (6):** ཕྱག་གཉིས་པའི་ཤེས་རབ་བདག་མེད་མ་ཡིན་ཏེ → "is not Nairātmyā"; ཆོག་པ་མེད་པར → "without being insatiable"; ཞིག ("ceased") → "stabilized".
  - **Page-final sentence whose negation is on the next side (3).** For example, ཐོབ་པར་[མི་ནུས] → "attains". A one-page request cannot see it. For a reader going page by page this reads as a reversal.
  - **A denied or refuted statement given as asserted (3)** and **a case pair swapped (1)** ("seventh case for the first" for "first for the seventh").
  - 2 of the 22 are debatable (Q178, Q313).

**Consequences.**
1. **The stored draft is as good as the test said, and the label's number should be stated as 3–6 per 100 pages.**
   - On the 104 sides #5704 judged, stored = test = 4.8 per 100.
   - Over 354 sides, the stored rate is **6.2 per 100 (4.1–9.2) by either judge** and **3.4 (1.9–5.8) by both**.
   - "2–5" sits inside the both-judges interval but under the either-judge point estimate. "About 3–6 reversed statements per 100 pages" covers both readings.
2. Whatever drives the rate, it is not the difference between test and storage: arm B re-judged today scores the same 6.2. It is the larger sample (the new 250 sides run 6.8) and judge-to-judge spread on borderline cases.
3. Three of the 22 are page-final sentences completed on the next side. The fix belongs in the reader: show the next side's first line. Retranslating will not remove them.

**Replicated?** Partly. There were two judges, 30/30 on controls, and 354 sides. #5704's arm B was re-judged on 104 sides and gave the same rate. The sample is still 3 texts plus 4 sides of small texts, all from the sections 84000 has translated. No Madhyamaka, Pramāṇa, grammar or medicine side has an 84000 reference.

**Artifact.**
- `scripts/eval/results/tengyur-ref-2026-10/stored/`: key, plants, sample, verdicts J1/J2, `scores.json` and `stored-provenance.jsonl`.
- Step C (repairs, residue lists, tantra pages read by eye) is in `scripts/eval/results/tengyur-check-2026-10/`.
- 84000's English is CC BY-NC-ND. It was judge input only; the verdicts quote at most short spans.
