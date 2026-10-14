---
stage: ocr
measure: agreement
languages: [la, lzh, en]
scripts: [Latn, Hani]
canons: []
n_books: 90
n_pages: 90
verdict: "Model-adjudicated key (no human), re-scored 2026-10-14 under normalizeForScript v4. Chinese manuscripts: Paddle over flash-lite (switch, unchanged). English: no change (unchanged). Latin: Sonnet vs flash-lite cannot be told apart on the adjudicated spans (v3 digit handling), but reads switch (+2.2 [+1.1, +3.4]) under v4, where 71 digit-bearing Latin spans have no adjudication yet."
status: informational
decision: null
superseded_by: null
issue: [6388]
---
## 2026-10-10 · #6388 Q1–Q3 again, on a model-adjudicated key (Amendment 2)

PRIOR ART: `2026-10-10-ocr-prereg-routing-6388.md` (the provisional stage, same draw and reads; this file only
replaces its AI-consensus key). The design was posted as Amendment 2 on #6388 before any adjudication call. Code:
`ocr-prereg-6388/adjudicate.mjs`. The alignment, normaliser and outcome code come from `panel-key.mjs` (#6434),
through `network.mjs`. Numbers in the sections after "Re-score" are the 2026-10-10 ones (normaliser v2).

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

### Re-score under the current normaliser (2026-10-14)
The replies below were collected on 2026-10-10 on spans built under `normalizeForScript` v2. Main has since moved:
v3 (#6584) fixed the centred-line deletion, v4 (#6632) keeps ASCII digits in Latin text. `adjudicate.mjs score` now
runs on `panel-key.mjs` (the same alignment, normaliser and outcome code as the panel) and was re-run on the
committed `adjudication/raw/*.jsonl.gz`. **No model was called**; local compute only.
- **How replies attach.** A current span takes the adjudicated item with the same candidate readings (spacing
  ignored) on the same page, nearest in position. A span with no adjudicated twin has no verdict, so every
  candidate is accepted for it (on every key alike). Counts are in `results.json` `span_remap`.
- **v3 digit handling (`--v3-digits`, reproduction).** 334 of 336 Latin spans and all 311 Chinese and 111 English
  spans find their twin. **0 of 84 verdicts change** against the 2026-10-10 results. Latin flash-lite L1 is 3.5
  (was 5.5): the old 5.5 was the centring bug, and the old `uncentered` rows are now simply the main rows.
- **v4 (current, the default).** Digits are part of the text, so new disputed spans appear that were never put to
  the adjudicators: Latin 373 spans now, 302 with a twin, **71 without**; English 147 now, 81 with a twin, **66
  without**; Chinese unchanged (311/311). Those 137 spans are accepted-all, which lowers every arm's CER on them
  alike but is not an adjudicated key. Numbers that moved (old → new, pts of CER):
  - Latin S vs L1 (family): +3.5 [+0.7, +8.4] → **+2.2 [+1.1, +3.4]**, margin 1.0; verdict "cannot be told apart"
    → **"switch"**. L1 CER 5.5 → 3.5, S 2.0 → 1.3. Neutral key: +4.9 [+1.5, +10.1] → +3.0 [+1.5, +5.2] (switch both times).
  - Latin G vs L1: +0.9 [−4.1, +6.9] → +1.1 [−0.5, +2.5], still cannot be told apart. O vs L1 −4.2 → −5.5, IA vs L1
    −26.7 → −30.9 (no change both times).
  - English: G vs L1 −10.9 [−25.5, +2.7] → −5.4 [−18.6, +6.8]; S vs L1 −5.8 → −5.5; O vs L1 −2.0 → +0.7; IA vs L1
    −12.2 → −10.1. Margin 10.2 and every verdict unchanged.
  - Chinese: no number changes (digits are not kept for CJK).
  - AA bands unchanged: Latin 0.6, Chinese 3.7, English 10.2. Planted gate 46/46 and 46/46, self-agreement 90% and
    79%, adjudication tables and consensus check (0.059% → 0.059%) unchanged; they do not depend on Latin digits.
- **How to read it.** The 2026-10-10 tables below are kept as written, with the normaliser they used (v2). Only
  Latin Q1 moves, and it moves at the margin (lower CI bound +1.1 against a 1.0 margin) on a key that is partly
  unadjudicated. Treat Latin Q1 as unsettled until the 71 + 66 digit-bearing spans are adjudicated, which needs
  new Opus / Gemini Pro calls and was not done here.

### Results (2026-10-10, normaliser v2): gap against L1, pts of CER, model-adjudicated key (no human)
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
- **Q1 Latin print: cannot be told apart (2026-10-10, v2); re-scored 2026-10-14 under v4 it reads "switch" at the
  margin (+2.2 [+1.1, +3.4]) with 71 digit-bearing spans unadjudicated. See "Re-score". No routing change is made
  on this file.** The 2026-10-10 answer was the same as the provisional one. Sonnet is ahead of
  flash-lite by +3.5 [+0.7, +8.4], but the CI reaches below the 1.0-pt margin. Only the `neutral` key, which the
  measured Opus-to-Sonnet lean flatters, reads "switch". Under the family rule it does not. **No change to routing.**
- **Q2 Chinese manuscript: switch** (Paddle over flash-lite), +23.9 [+11.7, +37.1]. This agrees with the provisional
  answer and with Derek's decision of 2026-10-10. It holds on every key.
- **Q3 English print: no change.** No engine's CI reaches the margin of 10.2. That margin is wide because of the one
  L1 RECITATION refusal.

### Normaliser bug found on the way (affects #6388's provisional numbers too)
`lib/metrics.mjs` `cleanMarkup` stripped tags with `/<[^>]*>/`. A page with two `->centered<-` lines lost all text
from the `<-` that closes the first to the `->` that opens the next. Reads affected: L1 4/90, L2 5/90, stored P 3/90,
Sonnet 1/90; G, O and IA none. It inflated flash-lite's Latin CER by about 2 pts. The scores above follow the
preregistered (v2) normaliser, and the `uncentered` rows show the fix. **The fix has since landed on main
(#6584, v3), so the current `chars` already carry it and the `uncentered` rows equal the main rows.**

### Cost
$0 cash. Subscription calls:
- Opus: 10 control, 70 main, 8 repeat and 12 transcription calls.
- Gemini Pro: 10, 70, 8 and 11.
- Fable: 56 pages of tiebreaks.

Nothing was written to `pages` or `books`.

Artifacts: `ocr-prereg-6388/adjudication/` (`pages.json`, `raw/*.jsonl.gz`, `results.json`, `results.md`).
