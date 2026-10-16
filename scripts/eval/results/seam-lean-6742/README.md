# seam-lean-6742 — results (#6742)

Write-up: `scripts/eval/experiments/2026-10-16-seam-repair-lean-6742.md`. Scripts: `scripts/maintenance/seam-repair-6742/`
(`rules.mjs`, `score-rules.mjs`, `gemini-repair.mjs`, `lean.mjs`; the pilot's `seam-repair.mjs` is reused).

| file | what |
|---|---|
| `rules-vs-opus.json` | Test A: the model-free echo and dup8 rules against Opus's labels and repairs on the pilot's 500 tranche joins |
| `rules-vs-opus.jsonl.gz` | Test A, one row per join × signal: the rule's repair or decline, the Opus label, the two repaired joins (≤ 200 chars each side) |
| `test-b/test-b.json` | Test B: Gemini 3.8 Flash low (agy) vs Opus as repairer on the #6742 300-junction set, per arm and stratum |
| `test-b/repair-gemini.jsonl.gz` | Gemini's label + minimal repair per junction (the Opus arm is `../seams-6742/labels.jsonl.gz`) |
| `test-b/verify-{gemini,opus}.jsonl.gz` | the pilot's blind Opus judge, both orders, 10 pairs per call, with A/A pairs |
| `test-b/calls.jsonl.gz` | every call: agy tokens (input / output / thinking) and the judge's list-price equivalent (not billed) |
| `dry-run/runs.jsonl`, `writes.jsonl` | the 2,000-join dry run's tally, and its write plan re-run after the structure guard (`lean.mjs write`) |
| `dry-run/candidates.jsonl.gz` | the 2,000 joins (excerpts stripped; book, pages, hashes, signals, readership rank, rule repairs) |
| `dry-run/repairs.jsonl.gz`, `verify.jsonl.gz`, `apply-refusals.jsonl.gz`, `calls.jsonl.gz` | Gemini repairs, the 7% blind sample, store refusals, every call |
| `dry-run/readership.json`, `books-done.jsonl` | the readership instrument and the 43 books walked, most-read first |
| `dry-run/not-a-translation-flags.json` | 59 joins Gemini called "not a translation of its source": unverified leads for a containment check |
| `dry-run/opus-fallback/` | the Opus 30-joins-per-call fallback on 60 of the same joins |

Re-score Test A: `score-rules.mjs rebuild --out=DIR` (Mongo reads), then `score-rules.mjs score --out=DIR`.
Re-score Test B: `gemini-repair.mjs stage --out=DIR`, unpack `test-b/*.gz` into DIR, `gemini-repair.mjs score --out=DIR`.
