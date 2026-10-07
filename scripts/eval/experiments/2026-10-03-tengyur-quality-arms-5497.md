## 2026-10-03 · Tengyur quality levers on the 84000-referenced pages: a Sanskrit parallel, a glossary, a negation check with a Pro second pass, Flash thinking, and an Opus ceiling (#5497)
<!-- PRIOR ART: 2026-10-03-tengyur-84000-reference-ab-5497.md (PR #5704) picked arm B, one page per request with no context, and built the instrument reused here unchanged: the 113-side sample, the 84000 folio cuts, the judge rubric and the control shapes. scripts/eval/tibetan-mt-ab/ judges several candidates per item, which is the shape the packets take here. Neither tested a lever on top of B. -->

**Question.** The full Derge Tengyur draft (≈ $220, approved) will run arm B. Before it does: does any single quality lever improve B against 84000's human English, on the same pages and with the same instrument? And does any lever beat the difference between two runs of B itself?

**Design.** Same 113 judged sides, same 84000 cuts, same rubric, all from tengyur-ref. Outputs went to files only.
- **Base B:** `gemini-3-flash-preview`, prompt v13, one page per request, thinking off. B's English is the tengyur-ref output. Each arm adds ONE lever to B. All new arms ran in realtime through `gemini-script-client` (metered, `endpoint eval/tengyur-arms-5497`).
- **X1 noise floor, B2:** B's request again.
- **C, Sanskrit parallel** (`build-parallel.py`): the GRETIL Sanskrit is prompt input only, never stored or shown.
  - Aligned only for Toh 4377 (Bhadracarī, the last 62 verses of GRETIL's Gaṇḍavyūha): 36 syllables per verse, ± 1 verse. **6 of 113 sides had a parallel.**
  - Toh 3808 is lost in Sanskrit. A Mahāvyutpatti-term retrieval over GRETIL's Pañcaviṃśati found no peak, so no parallel was given. A wrong passage is worse than none.
  - The Toh 1183 and 1189 Sanskrit is not on GRETIL or on our shelf.
- **D, glossary** (`build-glossary.py`):
  - The only source is the Mahāvyutpatti (DILA edition, Wylie → Unicode with pyewts). Entries are matched as whole syllables in the page's e-text, two or more syllables long. Two-syllable entries found on more than 15% of pages are dropped as generic. Median 18 terms per page.
  - Not used: 84000's glossaries (the reference's vocabulary, and NC-ND), Rangjung Yeshe (©), and our `note_claims` pairs (their matches were settled against a mostly-84000 table).
- **E, negation and role check** (`negcheck.py`, $0):
  - It compares Tibetan negation syllables (མ མི མེད མིན, with lexicalised compounds excluded) against English negations in sliding windows over the page. It also flags the Lord made a speaker more often than the Tibetan has him speak.
  - Thresholds were set on tengyur-ref's A/B reversal labels (in-sample).
  - Flagged pages get ONE `gemini-3.1-pro-preview` pass that returns find/replace edits for reversed or role-swapped statements only. Requested `thinkingBudget` 1024; billed thinking was a median of 2,972 tokens per call. The model overran its budget.
- **X2, thinking:** B with `thinkingConfig {thinkingBudget: 2048}`. It billed an average of 163 thinking tokens per page.
- **X3, ceiling:** Opus (8 subscription subagents) translated 40 of the 113 sides from the same prompt text. It is not a production candidate.
- **Combination:** reserved for the levers that individually beat X1. None did, so none was run.
- **Judges.** Two blind Opus judges.
  - The rubric is tengyur-ref's `JUDGE-PROMPT.md` verbatim, except that an item carries two to four candidates. B is in every item, so each lever is graded beside the base in the same read.
  - F1 = {B, B2, D, X2} on all 113 sides. F2 = {B, E where changed, C, X3} on 48 sides.
  - Each family carries 15 controls: wrong page, planted reversal, duplicate.
  - A rate-limit stop cut parts 5–8 of F1 mid-way. Their unjudged items were re-cut into four "rest" files with the same items and judges, so every item was graded once per judge.
- **Spend: $2.79** of the $14 envelope (`tengyur-arms-5497`). The envelope has since been closed.

**Result.** Controls: **59/60**. One judge missed one planted reversal in F2. The judges agreed within one grade on every page of every arm.

| arm (pages) | fidelity median / mean | ≥ 4 (95% CI) | reversal pages, either / both judges | omissions | span off | net preference vs B (wins − losses) / judgements | $/page, batch-equivalent |
|---|---|---|---|---|---|---|---|
| **B** base (113) | 4.5 / 4.55 | 98.2% (94–99.5) | 5 / 2 | 3.5% | 0.9% | — | 0.0017 |
| **B2** = B again, X1 (113) | 5 / 4.62 | 99.1% (95–99.8) | 6 / 1 | 2.2% | 1.8% | **+0.093** (59–38, tie 129) | 0.0018 |
| **D** glossary (112) | 4.5 / 4.53 | 98.2% (94–99.5) | **10 / 7** | 4.0% | 0.4% | 0.000 (46–46) | 0.0019 |
| **X2** thinking 2048 (113) | 4.5 / 4.54 | 98.2% (94–99.5) | 9 / 3 | **8.4%** | 3.5% | −0.058 (44–57) | 0.0020 |
| **C** Sanskrit (6, Toh 4377) | 4.5 / 4.50 (B 4.58) | 100% | 0 / 0 | 16.7% (B 0) | 25% (B 8%) | 0.000 (2–2, tie 8) | 0.0018 |
| **E** Pro pass (29 flagged, 7 changed) | changed pages: E above B 3, below 1, tie 3 | — | removes 1, adds 1 | — | — | +0.018 over 113 | 0.0017 + 0.0255 per flagged page (≈ 0.0083 averaged) |
| **X3** Opus ceiling (40) | **5 / 4.84** (B 4.34) | 97.5% (B 95%) | 1 / 1 (B 2 / 2) | **0%** (B 7.5%) | 0% | **+0.512** (48–7, tie 25; 25 pages higher vs 2, p < 0.0001) | — |

- **X1.** B2 against B is a net +0.093 preference with a fidelity difference of +0.066 (sign test p = 0.24). That is the noise floor. No Gemini lever exceeds it on preference or fidelity.
- **D adds reversals.**
  - Both-judge reversal pages: 7 for D, against 2 for B and 1 for B2.
  - By eye: v93 p557 swaps condition and consequent (ཆོས་རྣམས་ཡོད་ན་མཉམ་པ་ཉིད་…ཡོད་དོ → "if equality exists, then phenomena must also exist"). v93 p134 has "do not lack a location" for ཡུལ་ན་མི་གནས.
  - D's glosses are fewer (18 judgements against B's 35).
- **X2 does not cut reversals.** Thinking pages had 9/3 reversal pages against 5/2, and omissions more than doubled. The reference set holds no Madhyamaka or Pramāṇa verse (Toh 3808 is commentary prose), so that narrower question is untested.
- **E.**
  - The detector is at chance out of sample. Against the F1 judges' labels:
    - on B, recall 2/5 at a 26% flag rate;
    - over all four F1 arms (451 page-arms), recall 11/30, precision 0.09 against a 0.07 base rate;
    - both-judge reversals only, recall 3/13.
  - The Pro pass, read by eye on all 7 pages it changed: 5 right, 1 wrong, 1 undecided. The right ones include the v93 p198 vocative "O Blessed One", which all four Gemini arms got wrong. The wrong one is v93 p449, where ས་བརྒྱད་པ་ལ་ཕྱིར་#ལྡོག་པར turned "non-retrogression" into "retrogression". The literal block wins over 84000's reading and the doctrine, at a collation mark (`#`). Both judges flagged E there.
  - Net reversal change: zero.
- **Shared reversals.** The same shapes recur across the Gemini arms, levers included:
  - the vocative Lord made the speaker: v93 p198 and p320, in all four F1 arms;
  - a reason clause negated: v93 p573, in B, D and X2;
  - "not merely conceptualisation" read as "more than": v93 p570, in B2, D and X2.

  These belong to the model, not the prompt.
- **X3.** Opus with the same prompt gives the only headroom measured: +0.5 fidelity on the same 40 pages, no omissions, and the p198 vocative read correctly. That headroom comes from the model, not from a prompt lever.

**Consequences.**
1. **Run the full Tengyur with arm B as it is:** `gemini-3-flash-preview`, prompt v13, one page per request, no context, thinking off, Batch API. That is ≈ $0.0017 per page, so **≈ $220 for 128,369 pages**.
   - No lever is adopted, so there is nothing for the next job to build.
   - Had E been adopted, it would have been a per-book option in `translate-batch-chained` for the held Tengyur books (`negcheck` after the page lands, a Pro patch pass on flags). At full scale that adds ≈ 26% × 128K × $0.0255 ≈ $850 for zero net reversals. It is not recommended.
2. **Do not ship the glossary lever** (D). Its reversals rose from 2 to 7 both-judge pages. **Do not turn thinking on** (X2): omissions doubled and reversals did not fall.
3. **The Sanskrit lever cannot be judged:** only 6 of 113 sides could be aligned to open Sanskrit. It needs an aligned e-text (Bhadracarī-like verse texts) before it can matter at Tengyur scale.
4. **The headroom is in the model.** If the reversal rate (≈ 2–5 per 100 pages) must come down, the next test is a stronger translator on these 113 pages, priced, not another prompt lever. A Pro-tier Gemini full translation is the candidate. Until then the English stays an unreviewed machine draft.

**Replicated?** Partly.
- Two judges, 59/60 controls, B re-graded inside every item.
- Every lever is a null or a loss against the noise floor at n = 112–113.
- E's per-edit reading is n = 7. C is n = 6.
- X3's lead is large (25 pages higher vs 2) but on 40 pages.
- The detector thresholds are in-sample to tengyur-ref's labels, and its out-of-sample figures are the F1 labels above.

**Artifact.** `scripts/eval/results/tengyur-arms-2026-10/`:
- `arms/*.jsonl`: every arm's raw English; E with its draft, flags, edits and thinking tokens; X3 from Opus.
- `arms/ledger.jsonl` and `cost.json`.
- `judge/F1|F2/`: key, plants, verdicts J1/J2, scores.
- `judge/detector-pr.json`, `gloss-stats.json`, `sanskrit-coverage.json`, `by-eye.md`.

Scripts are in `scripts/eval/tengyur-arms/`. The glossary entries, the GRETIL text and the judge packets (which carry 84000's English) stay on Hetzner in `/root/tarms/`. There were no writes to `pages` or `books`, and the Tengyur books stayed held and hidden.
