# translation-prompt-v17-2026-10 (#5698)

Prompt v13 (run twice) against v17-study and v17-reading on 40 reference pages plus 8 gallery-pool pages.
Write-up: `scripts/eval/experiments/2026-10-04-translation-prompt-v17-typed-notes-5698.md`.
Rule: `scripts/eval/PREREGISTRATION-translation-prompt-v17.md`. Scripts: `scripts/eval/translation-prompt-v17/`.

| file | what |
|---|---|
| `sample.jsonl` | the pinned draw: 40 `main` + 8 `gallery-pool` pages, with source text, public reference text and licence |
| `records.jsonl` | the same pages in harness shape, with the four arms as candidates |
| `arms.jsonl` | 192 model outputs (page × arm): text, model, tokens, cost, prompt row |
| `arms-exploratory-fix.jsonl`, `exploratory-fix.json` | the follow-up arm run after unblinding (study + three lines); mechanical only |
| `mechanical.json` | string checks per page and arm, paired CIs against v13-a, the v13-b floor |
| `dimension-verdicts.jsonl`, `dimension-key.json` | one blind Opus judge: five dimensions, note audit, alternatives, undisclosed choices |
| `results-fidelity.json`, `fidelity-verdicts-j{1,2}.jsonl`, `fidelity-key.json` | the #5695 harness, two blind Opus judges; controls and gate inside |
| `note-fact-verdicts.jsonl` | 135 notes + 8 seeded false ones, one Opus judge (`seed: true` rows are ours, not the model's) |
| `results.json` | everything joined, with the preregistered verdicts |
| `gallery.md` | six pages, the same passage under every arm |

Measures: dimension scores are agreement with a rubric (one judge); fidelity is judged against a human reference
(two judges); the mechanical rows are exact counts. None is accuracy in the eval-design §2 sense.

To rebuild from the working directory (not committed): `score.mjs --pack`, `score.mjs`, `report.mjs`, `gallery.mjs`.
