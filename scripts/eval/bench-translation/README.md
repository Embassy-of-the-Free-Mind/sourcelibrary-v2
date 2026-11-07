<!-- PRIOR ART: scripts/eval/translation-vs-reference/ (the #5695 harness: records, judge prompt, controls), scripts/eval/plain-6728/ (PLAIN arm, body rule, cross-family CLI judges), scripts/eval/pareto-6182/ (load-xl.mjs panel loader, run-arms.mjs Batch runner). This directory composes them into one standing benchmark and adds nothing they already do. -->
# bench-translation — the standing translation benchmark (#7499)

**Who reads the result:** Derek and the router (#7263), deciding per engine × language group which translation prompt
new pages get. **What it answers:** is a candidate prompt (a fix, a simplification, an addition) no worse, or better,
than the live default on pages that have a published human translation? **Measure:** `judged_vs_reference`
(eval-design §2): blind cross-family judges, the published translation as a guide to meaning, controls that gate.

## The panel (frozen)

`manifest.json`: 365 pages, **one page per book**, every page of the #5695 / #5873 reference tracks whose reference
text is on the job boxes (`pareto-6182/load-xl.mjs`). Per page: id, link, language, group, print / manuscript,
century, `ocr_sha16` (the exact transcription translated), `ref_sha16`, the reference's title, translator, licence and
style, and whether it is in the #6545 sub-panel (132 pages) or the #6728 noise-floor set (50). No text is committed;
the reference texts stay on the box (some are in copyright, #5488).

| group | pages | of which #6545 |
|---|---|---|
| latin | 71 | 0 |
| greek | 69 | 25 |
| vernacular (de 22, fr 14, it 10, nl 7, es 6) | 59 | 0 |
| sanskrit-pali | 60 | 30 |
| hebrew-aramaic | 34 | 29 |
| chinese | 25 | 25 |
| arabic | 24 | 0 |
| persian | 23 | 23 |

`build.mjs --check` rebuilds the panel from current data and exits 1 if any page's OCR or reference hash has drifted.
A drifted page is replaced only by a new manifest version, never silently.

## Run it

```
node scripts/eval/pareto-6182/load-xl.mjs --out $JOB_SCRATCH/xl --summary $JOB_SCRATCH/xl/summary.json
E="node --env-file=/root/sourcelibrary/.env.production.local"
$E scripts/eval/bench-translation/build.mjs                         # requests for every arm (private, $W/req)
$E scripts/eval/bench-translation/run.mjs --engine lite --arm v20     # Batch submit; then --collect
$E scripts/eval/bench-translation/run.mjs --engine flash38 --arm v20  # agy -p only
$E scripts/eval/bench-translation/run.mjs --engine opus --arm v20     # sealed claude -p only (--batch 2: other pages)
node scripts/eval/bench-translation/bodies.mjs                        # one body rule for every arm
python3 scripts/eval/bench-translation/build-packet.py lite           # per engine; controls added once
$E scripts/eval/bench-translation/run.mjs --judge lite                # cross-family judge, one item per call
python3 scripts/eval/bench-translation/score.py [--look 1]            # results/bench-translation-7499/
```

A new arm is a new entry in `prompts.mjs` (anchored edits to the live text, each found exactly once) and in
`build.mjs` `PLAN`. Arms: `v13` (live default, as production composes it: `buildTranslationPrompt` +
`PAGE_BREAK_SCOPED`, the stored previous page as seed, neighbours' OCR; CLI lanes add agy-cli `TRANSLATE_SUFFIX`),
`v13b` (v13's request again: the A-vs-A floor), `v20`, `plain`. Kept reads: the CLI runners resume per page; the lite
runner never resubmits a collected page.

## Engines, channels, judges

| engine | channel | judge |
|---|---|---|
| lite `gemini-3.1-flash-lite` | paid API, Batch (`pareto-6182/run-arms.mjs`: temperature 1.0, thinking 0, cap) | Opus, `claude -p` |
| 3.8 Flash low | `agy -p` only (agy-cli `gatedTextCall`) | Opus, `claude -p` |
| Opus | sealed `claude -p` only, one page per call | `gemini-3.8-flash-high`, `agy -p` (same-family Opus only if agy is locked, and said) |

One judge item per page per engine holds all that engine's arms for the page, labels shuffled
(`pro-translate-6545/JUDGE-PROMPT-PRO.md`). Candidates are **bodies** (`plain-6728/prompts.mjs bodyOf`): notes,
summary, keywords, meta, warnings and image descriptions removed with their content in every arm; other tags
unwrapped. So the benchmark measures *the translation as text* (what search, quotes, exports and embeddings read).

**Controls, per engine:** a planted meaning error in the v13 body of 2 pages per group; 4 wrong-page items; 4
duplicate items. The gate: plants located at their span ≥ 80%, every wrong page ≤ 2, duplicates equal in ≥ 3 of 4.

## Floors (A-vs-A, v13 twice)

Per engine, on the floor pages (lite: all 365; Flash and Opus: the 50 #6728 floor pages). `scores.json`
`engines.<e>.floor`: the fidelity difference v13b − v13 with its interval, and the reversal-page discordance
`d_floor_rev` that the reversal guard uses. The floors measured in this run are in the experiment file.

## Decision rules

Fixed in `../PREREGISTRATION-bench-translation-7499.md` before the first judge call; restated here because they are
the benchmark's standing rules (eval-design §10.2, card 3).

- **A fix or a simplification passes on non-inferiority:** the lower 95% bound of (arm − v13) fidelity > **−0.15**, and
  reversal pages rise by no more than the floor allows (`max(1, round(n × d_floor_rev))`).
- **An addition** (a new instruction, a new output) **needs superiority beyond the floor:** the 95% interval excludes 0,
  the point estimate lies outside the A-vs-A interval, and it is ≥ 0.25.
- **Inferior:** the upper bound < 0, or the reversal guard fails with a point estimate ≤ 0. **Otherwise inconclusive.**
- **Sequential batches.** Look 1 decides only under 99% intervals; a second batch on new pages gives the final look at
  95%. A cell that is still inconclusive is reported as test-next with the n that would resolve it; nobody tops up
  after seeing a near-miss without a new registration.
- **Cells and grades.** Engine × language group; Persian is always its own group. Books < 30 exploratory, ≥ 30
  directional, ≥ 50 decision grade. Pools (all; Latin script; non-Latin) count only with the §10.2 heterogeneity check.
- **Nothing here flips a default.** The output is a per-cell recommendation (keep v13 / switch to v20 / switch to
  PLAIN / test-next); the flip is Derek's decision, made on the router table (#7263).

## Outputs

`scripts/eval/results/bench-translation-7499/`: `scores.json` (cells, pools, floors, gate), `per-page-<engine>.jsonl`
(per page and arm: fidelity, reversal, omission, invention; no text), `key-<engine>.json` (labels → arms, plants).
