# Non-canonical OCR eval — continuation runbook (2026-07-19)

Context: #3235 / PRs #3253 #3255 #3256 #3257. Paper plan: `.claude/docs/ocr-memorization-paper.md`
(read it first — claims, outcome battery, verified related-work dossier, scoop watchlist).
Worktree: `.claude/worktrees/noncanon-eval` on branch `feat/ws1-pages` (12 new pinned pages
committed; sweep outputs deliberately NOT committed mid-run).

## In flight at handoff time (check before doing anything)

1. **12-page model sweep** (detached nohup, ~$2.73 authorized): appends to
   `scripts/eval/results/scorecard-outputs-2026-07-19.jsonl`. Complete when the file
   reaches **469 lines** (baseline 325 + 144). Log:
   `<scratchpad>/sweep-ws1.log`. If it died early: count per-work outputs (12 per work
   = complete), strip partial works' lines, rerun those slugs only via
   `qa-eval.mjs scorecard --only=<slug-rx> --models=pro,flash,lite,sonnet5 --runs=3`
   (foreground per page ≈5 min; background Bash tasks get killed — use nohup).
2. **5K revision-agreement pilot** (detached, free): overwrites
   `scripts/eval/results/revision-agreement-pilot-2026-07-19.json` when done. Log:
   `<scratchpad>/pilot-5k.log`.

## UPDATE (late 2026-07-19): a detached experiment driver is running

`<scratchpad>/flashlite-experiments.sh` (log: `<scratchpad>/flashlite-experiments.log`,
scratchpad = /private/tmp/claude-501/-Users-dereklomas-sourcelibrary/c9dbb822-0ebc-4e99-a577-df4592530f19/scratchpad)
waits for the sweep (469 lines) then runs, sequentially: German bare baseline
(flash+lite ×3), Mistral non-canonical, resolution ablation (6 pages × widths
2000/1000/600 × flash+lite ×2 — outputs tagged `@wN` on the model field), and the
prompt ablation (production Standard OCR v15 prompt vs bare, all 40 pages ×
flash+lite ×3 — tagged `@annotated`). ~$2 total, Derek-approved. It ends by
rebuilding observations and writing final-gap-report.txt + final-recommendations.txt
to the scratchpad. **KNOWN DATA LOSS (2026-07-19 ~15:15): a `git reset --hard` destroyed ~64 uncommitted
sweep-output lines** (≈$1.20 of paid calls) while the sweep was mid-run, so the file will
top out around ~404 lines, NOT 469, and the driver will proceed when the sweep process
exits. Recovery (now mandatory): after the driver finishes, count outputs per work
(12 per work = complete), strip partial works' lines, rerun ONLY those slugs with
pro,flash,lite,sonnet5 ×3 (~$1.20). Do this BEFORE the v0.2 export. **Check its log FIRST**: if "ALL DONE", skip straight to
committing + analysis below (rebuild already done); if it died mid-arm, the per-arm
`--only`/`--tag`/`--width` commands in the script are re-runnable individually.
New analysis to run on the arms: resolution curves (accuracy vs @w600/@w1000/@w2000/native
per page × model) and the prompt-ablation delta (@annotated vs bare per page × model)
— add both to the paper doc's Results.

## Then, in order (mechanical — good Opus work)

1. `set -a; source .env.production.local; set +a; node scripts/eval/build-observations.mjs`
   → expect ~640 rows (35 pages).
2. `node scripts/eval/report-canonical-gap.mjs` → update the paper doc's Results section
   (gap table, outcome battery, same-book contrasts — now 5 same-language contrast sets).
3. `node scripts/eval/export-eval-dataset.mjs --version=v0.2` → commit dataset dir. Run this AFTER the experiment driver finishes so the ablation arms are included in runs.jsonl.
4. Commit `scorecard-outputs-2026-07-19.jsonl` + observations + pilot json + dataset
   v0.2 on this branch, PR, merge (scripts+data only; DCO signoff:
   `Signed-off-by: JDerekLomas <j.d.lomas@tudelft.nl>`).
5. `node scripts/eval/recommend-experiments.mjs` → paste output into #3235 as the
   standing "next paid runs" queue.

## Paid experiments queue (Derek approves spend; estimates from the recommender)

- P1 gap-hole: mistral non-canonical sweep ($0.28)
- P1 resolution ablation: 6 pages × 4 widths × 4 models ×2 ($3.63) — needs a tiny
  harness addition: scorecard needs a `--width=` image-resize option (sharp resize
  before sending; record width in the outputs line).
- P2 prompt ablation ($1.57), truncation 2×-maxTokens probes ($0.69/$3.44),
  regression-verify (free audit first).

## Division of labor now that Fable is low

- **Opus sessions**: everything under "Then, in order" (mechanical, verifiable);
  the full 126K-pair revision-agreement run (extend pilot with --sample=all +
  batched lookups); resolution-ablation harness + run; blog-post first draft FROM
  the paper doc (the doc has the claims and numbers; keep the writing rules —
  quote via get_quote only, no em-dashes in editorial voice, validate links).
- **Sonnet subagents** (via Agent tool from any session): page hunting for new
  languages (German/DTA is next: pilot shows German revision pairs with no anchors),
  reference extraction + guard verification (the ws1 agent brief in this session's
  transcript is the template).
- **Keep for a strong model / Derek**: interpreting factor analyses, paper claims,
  novelty positioning, anything touching the scoop-sensitive framing; final wording
  of the blog post; Zenodo/HF publication decision + dataset naming.

## Standing cautions

- Guard tests: `npx vitest run tests/unit/reference-ocr-guard.test.ts` after ANY
  metrics.mjs change (scoring_version stamps rebuilds).
- `pages.ocr` has no history but `page_revisions` DOES (126,551 OCR priors /
  100,992 pages) — don't repeat the "no versions" mistake.
- Recitation protocol for any new pinned page: visual page audit before --write,
  `page_class.canonical_text` + `memorization_risk` mandatory.
- TITUS references: never redistribute text publicly (pointer + sha256 in dataset).
- Sweep-day gotcha: `scorecard-<date>.json` is a latest-run summary that scoped runs
  clobber — scoped runs now save as `scorecard-<rx>-<date>.json`, but check before
  trusting any summary file; raw truth is scorecard-outputs JSONL.
