---
stage: ocr
measure: [accuracy, judged_vs_reference]
languages: [emy]
scripts: [Maya]
canons: []
n_books: 1
n_pages: 8
verdict: "Neither model can put glyph readings on the Dresden Codex. Opus with a sign catalogue and 17 published example readings (arm c) leaves 54 of 70 held-out blocks unread and gets 5 exactly right. All 5 repeat readings that appear in its own examples; it reads 0 of the 55 blocks whose reading it was not shown. It invents nothing on 8 illegible controls. Gemini 4 Argon on the same prompt gets 22 of 70 exact and 27 judged correct (9 of 55 unseen blocks exact), but it is confidently wrong on 17 of its 60 attempts: every wrong answer comes at confidence ≥0.75."
status: rejected
decision: "No model glyph readings on codex pages (#6903). Glyph pages keep describe-or-decline (#5653)."
superseded_by: null
issue: [6903, 5653]
---
PRIOR ART: `dresden-opus-test` (#6559) tests numerals, calendar and deities against Förstemann 1906, a different question, and this run did not repeat it. No earlier glyph-reading eval exists in `scripts/eval/` (searched `INDEX.md`, `EXPERIMENTS.md`, `git grep -i maya`).

## 2026-10-18 · Can Opus read Maya glyph blocks from a sign catalogue and published examples? (#6903)

**No.** In the useful sense, nothing can read Maya glyph blocks here. Opus is honest but reads almost nothing it was not shown. Gemini 4 Argon reads about a third of the blocks, and states its wrong readings with the same confidence as its right ones.

**Design**
- **Images.** Dresden Codex, book `69dfd990220eedf04e13b0cf` (Förstemann's colour facsimile), full-resolution leaves, one crop per caption.
  - The leaf order is not the page order: leaves 1–24 = pp.1–24, 25–53 = pp.46–74, 54–74 = pp.25–45. Checked by eye.
- **Answer key.** Vail & Hernández, *The Maya Codices Database* (mayacodices.org): Thompson numbers, transliteration and English per block. It is copyrighted, so it was used as a private answer key only. None of its readings are in this repo.
- **Held-out set.** 17 captions, 70 blocks, on 8 pages: 6, 9, 13, 15, 21, 29, 38, 47.
  - Content: almanac captions (verbs, deity names, offerings), directional and colour Chaak captions (pp.29, 38), and two Venus-table columns (p.47).
  - One more caption (p.13 c) was dropped before any run because its block order on the facsimile was ambiguous.
- **Planted controls.** 3 eroded captions (pp.15, 17) holding **8 blocks** the reference marks illegible. The brief asked for 6; these three captions hold 8.
- **Few-shot.** 4 captions (17 blocks) from pages 7, 14, 16 and 48. None of these pages is in the held-out set.
- **Sign catalogue.** 605 signs. The backbone is the Bonn TWKM Digital Sign Catalog (open access for scholarly use; Thompson, Macri–Vail, Gates and Zimmermann concordances). Montgomery's day and month signs were added from FAMSI.
- **Arms.** One call per caption. Each call asks per block for signs (T-numbers), transliteration, gloss and confidence, or "unread". The prompt says that a confident wrong reading is worse than "unread".
  - (a) Opus 5.5 bare;
  - (b) Opus 5.5 + catalogue;
  - (c) Opus 5.5 + catalogue + few-shot, run twice (C, C2) for the noise floor;
  - (d) Opus 5.5 on (c) with "always give a best attempt" added (not in the brief: it separates recognition from abstention);
  - (G) Gemini 4 Argon (`gemini-4-argon-high`, `agy` on main) on (c)'s prompt.
  - Claude ran only through `claude -p` and Gemini only through `agy`; no API calls.
- **Scoring.**
  - Deterministic: T-number sets, and transliteration tokens normalised for orthography (b'→b, j→h, vowel length).
  - Two blind judges, Opus 5.5 and Gemini 4 Argon, saw all arms mixed and unlabelled and gave match / partial / wrong for each block's transliteration and gloss and each caption's English.
  - Judge agreement: Krippendorff α (ordinal) 0.98 [0.96, 0.99] on transliteration (174 blocks), 1.00 on block gloss, 0.97 [0.91, 1.00] on caption gloss (38 captions). All reliable. Both judges are quoted.

**Result.** n = 70 held-out blocks in 17 captions, plus 8 control blocks. "O | G" = Opus judge | Gemini judge.

| arm | attempted | signs: all right / ≥1 right | translit exact (det.) | translit judged match, O \| G | gloss judged match, O \| G | caption judged match / ≥partial (of 17) | wrong attempts, O \| G | of those at conf ≥0.5 | controls read (of 8) |
|---|---|---|---|---|---|---|---|---|---|
| a Opus bare | 8 | 0 / 2 | 1 | 1 \| 1 | 1 \| 1 | 0 / 1 | 5 \| 5 | 1 | 0 |
| b + catalogue | 10 | 0 / 3 | 1 | 2 \| 1 | 2 \| 2 | 0 / 0 | 6 \| 6 | 0 | 0 |
| c + catalogue + few-shot | 16 | 6 / 8 | 5 (7%, CI 3–16) | 6 \| 6 | 5 \| 5 | 0 / 2 | 8 \| 8 | 0 | 0 |
| c repeat (noise floor) | 10 | 2 / 5 | 2 | 2 \| 2 | 2 \| 2 | 0 / 1 | 5 \| 5 | 0 | 0 |
| d = c, forced attempt | 70 | 7 / 24 | 5 | 7 \| 7 | 9 \| 8 | 0 / 9 | 43 \| 44 | 0 | 2 (conf ≤0.15) |
| **G Gemini 4 Argon on c** | 60 | 19 / 44 | **22 (31%, CI 22–43)** | **27 \| 26** | **29 \| 29** | 2 \| 1 / 15 | 17 \| 16 | **17 \| 16 (all)** | 0 |

**Findings**
- **Gemini failed reads.** Two of Gemini's 20 captions (8 blocks) timed out three times at 20 minutes each. They count as failed reads (`outcome: truncated`). Its calls took 5–10 minutes per caption.
- **Opus reads only what it was shown.**
  - Split by whether a block's reading appears among the 17 example blocks: arm c is exact on 5 of 15 seen readings and **0 of 55** unseen ones.
  - Gemini is exact on 13 of 15 seen and **9 of 55** unseen (judged match 14 | 13 of 55).
  - Most of each model's score is formula-matching against the examples. Dresden captions are formulaic (u-chi-chi, ox-wi'il, ahaw-le…), so this is real visual matching, but it does not generalise.
- **Noise floor (C vs C2).** Opus attempts swing from 16 to 10 and exact readings from 5 to 2. Opus's arm-to-arm differences (a ≈ b < c) sit inside that floor, apart from c's in-example matches. Gemini's lead (22 vs 5 exact) is far outside it.
- **Calibration.**
  - Opus's attempts run at confidence 0.1–0.5, and under forcing (d) 56 of 70 are at 0.1. Its "unread" is honest; it simply cannot read.
  - Gemini states 0.75–1.0 on every block it attempts. Its wrong readings sit a little lower (median 0.85, against 0.95 for right ones), but no threshold makes it safe.
    - At confidence ≥0.95 (34 blocks, Opus judge): 23 match, 5 partial, 6 wrong.
    - At ≥0.98 (9 blocks): 7 match, 1 partial, 1 wrong.
    - The Gemini judge gives the same picture.
    - So about one block in six is wrong even in the most confident tier.
- **Invention.**
  - Neither model read an illegible control block in arms a–c or G.
  - Under forcing, Opus put a 0.08–0.15 guess on 2 of the 8.
  - The wrong readings that remain are substitutions, not inventions on blank leaf. A wrong block is most often a deity name from the examples or from general Dresden knowledge (Itzamna, Ixik, Kisin, Chaak): 12 of Opus d's 44 wrong attempts.
- **Possible recall (unmeasured).** Gemini wrote its answers in the reference's own notation ("??", "x/y" alternatives). That notation was also in the few-shot prompt. The published readings have been online for 20 years, so some of Gemini's correct readings may be recall rather than reading. A bare Gemini arm would measure this; it was not run.

**Replicated?** Opus arm c twice (above). The Gemini repeat (G2) was queued on main. If it lands, it is reported on #6903, not here.

**Artifact.** Everything is on l7a under `/data/scratch/sl/jobs/maya-glyph-6903/`: crops, private key, raw outputs, judge packets and verdicts. The scratch `ops_reports` documents used to move the private payload to main were deleted after the run. Nothing was written to book pages.
