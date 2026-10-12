---
stage: ocr
measure: accuracy
languages: [la, en]
scripts: [Latn]
canons: []
n_books: null
n_pages: 191
verdict: "Through the CLI, 3.7 and 3.8 Flash were losing Latin and Early English pages to the route, not the model. Two changes fix it: an answer between markers, and a hook that refuses tools with a reason. On held-out pages, 3.8 low goes from 14 of 157 pages over half wrong to 1 of 161, and 3.8 high from 25 to 2."
status: informational
decision: null
superseded_by: null
issue: [6523, 6293]
---
## 2026-10-12 · Fixing the Gemini CLI OCR route by iteration (#6523): markers + a tool gate put 3.7 / 3.8 Flash where the model is

Job `cli-ocr-fix-6523c` (Hetzner). Every read went through `agy -p` on the Google subscription, $0 billed; no paid
call, no fallback route. #6345 holds throughout: no auto-approve, no `--dangerously-skip-permissions`, no tool
execution. About 1,700 CLI calls in all (dev rounds 720, held-out 483, fresh dev pass 90, probes).

### Step 1: why the CLI reads failed

I read the raw replies of the 93 stored 3.7 / 3.8 CLI reads that are over half wrong (Latin print + Early English):

| cause | pages |
|---|---|
| Gemini's recitation (copyright) filter cuts the read mid-page; the agent then apologises or offers a summary | 35 |
| empty: the model asked for a shell, headless mode denied it, still empty after the #6331 nudge | 34 (27 at 3.8 high) |
| empty: timeout | 5 |
| doubled or restarted reply (the agent retries after the cut, and is cut at about the same place) | 5 |
| blocked by Gemini's filter, only a stub before the block | 4 |
| partial read + summary offer, no filter wording | 3 |
| real misread | 3 |
| plan note | 2 |
| loop / other | 2 |

- **The "transcription + chat" pages are mostly PARTIAL reads.** The chat follows a recitation cut. It does not follow a complete page.
- **Recitation is model-side.** The paid-API 3.8 Flash arm on the same bench has `finishReason: RECITATION` on 25 of 81 `ref-ws` pages and 11 of 58 EEBO pages. Lite and 3 Flash have none on `ref-ws`.

### Step 1b: a scoring change, applied to every engine

`extractTranscription()` (`scripts/lib/cli-chatter.mjs`) does four things:
- it takes the block between `<<<BEGIN>>>` and `<<<END>>>` when the reply has the markers;
- it drops a leading plan note or "Here is…" line, and every ``` fence;
- it cuts at the first line of agent chat;
- it keeps the longest copy of a restarted or doubled reply.

`ocr-pareto-6293/rescore-extract.mjs` applies it to every engine's stored read in the four Latin-script strata. That
file (`results/ocr-pareto-6293/extract-rescored.json`) now feeds `build-ocr-pareto.mjs`. It replaces the #6386
plan-note re-score, whose note it also removes.
- **Positive control:** every read it leaves unchanged reproduces the committed CER. That was 2,806 / 2,806 on the stored reads.
- **Fairness:** on the reads stored before this job, no API or self-hosted read changed except one Chandra read, which lost a trailing rule with CER unchanged. No API number on the charts moved.
- **On the stored CLI reads,** 98 reads improve and 19 get worse. The worse ones are partial reads, where removing the refusal paragraph raises CER because its letters had been matching the reference by chance.
- **Alone it barely moves 3.8:** Latin primary 0.578 → 0.576. Its failures there are recitation cuts too short to align, and tool-request empties.

### Step 2: dev rounds

- **Dev set:** 20 pages 3.8 low failed on, drawn by cause (9 recitation, 5 tool-empty, 3 blocked, 2 unalignable, 1 misread) + 10 pages it read well. Draw: `random.Random(6523)`, frozen in `cli-ocr-fix-6523/sets.json`. **Held-out:** the other 161 pages of the capped Latin + Early English sets.
- **Model:** 3.8 Flash low in every round.
- **Scoring:** `benchmark-score.mjs`, unchanged, on a dev bench (`cli-ocr-fix-6523/score-round.mjs`). That harness reproduces the chart's per-page CER on all 30 dev pages. Chart rule: an empty, refused or unaligned read counts as 1.0.
- **Each round is TWO passes (60 reads).** The baseline run twice gave failed-20 CER 0.367 and then 0.085, because pages flip between a clean read and an empty one from call to call.

| round | lever | reads | empties | refusals | over half wrong | mean CER failed-20 | mean CER good-10 | retries | nudges | gate denials | |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R0 | baseline: plan mode + nudge, 2 attempts (#6293 config) | 60 | 9 | 2 | 11 | 0.226 | 0.197 | 50 | 50 | 0 | baseline |
| R1 | structure: <<<BEGIN>>>/<<<END>>> sentinels, nothing outside them | 60 | 4 | 1 | 5 | 0.139 | 0.095 | 32 | 30 | 0 | kept |
| R2 | R1 + tool gate (PreToolUse hook: view_file in workspace only, deny the rest with a reason) | 60 | 0 | 1 | 3 | 0.08 | 0.092 | 0 | 0 | 26 | kept |
| R3 | R2 with the gate's denial reason naming view_file (no claim the image was seen) | 60 | 0 | 0 | 0 | 0.033 | 0.042 | 1 | 0 | 36 | kept (final) |
| R4 | R3 + image downscaled to 1600 px long side | 60 | 0 | 1 | 3 | 0.08 | 0.091 | 1 | 0 | 32 | dropped |
| R5 | R3 + one fresh retry when the reply is a refusal / filter cut | 60 | 0 | 0 | 0 | 0.034 | 0.046 | 3 | 0 | 37 | dropped |

What each lever did:
- **R1, markers.** The prompt ends with: "Write the transcription between two marker lines, `<<<BEGIN>>>` and `<<<END>>>`. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions." 58 of 60 replies used the markers.
- **R2, tool gate.** `scripts/lib/agy-tool-gate.py` runs as an agy PreToolUse hook (`.agents/hooks.json` in the page's one-image workspace). It allows `view_file` inside that workspace and denies every other tool, with a reason. The denial comes back to the model as a tool result, and the model writes the transcription in the same turn. Before, headless mode ended the turn empty.
  - The model asks for `run_command` (to crop), `read_url` or `search_web` (to fetch the text online) on about 40% of 3.8 low reads, and on **every** 3.8 high read.
  - Nothing is approved that plan mode would not allow.
- **R2's invented read.** One R2 read was **invented**: `ref-ws|…poemander-1854-djvu-p26`, Greek text with a Latin translation, came back as a list of codices from Parthey's preface, checked against the image. The first denial reason said "you have seen the image".
- **R3** changes only that reason: it names `view_file` and says to open the image if not yet done. 0 of 60 reads over half wrong. Each read's tool sequence is now logged; the R3 read that never called `view_file` is clean (CER 0.015), because the `@` attachment sometimes reaches the model inline.
- **R4, a 1,600 px downscale:** no gain. Dropped; the CLI keeps the sealed JPEG the API arms read.
- **R5, one fresh retry on a refusal or filter cut:** 3 retries in 60 reads, no gain over R3. Dropped by the rule "keep a lever only if it improves failed-20". It remains the next lever for recitation cuts (below).
- **Stop:** two rounds in a row (R4, R5) without gain. Thinking level was not run as a dev lever: the held-out run includes 3.8 high.

**Runner bug found on the way.** At `--print-timeout`, agy returns the PARTIAL reply with exit 0. `run-cli-arm.py` and `cli-ocr.mjs` stored such replies as clean reads.
- The markers exposed it: the reply ends without `<<<END>>>`.
- Both runners now class it as a timeout, and the default timeout is 300 s instead of 120 s. 3.8 high runs 70–240 s on a dense page.
- Two 3.8 high held-out pages cut at 120 s were dropped and re-read at 300 s. The 3.8 low held-out arm ran at 120 s; its longest call was 91 s.

### Step 3: held-out confirmation (final config = R3)

161 held-out pages, one pass per arm. Over half wrong is counted on the pages each arm had a stored read for (157).

| chart (held-out pages) | arm | stored read (#6293 config): mean CER / over half wrong | #6523 config | lite | 3 Flash |
|---|---|---|---|---|---|
| Latin (116) | 3.8 low | 0.132 / 7 | **0.071 / 0** | 0.077 / 2 | 0.059 / 0 |
| Latin (116) | 3.8 high | 0.158 / 11 | **0.064 / 0** | | |
| Latin (116) | 3.7 low | 0.111 / 6 | **0.082 / 2** | | |
| Early English (41) | 3.8 low | 0.216 / 7 | **0.074 / 1** | 0.059 / 0 | 0.045 / 0 |
| Early English (41) | 3.8 high | 0.365 / 14 | **0.078 / 2** | | |
| Early English (41) | 3.7 low | 0.178 / 6 | **0.080 / 2** | | |

On all 161 held-out pages:

| arm | empties | blocked | retried |
|---|---|---|---|
| 3.8 low | 0 | 1 | 0 |
| 3.8 high | 1 | 1 | 1 |
| 3.7 low | 0 | 0 | 0 |

- **Residual failures are recitation cuts on famous texts.** Newton's *Principia* came back as three copies, each cut, and the last carries `<warning>Verbatim transcription filtered by automated safety systems</warning>`. 3.7 shows two such restarts on held-out pages.
- These are the model's filter, and the API arm shows it too. A retry-on-refusal (R5) is the obvious next lever if they matter.

### The charts (`src/data/ocr-pareto.json`, rebuilt)

**What was re-read.** Each CLI arm's 191 Latin + Early English pages were re-read with the final config, through `cli-ocr-fix-6523/apply-reread.mjs`:
- the 161 held-out pages;
- a **fresh** pass over the 30 dev pages, which were not tuned further.

That replaces those pages' rows in `outputs-` and `meter-<engine>.jsonl`; each meter row names `cli_config` and the tool calls.

**How it was re-scored.** `benchmark-score.mjs` re-scored the four strata.
- **Control:** every engine cell that was not re-read reproduces the committed score, 5,180 of 5,180.
- **Costs:** `cli-cost.mjs` was recomputed for the two charts. The markers add about 22 characters to each read's length (< 1% of r_out).
- **Note:** the 30 dev pages sit inside these panels (13 of the Latin primary's 44), so **the held-out table above is the clean evidence**.

Accuracy (1 − mean CER), before → after:

| panel | 3.8 low CLI | 3.8 high CLI | 3.7 CLI | lite | 3 Flash |
|---|---|---|---|---|---|
| Latin primary (44, `ref-ws`) | 0.578 → **0.942** | 0.722 → **0.989** (on the frontier, "better" than lite) | 0.891 → 0.920 | 0.962 | 0.986 |
| Latin whole-anchored (93) | 0.859 → 0.910 | 0.854 → 0.907 | 0.846 → 0.916 | 0.910 | 0.925 |
| Early English (44) | 0.731 → **0.928** | 0.658 → **0.926** | 0.797 → 0.923 | 0.940 | 0.956 |

- **Disclosure on the chart:** the Latin and English captions name the route config and the retry rate (1 of 573). Each CLI arm's cost `detail` on those charts carries the full config.
- **Not re-read:** the other charts' CLI reads (Greek, Chinese, other Latin-script, Armenian, Syriac) are still the #6293 config. Other Latin-script (German / French `ref-ws`, 22 pages) shows the same route failures (3.7 / 3.8 at 0.71); re-reading it is about 70 calls.

### Step 4: in the shared runners

- **`scripts/batch/cli-ocr.mjs` (the CLI OCR writer):**
  - the prompt asks for the markers, and the tool gate is installed in each page's workspace;
  - `.txt` holds the text between the markers and `.raw.txt` the whole reply;
  - a reply with text outside the markers, or cut before `<<<END>>>`, is read once more and then never written;
  - print timeout 300 s, and a timeout partial is not a read;
  - reads made before this change rebuild their legacy prompt, so their hash still matches at apply.
- **`scripts/eval/run-cli-arm.py`:**
  - the tool gate is on for every image request (`--no-tool-gate` opts out);
  - for `--kind ocr` the markers are on (`--no-sentinels`), with `text` = between the markers, `raw` = the reply, `wrapper` = why not clean;
  - default print timeout 300 s.
- **Tests:** `tests/unit/cli-ocr-extract-6523.test.ts` covers the extractor, the unwrap, the gate, and the parity of the marker instruction between Python and JS. `ocr-pareto.test.ts` checks `rescore-extract.mjs --check`.

**Spend.** $0 billed. No database write.
