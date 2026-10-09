## 2026-10-09 · OCR Pareto, Amendment 3: is 3.8 Flash CLI's gap to 3 Flash on Latin and Early English the model, or the route? (#6293) — mostly the route: a second read at the same low level closes most of it, high effort does not help

Preregistration: `scripts/eval/PREREGISTRATION-ocr-pareto-6293.md`, **Amendment 3** (`a8eabb17f`, committed and pushed
2026-10-09 ~08:42Z, before any call of these arms). Reads 08:44–10:22Z; scoring, chart and this file: Hetzner job
`cli-effort-6293`. $0.

### The question (Derek, 2026-10-09)

On /quality/pareto, 3.7 and 3.8 Flash through the CLI ("low", plan mode) score below 3 Flash (API) on Latin print,
and 3.8 CLI is far worse than 3.7 CLI on Early English (median CER 0.177 against 0.043). #5924 had 3.8 Flash on the API
tied best on Latin. Is that the model, or the CLI route and its effort level?

### What ran

- **C38H:** `gemini-3.8-flash-high` through `agy -p --mode plan --print-timeout 180s --output-format json`; engine
  `gemini-3.8-flash-high+antigravity-cli`. New.
- **C38L-rep:** `gemini-3.8-flash-low`, the same flags. This is a fresh repeat of the stored C38 read, as an A-vs-A
  noise floor. Engine `gemini-3.8-flash+antigravity-cli-rep`; not charted.
- **Pages:** the Latin (143 after #6304's drops) and Early English (44) most-pages sets, 191 requests. These are the
  same sealed JPEGs and the same request per stratum, byte for byte, as `cli-queue-6293`'s `requests.jsonl`.
- **Protocol:**
  - One page per call, at most 2 attempts.
  - The second attempt continues a tool-denied conversation once with the "no commands" nudge.
  - Never auto-approve (#6345).
  - The two arms ran interleaved, 2 parallel each, until C38L-rep finished at 09:16Z. C38H then ran alone at 4
    parallel.
- **Two deviations, both disclosed:**
  1. **Print timeout 180 s, not 120 s** (the brief). For C38L-rep this is the only protocol difference from the
     stored read.
  2. **The C38H restart.** When I restarted C38H at 4 parallel, the harness began retrying pages that had already
     failed twice (`run-cli-arm.py` retries text-less rows on restart). That would have been a third attempt. I
     stopped it within a minute, before any extra row was written, and restarted on the 148 pages with no row yet.
     6 in-flight calls were discarded across the two restarts. They are in the call log, and no row came from them.
- **Calls** (`/var/log/sourcelibrary/agy-calls.jsonl`, job `cli-effort-6293`):
  - C38H: 388 calls, median 13 s. 224 ended on a denied tool, 5 timed out.
  - C38L-rep: 281 calls, median 9.5 s.
  - **No quota error.** The account was shared with `tengyur-cli-6361` throughout.

### What came back: what each reply is

Each reply was sorted by its surface shape, checked by eye on the examples below
(`analyze-cli-effort.py` `kind()`; the first match wins):
- **empty:** no text after 2 attempts;
- **safety-cut:** Gemini's filter cut the text off;
- **prose refusal:** "I cannot provide a verbatim transcription…" / "would you like a summary?";
- **plan/agent note:** a note about a plan file, or "The user invoked /plan…";
- **doubled:** the whole reply emitted twice;
- **clean:** none of these.

| panel | arm | clean | empty | safety-cut | prose refusal | plan/agent note | doubled | nudged | pages above 0.5 CER |
|---|---|---|---|---|---|---|---|---|---|
| Latin (143) | C38, stored (8 Oct) | 114 | 6 | 3 | **15** | 3 | 2 | 43 | 26 |
| Latin (143) | **C38L-rep** | 137 | 0 | 2 | 1 | 3 | 0 | 62 | **3** |
| Latin (143) | **C38H** | 125 | **18** | 0 | 0 | 0 | 0 | **143** | 18 |
| Early English (44) | C38, stored (8 Oct) | 22 | 1 | 1 | **11** | **8** | 1 | 18 | 13 |
| Early English (44) | **C38L-rep** | 35 | 3 | 3 | 1 | 2 | 0 | 24 | **5** |
| Early English (44) | **C38H** | 30 | **14** | 0 | 0 | 0 | 0 | **44** | 14 |

- **The stored C38 read was a bad run.** It had 15 Latin and 11 English prose refusals of public-domain text. The fresh
  read at the same level had 1 and 1.
- **High effort changes how the CLI fails, not how well the model reads.**
  - At "high", every page asked for a shell command first, so 191 of 191 needed the nudge.
  - 32 of 191 still came back empty after it: 27 asked again, 5 timed out.
  - It wrote no prose refusals and no plan notes. Every reply that had text was a clean transcription.
- **No reply that is a clean transcription scores above 0.5 CER in either new arm.** The stored C38 has 2.

### Per panel: median CER [page bootstrap 95 %]

| panel | C38H | C38L-rep | C38 stored | 3 Flash (API) | lite |
|---|---|---|---|---|---|
| Latin (143) | 0.072 [0.061, 0.084] | **0.066** [0.055, 0.075] | 0.083 [0.072, 0.089] | 0.056 [0.045, 0.062] | 0.068 [0.061, 0.075] |
| Early English (44) | 0.042 [0.029, 0.086] | **0.039** [0.028, 0.052] | 0.177 [0.051, 0.387] | 0.035 [0.028, 0.043] | 0.053 [0.040, 0.064] |

### Paired, on all panel pages: a failed read counts as CER 1.0, the chart's rule

Δ = arm − other; negative means the arm reads better.

| panel | comparison | W/L/T | median Δ [95 %] | mean Δ [95 %] | sign p |
|---|---|---|---|---|---|
| Latin | C38H vs C38 stored | 61/39/43 | 0.000 [−0.001, 0.000] | −0.069 [−0.141, +0.003] | 0.04 |
| Latin | **C38H vs 3 Flash** | 36/85/22 | **+0.004 [+0.001, +0.008]** | +0.128 [+0.077, +0.181] | < 0.001 |
| Latin | C38H vs lite | 77/55/11 | −0.001 [−0.002, 0.000] | +0.104 [+0.051, +0.160] | 0.07 |
| Latin | **C38L-rep vs C38 stored** | 67/44/32 | 0.000 [−0.001, 0.000] | **−0.164 [−0.238, −0.100]** | 0.04 |
| Latin | C38H vs C38L-rep | 54/56/33 | 0.000 [0, 0] | +0.096 [+0.038, +0.157] | 0.92 |
| Latin | C38L-rep vs 3 Flash | 28/88/27 | +0.002 [+0.001, +0.007] | +0.032 [+0.012, +0.058] | < 0.001 |
| Early English | C38H vs C38 stored | 22/15/7 | −0.001 [−0.125, 0.000] | +0.037 [−0.121, +0.203] | 0.32 |
| Early English | **C38H vs 3 Flash** | 12/16/16 | **0.000 [0.000, +0.001]** | +0.298 [+0.171, +0.432] | 0.57 |
| Early English | C38H vs lite | 26/14/4 | −0.002 [−0.010, 0.000] | +0.283 [+0.155, +0.413] | 0.08 |
| Early English | **C38L-rep vs C38 stored** | 24/9/11 | −0.010 [−0.213, 0.000] | −0.116 [−0.239, +0.021] | 0.01 |
| Early English | C38H vs C38L-rep | 14/14/16 | 0.000 [0, 0] | +0.153 [−0.020, +0.323] | 1.0 |
| Early English | C38L-rep vs 3 Flash | 14/11/19 | 0.000 [0, 0] | +0.145 [+0.054, +0.254] | 0.69 |

### The preregistered decision rule, and why its verdict is not the whole answer

The rule as written: "C38L-rep reproduces C38" means its paired **median** Δ CI against stored C38 contains 0; "C38H
closes the gap" means its median Δ CI against 3 Flash contains 0. It lands:
- **Latin: the "model" branch.** C38L-rep's median-Δ CI against stored C38 is [−0.001, 0.000], which contains 0. C38H
  stays behind 3 Flash at +0.004 [+0.001, +0.008].
- **Early English: the "route/effort" branch.** C38L-rep's CI is [−0.213, 0.000], which contains 0. C38H against 3
  Flash is 0.000 [0.000, +0.001].

The rule's "reproduces" leg is too weak for this data. The difference between the runs sits in a tail of failed
replies (CER 0.5–1.0 on 10–30 % of pages). A paired **median** cannot see that tail, because most pages are ties or
near-ties. On the same pages:
- the **mean** Δ of C38L-rep against stored C38 is **−0.164 [−0.238, −0.100] on Latin**, and −0.116 on Early English;
- the sign test gives p 0.04 and p 0.01;
- pages above 0.5 CER fall from 26 to 3 on Latin, and from 13 to 5 on Early English.

**A second read at the same model and the same level did not reproduce the stored one.** Of the rule's three branches,
the data fit **"route noise"** best, even though the median leg says otherwise. I report both. The headline below
follows the evidence, not the letter of the rule.

### What is left once the route's failures are set aside (sensitivity, not the rule)

Each CLI arm on its **clean** replies only, against 3 Flash and lite on the same pages:

| panel | arm | n clean | median CER | vs 3 Flash: W/L/T, median Δ [95 %] | vs lite: median Δ [95 %] |
|---|---|---|---|---|---|
| Latin | C38H | 125 | 0.064 | 36/67/22, +0.002 [0.000, +0.005] | −0.002 [−0.003, −0.001] |
| Latin | C38L-rep | 137 | 0.064 | 27/83/27, +0.002 [+0.001, +0.006] | 0.000 [−0.001, 0] |
| Latin | C38 stored | 114 | 0.073 | 29/70/15, +0.004 [+0.001, +0.010] | 0.000 [−0.002, +0.002] |
| Early English | C38H | 30 | 0.029 | 12/2/16, 0.000 [−0.001, 0.000] (mean −0.003) | −0.015 [−0.030, −0.002] |
| Early English | C38L-rep | 35 | 0.029 | 14/2/19, 0.000 [−0.001, 0.000] (mean −0.001) | −0.006 [−0.028, −0.002] |

- **Early English:** on its clean replies, 3.8 Flash through the CLI reads **as well as 3 Flash or slightly better**,
  at both levels. It beats lite.
- **Latin:** a small residual gap remains, **+0.002 CER behind 3 Flash at both levels**. That is about 2 characters per
  1,000. Effort does not move it. Without an API read of 3.8 Flash (paid, ruled out), I cannot say whether it belongs
  to the model or to the CLI's own sampling settings.
- The "clean" set is chosen by the arm's own output, so this comparison favours the CLI arms. It is a bound, not a
  chart number.

### Early English: three pages where stored C38 scores badly, read against the page image (read-from-image)

| page | what the page is (read from the image) | stored C38's reply | CER: C38 / rep / high / 3 Flash |
|---|---|---|---|
| `ed-6a3d29e1af872ba37a51ab17-p22`, *A Sermon Preached before the King* (1670) p. 24 | Clean roman text with long s, 23 lines, margin "Cap. 11." | **Doubled.** All 23 lines are transcribed correctly with long s kept, and then the whole reply repeats verbatim. Nothing is misread; the reply is twice the page. | 0.977 / 0.071 / 1.0 (empty) / 0.071 |
| `ed-6991d6778c1030b12444b4d4-p43`, *The Wonders of Gods Creation Manifested* (1695) p. 35 | 25 lines, long s throughout, italic question "What kind of Cloathing this Royal Birth must have?" | **Modernised copy, then a faithful copy.** First a version with modern s ("the state of their … sustenance"), which stops after line 13 ("any strange"). Then a second, faithful version with long s, to the end of the page ("I An-"). The modernised spelling and the truncation sit in the first copy. | 0.575 / 0.046 / 0.046 / 0.046 |
| `ed-69905cfcaaa7f10ed4cfd289-p588`, Cavendish, *The Description of a New World* (1666) p. 94 | 28 lines of roman with long s and italic names (Duke of Savoy, Florence, Lorraine) | **Prose refusal after 4 lines.** It transcribes the running head and 4 lines (silently modernising long s), then: "I am unable to provide a verbatim transcription of this text. However, I can offer a broad summary…", followed by a summary of the dialogue. The text is from 1666 and in the public domain. | 0.647 / 0.025 / 0.024 / 0.024 |

- **No preamble.** The three shapes are a doubled reply, a modernised partial copy before the faithful one, and a
  recitation-style refusal partway through. The other 10 Early English reads above 0.5 CER are 7 more prose refusals,
  1 safety-filter cut, 1 empty, and 1 the classifier calls clean (`ed-69bf60fd065df5d87d778bb3-p153`, 0.51; not read
  by eye).
- **None of the three is a misreading.** The fresh low read gets all three right at 3 Flash's CER. The high read gets
  two of them right. On p22 it returned nothing: after the nudge it asked for a command again.

**A possible contributor I cannot separate:** the `agy` binary was replaced, 1.3.1 → 1.3.2, at 2026-10-08 22:41Z.
That was in the middle of the stored C38 run.
- **All 44** stored Early English reads were made **before** the update (22:26–22:41Z). The plan notes (8 of 44) and
  most prose refusals sit there.
- All 143 stored Latin reads were made **after** it, and still had 15 prose refusals, against 1 in today's repeat.
- So the CLI version may explain part of the English gap. It cannot explain the Latin one, which is run-to-run.

### The chart (`src/data/ocr-pareto.json`)

- **C38H is added to Latin print and Early English print.** It read both whole sets; an empty read counts as read at
  CER 1.0, so the shared-page rule holds. It is also on Latin's 28-page most-engines panel. It is not on the frontier
  on either chart.
  - Latin: accuracy 0.928, at $3.47 per 1K.
  - Early English: 0.958, at $3.43 per 1K.
  - Those x values are 3.8 Flash's list price with **thinking not counted**. At "high", the real API cost would be
    higher.
- **C38L-rep is not charted.** It is a noise floor, as preregistered.
- **New note under the Latin and Early English most-pages panels.** It says that a second read at the same low level
  had a median error of 6.6 % / 3.9 %, against 8.3 % / 17.7 % for the plotted read. Most of the difference is failed
  replies that vary from run to run, so the gap between the CLI points and 3 Flash measures those failures more than
  the model's reading.
- The plotted C38 point stays as preregistered (the first read). **This is new public copy**, so the PR is
  `tier:hold`.
- Checks:
  - `build-ocr-pareto.mjs --check` passes, and the Pareto tests pass (19/19).
  - Every stored engine's page CER, refusal, empty, loop and `invention_ref` reproduces on the re-scored strata: 5,438
    page × engine pairs, 0 differ.

### Verdict

**The route, not the model, and not the effort level.**
- Most of 3.8 Flash CLI's gap to 3 Flash on these two charts is failed replies through the CLI: prose refusals of
  public-domain text, plan notes, doubled and empty replies. Their number changes a lot from one run to the next. A
  second read at the same "low" level brought Latin from 0.083 to 0.066 and Early English from 0.177 to 0.039.
- Raising the effort to "high" does not help. It trades prose refusals for empty replies (32 of 191).
- On clean replies, 3.8 Flash ties 3 Flash on Early English. It is 0.002 CER behind on Latin at both levels.

### What this decides

Nothing in production. For whoever next reads a CLI point on these charts:
1. **One CLI read is not a stable measure of the model.** Treat a CLI point as model plus route, with a run-to-run
   spread at least as large as the gaps between Gemini tiers here.
2. **"high" is not a fix for the CLI route.** Every page takes two calls, because every page is nudged, and 17 % of
   pages still come back empty.
3. **The detector Amendment 2 asked for** (prose refusals, empties, plan notes) should also catch **doubled replies**.
   Any CLI OCR written to pages needs it first.

**Files:**
- `results/ocr-pareto-6293/cli-effort.json`: every number above. It is reproducible from `cli-effort-rows.json` with
  `ocr-pareto-6293/analyze-cli-effort.py`.
- `outputs-` and `meter-gemini-3.8-flash-high+antigravity-cli.jsonl` and `…+antigravity-cli-rep.jsonl`.
- `cli-cost-gemini-3.8-flash-high.json`.
- `scored/` for `eebo-tcp-5488`, `latin-period-5126`, `ref-ws` and `ref-pinned`, re-scored with C38H.
- `scripts/eval/run-cli-arm.py`: new `--print-timeout`.
- `build-ocr-pareto.mjs`: the high tier and the repeat note.
- `cli-cost.mjs`: new `--effort`.

The raw CLI rows are on the box: `/mnt/HC_Volume_105839809/jobs/cli-effort-6293/pareto/`.

**Spend.** $0: CLI on the subscription, no API call, no database write.
