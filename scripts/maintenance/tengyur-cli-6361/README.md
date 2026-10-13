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
| `apply.mjs` | step 4: writes the 17,135 gate-passing pages through `writePageTranslation` (every page's `engine.run.entry_script` names this file) |
| `record-checks.mjs` | the 7 `book_checks` rows (retranslation-gate v1) against the now-stored English |
| `rerun-sample.mjs` | item 3: 100 not-applicable pages re-run in three arms (same call / no plan mode / plan mode + suffix) |
| `results/` | integrity.json (hashes and counts), gates.json, not-applicable.tsv (page ids + reasons), byeye/ |

The raw run directory (prompts, every `agy` JSON, manifest.jsonl, failures.jsonl) is on R2 at
`sl-corpus-snapshots/runs/tengyur-cli-6361/` (58,062 objects; manifest.jsonl sha256 in `results/integrity.json`).

**State, 2026-10-10 (evening):** Derek waived the per-volume by-eye stop rule (Decision Deck, 2026-10-10). Step 4
applied all 17,135 gate-passing pages (0 skipped; `results/apply/summary.json`, log on R2 `runs/tengyur-cli-6361/stage2/`),
and 7 `book_checks` rows are written (193 and 183 `fix`, 98 `caveat`, 101/112/174/175 `show`). The 6,494 not-applicable
pages keep their stored English pending a decision on the re-run arms
(`scripts/eval/experiments/2026-10-10-tengyur-cli-plan-mode-rerun-6361.md`). Not done: step 5, the closing #6321 judge
measure. Holds on the 37 volumes are unchanged.
