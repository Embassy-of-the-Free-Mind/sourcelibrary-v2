# #6361 — Tengyur Pramāṇa + Madhyamaka re-translation through the Gemini CLI

PRIOR ART: `scripts/batch/cli-translate.mjs` is the CLI read → apply writer this run would apply through (step 4); these
files are the run's own stage-1 driver (kept as it ran) and the stage-2 gates that come before any write.

| file | what |
|---|---|
| `stage1/build-prompts.mjs`, `stage1/scope.json` | scope (37 volumes, 23,629 pages) and the v13 one-page prompts |
| `stage1/driver.mjs`, `start-driver.sh`, `watchdog.sh`, `scope-fix.mjs` | the `agy -p` loop under tmux, as run 2026-10-09 → 10 |
| `integrity.mjs` | step 1: manifest ↔ files ↔ sha256s |
| `snapshot-stored.mjs` | the stored OCR + English of every in-scope page before stage 2 (read-only) |
| `gates.mjs` | step 2: detectors, plan-mode replies, length ratio, the write door's predicates |
| `draw-byeye.mjs` | step 3: the seeded draw and the per-page packets (method `retranslation-gate` v1) |
| `results/` | integrity.json (hashes and counts), gates.json, not-applicable.tsv (page ids + reasons), byeye/ |

The raw run directory (prompts, every `agy` JSON, manifest.jsonl, failures.jsonl) is on R2 at
`sl-corpus-snapshots/runs/tengyur-cli-6361/` (58,062 objects; manifest.jsonl sha256 in `results/integrity.json`).

**State, 2026-10-10:** stage 2 STOPPED at the by-eye gate (2 of 7 volumes with a serious error the stored English
lacks). Nothing was written to pages. See `scripts/eval/experiments/2026-10-10-tengyur-cli-retranslation-gate-6361.md`.
