---
stage: pipeline
measure: [agreement, none]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "The 566 dated write-ups (to 2026-11-04) fall into 15 kinds. Route choice is 221 of them (39%). Seven kinds should change a route, prompt, detector, judge rule, reference, published figure or cost row: 442 write-ups. Eight should not need integration: 124. An Opus re-read of 30 random labels agreed on 24 (4 defensible, 2 wrong). Of 134 sampled write-ups (10 per kind), 59 asked for no change. Of the 75 that did, 49 show the change happened, 12 claim it but the repo cannot show it, 13 are pending and 1 did not happen. In a seeded 60 (30 adopted, 30 rejected), 6 no longer match production, 10% (Wilson 95% 4.7 to 20.1%). Rejected write-ups mismatch more (5/30) than adopted ones (1/30). All 6, and the known behnken case, were overturned by a later change, and none of the 7 was marked superseded. A Sonnet ledger over 222 items (superseded, retraction language, handoffs, TAKEN lines) finds 107 mistakes in 13 classes. The largest are harness bugs (21), a blind or wrong instrument (19), and a stale premise (17)."
status: undecided
decision: "Proposal only, nothing wired: add two header fields, `feeds:` and `landed:`. Required when status is adopted and feeds is not none, and CI-checked. Add a forward link, `supersedes:`, on the later entry, and the builder derives the earlier entry's effective status from it. Recurring recipes go into skills that a brief must name: paired-arm-judge first. No workflow, rules.json, current.json or cron change in this PR."
superseded_by: null
issue: [6553]
router_evidence: "none — census of write-ups, no route compared"
defect_rates: "none — no output judged"
---
## 2026-11-04 · What kinds of experiment do we run, and what should each one feed? (#6553)

PRIOR ART: `2026-10-28-router-backfill-all-and-prior-weight-7263.md` sorted 214 judged OCR and translation write-ups by evidence shape, for the router only. It did not cover search, product, repair, census or judge tests. The brief also mentions a keyword pass that put 110 of 404 write-ups in "other". Keywords cannot separate the kinds, so this pass classifies from each write-up's header, question and decision. `scripts/audit/experiments-garden.mjs` (weekly) lists missing headers and stale `undecided` entries. It does not check whether a result reached production.

**Why.** Derek, 2026-11-04, on a proposal to wire experiments into the Quality Center, the router and the database: "worried it doesnt reflect all kinds experiments we are running". Two inbox notes extended the job. One asked to harvest the recipes we run regularly and propose skills for them (part 6). The other asked to "learn from the mistakes" (part 7).

**Data.** `scripts/eval/results/experiment-kinds-6553/`:
- `labels.jsonl`: kind and feeds for all 566 write-ups.
- `taxonomy.md`: the kind definitions.
- `agreement-30.json`
- `verify-134.json`
- `kind-table.json`
- `recipe-labels.jsonl`, `recipe-table.json`
- `mistake-ledger.json`
- `status-vs-production-60.json`

The scripts are `classify.mjs`, `extract.mjs`, `recipe.mjs`, `ledger-corpus.mjs` and `lean.sh`. Spend was $6.58 list on lean `claude -p --model sonnet` calls (cap $10). The verifiers were Sonnet subagents. Read-only: nothing was written to Mongo.

### 1. Method

1. A digest was extracted from every dated write-up: the header, the question heading, and the decision and verdict lines.
2. **Discovery:** Sonnet read 60 random digests (seed 6553) with no list of kinds and proposed 13. I consolidated them into 15, defined in `taxonomy.md`. A kind is *what sort of question, and what the answer changes*, not the topic.
3. **Apply:** 15 batches of about 40 digests each.
4. **Agreement:** Opus read 30 random whole files (seed 30) and labelled them blind.
   - Kind: 24 agree, 4 defensible, 2 wrong. Feeds: 23 / 5 / 2.
   - The 2 wrong labels: `librarian-speed-6904` is a product test, not a prompt test, and `translation-gap-counts-7778` is a census, not an audit.
   - The confusions sit on real boundaries:
     - route vs repair (`near-blank-fix-5274`)
     - audit vs route (EEBO Flash vs Lite)
     - detector vs judge-validity vs probe (`confidence-7866`)
   - The reviewer suggested one missing kind, *proxy/signal validation*. It is folded into judge-validity here.

### 2. The kinds

"30 d" counts write-ups dated 2026-10-05 or later. Happened/asked comes from 10 random write-ups per kind. Sonnet agents checked each one against `origin/main`, PRs and code. I re-checked 6 of the "happened" verdicts and all 6 held.

| kind | all | 30 d | should change | recorded today (of 10 sampled) | happened / asked |
|---|---|---|---|---|---|
| route-choice | 221 | 160 | a route (216) | issue 3, header only 3, PR 2, code 1, none 1; router reads `rules.json` by hand backfill, not headers | 3/5 |
| quality-audit | 67 | 41 | published figure 28, repair worklist 24 | none 5; `/quality` via `index.json` | 2/5 |
| detector-calibration | 59 | 38 | detector or threshold 47, guard 6 | PR 3, code 3 | 6/8 |
| judge-validity | 41 | 31 | judge rule 30 | PR 3, issue 2; eval-design.md by hand | 3/6 |
| prompt-test | 36 | 19 | prompt 36 | PR 4; live prompt is a Mongo record | 4/6 |
| repair-log | 29 | 25 | data repair 28 | PR 5; `sweep_log` | 5/10 |
| search-retrieval | 28 | 26 | product surface 26 | none 4, header only 3 | 3/5 |
| census | 19 | 14 | plan 9, figure 5 | none 5 | 4/4 |
| capability-probe | 18 | 13 | nothing 16 | header only 6 | 0/3 |
| reference-build | 12 | 8 | reference 11 | none 7; no reference registry exists (`corpus-registry.json` is a sampling registry) | 2/3 |
| plan-prereg | 11 | 10 | a later run | none 7 | 1/1 |
| pipeline-diagnosis | 11 | 8 | code fix 6, guard 4 | PR 4, code 2 | 6/7 |
| cost-throughput | 6 | 4 | route cost rows | PR 3, code 2; `estimator/ocr/route-costs.json` | 5/5 |
| product-test | 6 | 6 | product surface 5 | code 4, PR 2 | 5/5 |
| retraction | 2 | 1 | the earlier entry's status | code 2 | 0/2 |

**Examples** (3 per kind, seeded draw from `labels.jsonl`):
- **route-choice:**
  - `2026-10-28-correct-vs-reread-wave2-sa-ar-7568.md`
  - `2026-09-12-can-flash-lite-text-only-cleanup-rescue-rejected-internet.md`
  - `2026-09-29-does-image-preprocessing-binarise-contrast-deskew-upscale-crop-help-5250.md`
- **quality-audit:**
  - `2026-10-28-lane-judge-sampler-first-run-7611.md`
  - `2026-10-01-can-the-nyingma-tantra-manuscripts-get-an-accuracy-number-4523.md`
  - `2026-10-30-siku-translation-error-types-5600.md`
- **detector-calibration:**
  - `2026-10-13-translation-leaf-shift-5021.md`
  - `2026-09-24-are-the-scans-in-order-and-is-every-page.md`
  - `2026-10-04-clef-page-image-screens.md`
- **judge-validity:**
  - `2026-10-01-what-does-an-error-rate-look-like-5576.md`
  - `2026-10-06-transcription-error-three-ways-and-by-prompt-5939.md`
  - `2026-10-02-what-the-judge-calls-invention-5274.md`
- **prompt-test:**
  - `2026-10-04-translation-prompt-v17-typed-notes-5698.md`
  - `2026-10-29-seam-prevent-markers-7118.md`
  - `2026-10-01-does-a-long-s-prompt-line-fix-early-english-ocr-5488.md`
- **repair-log:**
  - `2026-10-30-author-links-singletons-compound-7761.md`
  - `2026-10-11-tengyur-cli-nudge-reread-convergent-6361.md`
  - `2026-10-26-tibetan-gutter-vllm-apply-6871.md`
- **search-retrieval:**
  - `2026-10-18-vector-ef-on-reader-queries-6821.md`
  - `2026-10-18-phrase-first-unspaced-6877.md`
  - `2026-10-17-question-search-jev-rerank-6875.md`
- **census:**
  - `2026-11-02-english-translations-ever-estimate.md`
  - `2026-10-21-philolaus-archytas-fragment-sort-7065.md`
  - `2026-10-07-ai-exposure-run3-6038.md`
- **capability-probe:**
  - `2026-10-09-second-reader-pilot-gemini-cli-6338.md`
  - `2026-10-06-greek-manuscripts-full-kraken-fit-5619.md`
  - `2026-10-19-mongol-real-pilot-score-5664.md`
- **reference-build:**
  - `2026-10-11-praetorius-syntagma-ref-page-repin.md`
  - `2026-10-06-typed-references-dta-camena-eebo-6012.md`
  - `2026-09-05-how-wrong-is-the-ground-truth-track-b-item-4523.md`
- **plan-prereg:**
  - `2026-10-29-rescued-eval-artifacts.md`
  - `2026-10-19-mongol-real-pilot-prereg-5664.md`
  - `2026-09-13-which-model-should-translate-classical-chinese-preview-pages-n.md`
- **pipeline-diagnosis:**
  - `2026-09-30-why-is-gemini-ocr-off-leaf-on-ia-bulk-5309.md`
  - `2026-10-07-embedding-vector-truth.md`
  - `2026-10-17-search-probe-2049.md`
- **cost-throughput:**
  - `2026-10-18-gex45-capability-card-6871.md`
  - `2026-10-27-agy-ocr-pace-read-file-correct-lane-7558.md`
- **product-test:**
  - `2026-10-18-librarian-citation-pages-6946.md`
  - `2026-10-06-librarian-grounding-5904.md`
  - `2026-10-20-librarian-citation-fixer-6946.md`
- **retraction** (only 2 exist):
  - `2026-09-25-retraction-of-the-arm-label-on-both-4681-seam-4681.md`
  - `2026-10-07-ai-exposure-run2-6038.md`

**Verification of the 134.** 59 asked for no change. Of the 75 that did:
- 49 happened.
- 12 are claimed but unverifiable, mostly Mongo writes the repo cannot show.
- 13 are pending.
- 1 did not happen: the siku Kanripo #7503 "strip the model's reply from 137 pages" has no script and no PR.

**Consumers today.**
- `index.json` → `src/lib/experiments-index.ts` → `/quality/record`, research/canon-gap, canon-quality, tibetan.
- The experiments-garden and quality-center-freshness audits.
- **The router does not read headers.** It reads `scripts/eval/estimator/router-table/rules.json`, filled by hand backfills. `router_evidence` is on 80 files and is "none" on 60 of them. Among the 221 route-choice write-ups: 15 name cells, 19 say none, and 187 have no field (most predate the #7263 rule).
- Cost results land in `scripts/eval/estimator/ocr/route-costs.json`.

### 3. Header gaps

- **`stage` has no value for search, the Librarian, the reader, product, eval method or the corpus.** These write-ups are filed under whatever fits least badly:
  - all 28 search-retrieval write-ups (23 tagged `pipeline`)
  - all 6 product-test write-ups (`pipeline`)
  - 37 of 41 judge-validity write-ups (27 tagged `ocr`: the judge is about OCR pages, but the result is about the judge)
  - 12 of 19 census write-ups (`metadata`)
  - 5 of 11 pipeline-diagnosis write-ups

  That is 71 write-ups where the stage misleads the reader of `index.json`.
- **`measure: none` is under-used.** Only 9 of 19 census write-ups and 7 of 29 repair logs say `none`. The rest claim `agreement` or `judged` for a count.
- **`status` does not fit two kinds.** Repair logs use `adopted` (19 of 29) for "the fix was applied". Capability probes use `rejected` (7 of 18) for "the model cannot do it", which is a finding, not a decision. `informational` is right for both.
- **No consumer at all:**
  - capability-probe, plan-prereg, census and retraction: no reader by design.
  - reference-build: there is no reference registry, so a later eval cannot find the reference.
  - search-retrieval and product-test: no surface reads them.
  - quality-audit: half of them feed `/quality`; the repair-worklist half reaches no worker.

### 4. Work that never became a write-up

- **`scripts/eval/results/`:** 416 run stems.
  - Before 2026-09-02: 100 of 109 are unnamed, which is expected (`_note-older-runs`).
  - Since then: 56 of 307 are unnamed. In a sample of 13 of them, 7 are recorded under another name and 6 are not: black-archive-6305, artwork-ustc-4326, truncated-ingests-4442, relabel-ia-4582, scan-gaps-6675, translation-model-obs. These are mostly repair and census worklists.
- **`scripts/eval/` directories:** 6 of 222 have no write-up: figure-reception, ground-truth-wikisource, ground-truth-wikisource-l4, methods, quality-dashboard, tibetan-expert-page.
- **DONE jobs on this box (cloudlayer):** 339 have a brief, 125 of them with eval words, and 73 are named in a write-up. In a sample of 25: 15 are named, 2 are recorded under another name, and 8 are not evals.
- **Other boxes** (box.sh landings, main/l7a/gex45): 54 are eval-named. 31 are named in a write-up, 7 have the write-up inside their PR, 6 are filed under an issue or topic name, and 7 are not evals. That leaves 2 plausibly unrecorded: agy-probe-6865 and search-evals-l7a (l7a).
- **About 2 of roughly 40 real eval jobs sampled left no record.** The gap is not missing write-ups. It is write-ups whose result never reaches a consumer (sections 2 and 7).

### 5. Proposal: the smallest header field and landing rule

1. **`feeds:`**, one of `route | prompt | detector | judge | reference | figure | cost | guard | surface | repair | none`. It is required on new entries. It replaces guessing from `stage`, and it covers search and product (`surface`) and judge tests (`judge`) without adding new stages.
2. **`landed:`**, a repo path or a merged PR, for example `scripts/lib/ocr-routing-table.json#latin-script-print` or `PR #7874`. It is required when `status: adopted` and `feeds` is not `none`. `experiments-lint.mjs` checks that the path exists or that the PR is merged. This is the field that would have caught the 12 unverifiable claims and the 1 change that did not happen.
3. **`supersedes:`**, a list, on the *later* entry (section 7). The builder derives the earlier entry's effective status from it. Nobody has to remember to edit the old header.

Which kinds need integration:
- **Need it (442 write-ups):** route, prompt, detector, judge, reference, quality-audit figure, cost.
- **Need none beyond the header (124):** capability-probe, plan-prereg, retraction, census, pipeline-diagnosis, product-test, search-retrieval and repair-log. For repair-log, `sweep_log` is the record. Product and search changes land as ordinary code PRs, which `landed:` already points at.

An optional follow-up adds `stage` values `search`, `product` and `method`, which would fix the 71 mis-staged write-ups. It is not needed if `feeds` is adopted.

### 6. Recurring recipes (inbox 2026-11-04 08:30Z)

Each write-up was labelled with its recipe (`recipe-labels.jsonl`). "Rebuilt" means its main script sits in its own new directory rather than reusing one.

| recipe | runs | 30 d | rebuilt / with a script | best copy today | covered by |
|---|---|---|---|---|---|
| paired-arm-judge (two arms, blind judge) | 154 | 108 | 94 of 137 | `scripts/eval/route-judge-6740/judge.mjs` (7 reuses) + `defect-rate.py` | nothing (`qa-eval` is the old #1329 MCR framework) |
| cer-vs-reference | 99 | 57 | 50 of 71 | `scripts/eval/lib/metrics.mjs` (CER) | `qa-eval` partly |
| screen-with-controls | 78 | 53 | 28 of 74 | `scripts/audit` + `lib/plant-ocr-errors` (18 importers) | nothing |
| sample-and-review | 55 | 44 | 31 of 44 | `scripts/eval/spot-check/run-reviewers.sh` | `spot-check-round`, `shelf-overview` (exist, unused by jobs) |
| apply-gated-repair | 41 | 37 | 23 of 40 | `scripts/maintenance` + `sweep-log` | nothing |
| judge-or-measure-check | 30 | 23 | 20 of 28 | — | — |
| retrieval-eval | 28 | 26 | 18 of 27 | — | — |
| census-query | 27 | 17 | 10 of 26 | `scripts/audit` | — |

**Recurring mistakes.** These come from the digest, so a flag is not set when a write-up never states the thing.
- No noise floor stated: paired-arm 83 of 154, CER 67 of 99, screen 71 of 78.
- Batch size: untested in 38 paired-arm runs, tested in 13.
- Still `undecided`: paired-arm 47 (20 of them older than 21 days), CER 15, screen 9.

**Rework.**
- 40 scripts under `scripts/eval` spawn `claude -p` themselves and 12 spawn agy. 56 import `lib/agy-cli` or `claude-cli-env`.
- 81 judge-named scripts sit in 52 directories.

**Skills in headless jobs.** A job session *lists* every repo skill, but jobs do not reach for them on their own:
- Across 370 job transcripts on cloudlayer, `review` was the only skill ever invoked (6 sessions).
- No brief names `spot-check-round` or `qa-eval`. One names `shelf-overview`.

**A brief must name the skill**, for example in a `Skill:` header line that `claude-job.sh start` could check.

**Ranked by runs × share rebuilt** (proposed, not written):
1. **paired-arm-judge** (≈106). Script parts:
   - a seeded draw
   - a blind packet with a wrong-page control arm
   - a same-arm rerun as the noise floor
   - a two-family judge
   - `defect-rate.py`
   - a write-up stub with `router_evidence` filled

   Prose covers only the choice of arms.
2. **cer-vs-reference** (≈70). Script parts:
   - a by-eye reference audit of 50 items
   - normalisation via `lib/metrics.mjs`
   - the comparison restricted to shared pages
3. **sample-and-review** (≈39). The skills exist; briefs should name `spot-check-round` / `shelf-overview`.
4. **screen-with-controls** (≈30). Script parts:
   - planted positives via `plant-ocr-errors`
   - known negatives
   - a by-eye check of 40 flagged items before any threshold is set
5. **apply-gated-repair** (≈24). Script parts:
   - a dry run
   - a `sweep_log` row
   - an undo file
   - a gate sample read by eye

   The `landed:` value is the `sweep_log` id.

### 7. Mistake ledger and status against production (inbox 2026-11-04 08:37Z)

**Sources** (222 items, `ledger-corpus.mjs`):
- the 25 `superseded` write-ups
- 53 more with retraction language (`retract`, `overstated`, `invalidat`, `did not hold`, `was wrong`, …)
- `memory/lessons-learned.md` and the 63 `.claude/handoffs/` with lesson or root-cause lines. There are no `lesson_` files in this box's auto-memory.
- 80 of the 668 TAKEN lines in `claude-jobs/taken.txt` (seeded)

One Sonnet call derived the classes and assigned each item ($0.32): 107 mistakes, 16 planned follow-ups (superseded by a bigger run, nothing wrong), and 99 with no mistake. Most of the no-mistake items are TAKEN lines (72 of 80): job decisions are rarely corrections.

| class | n | example | what would have prevented it |
|---|---|---|---|
| harness bug corrupted a result | 21 | `2026-09-25-retraction-of-the-arm-label-on-both-4681-seam-4681.md` (repair never substituted); `2026-10-03-quality-census-backfill-sizes-5700.md` (soft-hidden spreads counted as reversed) | harness self-check: each arm's inputs differ from the baseline before a packet is built; fail if an arm substitutes nothing |
| blind or wrong instrument | 19 | `2026-09-24-contact-sheet-screen-for-illustrated-pages-5009.md`; `2026-09-24-can-jev-judge-page-break-continuity-pilot-against-the-4681.md` | planted positives and known negatives through every instrument before use (screen recipe default) |
| stale or wrong premise | 17 | `2026-10-01-does-the-yigdzin-leaf-cut-drop-the-lower-leaf-s-first-line-4523.md`; `2026-10-01-chinese-ocr-cohort-5547.md` | prereg step: re-measure the baseline on current production before designing arms |
| overclaimed headline | 10 | `2026-09-02-does-ocr-prompt-v17-reduce-fabrication-vs-v15.md`; `2026-10-01-how-strong-are-the-quality-papers-numbers-once-corrected-for-chance-and-held-out-5495.md` | a held-out draw or replicate before a number leaves the worktree |
| pairing / identity error | 9 | handoff `2026-07-27-bulk-jp2-leaf-offset.md`; `2026-10-11-praetorius-syntagma-ref-page-repin.md` | image-vs-text pairing check on a sample; identity lookup by `id` OR `_id` |
| env / config failure | 8 (5 are adjacent TAKEN lines from one job) | TAKEN: `claude` not on job PATH → false refusal; handoff `2026-08-27-reset-cleanup-and-pr-sweep.md` (wrong checkout) | preflight in `claude-job.sh` (PATH, binaries, checkout = origin/main) |
| wrong reference | 7 | `2026-10-01-what-kinds-of-error-make-up-ocr-cer-5488.md` (reference wrong in 16 of 94); `2026-09-25-which-engine-should-retranslate-the-re-ocr-d-kanjur-4742.md` (wrong sutra) | by-eye audit of the reference on a sample; report its error rate beside the score |
| unmeasured or wrong denominator | 7 | handoffs `2026-08-12-attribution-health-loop.md`, `2026-08-01-repeat-ocr-as-a-quality-signal.md` | every figure printed with its numerator, denominator and population |
| judge bias or confound | 5 | `2026-11-01-flash-tier-judge-7611.md` (76 invented defects); `2026-10-04-human-ceiling-translation-5762.md` | cross-family judge, a wrong-page control arm, same-round arms |
| smaller classes (1 each) | 4 | strata pooled (`2026-11-02-latin-by-age-7933.md`), test leakage (`2026-10-27-tibetan-corrector-profiles-diff-qa-6560.md`), no noise floor (`2026-09-17-does-translation-survive-the-batch-api-the-block-boundary-4681.md`), synthetic-only test (lessons-learned) | stratify by form from the image; opaque ids and a leakage diff; a same-arm rerun; a hand check of about 7 production rows |

The first, second, fourth, seventh and ninth classes (62 of 107) are what the paired-arm and screen recipes in section 6 would make default. Only a script can prevent them, not prose.

**Status against production.** A seeded draw of 30 `adopted` and 30 `rejected` write-ups was checked against `origin/main` 6d8727460 by six Sonnet agents (`status-vs-production-60.json`). I confirmed two mismatches by hand: the translation routing table now sends Greek to `greek-cli-gemini38`, and the OCR router cell `latin-lite/print` switched to `agy-flash-low@4-read`.

| | match | mismatch | unverifiable | mismatch rate (Wilson 95%) |
|---|---|---|---|---|
| adopted | 26 | 1 | 3 | 1/30 = 3% (0.6 to 16.7%) |
| rejected | 24 | 5 | 1 | 5/30 = 17% (7.3 to 33.6%) |
| all | 50 | 6 | 4 | 6/60 = 10% (4.7 to 20.1%); 6/56 verifiable = 11% (5.0 to 21.5%) |

The six mismatches:
- `2026-10-14-opus-vs-flash-translation-maya-6559.md` (adopted): the Maya lane moved to Gemini 4 Argon Low two days later.
- `2026-10-08-cli-arm-xl-365-6331.md`: Flash OCR runs on agy CLI since #7075, and translation since #7917.
- `2026-10-26-tibetan-flash-correct-neyphug-tsha-6740.md`: the correction was applied after all, and the book was retranslated (#7495).
- `2026-10-14-paddle-table-gemini-review-gate-6561.md`: "serve nothing" was overturned two days later (#6744).
- `2026-10-15-gemini-4-argon-low-translation-hardest-6729.md`: Opus is no longer the hard-language translator (#7360).
- `2026-10-28-latin-diffqa-three-way-vote-7591.md`: "keep lite>opus" was overturned on 2026-11-03.

The known case, `2026-10-30-read-surface-box-behnken-6740.md` ("keep 4 a call", then #7874 moved German to 8), has the same shape.

**All seven are overturns, not mislabels.** Each status was right when written. In every case a later write-up or PR changed production, yet every one still has `superseded_by: null`. README already requires setting `superseded` "in the same PR that adds the later file". Across 566 files that rule was followed about 25 times. It has failed far more than twice, so by the repo's rule it should become a check. `supersedes:` on the new entry (section 5) is that check: the later file is the one being written, and the old body stays untouched.

A detector in `experiments-garden.mjs` could catch the rest. It would read each routing-table row's `adoption.sample` / `replaces` and list write-ups on the same cell whose status contradicts the row. Read-side, it needs no one's memory. It is proposed here, not built.

### Replicated?

- The kind labels: partly, by the 30-label Opus check.
- The status sample: no. It is one seeded draw. A second draw of 60 would narrow the rejected interval.

**Inbox notes acted on:** 2026-11-04 08:30Z (part 6) and 08:37Z (part 7).
