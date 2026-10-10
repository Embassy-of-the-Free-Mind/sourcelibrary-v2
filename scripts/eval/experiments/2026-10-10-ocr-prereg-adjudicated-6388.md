---
stage: ocr
measure: agreement
languages: [la, lzh, en]
scripts: [Latn, Hani]
canons: []
n_books: 90
n_pages: 90
verdict: "Model-adjudicated key (no human): the #6388 answers stand. Chinese manuscripts: Paddle over flash-lite (switch). Latin: Sonnet cannot be told apart from flash-lite. English: no change."
status: informational
decision: null
superseded_by: null
issue: [6388]
---
## 2026-10-10 · #6388 Q1–Q3 again, on a model-adjudicated key (Amendment 2)

PRIOR ART: `2026-10-10-ocr-prereg-routing-6388.md` (the provisional stage, same draw and reads; this file only
replaces its AI-consensus key). The design was posted as Amendment 2 on #6388 before any adjudication call. Code:
`ocr-prereg-6388/adjudicate.mjs`. The alignment comes from `score.mjs`, moved unchanged into `network.mjs`.

**Label.** Every number here is on a **model-adjudicated key (no human)**. Models chose between the readers' readings
with the page image open. No person did. Under eval-design §2 this is still `agreement`, not `accuracy`.

### Why
Derek, 2026-10-10: "no one will do those 4 hours. needs to be opus or fable or gemini pro or whatever on cli."

### Design (Amendment 2)
- **Adjudicators.** All $0 on subscriptions:
  - `claude -p --model opus`, which ran as `claude-opus-5-5`.
  - `agy -p --model gemini-3.1-pro-high`, the newest Pro the CLI lists.
  - `claude -p --model fable` (`claude-fable-5-1`), used only as the tiebreaker.
- **Calls.** One call per page per adjudicator. Each call carried the page, plus overlapping tiles at native
  resolution for pages over 2,000 px; no line boxes are stored, so there are no span crops. Each span lists its
  candidates as A/B/C… in a seeded order (seed 6388). The candidates are the distinct readings of G, S and O. No
  engine names appear, and production's reading is not offered. The answer is a letter, "none: <text>", or
  "illegible".
- **Spans adjudicated.** Spans where only Kraken disagrees (G = S) were skipped and take the G = S reading. That
  leaves 756 spans: Latin 334, Chinese 311, English 111.
  - One English page (`6a4ad8fa…-p34`) had text from Kraken alone. Both adjudicators were asked to transcribe it whole.
  - Opus was blocked by its content filter there, twice. That page therefore has no Opus key, so G, L1 and L2 are
    scored on 29 English pages, not 30.
- **Family rule.** A reader is never scored against a key its own family adjudicated:
  - `S` (Sonnet) is scored on Gemini Pro's verdicts.
  - `G`, `L1` and `L2` are scored on Opus's verdicts, and so is stored `P` on pages whose stored model is a Gemini.
  - Kraken (`O`), Archive OCR (`IA`) and stored Paddle are scored on spans where Opus and Gemini Pro agree. Fable
    breaks the rest.
- **Scoring.** Unchanged from #6388. Mean CER capped at 1.0, and a refusal counts 1.0. Work-level paired bootstrap
  (10,000 draws, seed 6386). Margin = max(AA band, 1.0 pt), with the AA band from L1 vs L2 on the Opus key.
- **Checks.**
  - `neutral`: every arm on one key, where each span Opus and Gemini Pro disagree on accepts either reading. This
    removes the cross-key mismatch in a paired gap.
  - `uncentered`: see the normaliser bug below.

### Controls
| control | Opus | Gemini Pro |
|---|---|---|
| Planted spans caught (gate ≥ 90%) | **46 / 46** | **46 / 46** |
| Self-agreement on 8 repeated pages (63 spans) | 57 / 63 = **90%** | 50 / 63 = **79%** |

- **Planted spans.** There are 46, not the 50 in the amendment: two Chinese control pages had too few stretches
  where every reader agreed. Both adjudicators pass the gate.
  - Limitation: each corruption makes a non-word ("cremoren", "每脲二"), so a model can catch it from language alone,
    without looking at the image. The gate shows the adjudicators are attentive and parse correctly. It does not
    show that they read the image.
  - Opus called the Read tool in every call (`num_turns` ≥ 2 throughout). The Opus control run was repeated once,
    to record `num_turns`; both runs scored 46/46.
- **Self-agreement.** This is the key's noise. Gemini Pro changes its mind on about 1 span in 5, Opus on 1 in 10.
- **Consensus check** (model-keyed, not human). On the 10 control pages, Opus and Gemini Pro each transcribed the
  whole page. Of **8,481** characters where every original reader agreed, both transcribers agreed on something
  else at **5** (0.06%), in 2 runs:
  - a 3-letter tail on Latin `69b62fe3…-p27`;
  - `十三` read as `新序` by both, on Chinese `6a3ced46…-p37`.

  Latin contributes 5,066 of those characters, Chinese 449 and English 2,966. Gemini Pro transcribed only part of
  the English spread (`69c877ac…-p-35`), which shows up as 2,087 characters rejected by one transcriber only, never
  by both. On this evidence a consensus key is not being fooled by shared errors at any rate that matters next to the
  gaps below.

### Adjudication
| stratum | spans | Opus = Gemini Pro | needed Fable | written in (Opus / Gemini Pro) | illegible |
|---|---:|---:|---:|---:|---:|
| Latin | 334 | 264 | **70** | 12 / 23 | 0 |
| Chinese MS | 311 | 165 | **146** | 28 / 62 | 1 / 1 |
| English | 111 | 89 | **22** | 3 / 11 | 0 |

Fable answered all 238 tiebreaks.

**Family lean, measured.** These are the spans where Sonnet's and the Gemini CLI's readings differ:

| stratum | spans | Opus picks S / G | Gemini Pro picks S / G | Fable (tiebreaks only) S / G |
|---|---:|---|---|---|
| Latin | 334 | 211 / 103 | 182 / 125 | 22 / 31 |
| Chinese MS | 311 | 153 / 130 | 100 / 148 | 72 / 35 |
| English | 81 | 50 / 21 | 38 / 28 | 13 / 2 |

In every stratum, Opus sides with Sonnet more often than Gemini Pro does, and Gemini Pro sides with the Gemini CLI
more often than Opus does. That is the lean the family rule exists to block. It is also why the `neutral` key, which
accepts either adjudicator's reading, flatters Sonnet in Latin (below).

### Results: gap against L1, pts of CER, model-adjudicated key (no human)
| Q | stratum | engine (its key) | n | CER engine / L1 | gap [95% CI] | margin | verdict |
|---|---|---|---:|---|---|---:|---|
| Q1 | Latin | S, Sonnet (Gemini Pro) | 30 | 2.0 / 5.5 | +3.5 [+0.7, +8.4] | 1.0 | **cannot be told apart** |
| | | G, Gemini CLI (Opus) | 30 | 4.6 / 5.5 | +0.9 [−4.1, +6.9] | 1.0 | cannot be told apart |
| | | O, Kraken (agreed + Fable) | 30 | 9.8 / 5.5 | −4.2 [−7.6, −1.4] | 1.0 | no change |
| | | IA (agreed + Fable) | 15 | 34.7 / 8.1 | −26.7 [−40.2, −16.4] | 1.0 | no change |
| Q2 | Chinese MS | **P, stored Paddle 27/30** (agreed + Fable; Opus on the 3 Gemini pages) | 30 | 14.9 / 38.8 | **+23.9 [+11.7, +37.1]** | 3.7 | **switch** |
| | | G (Opus) | 30 | 11.0 / 38.8 | +27.8 [+16.4, +40.6] | 3.7 | switch-level |
| | | S (Gemini Pro) | 30 | 12.0 / 38.8 | +26.8 [+16.3, +38.2] | 3.7 | switch-level |
| Q3 | English | O, Kraken (agreed + Fable) | 29 | 7.6 / 5.6 | −2.0 [−12.0, +8.2] | 10.2 | **no change** |
| | | S (Gemini Pro) | 29 | 11.5 / 5.6 | −5.8 [−19.5, +7.5] | 10.2 | no change |
| | | G (Opus) | 29 | 16.6 / 5.6 | −10.9 [−25.5, +2.7] | 10.2 | no change |
| | | IA (agreed + Fable) | 21 | 14.3 / 2.1 | −12.2 [−22.9, −4.0] | 10.2 | no change |

AA bands (L1 − L2, Opus key): Latin 0.6, Chinese 3.7, English 10.2.

**Checks.**
- **Neutral key** (one key for both arms):
  - Latin Sonnet: +4.9 [+1.5, +10.1], which reads **switch**.
  - Latin Gemini CLI: cannot be told apart.
  - Chinese and English: same verdicts as the main table.
- **Uncentered** (normaliser bug fixed for the scored arms):
  - Latin flash-lite L1 drops from 5.5 to 3.4.
  - Latin Sonnet: +1.4 [+0.3, +2.5], still cannot be told apart.
  - On the neutral key with the fix, Latin Sonnet is +2.7 [+1.2, +5.0], still "switch".
  - No other verdict moves.
- **Against stored `P`** (secondary): every Latin and English candidate is "cannot be told apart" or "no change".
  - Chinese, G vs Paddle: +4.0 [+0.3, +7.6], cannot be told apart.
  - Chinese, S vs Paddle: +2.9 [−1.9, +9.1], cannot be told apart.
  - Both understate Paddle: its readings were never offered as candidates, because the Chinese key readers are G and S
    only (Amendment 1).

### Answers (model-adjudicated key, no human)
- **Q1 Latin print: cannot be told apart.** The answer is the same as the provisional one. Sonnet is ahead of
  flash-lite by +3.5 [+0.7, +8.4], but the CI reaches below the 1.0-pt margin. Only the `neutral` key, which the
  measured Opus-to-Sonnet lean flatters, reads "switch". Under the family rule it does not. **No change to routing.**
- **Q2 Chinese manuscript: switch** (Paddle over flash-lite), +23.9 [+11.7, +37.1]. This agrees with the provisional
  answer and with Derek's decision of 2026-10-10. It holds on every key.
- **Q3 English print: no change.** No engine's CI reaches the margin of 10.2. That margin is wide because of the one
  L1 RECITATION refusal.

### Normaliser bug found on the way (affects #6388's provisional numbers too)
`lib/metrics.mjs` `cleanMarkup` strips tags with `/<[^>]*>/`. A page with two `->centered<-` lines loses all text
from the `<-` that closes the first to the `->` that opens the next. Reads affected: L1 4/90, L2 5/90, stored P 3/90,
Sonnet 1/90; G, O and IA none. It inflates flash-lite's Latin CER by about 2 pts. Q1's verdict is the same either
way. The scores above follow the preregistered normaliser, and the `uncentered` rows show the fix. The fix to
`metrics.mjs` itself is left out of this PR: it changes `NORMALIZE_FOR_SCRIPT_VERSION` for every eval.

### Cost
$0 cash. Subscription calls:
- Opus: 10 control, 70 main, 8 repeat and 12 transcription calls.
- Gemini Pro: 10, 70, 8 and 11.
- Fable: 56 pages of tiebreaks.

Nothing was written to `pages` or `books`.

Artifacts: `ocr-prereg-6388/adjudication/` (`pages.json`, `raw/*.jsonl.gz`, `results.json`, `results.md`).
