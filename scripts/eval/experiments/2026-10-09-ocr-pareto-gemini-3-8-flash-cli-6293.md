## 2026-10-09 · OCR Pareto, Part A: Gemini 3.8 Flash through the CLI on the 908 preregistered pages (#6293) — it beats Flash-Lite on Greek, Chinese and Syriac manuscript, never 3 Flash; the CLI fails ~6 % of pages in ways the API arms don't

Preregistration: `scripts/eval/PREREGISTRATION-ocr-pareto-6293.md`, committed before any arm ran. Hetzner job
`cli-queue-6293`, $0. This run is ONE arm only: `gemini-3.8-flash-low` through the Gemini CLI (`agy -p`, Google
subscription). No other tier was run on these pages by this job.

### What ran, and how it differs from the preregistration

- **Pages:** the frozen 908 (`results/ocr-pareto-6293/pages.json`): each chart's most-pages panel on `0a3a4ab3a`.
  The images are the same sealed JPEGs, and the prompt is the one each stratum's charted Gemini points used:
  - production v19.1 on `latin-period-5126` (`content_hash 9d8f959e…`);
  - the generic transcription prompt everywhere else.
- **Route: CLI, not the Batch API. This is the deviation.** Derek's 2026-10-08 rule allows no paid Gemini call
  except 3.1 Flash-Lite. So:
  - the image is attached as `@./<slug>.jpg`;
  - the CLI sets its own temperature (prereg: 0), and its "low" thinking level (prereg: budget 0);
  - there is no `maxOutputTokens`.

  Each point therefore differs from lite and 3 Flash in route as well as model. The chart's panel note says so, and
  the point sits at the API list price with $0 billed.
- **The CLI is an agent, and that shaped the protocol:**
  - **17:47–19:57Z (41 pages):** run with `--add-dir … --dangerously-skip-permissions`, so the model could run tools.
    These were the first 41 pages: Armenian 5, `chinese-ext` 12, `chinese` 7, the first German `ref-ws` pages. The
    one row left empty from that window was re-run with the new flags. The other 40 are kept as they came back,
    per Derek's restart note (#6345 disclosure).
  - **From 22:11Z (867 pages):** `--mode plan --print-timeout 120s --output-format json`, never auto-approve.
  - **The nudge.** Even in plan mode the model often asks for a shell command (python, to crop the image). Headless
    mode denies it and the turn ends empty. The runner then continues *that* conversation once with: "Running
    commands is not available here. Answer directly from the attached file now, following the instructions above
    exactly." This happened on **470 of 867 pages**; those rows are marked `nudged`. A nudged read is a two-turn
    conversation with the image already in context. It is not the single request the API arms made.
  - At most 2 attempts per page; image calls ran 2 at a time.
- **Scoring:** the instruments are unchanged.
  - `benchmark-score.mjs` on the #6293 bench, with every stored engine beside the new arm. Every stored engine's
    page CER and alignment reproduce the pre-run baseline exactly: 10,044 page × engine pairs, 0 differences.
  - Syriac: `score-syriac-retest.py`, scored on a tree holding only the new engine, against the same ground truth.
  - The Pareto feed: `build-ocr-pareto.mjs` reads `results/ocr-pareto-6293/scored` and the Syriac file, taking only
    `gemini-3.8-flash+antigravity-cli`.

### What came back (908 pages)

| outcome | pages | how it is scored |
|---|---|---|
| text | 844 | as returned |
| safety filter ("This request was blocked by Gemini's filters") | 38 | the message is cut and the text before it is kept and scored. **10 had no text before it** (`chinese-cohort-5547` 9, `greek-ext` 1). Under the prereg those are refusals, so they leave their panel's shared set: Greek 121 → 120 pages, Chinese manuscript 498 → 489 |
| empty after 2 attempts | 26 | a blank read, never inferred to be a refusal (meter `finishReason: CLI_EMPTY`). By stratum: `chinese-cohort-5547` 14, `ref-ws` 5, others ≤ 2 |
| **prose refusal** inside the text | 26 (of the 844 + 38) | as returned. This is a failure the API arms do not show: the model transcribes part of the page, then writes "I cannot provide the full transcription … content filters", or offers a summary instead ("Would you like a summary of the next section?"). It happened on public-domain pages: `ref-ws` 17, EEBO 6, `latin-period-5126` 2, `ref-pinned` 1 |

**One rule added for this arm.** In the reference tiers (`ref-ws`, `ref-pinned`), a page the scorer cannot align has
no CER. For the stored engines that page is coverage, and it leaves the panel. For this arm such a page is an empty
read, a stub or a prose refusal: a failed read. So it counts as **CER 1.0**, as a refusal does in the sealed strata.
That keeps the arm on each chart's whole frozen set, as the prereg requires ("a refused or empty page counts as
read"). It affects:
- Latin: 20 of 143 pages;
- other Latin-script: 5 of 23;
- Armenian: 2 of 5.

### Per chart (most-pages panel; accuracy = 1 − median CER, page bootstrap)

The "W/L/T" columns are the paired comparison on the panel's pages: wins / losses / ties for 3.8 Flash CLI, with the
median Δ CER [bootstrap 95 %] and the sign-test p.

| chart | n | **3.8 Flash CLI** median CER [95 %] | lite | 3 Flash | vs lite: W/L/T, median Δ [CI], p | vs 3 Flash: W/L/T, median Δ [CI], p |
|---|---|---|---|---|---|---|
| Latin print | 143 | **0.083** [0.073, 0.089] | 0.068 | 0.056 | 58/77/8, +0.002 [0.000, 0.006], p 0.12 | 24/92/13, +0.016 [0.006, 0.024], p < 0.001 |
| Early English print | 44 | **0.177** [0.053, 0.393] | 0.053 | 0.035 | 17/25/2, +0.089 [−0.001, 0.303], p 0.28 | — (no shared pages) |
| Other Latin-script | 23 | **0.002** [0, 0.004] | 0.006 | 0.002 | 13/7/3, −0.002 [−0.005, 0], p 0.26 | 6/8/9, 0 [0, 0.001], p 0.79 |
| Greek | 120 | **0.078** [0.067, 0.093] | 0.118 | 0.076 | **89/23/8, −0.021 [−0.031, −0.008], p < 0.001** | 39/63/18, +0.001 [0, 0.002], p 0.02 |
| Chinese manuscript | 489 | **0.210** [0.192, 0.234] | 0.254 | 0.202 | **310/122/57, −0.010 [−0.012, −0.006], p < 0.001** | 148/231/110, 0 [0, 0.004], p < 0.001 |
| Chinese print | 12 | **0.128** [0.088, 0.228] | 0.162 | 0.147 | 9/1/2, −0.025 [−0.036, −0.005], p 0.02 | 6/4/2, −0.003 [−0.014, 0.004], p 0.75 |
| Armenian | 5 | **0.041** [0.025, 1] | 0.029 | 0.007 | 2/3/0, p 1 | 1/3/1, p 0.63 |
| Syriac manuscript | 40 | **0.718** [0.684, 0.779] | 0.991 | 0.767 | **27/11/2, −0.098 [−0.209, −0.001], p 0.01** | 22/15/3, −0.040 [−0.089, +0.040], p 0.32 |

- **Noise floor:** the chart quotes lite's A-vs-A repeat where the stratum has one (Latin, Greek, Chinese); this file
  does not re-derive it. The Greek and Chinese manuscript gains over lite have paired intervals that exclude 0.
- **Frontier:** the arm is on the frontier only on Syriac manuscript, where it is the most accurate Gemini point at
  $1.93. Everywhere else 3 Flash ($2.71) or lite ($1.28) is cheaper and at least as accurate. The exception is Chinese
  print, where 3.8 reads better than 3 Flash on 12 pages, but within its interval and at a higher price.
- **Early English:** the median is pulled up by the CLI's failures (6 prose refusals, 1 empty, 2 stubs on 44 pages),
  not by misreading.
- **Latin:** 20 failed reference-tier reads at 1.0 make up most of the gap to lite.

**How each read was made, per panel** (median CER for this arm and for lite on the same rows; *pre-fix* = the 40
reads kept from before the plan-mode fix):

| chart | nudged | plain (plan mode) | pre-fix |
|---|---|---|---|
| Latin | 43: 0.087 (lite 0.064) | 100: 0.083 (lite 0.070) | — |
| Early English | 18: 0.053 (lite 0.046) | 26: 0.212 (lite 0.063) | — |
| Other Latin-script | — | 5: 0.002 | 18: 0.002 (lite 0.005) |
| Greek | 70: 0.075 (lite 0.146) | 50: 0.080 (lite 0.110) | — |
| Chinese manuscript | 285: 0.211 (lite 0.262) | 204: 0.210 (lite 0.240) | — |
| Chinese print | — | — | **12: 0.128 (lite 0.162), the whole panel** |
| Armenian | — | — | **5: 0.041 (lite 0.029), the whole panel** |
| Syriac manuscript | 40: 0.718 (lite 0.991) | — | — |

- Nudged and plain reads score alike against lite on the same rows. The nudge selects harder pages (lite's medians
  are higher there) but does not show a penalty of its own.
- English's plain rows are worse because the prose refusals sit there.
- **The Chinese print and Armenian points, and 18 of the 23 other-Latin-script pages, come entirely from reads made
  with tools allowed (`--dangerously-skip-permissions`).** Treat those three points as a different protocol until
  re-read; re-reading them under plan mode is 40 calls.

**The five worst pages** on the Latin, Greek and Chinese manuscript charts. These were classified from the output
against the reference, **not by eye against the image**; the prereg's by-eye read is not done.
- **Latin:** a prose refusal (CER 2.2); v19.1's `<vocab>` metadata written out as text; one empty; one safety stub;
  one partial transcription followed by "please let me know which parts".
- **Greek:** two Latin/German-language pages read in full (CER > 1 against the Greek-letters-only fold, the
  stratum's known caveat); one empty; one stub ("122 Λ"); one partial.
- **Chinese manuscript:** one loop of `欽thought` (a CLI artefact: the model's "thought" marker leaking into the
  text); one over-long read; three empty.

**Cost axis** (`ocr-pareto-6293/cli-cost.mjs` → `results/ocr-pareto-6293/cli-cost.json`). $0 was billed. The point
uses the preregistered formula:

> 1000 × ½ × [3,736 × r_in × $0.75 + 1,082 × r_out × $3.75] / 1e6

- r_in = 1: the identical request.
- r_out is the CLI's characters over lite's, on each chart's pages where both returned text. Over all 870 such pages
  r_out = 0.77, giving **$2.96 / 1K**.
- Per chart: Latin $3.32, English $3.41, other Latin-script $2.87, Greek $3.45, Chinese manuscript $3.54, Chinese
  print $3.52, Armenian $2.31, Syriac $1.93. Syriac is low because lite loops there.
- Thinking is not counted: the CLI ran at "low" and reports no per-request tokens.

### Calls and time (from `/var/log/sourcelibrary/agy-calls.jsonl`)

- **Before the fix:** 49 calls, 17:47–19:57Z (2 h 10 min, 41 pages, one at a time; calls up to 420 s while the
  model hung on a denied tool).
- **After the fix:** 1,365 calls, 22:11Z → 01:19Z (3 h 08 min, 867 pages, 2 in parallel; median call 9 s):

  | outcome | calls |
  |---|---|
  | ok | 805 |
  | ended on a denied tool (then nudged) | 484 |
  | safety filter | 36 |
  | empty | 24 |
  | exit 3 | 11 |
  | probes | 5 |
- **No quota error** at any point.
- **For the next tier on these 908 pages:** about 1,400 CLI calls and ~3¼ h at 2 parallel.

### What this decides

Nothing in production, by design. Two findings bear on any later proposal:
1. On Greek and Chinese manuscript, 3.8 Flash reads better than lite, beyond the floor. It only ties 3 Flash, and
   costs more than either at list price.
2. **Through the CLI, about 6 % of pages fail in ways the API arms do not:** 26 empty, 10 blocked with no text, and
   26 prose refusals of public-domain text. Almost half the reads also needed the "no commands" nudge. A CLI route
   for production OCR would need a detector for prose refusals and empties before it could be trusted.

**Files:**
- `results/ocr-pareto-6293/`: `scored/`, `syriac-gt-score.json`, `outputs-` and `meter-gemini-3.8-flash+antigravity-cli.jsonl` (per page: route, `cli_mode`, `nudged`, attempts), `cli-cost.json`
- `ocr-pareto-6293/import-cli-arm.py` and `cli-cost.mjs`
- `run-cli-arm.py`

The raw CLI rows are on the box: `/mnt/HC_Volume_105839809/jobs/cli-queue-6293/pareto/`.

**Spend.** $0: CLI on the subscription, no API call, no database write.
