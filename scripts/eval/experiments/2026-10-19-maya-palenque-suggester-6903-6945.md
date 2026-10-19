---
stage: ocr
measure: [accuracy, judged_vs_reference]
languages: [emy]
scripts: [Maya]
canons: []
n_books: 1
n_pages: 0
verdict: "PALENQUE: Gemini 4 Argon with retrieved parallels reads 45 of 100 held-out Cross Group blocks exactly (judged 56–60), against 10 from the bare image, and the Opus check of its readings is right on 74–80% of what it accepts (90% needed). Opus reads 9–10 with the image and 13 with the image withheld, so its readings come from the context, not the image. SUGGESTER: no-go. Fused recall@6 of the true sign is 32% on Palenque (80% needed) and 38% on the Dresden codex (50% needed). Even a perfect choice of channel per sign would reach only 51% and 58%. Picture search against the sign drawings is at chance on both."
status: rejected
decision: "No suggester UI yet (#6945): the picture channel is the limit. No AI glyph readings shown to readers (#6903): the best team is 74–80% precise on Palenque and 47–50% on the codex. Next for #6945: a numeral counter and a picture channel trained on confirmed blocks, re-measured with this replay."
superseded_by: null
issue: [6903, 6945]
---
PRIOR ART: rounds 1 and 2 (`2026-10-18-maya-glyph-reading-6903.md`, `2026-10-18-maya-glyph-round2-6903.md`) give the arms, scoring and judges reused here, and round 2's Gate 0 gives the picture index. No sign-suggester replay exists in `scripts/eval/` (searched `INDEX.md`, `EXPERIMENTS.md`, `git grep -i 'recall@\|suggest'`).

## 2026-10-19 · Palenque held-out eval (#6903 stage 2) and an offline replay of the candidate-sign suggester (#6945)

Harness: `scripts/eval/maya-suggest-6945/` (README there). Access was subscription only: Opus 5.5 through `claude -p` on l7a, and Gemini 4 Argon (`gemini-4-argon-high`) through `agy` in helper jobs on main and cloudlayer. No API calls, $0. Nothing was written to book pages.

### A. Palenque held-out eval (#6903 stage 2)

**Set.** From Mongo `maya_glyph_blocks` (David Stuart, *The Palenque Mythology*, 2006; open access per Stuart):
- **Held out:** 100 blocks drawn from the 417 clean entries (no `?`, brackets, range, partial or incomplete flag), stratified by monument (`palenque_set.py`, seed 6903). Tablet of the Cross 35, Foliated Cross 24, Sun 22, the 8 smaller panels 19.
- **Controls:** 10 blocks. Eight are the single blocks Stuart prints as `?`. Then TC jamb Bp5 (`9-?-?`, broken) and TC alfardas E1 (`[11-WINIK-ki]`, entirely reconstructed).
  - Six of the eight `?` blocks are the **undeciphered name glyph of the god GI**, and Stuart's translation line says "GI". So these controls test whether a model invents a *phonetic* reading for a sign nobody can read. They do not test reading blank stone.
- **Calls:** one per group of ≤5 test blocks from one monument, in reading order: 27 groups. Crop files are renamed to opaque hashes.

**Arms**, round 2's wording ported to Palenque (`prompts.mjs`):
- **O-K** (round 2's best Opus arm): crops + monument name + coordinates + round 1's 605-row catalogue + retrieved parallels. Run twice.
  - The parallels are Stuart's readings of ~20 other blocks per group, chosen by position only: the non-test blocks around each test block in reading order, and the same coordinate on the two sister tablets.
  - **SEEN:** the test block's reading appears verbatim in its own context: 7 of 100 (13 by round 2's token rule).
- **G-K:** Gemini on the O-K prompt.
- **Team** (round 2's team arm): Opus checks G-K's output block by block (accept / correct / decline), with the O-K context. Run twice.
- **Recall control, MANDATORY:** a **bare** arm with crops only. No monument, no coordinates, no neighbours, no catalogue, and blocks shuffled across monuments in groups of 5. It is also asked to name the source monument. Run for Opus (O-bare) and Gemini (G-bare).
- **Added: a no-image arm.** The O-K prompt with every crop withheld, for Opus (O-noimg) and Gemini (G-noimg). The bare arm cannot tell whether the *monument name and coordinates* unlock a memorised text; this arm can.

**Scoring.** As in rounds 1 and 2: deterministic exact (every legible reference sign present; number words and glottal stops folded), plus **two blind judges**. Opus 5.5 and Gemini 4 Argon saw every arm's attempted blocks mixed, shuffled and unlabelled, against Stuart's transliteration, transcription and translation.
- Judge agreement, Krippendorff α (ordinal): **0.95** on transliteration (294 of 307 pairs identical) and **0.96** on gloss.
- Columns quote "O | G" = Opus judge | Gemini judge.

| arm | attempted (of 100) | exact (Wilson CI) | judged match O \| G | gloss match O \| G | exact UNSEEN strict (of 93) / judged | wrong O \| G | wrong at conf ≥0.5 | controls read (of 10) |
|---|---|---|---|---|---|---|---|---|
| O-K | 47 | 9 (5–16) | 15 \| 15 | 16 \| 15 | 8 / 14 | 5 \| 5 | 1 | 1 ("MUWAAN-MAT", 0.25) |
| O-K repeat | 53 | 10 (6–17) | 15 \| 15 | 16 \| 17 | 8 / 13 | 14 \| 13 | 0 | 3 ("GI" ×3, ≤0.3) |
| **O-noimg** (crops withheld) | 55 | **13** (8–21) | 17 \| GNI_OJ | 23 \| GNI_OG | 13 / 16 | 15 \| GNI_OW | 0 | 5 (1 at ≥0.5) |
| O-bare (recall control) | 13 | 0 (0–4) | 0 \| 0 | 0 \| 0 | 0 / 0 | 7 \| 6 | 0 | 0 |
| **G-K** | 94 | **45** (36–55) | **60 \| 56** | 64 \| 63 | 39 / 54 \| 50 | 9 \| 11 | 9 \| 11 (all) | 4 (all ≥0.8) |
| G-noimg (crops withheld) | GNI | GNI | GNI | GNI | GNI | GNI | GNI | GNI |
| G-bare (recall control) | 74 | 10 (6–17) | 15 \| GB_G | 15 \| GB_GG | 10 / 15 | 31 \| GB_GW | 28 | 1 ("K'INICH", 0.85) |
| **Team** (Opus checks G-K) | 51 | 22 (15–31) | 33 \| 33 | 35 \| 36 | 18 / 29 | 1 \| 1 | 1 | 2 (both "GI") |
| Team repeat | 49 | 29 (21–39) | 37 \| 36 | 39 \| 40 | 25 / 33 | 2 \| 2 | 1 | 3 |

**Team precision** (judged match ÷ accepted):

| run | accepted / corrected / declined | precision on accepted, O \| G | on accepted UNSEEN | wrong among what it stood behind |
|---|---|---|---|---|
| Team | 43 / 8 / 49 | **32 \| 32 of 43 = 74%** (Wilson 60–85) | 28 of 39 | 1 of 51 (the rest of the misses are partial) |
| Team repeat | 44 / 5 / 51 | **35 \| 34 of 44 = 80%** (65–89) | 31 of 40 | 2 of 49 |

**Recall control: neither model recognises these famous tablets from a crop.**
- **O-bare** read 0 blocks. It named no monument for any of the 110 crops.
- **G-bare** read 10 exact, and 9 of the 10 are dates or periods (`4-AJAW`, `9-IK'`, `1-WINIKHA'B'`, `9-HA'B'-ya`). It named a source for 16 crops, but only 5 named Palenque and 2 the right tablet. It also named the wrong monument for 6 at confidence 0.95 ("Piedras Negras Stela 3" ×5).
- G-bare and G-K share 9 exact readings. So G-K's other 36 exact readings need the context (monument, coordinates, parallels), not just the image.
- **The no-image arm** is what separates memory from reading:
  - **Opus:** with the crops withheld it reads more (13 exact, judged 17) than with them (9–10, judged 15). Only 4 blocks are exact in both O-K and O-noimg. Opus's Palenque readings come from the context and its knowledge of the Cross Group, not from the drawing. The pre-stated round-2 bar ("≥5 UNSEEN blocks exact, 0 controls") is passed on paper (8 and 8) and fails in substance.
  - **Gemini:** GNI_SENTENCE

**Findings**
- **Gemini reads Classic Palenque far better than the Postclassic codex:**
  - G-K is exact on 45 of 100 here, judged 56–60, against 26 of 70 on Dresden in round 2.
  - It is exact on 39 of the 93 blocks whose reading was not in its context. 24 of its 45 exact blocks carry a numeral (dates, periods, distance numbers).
  - Every judged-wrong answer is stated at confidence 0.9–0.95, and 32 of its 92 readings at confidence ≥0.9 are not judged a match (Opus judge).
- **The team filters better here than on the codex, but not well enough.**
  - Opus accepts 43–44 of G-K's 94 readings, at **74–80%** precision (codex: 47–50%), against the 90% bar.
  - What it stands behind is almost never wholly wrong (1–2 of ~50). The misses are near-misses: a dropped `i-` prefix (`K'AL-SAK-HUUN` for `I-K'AL-SAK-HU'N`), `CH'EEN-na` for `CHAN-na-CH'E'N-na`, a month written `K'AYAB` for Stuart's `K'AN-a-si-ya` (judged a match by both judges).
- **Invention on controls.**
  - Gemini read 4 of the 10 controls at confidence ≥0.8. Two are "GI" for Stuart's "GI" name glyph, which is a correct identification. One is a bare "?".
  - One is the phonetic reading `AKAN-YAX?-ja` (0.95) for a GI name Stuart leaves unread. That is the codex finding again: a confident reading of a sign nobody reads.
  - The team accepted 2–3 controls, all "GI".
- **Replicated?** O-K 9 vs 10 exact (15 vs 15 judged). Team 74% vs 80% precision. Ranking and verdict hold.

### B. Suggester replay (#6945, step 1)

**Question:** if the machine only narrows the choices, is the true sign among the first k candidates often enough to build a UI on?
- **Blocks:** Dresden, round 2's 70 held-out blocks (182 legible signs, 32 blocks SEEN in round 2's retrieval). Palenque, the 100 held-out blocks above (344 signs, 7 SEEN).
- **Sign:** a sign is its value (`u`, `ya`, `AJAW`, `8`), normalised as in the scorer.
- **No weight is fitted on these blocks** (`suggester.py`, `picture.py`).
- **Sequential confirmation assumed:** when a channel uses context, it uses the previous block's and the previous sign's true reading, as if the human had already confirmed them.

**Channels**
- **picture:** sign-sized pieces vs the `maya_signs` drawings (Stuart syllabary v2 + Wayeb 2025; a TWKM variant is shown too). This is fused with the whole block vs **reference block crops**:
  - Palenque: the 547 non-test Palenque crops, the same drawing style, i.e. what "confirmed crops accrue" would give.
  - Codex: all 649 Palenque crops, **the cross-style test**.
  - DINOv2 + CLIP, zero-shot, rank-fused. Palenque line drawings are one connected component, so a fixed grid of windows was added (halves, quadrants, 3×3), as in round 2's dense search.
  - Index coverage: 73% of Palenque signs and 80% of codex signs have any drawing in `maya_signs`. 57 Palenque signs (17%) are bar-and-dot numerals, which have no drawing.
- **parallels:**
  - Dresden: round 2's layout-retrieved captions, the same position weighted ×3.
  - Palenque: the retrieval context above, sister-tablet same coordinate ×3.
  - Both: what follows the previous block's reading elsewhere in the non-test reference pool.
- **spelling:** the pool frequency prior, re-ranked by the previous sign in the block. Rules: synharmonic CV-CV; a logogram's final consonant → CV complement; a CV syllable → a logogram with that onset.
- **calendar:** fires only after a confirmed day sign (→ Haab: the month coefficient is one of four, set by the day name) or a count/period block (→ a day sign: 1–13 + day names). Dresden: round 2's Venus arithmetic fixes its two Haab dates, and nothing else in that set is calendrical.
- **fused:** reciprocal-rank fusion (k₀ = 10, equal weights). A channel that abstains adds nothing.
- **Clicks:** per sign, ⌈rank/6⌉ page-throughs of a 6-candidate tray if rank ≤ 18, else 4 (open search, type, pick, confirm). The no-suggester baseline is 4 per sign. Sign boxes are taken as given; correcting them is not costed.

**Recall of the true sign, % of signs** (k = 1 / 3 / 6 / 8), and clicks per block:

| channel | Dresden codex (182 signs) | clicks/block (none: 10.4) | Palenque (344 signs) | clicks/block (none: 13.8) |
|---|---|---|---|---|
| prior only (frequency) | 0 / 8 / 16 / 24 | 7.9 | 8 / 14 / 23 / 26 | 10.4 |
| picture: sign drawings (`maya_signs`) | 2 / 6 / 10 / 17 | 8.6 | 0 / 1 / 5 / 10 | 12.4 |
| picture: + TWKM drawings | 3 / 7 / 12 / 21 | 8.6 | 1 / 2 / 6 / 8 | 12.4 |
| picture: reference block crops | 1 / 4 / 10 / 13 | 9.2 | **9 / 24 / 38 / 44** | 8.6 |
| picture (drawings + crops) | 4 / 7 / 13 / 16 | 8.5 | 6 / 15 / 26 / 32 | 9.6 |
| parallels | **17 / 37 / 45 / 52** | 5.9 | 9 / 17 / 25 / 29 | 10.3 |
| spelling | 2 / 9 / 20 / 27 | 7.8 | 8 / 13 / 17 / 28 | 10.5 |
| calendar (abstains on most signs) | 1 / 3 / 3 / 3 | 10.2 | 1 / 3 / 6 / 6 | 12.8 |
| **fused** | 7 / 24 / **38** / 44 (CI@6 31–45) | 6.3 | 8 / 19 / **32** / 38 (CI@6 28–37) | 9.0 |
| fused without picture | 12 / 27 / 40 / 49 | 6.1 | 6 / 15 / 28 / 34 | 9.6 |
| fused without parallels | 7 / 12 / 23 / 27 | 7.5 | 7 / 18 / 28 / 34 | 9.4 |
| fused without spelling | 12 / 26 / 40 / 47 | 6.2 | 8 / 19 / 31 / 37 | 9.2 |
| fused without calendar | 7 / 23 / 37 / 43 | 6.4 | 8 / 19 / 30 / 37 | 9.2 |
| *ceiling: any one channel has it in its top k* | 23 / 48 / **58** / 68 | – | 23 / 35 / **51** / 57 | – |

- **SEEN vs UNSEEN** (fused recall@6):
  - Dresden: 58% on SEEN blocks (78 signs), 23% on UNSEEN (104).
  - Palenque: 43% SEEN (23 signs), 31% UNSEEN (321).
- **Whole blocks:** all signs of a block in the fused top 6 for 6 of 70 Dresden blocks and 3 of 100 Palenque blocks.

**Go/no-go (#6945): NO-GO.** The bars were combined recall@6 ≥ 80% on Palenque and ≥ 50% on the codex.
- **Palenque: 32%** (CI 28–37). Even an oracle that took each sign from whichever channel ranks it highest reaches only 51%. No re-weighting of these channels can reach 80%.
- **Codex: 38%** (CI 31–45). The oracle ceiling is 58%, so a better fusion could in principle pass 50%. But the best single channel, parallels, is 45%, and the drawings add nothing.

**Which channel limits it: the picture channel.**
- **Against the sign drawings it is at chance on both corpora:** 5–6% at k = 6 on Palenque, 10–12% on the codex, below the frequency prior. Removing it from the fusion moves recall@6 by 2–4 points: up on the codex, down on Palenque (the crops).
  - It fails even on Palenque, where drawing and query share the Classic style. Zero-shot DINOv2/CLIP does not match a sign inside a block to its isolated drawing.
  - About a quarter of Palenque signs (numerals, many logograms) have no drawing at all.
- **The only visual signal is block-to-block:** Palenque test crops against other Palenque crops reach 38% at k = 6 alone, the best single channel there. The fusion's equal weights dilute it.
  - Across styles (codex blocks against Palenque crops) it is 10%. Confirmed codex crops would have to come from the codex itself.
- **Parallels carry the codex** (45% at k = 6), mostly on SEEN almanac formulae. That is round 2's finding again: the context supplies repeated formulae, not new readings.
- **Calendar works where it is right to fire, and it fires too rarely.**
  - After a confirmed day sign, the Haab coefficient is in its top 4 every time (8 of 8).
  - Its count → day-sign gate misfires on chains of distance numbers. Real arithmetic over parsed distance numbers was not built.
- **Spelling** is barely above the prior: CV-CV and complement rules re-rank only the second and later signs, and only by one neighbour.

**What would change the answer.** In order of expected gain:
1. A **bar-and-dot numeral counter**: 17% of Palenque signs, near-deterministic to read from the image.
2. A picture channel **fine-tuned on confirmed blocks**, not zero-shot. Block-to-block same-style retrieval is already the best Palenque channel.
3. **Distance-number arithmetic** for Palenque dates.
4. A **fusion fitted on non-test blocks**: the ceiling leaves room on the codex, not on Palenque.

Re-measure with `suggester.py` before building a UI.

**Artifact.** l7a `/data/scratch/sl/jobs/maya-suggest-6945/` held the crops, prompts, raw outputs, judge packets and verdicts; it was deleted after the run, as were the private `ops_reports` scratch documents (`eval-scratch:maya-suggest-6945:*`). The committed scripts rebuild it from Mongo and round 2's l7a scratch.
