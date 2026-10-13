---
stage: ocr
measure: agreement
languages: [la, lzh, en]
scripts: [Latn, Hani]
canons: []
n_books: 90
n_pages: 90
verdict: "Provisional (AI-consensus key): PaddleOCR beats flash-lite on Chinese manuscripts by 24.5 pts CER; on Latin print no engine can be told apart from flash-lite; on English print nothing beats it."
status: undecided
decision: null
superseded_by: null
issue: [6388, 6203, 6386]
---
## 2026-10-10 · Three OCR routing questions on a random sample of our own books, provisional AI-consensus key (#6388)

PRIOR ART: #6388 (the preregistration, binding), #6203 (the method), #6386 (why the Pareto page could not grade most
panels). `2026-10-09-latin-cli-pilot-6375.md` (the production lite call and the CLI arm, copied),
`2026-10-02-paddle-zh-serving-config-5600.md` and `2026-10-01-chinese-ocr-cohort-5547.md` (PaddleOCR's cost per
page). No new scorer kernel: `lib/metrics.mjs` normalisers, `lib/paired-stats.mjs` bootstrap. The leave-one-out
consensus key is new (`ocr-prereg-6388/score.mjs`).

**Question.** On a random sample of the books we serve, does any engine beat production on mean capped CER, beyond
the A-vs-A band? Q1 Latin print 1500–1800, Q2 Chinese manuscript, Q3 English print 1500–1900.

**Label.** Every number here is **provisional (AI-consensus key)**. The key is made by other AI readers, not by a
person. Under eval-design §2 that is `agreement`, not `accuracy`. The numbers become accuracy once a person resolves
the adjudication spans with the image open.

### Design (as preregistered, plus Amendment 1)
- **Draw.** Rule committed before the draw (`fd04cd13d`). The draw was committed before any engine ran (`50b0a5ad4`).
  Served books (`visible`, `pages_count > 0`, `pages_ocr > 0`), strata by catalogue language, `book_class` (#5768)
  and year. 30 works per stratum, seed 6386, exact Fisher–Yates, one interior page per work (skip 15% front and 5%
  back). Front matter, plates and blanks were excluded by a `page_type` pattern. All 90 images fetched, with no
  spares used. Frames: Latin 6,841 works, Chinese manuscript 12,086, English 1,814.
- **Amendment 1** (posted on #6388 before any engine ran). The stored OCR is mostly not flash-lite. Latin:
  gemini-3-flash-preview 20/30. English: 20/30. Chinese: PaddleOCR-VL-1.6 27/30. So:
  - `L1` is the primary baseline: `gemini-3.1-flash-lite` on the live prompt (Standard OCR v19.1) with the
    realtime-ocr.mjs config.
  - `P`, the stored text as served, is secondary.
  - `L2` is a second identical flash-lite run. The AA band comes from L1 − L2.
  - The Chinese key has no open reader. Production there *is* Paddle, so Q2 is stored Paddle (`P`) against `L1`.
- **Readers.** All three ran with no API spend:
  - `G`: `gemini-3.8-flash-low` via `agy -p` (`run-cli-arm.py`, plan mode, nudge).
  - `S`: Claude Sonnet via `claude -p` (subscription, Read tool only).
  - `O`: Kraken + CATMuS on CPU, Latin and English only.
  - `IA`: Archive OCR from `_djvu.xml`, scored but never in a key. The leaf was located within ±3 leaves by agreement
    with G, which favours IA. 37 of 60 Latin and English pages had a leaf.
  - GLM-OCR and PaddleOCR were dropped as readers: both ran only on rented GPUs, so neither runs at $0 on this box.
    No Tesseract.
- **Key.**
  - For engine X, the key is the non-production readers other than X: Latin and English {G, S, O} \ {X}; Chinese
    {G, S} \ {X}. X and both production arms are scored on that same key, so every gap is paired.
  - Readers are aligned per character. Each column accepts its plurality reading, and a tie accepts every tied
    reading.
  - CER = edit distance to the key ÷ the key readers' mean length, capped at 1. A refusal, empty or failed read
    scores 1.0.
  - Latin and English are folded by `normalizeForScript(…, 'latin')`: ſ→s, u/v, i/j, case, spaces removed. That is
    OCR-D Level 1 plus case. Chinese uses `normalizeCJK`.
- **Rule.**
  - Gap d = CER(baseline) − CER(engine), with a work-level bootstrap 95% CI (10,000 draws, seed 6386).
  - margin = max(AA band, 1.0 pt).
  - **Switch** if the CI is wholly above the margin. **No change** if it is wholly below. **Cannot be told apart** if
    it straddles the margin.

### Results — gap against L1 (primary), pts of CER, provisional

| stratum | engine | key | n | CER engine | CER L1 | gap [95% CI] | margin (AA band) | verdict |
|---|---|---|---:|---:|---:|---|---:|---|
| Latin | G (Gemini CLI) | {S, O} | 30 | 4.2 | 4.0 | −0.2 [−4.4, +4.0] | 1.0 (0.4) | cannot be told apart |
| Latin | S (Sonnet) | {G, O} | 30 | 2.0 | 4.7 | +2.7 [+0.8, +5.7] | 1.0 (0.1) | cannot be told apart |
| Latin | O (Kraken) | {G, S} | 30 | 9.1 | 5.1 | −3.9 [−7.2, −1.2] | 1.0 (0.5) | no change |
| Latin | IA | {G, S, O} | 15 | 34.0 | 7.2 | −26.8 [−40.8, −16.1] | 1.0 (0.4) | no change |
| Chinese MS | **P (stored PaddleOCR 27/30)** | {G, S} | 30 | 9.3 | 33.8 | **+24.5 [+12.4, +37.9]** | 4.5 (4.5) | **switch** |
| Chinese MS | G | {S} | 30 | 20.3 | 39.8 | +19.5 [+9.4, +30.6] | 3.3 | switch-level, but worse than P (−0.8 [−3.6, +1.7] vs P) |
| Chinese MS | S | {G} | 30 | 19.8 | 37.9 | +18.0 [+7.6, +29.5] | 3.2 | switch-level, but worse than P (−5.4 [−9.9, −1.4]) |
| English | G | {S, O} | 30 | 19.4 | 5.2 | −14.2 [−28.9, +0.2] | 9.9 | no change |
| English | S | {G, O} | 30 | 13.7 | 5.3 | −8.4 [−22.3, +5.1] | 9.9 | no change |
| English | O (Kraken) | {G, S} | 29 | 7.3 | 5.4 | −1.9 [−11.8, +8.2] | 10.2 | no change |
| English | IA | {G, S, O} | 22 | 14.5 | 2.6 | −11.9 [−22.4, −4.2] | 9.8 | no change |

Against the stored text `P` (secondary):
- **Latin.** Sonnet +1.1 [−0.0, +2.3] and Gemini −1.3 [−5.1, +1.5]: both cannot be told apart. Kraken and IA: no
  change.
- **English.** Sonnet, Kraken and IA: cannot be told apart. Gemini: no change.

Full tables: `ocr-prereg-6388/results.md`. Per page: `results.json`.

### Answers (provisional, AI-consensus key)
- **Q1 Latin print: cannot be told apart.** Sonnet is the only engine better than flash-lite with a CI that excludes 0
  (+2.7), but its CI reaches below the 1.0-pt margin. Kraken and Archive OCR are worse than flash-lite.
- **Q2 Chinese manuscript: switch.** PaddleOCR beats flash-lite by 24.5 pts. Its cost passes the rule: about €0.0007
  a page (3.35 s on an L4 at €0.79/h, #5547), against flash-lite's measured $0.0015–0.0023. In practice this
  confirms the served state (Paddle on 27 of 30 pages): **do not route Chinese manuscripts back to flash-lite**.
  Flash-lite's deficit is concentrated in repetition loops: 8 of 30 pages score ≥ 0.6, and one read runs 14,869
  characters against about 300 from the other readers.
- **Q3 English print: no change.** No engine's CI reaches the margin. The margin is wide (9.9) because one L1 read
  was a RECITATION refusal that L2 read. A single refusal moves the AA band by about 3 pts at n = 30.

### What the key cannot see, and what the readers did
- **Leniency.** With two key readers, every disagreement is a tie and both readings are accepted, so this key
  flatters all engines. That works for paired gaps, but the absolute CERs are lower bounds.
- **Shared errors.** All three readers can agree on a wrong reading. The 10-page hand-key control measures that
  floor. It is not keyed yet.
- **Refusals and failures.** These count 1.0, so they drive the English results:
  - Sonnet refused 4 of 30 English pages (`Output blocked by content filtering policy`).
  - Gemini CLI: 2 safety refusals and 1 tool-permission failure that the nudge did not recover.
  - Flash-lite L1: 1 RECITATION refusal.
  - Stored P: 1 empty page.
  - Latin and Chinese had none.
- **Chinese reading order.** Sonnet often reads manuscript columns out of order (e.g. p74), and Gemini sometimes
  drops a passage that Sonnet and Paddle both have (p30). Those spans are in the adjudication list.
- **Catalogue strata.** `book_class` and the year come from the catalogue. No leaf was classified by eye before the
  run.

### Adjudication lists (`ocr-prereg-6388/adjudication-<stratum>.jsonl.gz`)
Each span has every reader's reading, production's reading where it aligns, 30 characters of context either side,
and the image URL. Spans that differ only in word spacing are dropped.

| stratum | pages | pages with spans | spans | median per page |
|---|---:|---:|---:|---:|
| Latin print | 30 | 30 | 1,071 | 18 |
| Chinese manuscript | 30 | 30 | 311 | 9 |
| English print | 30 | 27 | 425 | 9 |

Most Latin and English spans involve Kraken (CATMuS) alone. A person resolving them should start with spans where G
and S disagree.

### Hand-key control set (seed 6396, `ocr-prereg-6388/control-set.json`)
Latin 5: `6a26bbc2…-p25`, `69b62fe3…-p27`, `69b65ede…-p10`, `6a42c716…-p19`, `697a3056…-p111`. Chinese 4:
`6a3c7895…-p80`, `6a3cbc99…-p184`, `6a3c694c…-p94`, `6a3ced46…-p37`. English 1: `69c877ac…-p-35` (negative
page numbers in that book).

### Cost
- **API:** $0.408 at list price, for two flash-lite runs of 90 pages each. Metered in `gemini_usage` under endpoint
  `scripts/eval/ocr-prereg-6388/reads.mjs`.
- **Subscription:** 90 `agy -p` calls plus nudges, and 90 `claude -p` calls.
- **Local:** Kraken on CPU, about 80 s a page.

### Not done here
- No routing constant was changed.
- No `DECISIONS.md` row: the verdicts are provisional until the spans are resolved.
- The human adjudication and the 10-page hand key are the next stage. They are a separate decision about human
  time (#6388).

Artifacts: `scripts/eval/ocr-prereg-6388/` (README, draw, sample, reads/*.jsonl.gz, results, adjudication).
