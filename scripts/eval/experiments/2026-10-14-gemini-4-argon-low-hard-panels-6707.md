---
stage: ocr
measure: accuracy
languages: [syc, lzh, grc, bo]
scripts: [Syrc, Hani, Grek, Tibt]
canons: []
n_books: null
n_pages: 393
verdict: "Gemini 4 Argon low (CLI) beats 3.8 Flash only on Syriac print (+13 points a page), and is the same on Syriac manuscripts, Chinese manuscripts and print, and Greek. It loses to Kraken on both Syriac panels and to Yigdzin on Tibetan. It ties PaddleOCR-VL on Chinese manuscripts with no failed reads. Its Syriac manuscript failures are canonical-text substitution: the right book, the wrong passage."
status: informational
decision: null
superseded_by: null
issue: [6707, 6293]
---
PRIOR ART: 2026-10-12-cli-ocr-route-fix-6523.md (the CLI route these reads use), 2026-10-07-ocr-engines-full-sets-wave2-6011.md (the Tibetan measure and wave-1 arms), PREREGISTRATION-ocr-pareto-6293.md Amendments 4 and 4.1 (this run's protocol).

## 2026-10-14 · Does Gemini 4 Argon (low, through the CLI) move the needle where our readers fail?

Job `g4-hard2-6707` (Hetzner), 2026-10-14 01:00–02:21Z. Gemini 4 Argon appeared in `agy models` on 2026-10-13. Derek: "Latin and Early English is a lame test" (best engines 0.99 there), so the panels are the six where 3.8 Flash CLI trails the best engine. Every read used `agy -p` on the Google subscription: **$0 billed, no paid API**. The protocol is Amendment 4, as changed by **Amendment 4.1** (`c943d05`, pushed before any read): **G4L only** (`gemini-4-argon-low`, 300 s), because G4H (`-high`) timed out on all 5 smoke pages at 300 s and took 768 s at 900 s. Whether G4H runs is decided from these results. 393 reads, 3 in parallel, in 80 minutes. **No quota events, no timeouts, no retries, no nudges.**

**Design.** The requests are byte for byte those of the stored 3.8 CLI reads (same sealed images, same prompt per stratum), plus the #6523 markers and tool gate. The instruments are unchanged, and each reproduced its committed cells before a G4L cell was scored:

| instrument | stored cells reproduced |
|---|---|
| Syriac manuscript | 120 / 120 |
| Syriac print | 318 / 318 |
| Chinese and Greek | 8,071 / 8,071 (cohort refs unpacked) |
| Tibetan (Opus) | 60 / 60 |

Adding G4L moved no stored CER; one DeepSeek `loop` flag flips, because that flag is relative to the other engines' lengths. Accuracy is 1 − mean capped CER over scored pages, the chart's measure. Under the ONE FAILURE RULE, a failed read is counted and not scored. The paired Δ is the median CER difference (G4L − other; negative = G4L better) on pages both engines answered, with a 2,000-resample bootstrap. Decision rule: the CI excludes 0 **and** |Δ| exceeds the panel's floor (1 pp; 1.8 pp on Syriac print).

**Result.**

| panel | n | G4L | 3.8 Flash CLI | best engine | vs 3.8: Δ [CI], W/L/T | vs best |
|---|---|---|---|---|---|---|
| Syriac manuscript | 40 | 0.337 [0.265, 0.414] | 0.243 | Kraken Sophro 0.590 | −0.059 [−0.121, 0.000], 24/11/2 **same** | +0.305 [+0.213, +0.348] **worse** |
| Syriac print | 20 | 0.720 [0.664, 0.769] | 0.451 | Kraken OmniSyr 0.873 | −0.128 [−0.312, −0.081], 18/0/0 **better** | +0.158 [+0.105, +0.225] **worse** |
| Chinese manuscript | 148 | 0.797 [0.782, 0.812] | 0.770 | PaddleOCR-VL 0.797 | −0.006 [−0.008, 0.000], 79/23/34 **same** | 0.000 [0.000, +0.004] **same** |
| Greek (whole-page) | 109 | 0.877 [0.842, 0.905] | 0.868 | 3.7 Flash CLI 0.906 | −0.003 [−0.006, −0.001], 64/30/7 **same** | −0.001 [−0.005, 0.000] **same** |
| Chinese print | 12 | 0.838 [0.788, 0.884] | 0.828 | Qwen3-VL 8B 0.839 | −0.005 [−0.009, +0.002], 8/3/0 **same** | −0.002 [−0.012, +0.016] **same** |

On Tibetan (60 Kangyur leaves, syllable identity against Derge, by-book CI, reported apart from the CER chart), **G4L 0.912 [0.898, 0.924]**:
- **vs Yigdzin** (served, 0.949): worse, Δ −0.034 [−0.054, −0.020], 18/42.
- **vs Opus 5.5** (0.715): better, +0.177 [+0.110, +0.207], 56/4.
- No page is under 0.5 identity.

Against the secondary comparators (production and 3 Flash):
- **Better than production lite** on Syriac manuscript (−0.143), Chinese manuscript (−0.019) and Chinese print (−0.013).
- **Better than 3 Flash (API)** on Syriac manuscript (−0.099).
- **The same as 3 Flash** everywhere else.

**Route caveat:** the stored 3.8 reads predate #6523, so "vs 3.8" compares route as well as model.

**Failed reads (counted, not scored).**
- **G4L:** Syriac manuscript 3 of 40 and Syriac print 2 of 24, all Gemini's copy filter. Greek 1 of 109, a copy decline in the model's own words. Chinese 0 of 160. Tibetan 0 of 60.
- **3.8 CLI on the same pages:** 12 failed reads on Chinese manuscript and 7 on Greek.

**Calls.**
- **Median seconds per call:** Syriac manuscript 60, Syriac print 44, Tibetan 38, Greek 28, Chinese 20. The stored 3.8 CLI took 23 and 17 on the same Syriac and Chinese pages.
- **Refused tool calls (the #6523 gate):** 30 in 40 Syriac manuscript pages (`run_command` 20, `search_web` 10), 9 in 24 Syriac print, 6 in 109 Greek, 10 in 60 Tibetan, 0 in 160 Chinese. None ended a turn.

**Sensitivities.**
- **Greek:** 5 replies restarted inside the markers (two or three `<<<BEGIN>>>` before one `<<<END>>>`), doubling the text. Those pages score CER 0.55–1.0 against 0.03 for the other engines. On the image the reading itself is right (checked on Aristotle p. 126). Scoring the last restarted block instead gives Greek **0.908**, the best mean on the panel; the paired verdicts do not change.
- **Syriac filter stubs:** scored as returned, which is the chart's own rule for Syriac CLI reads, they give 0.342 (manuscript) and 0.689 (print).

**What the worst pages are** (`read-from-image`, then compared with the reference and a second engine):
- **Syriac manuscript: canonical-text substitution (O3).** On the 5 worst pages (all Jerusalem 36, CER ≥ 1), G4L reads the running head right, then writes fluent Peshitta from another passage of that book:
  - Hebrews 10 for Hebrews 4;
  - Romans 1 for Romans 16;
  - John 14 for John 12;
  - Matthew 6–8 for Matthew 27;
  - Luke 24 running on into John 1.
- **Syriac print: confabulation in the right genre (O1).** Line counts are right and words are swapped. In the Acts of Thomas (Bedjan p. 161), the page's Vizan, Manashar and Mygdonia become Kepha, Nicetas and Aquila. The running head "the fifteenth act" becomes "Acts of the Apostles".
- **Chinese manuscript: not G4L errors.** On its 5 worst pages every engine scores about 0.4. The Kanripo window runs into the neighbouring leaf (226 reference characters for 145 on the page); G4L's reading of the leaf is right apart from one character.
- **Tibetan:** identity divides by the read's length, so it rewards a memorised Derge and ignores omissions. G4L's syllable count is 1.01× Yigdzin's (median), so it omits nothing. On its lowest-identity leaves, 19–32 % of G4L's syllables agree with Yigdzin and not with Derge. There it reads the witness, not Derge. Across all pages, 3.4 % of syllables are Derge-only and 1.2 % leaf-only (Opus: 5.2 % / 2.2 %). This does not separate Yigdzin's own errors from recitation, so it is evidence against wholesale recitation, not proof.

**Chart.** G4L joins `src/data/ocr-pareto.json` on Syriac manuscript, Syriac print, Chinese print, and the Chinese manuscript CLI subsample. It is unplaced: "no API list price; $0 billed on the subscription". It is not added to Greek: the chart's CLI rule needs all 127 Greek chart pages, and the preregistered panel was the 109 that 3.8 had in that family. Tibetan has no CER chart.

**Grade.** Directional on Chinese manuscript (148 pages) and Greek (109); exploratory elsewhere (eval-design §3.1). This is a statement about this route, these pages and this date.

**Replicated?** No. There is no G4L A-vs-A repeat, and G4H has not been read.

**Routing.** No change on this evidence. Kraken stays the Syriac lane and Yigdzin the Tibetan one. On Chinese manuscripts G4L ties PaddleOCR-VL, but it would run through a CLI with no price.

**Artifacts.**
- `scripts/eval/g4-hard-6707/`: runner and scorers.
- `scripts/eval/results/g4-hard-6707/`: per-panel results, call stats, the Tibetan scores and recitation check, and the Syriac/Tibetan raw replies.
- `results/ocr-pareto-6293/{outputs,meter}-gemini-4-argon-low+antigravity-cli.jsonl` and `scored/*-2026-10-14.json`.
- `results/ocr-pareto-6293/syriac-gt-score.json` and `results/syriac-pareto-6295/ocr-{score,summary}.json`, each with the G4L arm added.
