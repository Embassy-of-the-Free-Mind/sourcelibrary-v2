---
stage: ocr
measure: accuracy
languages: []
scripts: []
canons: []
n_books: null
n_pages: 555
verdict: "3.7 Flash CLI beats lite on Greek, Chinese and Syriac manuscript and ties 3 Flash, as 3.8 does; 3.6 is worse than 3.8 on four charts and loops; the CLI adds a third failure, the plan note."
status: informational
decision: null
superseded_by: null
issue: 6293
---
## 2026-10-09 · OCR Pareto, Amendment 2: Gemini 3.7 and 3.6 Flash through the CLI on 555 pages (#6293) — 3.7 reads as well as 3.8 and ties 3 Flash; 3.6 is worse; no decision changes

Preregistration: `scripts/eval/PREREGISTRATION-ocr-pareto-6293.md`, **Amendment 2** (`c745f9649`, committed 2026-10-09
~02:40Z, before any score of these arms was computed). Reads: a plain script (`read-tiers.sh`, no scorer in the
loop), 2026-10-08 22:45Z → 2026-10-09 04:13Z. Scoring, chart and this file: Hetzner job `cli-queue-b-6293`. $0.

### What ran

- **Arms:** `gemini-3.7-flash-low` and `gemini-3.6-flash-low` through the Gemini CLI (`agy -p`, Google subscription),
  engine ids `gemini-3.7-flash+antigravity-cli` and `gemini-3.6-flash+antigravity-cli`. Same sealed JPEGs and same
  prompt per stratum as the 3.8 arm (production v19.1 on `latin-period-5126`, the generic prompt elsewhere).
- **Protocol, from the first call:** `--mode plan --print-timeout 120s --output-format json`; never auto-approve; at
  most 2 attempts per page; the second continues a tool-denied conversation once with the "no commands" nudge.
  2 image calls in parallel.
- **Pages: 555, not 908 (the deviation).** Every chart's most-pages set is whole except **Chinese manuscript: 150 of
  its 503 pages**, `random.Random(62931).sample(sorted(pages), 150)` (`results/ocr-pareto-6293/capped-set.json`).
  - 148 remain after #6304's drops.
  - On that chart the two arms are **not** on the 489-page panel. They sit on a **new panel of 143 pages**: the
    capped pages that the main panel shares, minus the 5 that 3.8 refused. Every engine on that panel is scored on
    those same 143 pages.
- **3.8 Flash's 41 pre-fix reads were re-read under the same plan-mode protocol** (Amendment 2), 04:13–04:22Z, and
  replace the old reads on the charts. These are the reads that had been made with tools allowed (#6345). Details
  below.
- **Not run:**
  - **3.5 Flash-Lite:** the CLI does not offer it (`agy models`, 2026-10-08 and 2026-10-09), and paid Gemini calls are
    ruled out (Derek, 2026-10-08).
  - **3 Flash (a fresh read):** not offered on the CLI either. Its stored API read stays on the charts.
  - Both now read **"not run"** with that reason on the charts. Before, the Syriac print charts listed them under
    "CLI arm pending". 3.5 Flash-Lite is also listed as not run on the eight #6293 charts.

### What came back

| arm | pages | text | safety filter (text before it kept) | blocked with no text (refusal, leaves the panel) | empty after 2 attempts | nudged |
|---|---|---|---|---|---|---|
| 3.7 Flash | 555 | 549 | 1 | 4: 3 Greek, which leave the panel; 1 Syriac manuscript, which the Syriac scorer reads as an empty page | 1 | 156 (28 %) |
| 3.6 Flash | 555 | 553 | 0 | 0 | 2 | 119 (21 %) |
| 3.8 Flash, the 41 re-read pages | 41 | 34 | 1 | 1 (Armenian) | 6 | 29 |

**A failure the 3.8 run did not name: the plan note.**
- In plan mode the CLI sometimes opens its reply with a note about a plan file before the text, for example "I have
  created the transcription plan artifact [transcription_plan.md](…). Please review it and let me know if you approve
  so I can output the transcription."
- Usually the transcription follows the note. In 1 reply it does not.
- Counts: **3.6 Flash 362 of 555 replies**, 3.8 Flash 28 of 908, 3.7 Flash 4 of 555.
- On 3.6 the note sits mostly on plain rows (336 plain, 26 nudged). A nudged row has been told "answer directly", and
  the note mostly goes away.
- **The chart scores the reply as returned, as preregistered.** The chart note now says a reply may open with this
  note and that the note is scored as part of the read.
- The sensitivity check below strips the note.

### Per chart (most-pages panel; Chinese manuscript: the 143-page subsample panel)

Median CER [page bootstrap 95 %], with the CLI arms' list-price x-axis value; ● = on the frontier.

| chart | n | **3.7 Flash CLI** | **3.6 Flash CLI** | 3.8 Flash CLI | lite | 3 Flash |
|---|---|---|---|---|---|---|
| Latin print | 143 | 0.072 [0.058, 0.085] $3.50 | 0.083 [0.071, 0.093] $3.59 | 0.083 [0.073, 0.089] $3.32 | 0.068 ● | 0.056 ● |
| Early English print | 44 | 0.043 [0.034, 0.076] $3.60 | 0.262 [0.199, 0.316] $3.85 | 0.177 [0.053, 0.393] $3.41 | 0.053 | 0.035 ● |
| Other Latin-script | 23 | 0.008 [0.005, 1.0] $3.33 | 0.003 [0.002, 0.004] $3.75 | 0.004 [0.002, 0.009] $3.47 | 0.006 ● | 0.002 ● |
| Greek | **117** | 0.071 [0.065, 0.085] $3.50 | 0.096 [0.082, 0.113] $4.14 | 0.075 [0.066, 0.086] $3.45 | 0.116 ● | 0.071 ● |
| Chinese manuscript, subsample | **143** | 0.195 [0.168, 0.231] $3.63 | 0.287 [0.233, 0.317] $7.10 | 0.211 [0.176, 0.244] $3.54 | 0.242 | 0.210 |
| Chinese print | 12 | 0.151 [0.097, 0.229] $3.55 | 0.169 [0.103, 0.269] $5.61 | 0.175 [0.106, 0.266] $3.63 | 0.162 | 0.147 ● |
| Armenian | 5 | 0.025 [0.009, 1.0] $3.10 | 0.029 [0.013, 1.0] $2.98 | — (see below) | 0.029 ● | 0.007 ● |
| Syriac manuscript | 40 | **0.702** [0.677, 0.737] ● $2.06 | 0.959 [0.801, 1.0] $2.19 | 0.718 [0.684, 0.779] ● $1.93 | 0.991 ● | 0.767 |

- **Panels that shrank:**
  - **Greek, 120 → 117 pages.** 3.7 Flash's 3 blocked reads are refusals. Under #5581 a page any plotted engine
    refused leaves the panel.
  - **Armenian: 3.8 Flash leaves the panel.** Its plan-mode re-read of one of the 5 pages was blocked with no text.
    Keeping 3.8 would leave 4 pages, under the 5-page floor, so the builder dropped 3.8 and kept the 5 pages. 3.8 is
    listed under the chart as run on too few of the same pages.
- **Frontier changes:** one. On **Syriac manuscript**, 3.7 Flash CLI joins the frontier beside 3.8 CLI: 0.702 at
  $2.06 against 0.718 at $1.93. Elsewhere 3.7 and 3.6 cost more than lite and 3 Flash at list price and read no
  better than 3 Flash, so neither is on the frontier.

**Paired, on the pages both answered** (W/L/T for the CLI arm; median Δ CER = arm − other, negative means the arm
reads better, [bootstrap 95 %], sign-test p; from `results/ocr-pareto-6293/cli-tiers.json`):

| arm | chart | n | vs lite | vs 3 Flash | vs 3.8 Flash CLI |
|---|---|---|---|---|---|
| 3.7 | Latin | 143 | 69/57/17, +0.000 [−0.001, +0.000], p 0.33 | 31/84/28, +0.004 [+0.001, +0.010], p < 0.001 | 64/46/33, +0.000, p 0.10 |
| 3.7 | Early English | 44 | 26/15/3, −0.002 [−0.019, 0], p 0.12 | 16/15/13, 0, p 1 | 26/9/9, −0.011 [−0.155, 0], p 0.006 |
| 3.7 | Other Latin-script | 23 | 8/12/3, p 0.50 | 1/18/4, +0.006 [+0.001, +0.209], p < 0.001 | 6/8/9, p 0.79 |
| 3.7 | **Greek** | 121 | **106/6/6, −0.033 [−0.039, −0.023], p < 0.001** | 43/53/22, +0.000, p 0.36 | 59/38/20, −0.001 [−0.002, 0], p 0.04 |
| 3.7 | **Chinese manuscript** | 148 | **105/28/15, −0.012 [−0.020, −0.008], p < 0.001** | 51/65/32, 0 [0, +0.004], p 0.23 | 62/41/40, 0, p 0.05 |
| 3.7 | Chinese print | 12 | 7/3/2, p 0.34 | 2/7/3, p 0.18 | 4/8/0, p 0.39 |
| 3.7 | Armenian | 5 | 3/2/0, p 1 | 1/4/0, p 0.38 | 2/1/1, p 1 |
| 3.7 | **Syriac manuscript** | 40 | **30/9/1, −0.127 [−0.284, −0.070], p 0.001** | 22/16/2, −0.056 [−0.100, +0.029], p 0.42 | 22/18/0, −0.009 [−0.067, +0.054], p 0.64 |
| 3.6 | Latin | 143 | 45/81/17, +0.002 [0, +0.008], p 0.002 | 13/108/22, +0.013 [+0.007, +0.022], p < 0.001 | 53/85/5, +0.002, p 0.008 |
| 3.6 | Early English | 44 | 5/38/1, +0.200 [+0.150, +0.273], p < 0.001 | 2/40/2, +0.231, p < 0.001 | 18/23/3, p 0.53 |
| 3.6 | Other Latin-script | 23 | 15/4/4, −0.002 [−0.004, 0], p 0.02 | 7/11/5, p 0.48 | 12/8/3, p 0.50 |
| 3.6 | Greek | 121 | 83/31/7, −0.013 [−0.023, −0.005], p < 0.001 | 20/91/10, +0.008 [+0.005, +0.012], p < 0.001 | 33/77/10, +0.004, p < 0.001 |
| 3.6 | Chinese manuscript | 148 | 65/68/15, 0 [−0.004, +0.006], p 0.86 | 18/113/17, +0.015 [+0.011, +0.023], p < 0.001 | 28/96/19, +0.011, p < 0.001 |
| 3.6 | Chinese print | 12 | 6/5/1, p 1 | 2/9/1, p 0.07 | 4/8/0, p 0.39 |
| 3.6 | Armenian | 5 | 3/2/0, p 1 | 0/4/1, p 0.13 | 0/4/0, p 0.13 |
| 3.6 | Syriac manuscript | 40 | 17/16/7, 0 [−0.041, +0.029], p 1 | 14/21/5, p 0.31 | 6/32/2, +0.096 [+0.050, +0.197], p < 0.001 |

- **3.7 Flash** beats lite beyond the interval on Greek, Chinese manuscript and Syriac manuscript, the same three
  scripts as 3.8. It ties 3 Flash on Greek and Chinese manuscript. It loses to 3 Flash on Latin by 0.004, and on
  other Latin-script, where 3 Flash scores 0.002. Against 3.8 Flash CLI it is level or slightly better: Greek
  −0.001, p 0.04; Early English p 0.006, where 3.8's prose refusals sit.
- **3.6 Flash** is worse than 3.8 Flash on Latin, Greek, Chinese manuscript and Syriac manuscript, beyond the interval.
  Its Early English and Syriac numbers are mostly the plan note (see the sensitivity check). Its Chinese manuscript
  number is not: the Chinese scorer ignores Latin letters, so the note costs nothing there. On 26 of the 150 pages
  3.6's read is above 0.5 CER, with 15 loops. That is also why its list-price x value there is $7.10: it writes 2.8×
  lite's characters.
- **Noise floor:** lite's A-vs-A repeat where the chart quotes one (Latin, Greek, Chinese); not re-derived here.

### The nudge (preregistered, descriptive)

Share of answered reads that needed the nudge; median CER on nudged (N) and plain (P) rows, each with lite's median
on the same rows in brackets:

| chart | 3.8 Flash | 3.7 Flash | 3.6 Flash |
|---|---|---|---|
| Latin | 30 % · N 43: 0.087 (0.064) · P 100: 0.083 (0.070) | 10 % · N 14: 0.007 (0.042) · P 129: 0.076 (0.072) | 24 % · N 34: 0.026 (0.029) · P 109: 0.089 (0.074) |
| Early English | 41 % · N 18: 0.052 (0.046) · P 26: 0.211 (0.058) | 30 % · N 13: 0.059 (0.051) · P 31: 0.043 (0.056) | 14 % · N 6: 0.047 (0.073) · P 38: 0.274 (0.052) |
| Other Latin-script | 48 % · N 11: 0.007 (0.010) · P 12: 0.004 (0.004) | 26 % · N 6: 0.006 (0.006) · P 17: 0.008 (0.006) | 44 % · N 10: 0.003 (0.005) · P 13: 0.003 (0.008) |
| Greek | 58 % · N 70: 0.075 (0.146) · P 50: 0.080 (0.110) | 20 % · N 24: 0.066 (0.167) · P 94: 0.073 (0.115) | 17 % · N 21: 0.133 (0.171) · P 100: 0.097 (0.116) |
| Chinese manuscript | 58 % · N 285: 0.211 (0.262) · P 204: 0.210 (0.240) | 45 % · N 66: 0.217 (0.244) · P 82: 0.175 (0.242) | 5 % · N 7: 0.272 (0.242) · P 141: 0.292 (0.243) |
| Chinese print | 75 % · N 9: 0.206 (0.179) · P 3: 0.118 (0.145) | 33 % · N 4: 0.110 (0.116) · P 8: 0.178 (0.179) | 0 % · P 12: 0.169 (0.162) |
| Armenian | 100 % · N 4: 0.018 (0.025) | 0 % · P 5: 0.025 (0.029) | 60 % · N 3: 0.013 (0.029) · P 2: 0.524 (0.025) |
| Syriac manuscript | 100 % · N 40: 0.718 (0.991) | 60 % · N 24: 0.701 (1.000) · P 16: 0.706 (0.820) | 92 % · N 37: 0.954 (0.982) · P 3: 0.985 (1.000) |

- The nudge selects harder pages: lite's median is higher on the nudged rows in most cells.
- Against lite on the same rows, nudged reads do no worse than plain ones. Where plain rows are worse (3.6 Latin and
  Early English, 3.8 Early English), the plan note or the prose refusals sit on those plain rows.
- No point was held off the chart for the nudge.

### Sensitivity: the plan note stripped (not the chart)

Leading lines of the note are removed. A reply that opens "I have …" and names a plan, an artifact or a transcription
loses its leading English lines until the first line of text. Everything was then re-scored with the same scorers
(`cli-tiers-plan-note-stripped.json`). Only rows whose median moved are shown:

| chart | arm | as returned | stripped [95 %] | stripped vs lite | stripped vs 3 Flash |
|---|---|---|---|---|---|
| Latin | 3.6 | 0.083 | 0.072 [0.059, 0.080] | 61/65/17, p 0.79 | 21/99/23, +0.004, p < 0.001 |
| Early English | 3.8 | 0.177 | 0.051 [0.033, 0.281] | 22/19/3, p 0.76 | 10/21/13, p 0.07 |
| Early English | 3.6 | 0.262 | 0.041 [0.031, 0.050] | 29/13/2, −0.003 [−0.024, −0.001], p 0.02 | 7/23/14, +0.001, p 0.005 |
| Syriac manuscript | 3.7 | 0.702 | 0.695 [0.674, 0.724] | 30/9/1, p 0.001 | 23/15/2, p 0.26 |
| Syriac manuscript | 3.6 | 0.959 | 0.717 [0.692, 0.761] | 22/13/5, p 0.18 | 21/14/5, p 0.31 |

- With the note stripped, 3.6 reads like lite on Latin and Early English, and like 3.8 on Syriac manuscript.
- **The chart point for 3.6 measures the CLI route as it behaves today, not the model's reading.** A CLI route for
  production OCR would need a detector that strips or rejects this note, as well as one for prose refusals and
  empties (the 3.8 run's finding).
- Greek, Chinese manuscript and Chinese print do not move, because their scorers count only Greek or CJK characters.

### 3.8 Flash: the 41 re-read pages

These are the 41 pages read before the #6345 fix (with tools allowed), re-read under plan mode: `ref-ws` 18,
`chinese-ext` 11, `chinese` 7, `ref-pinned` 5.

- **The re-read is not better on balance.**
  - 6 pages came back empty after 2 attempts. They are now blank reads, CER 1.0 in the reference tiers.
  - 1 Armenian page was blocked with no text (`armenian-xorenatsi-patmutiwn-2-13`).
  - 5 pages that had failed before now read cleanly: 2 Armenian, 3 `ref-ws`.
- **Chart effects:**
  - Chinese print: 0.127 → 0.175 [0.106, 0.266]. Of its 12 pages, 1 empty read went to 1.0 and several others moved up by 0.01–0.04.
  - Other Latin-script: 0.002 → 0.004.
  - Armenian: 3.8 leaves the panel (above).
  - Every other 3.8 point is unchanged.
- The pre-fix reads stay in `/mnt/HC_Volume_105839809/jobs/cli-queue-6293/pareto/C38-ocr-6293.raw.jsonl`.
  `outputs-` and `meter-gemini-3.8-flash+antigravity-cli.jsonl` now hold the plan-mode rows, so all 908 rows are
  `cli_mode: plan`.

**Correction to `2026-10-09-ocr-pareto-gemini-3-8-flash-cli-6293.md`:**
- Its Latin and Early English "vs 3 Flash" cells were computed on the wrong pages. 3 Flash is on every page of both
  panels.
- Latin: 143 pages, 30/96/17, +0.011 [+0.004, +0.022], p < 0.001. The file had n 129 and +0.016.
- Early English: 44 pages, 7/27/10, +0.154 [0, +0.314], p < 0.001. The file had "no shared pages".
- The direction is unchanged: 3.8 CLI reads worse than 3 Flash on both.

### Instrument checks

- **Stored engines unchanged:** re-scoring the bench with the new arms reproduces every stored engine's page CER,
  refusal, empty, loop and `invention_ref`. That is 10,954 page × engine pairs, and it includes 3.8 on its 867
  un-re-read pages. 0 differ.
- **The environment was checked before any new row was added:** 10,995 pairs, 0 differ.
- **Syriac:** 3.8's summary in `syriac-gt-score.json` is identical to the committed one.

### Cost axis

`cli-cost.mjs --out`, the preregistered formula, at each model's list price ($0.75 / $3.75 per 1M for 3.6, 3.7 and
3.8 alike). r_out is the CLI's characters over lite's on each chart's pages where both returned text.

| | 3.7 Flash | 3.6 Flash |
|---|---|---|
| all pages | $3.03 (r_out 0.81) | $3.40 (r_out 0.99) |
| range by chart | $2.06 (Syriac) – $3.63 (Chinese manuscript) | $2.19 (Syriac) – **$7.10 (Chinese manuscript: loops)** |

$0 was billed. Thinking is not counted: the CLI runs at "low" and reports no per-request tokens.

### Calls and time (`/var/log/sourcelibrary/agy-calls.jsonl`, job `cli-queue-b-6293`)

| arm | calls | window | median call | ended on a denied tool (then nudged) | safety filter | empty / exit 3 |
|---|---|---|---|---|---|---|
| 3.7 Flash | 713 | 22:45Z → 01:35Z (2 h 49 min) | 12.5 s | 156 | 5 | 2 / 1 |
| 3.6 Flash | 675 | 01:35Z → 04:13Z (2 h 38 min) | 11.9 s | 121 | 0 | 0 / 1 |
| 3.8 Flash re-read | 71 (+1 probe) | 04:13Z → 04:22Z | 7.1 s | 35 | 1 | 0 |

**No quota error** in 1,460 calls. With the 3.8 run's 1,414 calls, that is about 2,870 image calls over two windows
with no 429.

### What this decides

Nothing in production, by design. For a later proposal:
1. **3.7 Flash through the CLI is the strongest CLI tier measured.** Beyond the interval it beats lite on Greek,
   Chinese manuscript and Syriac manuscript, as 3.8 does. It never beats 3 Flash beyond the interval. At list price
   it costs more than 3 Flash, so it is on the frontier only for Syriac manuscript, where every engine is above 0.68
   CER.
2. **3.6 Flash is not a candidate.** It is worse than 3.8 on four charts. On Chinese manuscript it loops: 15 of 150
   pages.
3. The CLI route fails in **three** ways the API does not: prose refusals, empties, and the plan note. All three need
   detecting before any CLI output is written to pages.

**Files:**
- `results/ocr-pareto-6293/`: `scored/` (re-scored with all three CLI arms), `syriac-gt-score.json`, `outputs-` and
  `meter-gemini-{3.8,3.7,3.6}-flash+antigravity-cli.jsonl`, `cli-cost.json` and
  `cli-cost-gemini-{3.7,3.6}-flash.json`, `capped-set.json`, `cli-tiers.json`, `cli-tiers-plan-note-stripped.json`
- `ocr-pareto-6293/analyze-cli-tiers.py`, which reads `build-ocr-pareto.mjs --dump-rows`
- `build-ocr-pareto.mjs`: three CLI engines; a Chinese-manuscript subsample panel; 3.5 Flash-Lite and 3 Flash listed
  as not run

The raw CLI rows are on the box: `/mnt/HC_Volume_105839809/jobs/cli-queue-b-6293/pareto/`.

**Spend.** $0: CLI on the subscription, no API call, no database write.
