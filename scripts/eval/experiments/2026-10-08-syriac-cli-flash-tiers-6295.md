---
stage: ocr
measure: [accuracy, judged]
languages: [syc]
scripts: [Syrc]
canons: []
n_books: 20
n_pages: 20
verdict: "On printed Syriac, 3.7 Flash CLI reads at CER 0.426 and 3.6 at 0.520 against the Kraken lane's 0.130; Kraken-text translations stay outside the floor under every tier; neither decision changes."
status: informational
decision: null
superseded_by: null
issue: 6295
---
## 2026-10-08 · Printed Syriac: Gemini 3.7 Flash and 3.6 Flash through the CLI, and 3.8 Flash's full repeat read (#6295) — directional; neither decision changes

Follows the 3.8 Flash addendum in `2026-10-08-syriac-print-pareto-6295.md`. It uses the same 24 sealed pages, the
same 20 fixed reference windows, the same scorer, the same judge design and the same cost method. Only the model
changes. Hetzner job `cli-queue-6293`, $0.

**What ran.** `agy -p` on the box, on the Google subscription, with $0 billed (`scripts/eval/run-cli-arm.py`; every
call is logged in `/var/log/sourcelibrary/agy-calls.jsonl`). `agy models` offers 3.8, 3.7 and 3.6 Flash (low /
medium / high) and 3.1 Pro. It does **not** offer Gemini 3 Flash or 3.5 Flash-Lite, so those two stay pending with
the reason "not offered on the CLI".

| arm | model | rows |
|---|---|---|
| C37-ocr, C37-ocr-b | `gemini-3.7-flash-low` | 24 + 24 (A-vs-A repeat) |
| T-C37-R, T-C37-K | `gemini-3.7-flash-low` | 20 + 20 |
| C36-ocr, C36-ocr-b | `gemini-3.6-flash-low` | 24 + 24 |
| T-C36-R, T-C36-K | `gemini-3.6-flash-low` | 20 + 20 |
| C38-ocr-b (completion) | `gemini-3.8-flash-low` | the 8 missing repeat reads, so it now has 24 |

- **Calls:** 189, including 3 probes, from 16:24 to 17:47Z (83 min wall-clock). There was no quota error. One
  3.7 call exited 1 and succeeded on retry.
- **The OCR prompt and translation requests are byte-identical** to the 3.8 run's (`cli-export/`). The image is
  attached as `@./<uid>.jpg`.
- **How the OCR calls ran (disclosure, #6345).** These image calls ran with `--add-dir <one-file workspace>
  --dangerously-skip-permissions`, before the 2026-10-08 19:20Z fix. So the model *could* run tools during a read.
  The CLI does not report whether it did; a read may have been agentic (several steps) rather than one model call.
  The translation calls were text-only and ran without the flag. The flags of 3.8's laptop run were not recorded. All
  later CLI work runs with `--mode plan` (see #6293).

**Cleaning** (`import-cli-arm.py`, the #6332 rule as a script; it first reproduces the committed C38 rows byte for
byte). Rows cut by the safety filter are kept and scored as returned, because a reader would get the same stub:

| arm | rows cut by the safety filter |
|---|---|
| C37-ocr | 3 of 24 |
| C37-ocr-b | 4 of 24 |
| C36-ocr | 1 of 24 |
| C36-ocr-b | 2 of 24 |
| C38-ocr-b's 8 new reads | 2 of 8 |

No row was empty.

### OCR (`score-ocr.mjs --fixed-refs`, the same 20 windows; every earlier arm reproduces exactly)

| engine | median CER [95%, by edition] | accuracy | pages ≤ 10 % | pages ≥ 50 % | cost per 1,000 pages |
|---|---|---|---|---|---|
| Kraken OmniSyr, the lane | 0.130 [0.076, 0.168] | 87 % | 7 | 0 | $0.11 (CPU) |
| **Gemini 3.7 Flash, CLI** | **0.426 [0.340, 0.533]** | 57 % | 0 | 6 | $4.63 (list, Batch; $0 billed) |
| Gemini 3.8 Flash, CLI | 0.433 [0.373, 0.632] | 57 % | 0 | 8 | $4.46 (list, Batch; $0 billed) |
| **Gemini 3.6 Flash, CLI** | **0.520 [0.454, 0.687]** | 48 % | 0 | 12 | $5.90 (list, Batch; $0 billed) |
| Gemini 3.1 Flash-Lite, fresh read | 0.683 [0.626, 0.711] | 32 % | 0 | 20 | $1.28 (metered) |

- **On the pages the filter did not stop:**
  - 3.7: 0.390 [0.311, 0.467] on 17 pages; the lane scores 0.122 on the same pages.
  - 3.6: 0.518 [0.454, 0.605] on 19 pages; the lane scores 0.138.
  - 3.8: 0.405 [0.355, 0.447] on 15 pages; the lane scores 0.138.
- **Page by page:** each tier beats Flash-Lite on most pages (3.7: 16 of 20; 3.6: 15; 3.8: 14) and beats the lane on
  no page.
- **A-vs-A (all n = 24 now):** none of the repeat reads is identical to its first read. Median difference on the 20
  scored pairs:

  | tier | median difference | medians A / B |
  |---|---|---|
  | 3.8 | 4.9 points | 0.433 / 0.444 |
  | 3.7 | 5.7 points | 0.426 / 0.457 |
  | 3.6 | 9.5 points | 0.520 / 0.586 |

  3.8's repeat was 16 reads in #6332 (4.5 points on 14 pairs).
- **OCR lever rule, re-run with the new arms:** OmniSyr is still best. No CLI tier's interval overlaps it, and no arm
  reaches CER ≤ 0.10, so the rule still says **a Kraken fine-tune (#5730)**.

### Translation (rounds `c37` and `c36`, the `c38` design)

Each item holds four drafts of a page: round 1's Flash-Lite drafts (R, K) as anchors, beside the tier's draft from
the e-text and its draft from the Kraken text. Labels are shuffled. Each round has 8 planted reversals and 4
duplicates, with its own seeds (`build-packet.py --round c37|c36`). Two blind Opus judges ran per round (`claude -p
--model opus`, subscription, `run-judges.sh`). **Judge gate: PASS in both rounds:** each judge caught 8/8 plants and
tied 4/4 duplicates. Round c36's judging was cut off at 17:20Z by the Claude session limit; its incomplete parts were
re-run in full after the reset, and none was merged from a partial run.

Fidelity is on a 1–5 scale [95%]; the last column is pages with a reversed statement (out of 20).

**Round c37 (Gemini 3.7 Flash):**

| draft | fidelity | share ≥ 4 | reversed | cost per 1,000 pages |
|---|---|---|---|---|
| Flash-Lite, e-text (R) | 3.95 [3.63, 4.27] | 65 % | 6 | $0.74 (metered) |
| Flash-Lite, Kraken text (K) | 2.83 [2.55, 3.13] | 10 % | 10 | $0.79 (metered) |
| **3.7 Flash CLI, e-text** | **4.93 [4.83, 5.00]** | 100 % | 0 | $2.11 (list, Batch) |
| **3.7 Flash CLI, Kraken text** | **3.90 [3.63, 4.14]** | 70 % | 2 | $2.17 (list, Batch) |

**Round c36 (Gemini 3.6 Flash):**

| draft | fidelity | share ≥ 4 | reversed | cost per 1,000 pages |
|---|---|---|---|---|
| Flash-Lite, e-text (R) | 4.20 [3.95, 4.48] | 90 % | 7 | $0.74 (metered) |
| Flash-Lite, Kraken text (K) | 2.98 [2.67, 3.30] | 20 % | 11 | $0.79 (metered) |
| **3.6 Flash CLI, e-text** | **4.88 [4.71, 5.00]** | 100 % | 1 | $2.09 (list, Batch) |
| **3.6 Flash CLI, Kraken text** | **3.30 [2.97, 3.59]** | 45 % | 5 | $2.19 (list, Batch) |

- **Kraken text minus e-text, each tier's own drafts:**
  - 3.7: −1.03 [−1.30, −0.75]
  - 3.6: −1.58 [−1.91, −1.25]
  - 3.8 (#6332): −0.98 [−1.18, −0.78]

  Every lower bound is far below round 1's −f = −0.275, so all three are **outside the noise floor**.
- **Each tier against Flash-Lite in the same read:**
  - 3.7: +0.98 on the e-text, +1.08 on the Kraken text.
  - 3.6: +0.68 on the e-text, +0.33 [0.13, 0.53] on the Kraken text.
- The anchors move between reads (Flash-Lite R: 3.95 in c37, 4.20 in c36, 4.03 in c38), so the scale is relative.
  Compare within a round, never across rounds; each round has its own chart panel.

**Cost axis.** `cli-cost.mjs` gives each tier its own list price (`model-pricing.mjs`) at the Batch rate, with
thinking at 0. Input tokens are Flash-Lite's billed tokens for the byte-identical request; output tokens are the CLI
text's length at Flash-Lite's tokens per character. 3.6 Flash's OCR figure is higher than 3.7's because its reads
are longer (more output). $0 was billed.

**Do the decisions change?** No.
1. **Re-translation:** the Kraken-text English stays **withheld** under every tier. 3.7 Flash behaves like 3.8: from
   the Kraken text it scores 3.90, close to Flash-Lite on the typed e-text, and reverses a statement on 2 of 20 pages.
   3.6 Flash is clearly worse from the Kraken text (3.30, 5 reversals).
2. **OCR lever:** 3.7 Flash reads 57 % of consonants right and 3.6 Flash 48 %, against the lane's 87 %. The fine-tune
   recommendation stands.

**Still pending:** Gemini 3 Flash (fresh read) and 3.5 Flash-Lite, both not offered on the CLI.

**Files:** `results/syriac-pareto-6295/{ocr-score,ocr-summary,cli-cost,translation-summary-c37,translation-summary-c36}.json`,
`results/syriac-pareto-6295/judge-c3{7,6}/` (blinding keys). The judges' outputs and drafts stay on the box
(`/mnt/HC_Volume_105839809/jobs/syriac-pareto-6295/`, raw CLI rows in `/mnt/HC_Volume_105839809/jobs/cli-queue-6293/syriac/`).

**Spend.** $0: CLI on the subscription, judges on the Claude subscription, no database write.
