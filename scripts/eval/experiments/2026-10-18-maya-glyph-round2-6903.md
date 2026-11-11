---
stage: ocr
measure: [accuracy, judged_vs_reference]
languages: [emy]
scripts: [Maya]
canons: []
n_books: 1
n_pages: 8
verdict: "Neither lever teaches a model to read Maya glyphs. Zero-shot picture search finds the right sign in an 8-drawing shortlist for at most 28% of sign values (40% needed), so the picture arms were dropped. Retrieved published readings of parallel captions lift Opus from 5 to 12–18 of 70 exact, but every gain is on blocks whose reading was in its context: 0 and 1 of 38 unseen. Opus as checker accepts 52 of Gemini 4 Argon's 70 readings at 50% precision (90% needed)."
status: rejected
decision: "No AI glyph readings on codex pages, not even 'Opus-checked' (#6903). The #6921 glyph rungs stay learner exercises over the published readings, not machine candidates."
superseded_by: null
issue: [6903, 6921]
---
PRIOR ART: round 1 is `2026-10-18-maya-glyph-reading-6903.md` (same held-out set, controls, scoring and judges; its numbers are not rerun here). No visual sign-index or retrieval eval for any script exists in `scripts/eval/` (searched `INDEX.md`, `EXPERIMENTS.md`, `git grep -i 'recall@\|sign index\|maya'`).

## 2026-10-18 · Do reference drawings and retrieved published readings let a model read Maya glyphs, alone or as a Gemini + Opus team? (#6903, round 2)

**No.**
- **Picture search fails at its own gate.** The right sign is in an 8-drawing shortlist for at most 28% of sign values.
- **Retrieval teaches copying, not reading.** Opus reads more blocks, but only blocks whose published reading sits in its context.
- **The team is not a safe filter.** Opus accepts three in four of Gemini's readings and half of those are wrong, often citing a retrieved parallel as its evidence.

**Design.** Round 1's harness, held-out set and scoring, unchanged:
- **Held-out set:** 17 captions, 70 blocks, on Dresden pp. 6, 9, 13, 15, 21, 29, 38 and 47.
- **Controls:** 8 illegible blocks in 3 eroded captions.
- **Scoring:** deterministic, plus two blind judges (Opus 5.5, Gemini 4 Argon) who saw every arm's blocks mixed and unlabelled.
- **Answer key:** Vail & Hernández, *Maya Codices Database*. It is private. Derek approved using it as an in-context retrieval memory for this comparison on 2026-10-18. None of its readings are in this repo.
- **Access:** Claude only through `claude -p` and Gemini only through `agy` (`gemini-4-argon-high`, helper jobs on main). No API calls.

- **Gate 0 (positive control): a visual sign index.**
  - **Drawings:**
    - Bonn TWKM Digital Sign Catalog: 1,582 drawings by Prager, CC BY 4.0; 1,089 signs.
    - David Stuart's *Maya Hieroglyph Syllabary* v2 (2013): 147 drawings, used with his permission (2026-10-18).
    - Kettunen & Helmke, Wayeb workshop handbook 2025: 297 drawings, open access.
    - The last two come from `bookstore.maya_signs`, PR #6935.
  - **Embeddings:** zero-shot DINOv2-base and CLIP ViT-B/16, in a CPU venv.
  - **Queries:** each block is cut on an even grid inside the caption crop. Sign-sized pieces come from connected components on an ink mask, 3.5 per block including the whole block. Pieces and drawings are both reduced to black-on-white ink before embedding.
  - **Measure:** recall@8, meaning the key sign is among the 8 nearest labels for any piece of its block. TWKM is scored by Thompson number; every index is also scored by value, against 182 key sign values. Chance is 8 random labels per piece.
- **Retrieval (O-K, G-K, Team).** For each caption, 8 captions from **non-held-out pages** with their published readings, as text.
  - First, frames of the same almanac that continue on another page, up to 4.
  - Then captions in the same register on the nearest pages.
  - The selection uses only page layout (almanac, register, page), never the held-out caption's reading. Nothing from the 8 held-out pages enters the pool (553 captions).
  - A purely visual selection was the first design. It was replaced once Gate 0 failed; drawing shortlists only break ties.
- **Arms**, all on the same 70 blocks and 8 controls, one call per caption:
  - **O-K:** Opus + round 1's 605-row text catalogue + retrieved readings. Run twice (OK, OK2).
  - **O-KV:** O-K + drawing shortlists. **Not run**, because Gate 0 failed.
  - **G-K:** Argon on the O-K prompt. Run twice (GK, GK2).
  - **G-bare:** Argon with no catalogue, no examples and no retrieval: round 1's arm (a) wording.
  - **Team:** Argon's G-K output goes to Opus with the O-K context. For each block Opus answers accept / correct / decline, and the prompt says a wrong accept is the worst outcome. No drawings, because Gate 0 failed. Run twice (TEAM, TEAM2).
- **SEEN / UNSEEN.** A block is SEEN when its published transliteration appears verbatim in that caption's retrieved context (round 1's rule, which there applied to the few-shot examples). The *strict* rule is that verbatim match.
  - A *token* rule also counts a block as seen when every reading token of the key appears in one retrieved block, which catches near-copies (`nah?/na?-kimil-la` → `nah?/na?-kimil`).
  - Retrieval puts 32 of the 70 readings verbatim into context (37 by tokens).

**Gate 0.**

| index | labels | recall@8, by value (of 182), DINOv2 \| CLIP | chance |
|---|---|---|---|
| TWKM | 1,089 | 31 \| 17 | 21 |
| Stuart v2 | 85 | 48 \| 41 | 30 |
| Wayeb 2025 | 179 | 42 \| **51 (28%)** | 33 |
| all three | 1,353 | 49 \| 40 | 13 |

- **By Thompson number,** TWKM finds 17 of 179 key signs (9.5%; CLIP 13).
- **A dense search over 35 windows per block** (280 drawings per block) finds 49, against **47 by chance**. Segmentation is not the bottleneck: Classic-period drawings do not retrieve the Postclassic codex forms zero-shot.
- **Verdict:** under 40% everywhere, so the picture arms were dropped.

**Result.** n = 70 blocks; "O | G" = Opus judge | Gemini judge. Judge agreement, Krippendorff α (ordinal): 0.99 [0.98, 1.00] on transliteration (402 pairs), 0.99 on gloss, 0.85 [0.65, 1.00] on captions (112).

| arm | attempted | signs all / ≥1 | translit exact | judged match O \| G | gloss match O \| G | caption ≥partial (of 17) O \| G | exact SEEN (of 32) | exact UNSEEN strict (of 38) / token (of 33) | wrong O \| G | wrong at conf ≥0.5 | controls read (of 8) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| O-K | 44 | 11 / 23 | 12 (CI 10–28) | 14 \| 13 | 21 \| 21 | 13 \| 13 | 12 | **0** / 0 | 19 \| 19 | 2 | 0 |
| O-K repeat | 46 | 18 / 31 | 18 (CI 17–37) | 20 \| 20 | 27 \| 27 | 14 \| 13 | 17 | **1** / 1 | 13 \| 13 | 3 | 0 |
| G-bare | 66 | 4 / 26 | 6 (CI 4–17) | 6 \| 6 | 9 \| 9 | 14 \| 15 | – (no context) | 6 of 70 | 36 \| 35 | 35 \| 34 | 0 |
| **G-K** | 70 | 24 / 37 | **26** (CI 27–49) | 27 \| 27 | 32 \| 33 | 16 \| 16 | 22 | 4 / **1** | 26 \| 26 | **26 (all)** | **1, conf 0.85** |
| G-K repeat | 70 | 24 / 42 | 24 (CI 24–46) | 28 \| 27 | 37 \| 38 | 16 \| 16 | 21 | 3 / 1 | 23 \| 25 | 23 \| 25 (all) | **1, conf 0.85** |
| **Team** (Opus checks G-K) | 53 | 22 / 33 | 24 (CI 24–46) | 26 \| 24 | 30 \| 29 | 15 \| 15 | 20 | 4 / 1 | 17 \| 17 | 14 \| 14 | 0 |
| Team repeat | 53 | 23 / 34 | 24 (CI 24–46) | 24 \| 24 | 31 \| 31 | 14 \| 14 | 21 | 3 / 1 | 16 \| 16 | 16 \| 16 | 0 |

No arm got a whole caption judged a full match.

**Team precision and coverage** (accepted blocks; precision = judged match / accepted):

| run | accepted (coverage of 70) | corrected | declined | precision, all accepted O \| G | accepted SEEN: precision O \| G | accepted UNSEEN: precision O \| G |
|---|---|---|---|---|---|---|
| Team | 52 (74%) | 1 (judged partial) | 17 | **26 \| 24 of 52 = 50%** (CI 37–63) | 20 \| 20 of 29 (69%) | 6 \| 4 of 23 (26%) |
| Team repeat | 51 (73%) | 2 (both judged partial) | 17 | 24 \| 24 of 51 = 47% | 21 \| 21 of 28 (75%) | 3 \| 3 of 23 (13%) |

**Findings**
- **Retrieval gives Opus a reading of only what it was shown.**
  - O-K is exact on 12 and 18 blocks, against round 1's best of 5. All of the gain is on SEEN blocks (12 and 17 of 32).
  - On the 38 blocks whose reading was not in its context it is exact on **0 and 1**, against the success bar of ≥5. The judges allow 1–2.
  - It read no control. Its wrong readings are mostly low-confidence borrowings of a parallel's formula.
- **Most of Gemini's score is its context, not memory.**
  - G-bare is exact on 6 of 70, but 35 of its 36 judged-wrong readings sit at confidence ≥0.5. Recall of the published readings explains little of round 1's 22.
  - With retrieval, G-K reaches 26 exact: 22 of 32 SEEN, and on UNSEEN 4 strict, of which 3 are near-copies of a parallel. That leaves **1** read from the image without a copy, and it is the Venus date, which arithmetic fixes (below).
  - The repeat lands at 24 exact, 21 SEEN and 1 UNSEEN by the token rule.
  - Every wrong G-K answer in both runs is stated at confidence ≥0.5.
- **The team does not filter.**
  - Opus accepts 74% of Gemini's readings at 47–50% precision. The two runs agree to within two blocks, so this is stable.
  - On UNSEEN blocks precision is 13–26%. The wrong accepts are mostly a formula from a retrieved parallel put in the wrong slot (`yu-tzi-li`, `u-mo-lo`, `CHAAK-ki`). Opus's stated reasons cite exactly those parallels ("matches the closing yu-tzi-li formula of Parallels 1 and 3"). Retrieval makes a wrong reading look *better* supported to the checker.
  - None of Opus's 3 corrections (over both runs) was right: all were judged partial. Its 17 declines per run included the one control Gemini had read.
- **Calendar check.** The held-out set has no day-sign blocks. Its calendar blocks are two Venus-table Haab dates (p.47 A1 of both columns).
  - The neighbouring frames' dates in context (19 Sek on p.46, 6 K'ayab on p.48) fix them by the 236/90/250/8-day intervals: 8 Sotz' and 18 Pax.
  - Across all 7 runs there are 14 readings of these two blocks.
    - The arithmetic catches **1 wrong one:** G-bare's 18 Kumk'u.
    - It confirms 7 right ones, 3 of which the deterministic scorer misses on notation ("8" for *waxak*, a dropped *-xa* complement).
  - It would supply the month that all four Opus O-K readings left unread.
  - Both Team runs declined a correct 18 Pax.
  - The numerals inside name blocks (*lahun* Kisin, *ox* wi'il) have no arithmetic check.
- **Invention.** Both G-K runs read one illegible control at confidence 0.85, the same block on p.15 (upper register):
  - run 1 reads it as `CHAAK`;
  - run 2 reads it as `u-pe`, the next block's reading in the p.14 parallel, borrowed into the wrong slot.
  - Opus declined it in both team runs ("no Chaak head can be seen"). No other arm read a control.

**Replicated?** Every arm except G-bare was run twice. The ranking and both verdicts hold in each pair: O-K 12 vs 18 exact (unseen 0 vs 1); G-K 26 vs 24 exact (8 blocks flip; 34 of 70 worded identically); Team precision 50% vs 47%.

**What this means for #6921.** The glyph rungs of the learning loop cannot use "AI candidate readings, Opus-checked": at 47–50% precision, half of what a learner would be shown as checked would be wrong. The published readings themselves are the usable material. Retrieval shows that a reader with the parallels in hand gets the formulaic blocks right, which is the learner's exercise, not the model's. Numerals and calendar dates are the one place where a machine check (arithmetic) adds something.

**Artifact.** On l7a, in `/data/scratch/sl/jobs/maya-glyph-team-6903/`:
- harness `bin/` (`gate0.py`, `gate0_multi.py`, `retrieval.py`, `prompts2.mjs`, `run-claude2.mjs`, `score2.py`, `table2.py`, `alpha.py`);
- raw outputs `runs/`, judge packets and verdicts;
- the private retrieval memory `set/retrieval.json`.

The `ops_reports` scratch documents that carried private payloads to main were deleted after the run. Nothing was written to book pages.
