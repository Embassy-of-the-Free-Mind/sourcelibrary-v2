---
stage: pipeline
measure: none
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Index of eval work rescued from old job worktrees on 2026-10-29: 14 rescue/*-20261029 branches (uncommitted files, not merged) and 177 MB of corpus page-profile outputs in R2 eval-rescue/2026-10-29/. Every experiment record on those branches is already on main; the branches hold the code, packets and raw outputs behind them."
status: informational
decision: "Kept as rescue branches and R2 objects, not merged (#6740 land-evals brief). Land a file from a branch only by a new PR that checks it against main first."
superseded_by: null
issue: [6740]
---
## 2026-10-29 · Rescued eval artifacts: where they are (#6740)
<!-- PRIOR ART: none — this is a finding aid, not a result; searched scripts/eval/experiments/ and scripts/eval/INDEX.md for "rescue" (no index of the rescue branches existed). -->

Old job worktrees on the boxes held eval files that were never committed. On 2026-10-29 they were pushed as
`rescue/<worktree>-20261029` branches (one commit each on top of the worktree's own branch), and the large
outputs that do not belong in git went to R2. **Nothing here is merged.** A file on a rescue branch may be older
than main's copy of the same path; diff against `origin/main` before landing anything.

Every experiment record (`scripts/eval/experiments/*.md`) that the 2026-10-29 branches add is **already on main**.
The branches hold what sits behind those records: code, frozen packets, references and raw outputs.

### Rescue branches (2026-10-29)

`git fetch origin rescue/<name>` and then `git diff --stat origin/main...origin/rescue/<name>`.

| branch | issue | what it holds | records it backs (on main) |
|---|---|---|---|
| `rescue/job-ocr-pareto-6293-20261029` | #6293 | OCR Pareto bench: preregistration, ~1,000 reference files in `scripts/eval/benchmark/refs/` (Chinese cohort #5547 and others) | `2026-10-09-ocr-pareto-*-6293.md` |
| `rescue/job-cli-queue-6293-20261029` | #6293, #6295 | the same bench refs + the CLI queue arms and outputs (1,040 files) | `2026-10-08-syriac-cli-flash-tiers-6295.md`, `2026-10-09-ocr-pareto-gemini-3-8-flash-cli-6293.md` |
| `rescue/job-cli-queue-b-6293-20261029` | #6293, #6295 | second CLI queue worktree: refs + 3.6/3.7/3.8 Flash arm outputs (1,051 files) | `2026-10-09-ocr-pareto-gemini-3-7-3-6-flash-cli-6293.md`, `2026-10-09-ocr-pareto-gemini-3-8-flash-cli-6293.md` |
| `rescue/job-cli-queue-6293-p2-20261029` | #6293 | `scripts/eval/ocr-pareto-6293/` build-bench / run-arms / transport-check, `results/ocr-pareto-6293/pages.json` | as above |
| `rescue/job-embed-integrity-6175-20261029` | #6175 | `scripts/lib/vector-truth.mjs`, `scripts/audit/page-vector-truth.mjs`, `scripts/eval/vector-truth/stores.mjs`, an `embed-gemini.mjs` edit | `2026-10-07-embedding-vector-truth.md` |
| `rescue/job-embed-integrity-6175b-20261029` | #6175 | `vector-truth/e5-enum.mjs`, `recall-stored-vs-fresh.mjs`, `recall-6175.jsonl`; **also edits to `2026-10-07-embedding-vector-truth.md` that main does not have** | `2026-10-07-page-vector-repair-and-drift-recall-6175.md` |
| `rescue/job-embed-next-6173-20261029` | #6173 | `scripts/eval/embed-format/` 100K design, pool builder, batch embed, `gold-100k/` | `2026-10-07-embedding-prefix-100k.md` |
| `rescue/job-fix-shifts-5803-20261029` | #5803 | `scripts/eval/jev/clef-book-offset-map.mjs`, `clef-shift-check.mjs`, two repair scripts in `scripts/maintenance/` (not run from here) | none |
| `rescue/job-paddle-qa-6388-20261029` | #6388 | `scripts/eval/paddle-zh-qa-6388/` draw, controls, Kanripo refs, packet map | none |
| `rescue/job-paddle-qa2-6388-20261029` | #6388 | the same directory, second pass (20 files) | none |
| `rescue/job-paddle-zh-5600c-20261029` | #5600, #5568 | Paddle zh optimisation preregistration, `paddle-zh-5600-optimize.mjs`, `results/paddle-zh-5600/`, `zh-skqs-5568-kanripo.mjs` | none |
| `rescue/job-page-profile-5643-20261029` | #5643 | `quality-covariates.mjs` and the small page-profile outputs (summary, descriptors, gzipped profile) | `2026-10-02-corpus-page-profile-5643.md` |
| `rescue/job-quality-round-1-20261029` | quality round 1 | `scripts/eval/quality-round-1/` preregistration, draw, enrol / measure / watch (same files as the 2026-10-01 rescue) | none |
| `rescue/job-v14-ab-20261029` | translation restraint A/B | an edit to `scripts/eval/translation-restraint-ab.mjs` | none |

Earlier rescues (2026-10-01, same convention): `rescue/job-brakes-5492-20261001` (#5492 spend brakes, docs +
`scripts/lib/pause.mjs`), `rescue/job-eternity-ab-pr-20261001` (#5513), `rescue/job-page-5527-20261001` and
`rescue/job-research-quality-20261001` (`src/app/research/` pages), `rescue/job-quality-round-1-20261001`.

### R2: `eval-rescue/2026-10-29/` (bucket `sourcelibrary`, not public-listed)

Corpus page-profile outputs, #5643 (`2026-10-02-corpus-page-profile-5643.md`), 177 MB in total:

| key | bytes |
|---|---|
| `eval-rescue/2026-10-29/job-page-profile-5643/corpus-page-profile-2026-10-02.jsonl` | 33,903,210 |
| `eval-rescue/2026-10-29/job-page-profile-5643/corpus-page-profile-2026-10-02.walk.jsonl` | 30,134,847 |
| `eval-rescue/2026-10-29/job-page-profile-5643/corpus-page-profile-2026-10-02.books.jsonl` | 8,084,772 |
| `eval-rescue/2026-10-29/job-page-profile-5643/corpus-page-profile-2026-10-02.descriptors.jsonl` | 3,134,167 |
| `eval-rescue/2026-10-29/job-page-profile-typeface/corpus-page-profile-2026-10-02-typeface.jsonl` | 45,409,367 |
| `eval-rescue/2026-10-29/job-page-profile-typeface/corpus-page-profile-2026-10-02.walk.jsonl` | 30,134,847 |
| `eval-rescue/2026-10-29/job-page-profile-typeface/corpus-page-profile-2026-10-02.books.jsonl` | 8,084,772 |
| `eval-rescue/2026-10-29/job-page-profile-typeface/corpus-page-profile-2026-10-02.descriptors.jsonl` | 18,217,931 |

Read with the R2 credentials in `.env.production.local` (`ListObjectsV2`, prefix `eval-rescue/2026-10-29/`).
