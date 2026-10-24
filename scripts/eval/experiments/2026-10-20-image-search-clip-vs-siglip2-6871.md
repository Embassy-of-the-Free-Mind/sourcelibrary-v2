---
stage: image
measure: accuracy
languages: []
scripts: []
canons: []
n_books: null
n_pages: 15000
verdict: "On 60 real search_images queries over 15,000 page images, SigLIP2-so400m finds 2.2x as many relevant pages as CLIP-B/32 (P@10 0.46 vs 0.21, Δ +0.25 [0.19, 0.31]; nDCG@10 0.64 vs 0.20), and beats SigLIP2-base by +0.12 [0.07, 0.17]. Judge re-agreement 0.94."
status: adopted
decision: "Per the prereg: if the ~20M page images are embedded for search, use SigLIP2-so400m, not CLIP-B/32 (≈ 5–8 GPU-days on the GEX45). Whether and where page-image hits are shown is a product decision for Derek (#6871 item 3)"
superseded_by: null
issue: 6871
---
## 2026-10-20 · Which model should embed the ~20M page images for text→image search: CLIP-B/32 or SigLIP2? (#6871, Derek's item 3)
<!-- PRIOR ART: 2026-09-29-does-a-stronger-image-matcher-dinov2-small-siglip2-beat-3193.md (SigLIP2 beat CLIP image→image for /identify; text→image never measured); 2026-10-18-gex45-capability-card-6871.md (the GPU-day prices). -->

**Design.** Preregistered in `scripts/eval/image-search-6871/PREREGISTRATION.md` (5bae463d5), committed before any arm ran.
- **Queries.** 60 real `search_images` queries from `mcp_tool_calls` (827 distinct), drawn by a fixed rule; the 56 rejects
  are listed with reasons in `queries.json`.
- **Pool.** 15,000 page images of visible books: 5,000 pages that carry an extracted illustration and 10,000 random
  pages. Each image has a long side ≤ 768 px and goes through each model's own processor.
- **Arms.** CLIP ViT-B/32, the model behind `clip_embeddings`; SigLIP2-base-224; SigLIP2-so400m-384. All fp16 on the
  GEX45.
- **Judging.** The union of the arms' top 10 per query (1,523 images) was shuffled and shown on numbered contact sheets
  with no arm shown. Ten Opus judges graded it 0/1/2. Two more judges re-judged 10 queries blind: 94 % agreement on
  relevant vs not, 93 % on the exact grade.

**Result** (`results/score.json`; P@10 = share of the top 10 graded ≥ 1; paired bootstrap over the 60 queries)

| arm | P@10 | Δ vs CLIP (95% CI) | nDCG@10 | queries with any hit | relevant hits | from pages with no extraction | img/s on the card |
|---|---|---|---|---|---|---|---|
| CLIP-B/32 | 0.21 | — | 0.20 | 41 / 60 | 126 | 19 | 381 |
| SigLIP2-base | 0.34 | **+0.13** (0.08, 0.17) | 0.44 | 52 | 202 | 28 | 436 |
| **SigLIP2-so400m** | **0.46** | **+0.25** (0.19, 0.31) | **0.64** | **57** | **274** | **40** | 45 |

- **Against the rule.** Both SigLIP2 arms beat CLIP: Δ ≥ 0.10 with the CI above 0. so400m beats base by **+0.12
  (0.07, 0.17)**, which clears the 0.05 needed to pay for the bigger model. **So the choice is SigLIP2-so400m.**
- **What a full-page embed adds.** 40 of so400m's 274 relevant hits (15 %) are pages with no gallery extraction. These
  are illustrations that today's image search cannot return at all.
- **Cost.** so400m runs at 45 images/s with the GPU as the bound, against CLIP's 381 and base's 436, both CPU-bound on
  decode. Over the 20.7M archived masters that is ≈ 5.3 GPU-days of compute (≈ 8 with fetch and decode, per the
  capability card), against ≈ 1.6 for CLIP or base. Base is the fallback if the box's time is wanted elsewhere: it gives
  half the gain at a fifth of the cost.
- **Where queries fail for every arm.** Several subjects have no picture in the pool at all, for example "valknut odin",
  "griot storyteller", "tower tarot lightning struck" and "circe ulysses swine". P@10 is a floor on what any model could
  score here, not a ceiling.

**What this does not show.**
- The CLIP arm is HF fp16, not production's `@xenova` int8 runtime. #5099 measured those two at cosine 0.991–0.993,
  close but not identical.
- The pool is 15K pages, not 20M. Absolute P@10 will differ at full scale; the ranking between models is what transfers.
- The judges are Opus on thumbnails (`read-from-image`), not readers.
- It does not decide whether to embed the 20M pages at all, or how page hits would be shown in `search_images` or `/gallery`.
- The same result suggests re-embedding the existing ~152K gallery crops with so400m, about an hour on the card. That
  was not measured here, because the pool is pages, not crops.

*Spend:* $0 (owned GPU, subscription Opus). *Artifacts:* `scripts/eval/image-search-6871/`:
- `queries.json` and `pool.jsonl.gz`;
- `results/*-top.json`, `judgements.jsonl`, `rejudge.jsonl`, `sheet-key.json` and `score.json`;
- `embed.py`, `sheets.py` and `score.py`.

The contact sheets stay on gex45 at `/root/jobs/image-search-6871/sheets`.
