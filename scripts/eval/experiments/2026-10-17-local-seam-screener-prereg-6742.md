---
stage: translation
measure: agreement
languages: []
scripts: []
canons: []
n_books: 300
n_pages: 600
verdict: "Preregistration only: an open model on the GEX45 (Qwen3-14B-AWQ, vLLM) as the page-join screener, scored against Opus labels on the #6742 300-junction set, with the agy Flash screener's agreement as the bar. No result here."
status: undecided
decision: null
superseded_by: null
issue: [6742, 6871]
---
PRIOR ART: `2026-10-16-seam-repair-lean-6742.md` (Test B: Gemini 3.8 Flash low via agy, same prompt, scored as a repairer by verified yield; its labels were never scored alone against Opus). `2026-10-15-seams-scale-opus-flashlite-6742.md` (the 300-junction set and the Opus labels; paid flash-lite detect arms D1–D5).

## 2026-10-17 · Preregistration: can an open model on the GEX45 replace the agy Flash screener for page joins? (#6742, #6871 item 1)

Committed before any local model output was scored. The Flash numbers below were computed first, because they ARE the bar.

**Why.** The lean seam runner (`lean.mjs`) spends one agy call per join on Gemini 3.8 Flash, which labels the join and
repairs it. agy quota is the binding constraint. If a local model on the GEX45 (RTX PRO 4000 Blackwell, 24 GB) can
make the ok/defective call as well as Flash, joins it clears never reach agy.

**Set.** The #6742 300 junctions (`results/seams-6742/items.jsonl.gz`), exactly as shown to Opus and to Flash: four
text excerpts, no images. Strata: random 120, flagged 120, presumed-good 30, planted 30. Reference = the Opus labels
(`labels.jsonl.gz`), binarised: defective = label ≠ `ok`. Primary set = the 240 real joins (random + flagged).

**The bar: the agy Flash screener vs Opus** (Test B rows, `seam-lean-6742/test-b/repair-gemini.jsonl.gz`, binarised the same way):

| set | agreement (Wilson 95%) | κ | sensitivity ("removes a mark" = miss) | specificity ("adds a mark") | flag rate |
|---|---|---|---|---|---|
| real 240 | **91.2% (87.0–94.2)** | 0.82 | 91/99 = 91.9% (84.9–95.8) | 128/141 = 90.8% (84.9–94.5) | 43% |
| random 120 | 89.2% (82.3–93.6) | 0.74 | 30/35 | 77/85 | 32% |
| flagged 120 | 93.3% (87.4–96.6) | 0.87 | 61/64 | 51/56 | 55% |
| plants | 30/30 caught | | | | |
| presumed-good | 2/30 flagged (Opus also flags 2) | | | | |

**Flash noise floor.** No designed Flash repeat on the 300 exists. One incidental repeat exists: 30 joins scored by
Gemini both in the lean dry run (2026-10-16 01:48Z) and in the all-joins dry run (12:12Z), same page hashes, same lean
windows: 29/30 agree (Wilson 83–99%). They are tranche joins (24/30 defective), so this is not a floor for the random
stratum. No Opus repeat on these 300 exists either. No paid API is run to make one. An agy repeat is not run unless
the primary arm lands within the CI of the bar, where the floor would decide the reading; this rule is fixed here.

**Arms** (vLLM 0.10.2, `/root/pz/srv`, `--gpu-memory-utilization 0.6`, `VLLM_USE_FLASHINFER_SAMPLER=0`, one model loaded at a time under `flock /root/gpu.lock`):
- **P (primary): `Qwen/Qwen3-14B-AWQ`, thinking ON**, max 6,144 output tokens, Qwen's recommended sampling (T 0.6, top-p 0.95, top-k 20), seed 6742.
- S (secondary): the same model, thinking OFF (T 0.7, top-p 0.8, top-k 20), max 1,024.
- R (local noise floor): P again with seed 6743. Its agreement with P is the local model's own repeat agreement.
- **No VLM arm.** The Flash screener and the Opus reference both judged text only; a join call needs no image.
  Qwen3.5/3.8 checkpoints exist but need a newer vLLM than the box has; out of scope here.

**Prompt.** `itemPrompt()` from `scripts/eval/seams-6742/opus-reference.mjs`, unchanged: the identical text Opus and
Flash saw (label + minimal repair, one JSON object). Only the label is scored here. A reply that does not parse to a
known label counts as **flagged** (in production it would go on to agy), and is reported.

**Scoring** (`scripts/eval/seams-6742/local-screener.mjs score`): agreement, κ, sensitivity and specificity with Wilson
95% CIs per set; paired bootstrap (10,000 resamples of joins, seed 6742) of arm − Flash for agreement, sensitivity
and specificity; plants caught; share of Test B's 110 verified Gemini repairs whose join the arm flags (the repairs a
screen in front of Gemini would keep).

**Decision rules, on P, real 240:**
1. **Adopt as the screener (replaces Flash's label)** if all hold: Δagreement ≥ 0 with paired 95% lower bound > −5
   points; Δsensitivity ≥ −3 points (a miss loses a repair); Δspecificity ≥ −5 points; plants ≥ 28/30.
2. **Adopt as a pre-filter only** (local "ok" skips agy; local "defective" still goes to Flash, which labels and
   repairs) if rule 1 fails but the arm keeps ≥ 95% of the 110 verified Gemini repairs AND clears (labels ok) ≥ 30%
   of the 240 real joins.
3. Otherwise **don't adopt**; S is reported as exploratory and cannot rescue P (if S passes where P fails, that is a
   finding for a confirmatory rerun on fresh joins, not an adoption).

**Throughput.** Wall-clock joins/s for the 300 at fixed concurrency (8 for P, 16 for S), prompt and completion
tokens per join; extrapolated to the ~330K tranche and the 4.40M prose-break frame on this card.

**No writes** to `pages` or any production store. Mongo is not read; the inputs are the committed files.
