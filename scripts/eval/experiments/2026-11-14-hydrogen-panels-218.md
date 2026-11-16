---
stage: ocr
measure: accuracy
languages: [la, en, de, el, zh, hy, syc]
scripts: [Latn, Grek, Hani, Armn, Syrc]
canons: []
n_books: null
n_pages: 661
verdict: "Gemini 4 Hydrogen low (agy) reads the wave-2 panels about as well as Gemini 3.8 Flash on the same CLI: Latin 0.942 [0.932, 0.951] against 0.938, Greek 0.936 against 0.934, English 0.968 against 0.967. Every set's leader is inside its interval except Armenian (5 pages) and Syriac, where it reads 0.332 against the leader's 0.624. Chinese manuscript reads 0.810 against PaddleOCR-VL's 0.820. Hydrogen medium was no better than low on the four sets it reached (Latin 0.938, English 0.968, Greek 0.927 on 49 pages)."
status: informational
decision: "None: a measurement. No chart point: /quality/pareto reads the ocr-pareto-6293 sets, which this run did not read. 14 low and 7 medium reads were agy tool-denial stubs, counted as failed. #218."
feeds: none
defect_rates: "none — CER against typed references; failed reads counted, not scored (#6523 rule)"
superseded_by: null
issue: 218
---
<!-- PRIOR ART: 2026-10-14-gemini-4-argon-low-hard-panels-6707.md and 2026-10-12-failed-reads-unscored-6523.md (the runner, the request, the failed/unaligned rules), 2026-11-13-deepseek-v4-1-flash-vision-ocr-224.md (the eight-set panel.mjs this reuses, with PANEL_* env vars added; unset, #224's run is unchanged). The judged router-cell half of #218 is 2026-11-14-hydrogen-paired-run-218.md. -->
## 2026-11-14 · Where does Gemini 4 Hydrogen sit beside the engines already scored on the sealed panels? (#218)

- **Question.** Hydrogen is new on agy. On the wave-2 panels, where 38 engines are already scored against typed references,
  is it level with Gemini 3.8 Flash (CLI), Gemini 4 Argon low (CLI) and each set's leader?
- **Answer.** Hydrogen low is level with 3.8 Flash on Latin, English, other Latin-script and Greek. It is ahead of 3.8 Flash on
  Syriac (paired interval excludes zero) and wins more Chinese manuscript pages (121 to 59), though that median gap's
  interval reaches zero. It is not distinguishable from any set's leader except on Syriac,
  where it is far behind, and on Armenian, which has only 5 pages. Medium buys nothing measurable over low.

### Design

- **Pages.** `/root/engine-wave2-6011/sets.json`, eight sets. Each Hydrogen tier had **661 pages** to read: the pages wave 2
  read, not the 919 in the eight sets, because wave 1 had already read the rest.
- **Arms.**
  - `gemini-4-hydrogen-low` and `gemini-4-hydrogen-medium` through agy, on `AGY_HOME=/root/.agy-james` (the one-night
    exception; times in the paired-run file).
  - The same request as "Gemini 3.8 Flash (CLI)" and "Gemini 4 Argon low (CLI)": the same prompt and the same image
    handling, one page per call (`build-requests.py`).
  - Low read all 661 pages. Medium read the sets in the order latin, latin-script-other, english, greek and stopped at the
    call budget, 73 of Greek's 127 pages in. **Medium never reached chinese-print, chinese-manuscript, armenian or syriac, or
    the rest of Greek.**
- **Scorer.** Unchanged: `benchmark-score.mjs`, and for Syriac the PAGE-XML ground-truth scorer
  (`syriac-score-h.py`, the #224 copy).
- **Rules.** As in #6523:
  - A failed read is counted and not scored.
  - An unaligned read is scored as a 100% error.
  - Engines are compared on shared pages only.
  - Accuracy = 1 − median CER, with a page-bootstrap interval (B = 2,000).
- **Tool-denial stubs.** On 14 low reads and 7 medium reads, agy denied the model's `read_file` call, and the model wrote
  "Unable to read image…" instead of a transcription.
  - `blank-toolfail.py` marks these as failed reads before import. Without it, `import-cli-arm.py` would score them as text.
  - They were not re-run, because the call budget was used up.
- **Recitation cuts.** 2 low reads were cut short by the recitation filter (an EEBO page and an Armenian page). They are
  scored as partial reads, as `import-cli-arm` scores a filter cut.

### Result by set, Hydrogen low (accuracy, shared pages)

The paired column, Hydrogen vs 3.8 CLI, gives the pages where Hydrogen's CER is lower or higher, and the median CER
difference with its interval. A negative difference means Hydrogen is better.

| set | shared / set | Hydrogen low [95% CI] | n | failed | 3.8 Flash CLI [CI], n | Hydrogen vs 3.8 CLI: pages better / worse, median ΔCER [CI] | Argon low CLI, n | set leader [CI] |
|---|---|---|---|---|---|---|---|---|
| latin | 145/158 | 0.942 [0.932, 0.951] | 136 | 9 | 0.938 [0.925, 0.950], 137 | 58 / 31, 0 [−0.001, 0] | — | Gemini 3 Flash 0.947 [0.937, 0.955] |
| english | 43/44 | 0.968 [0.957, 0.973] | 42 | 1 | 0.967 [0.957, 0.973], 42 | 17 / 8, 0 [−0.001, 0] | — | Sonnet 0.968 [0.957, 0.972] |
| latin-script-other | 23/23 | 0.998 [0.996, 1.000] | 20 | 3 | 0.998 [0.996, 0.999], 16 | 5 / 5, 0 | — | Gemini 3 Flash 0.998 [0.996, 1.000] |
| greek | 86/127 | 0.936 [0.923, 0.950] | 85 | 1 | 0.934 [0.919, 0.952], 75 | 44 / 17, −0.001 [−0.005, 0] | 0.922, 67 (H 25 / 34) | Gemini 3.7 Flash CLI 0.935 [0.922, 0.948] |
| chinese-manuscript | 245/503 | 0.810 [0.789, 0.827] | 245 | 0 | 0.797 [0.769, 0.820], 229 | 121 / 59, −0.005 [−0.006, 0] | 0.817, 63 (H 19 / 26) | PaddleOCR-VL 1.6 0.820 [0.797, 0.836] |
| chinese-print | 19/19 | 0.753 [0.636, 0.855] | 19 | 0 | 0.827, 11 (5 / 4) | — | 0.843, 12 (H 2 / 5) | Gemini 3 Flash 0.753 [0.636, 0.886] |
| armenian | 5/5 | 0.973 [0.752, 0.995] | 5 | 0 | 0.983, 4 (2 / 2) | — | — | Gemini 3 Flash 0.993 [0.961, 0.996] |
| syriac | 40/40 | 0.332 [0.314, 0.354] | 40 | 0 | 0.282 [0.221, 0.316], 40 | 31 / 9, −0.057 [−0.100, −0.035] | 0.358, 40 (H 18 / 22) | Sophro (default seg) 0.624 [0.432, 0.732] |

No read was unaligned. On Chinese print and Armenian, the 3.8 CLI and Argon figures cover only 4–12 pages each, so their
headline accuracies are not on the same pages as Hydrogen's. Read only the paired counts there. The Syriac leader is a
trained HTR model, and every Gemini engine is far behind it.

### Hydrogen medium (the sets it reached)

| set | Hydrogen medium [95% CI] | n | failed | vs 3.8 CLI: pages better / worse | vs Hydrogen low: pages better / worse |
|---|---|---|---|---|---|
| latin | 0.938 [0.930, 0.949] | 142 | 3 | 54 / 31 | 33 / 32 |
| english | 0.968 [0.957, 0.973] | 41 | 2 | 16 / 7 | 10 / 4 |
| latin-script-other | 0.998 [0.996, 1.000] | 22 | 1 | 6 / 5 | — |
| greek (73 of 127 read) | 0.927 [0.913, 0.942] | 49 | 0 | 27 / 10 | 16 / 26, ΔCER +0.002 [0, 0.003] |

On Greek, medium is slightly worse than low on the same 49 pages. A medium call costs about 6 times a low call in quota
(0.0064 vs 0.001 of a weekly point, from the smoke) and takes 2–3 times as long. On these panels it is not worth that.

### By eye (read by the job session with the page image open)

The three worst Hydrogen-low pages by CER are not misreads:
- An EEBO page cut by the recitation filter after three lines.
- A Kircher index page and a Chinese manuscript page where every engine scores about 0.50: the reference covers a
  different span from the page.

Notes: `scripts/eval/results/hydrogen-panels-218/by-eye/by-eye.md`.

### Artifacts

All in `scripts/eval/results/hydrogen-panels-218/panels/`:
- `H4L/` and `H4M/`: `panel.json`, `perpage.json` and `table.txt` for each tier.
- The outputs and meter JSONL for both tiers.
- `requests-manifest.json`.
- The raw agy records, gzipped.
- `quota-*.json`, the `/quota` reads.
