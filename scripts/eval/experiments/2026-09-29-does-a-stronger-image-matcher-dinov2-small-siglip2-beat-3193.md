---
stage: image
measure: accuracy
languages: []
scripts: []
canons: []
n_books: null
n_pages: 63
verdict: "The CLIP index at probes=1 hid matches (top-1 21 to 30 of 63 at probes 10); SigLIP2 fp32 beats CLIP on top-1, 59 vs 49 (random pool) and 47 vs 34 (hard negatives)."
status: undecided
decision: "probes=10 shipped (PR #5256); SigLIP2 as the /identify recall model awaits Derek (#3193)"
superseded_by: null
issue: 3193
---
## 2026-09-29 — Does a stronger image matcher (DINOv2-small, SigLIP2) beat CLIP ViT-B/32 for /identify, and where does CLIP actually lose? (#3193 Phase 2)

- **Question.** The Embassy visitor photographs a plate and `/identify` should land on that page. After Phase 1
  (crop index, query crop, Gemini rerank of the top candidates), what was left was (a) sibling woodcuts from the same
  book outranking the true one and (b) perspective shear. Does an instance-level model fix those, at what CPU cost?
- **Design.** `measure: accuracy` (retrieval rank of the known true gallery image). `scripts/eval/identify-bench.mjs`
  with three new strata beside `main` (24 plates from 24 books, wall recipe): `shear` (the same 24 plates under the
  2026-09-26 sample test's 12% affine shear, dark wall, blur), `siblings` (12 books with ≥ 6 illustrations; up to 60
  of each book's other illustrations added to the pool), `named` (the three known misses by id: Aldrovandi serpents,
  Musaeum metallicum, Rehe palace plans). Same pool, same wall photos, same bbox crops through every model; only the
  embedding changes. Models ran on Hetzner CPU (`identify-matcher-server.mjs`, transformers v4 in a scratch dir, fp32
  unless stated): `onnx-community/dinov2-small-ONNX` (CLS and GeM-pooled patch tokens) and
  `onnx-community/siglip2-base-patch16-224-ONNX` (vision tower). Three pools: **random** (1,194 images), **hard
  negatives** (the same + each target's top-50 CLIP neighbours mined from the LIVE `clip_embeddings` index, 3,716),
  and the **live index itself** for CLIP (`scripts/eval/clip-index-recall.mjs`, 333K rows).
- **Positive control.** Plain run first (n=24, pool 400): Runion 23/24 (July: 23/24), B 15/24 (July 17/24,
  re-sampled set), Bcrop 23/24. CLIP numbers reproduced exactly between two runs on the same frozen set (B 13, Bcrop 21).
- **Result 1: the index, not the model, was hiding matches.** `clip_embeddings` is `ivfflat lists=32` (built at ~10K
  rows) and `match_clip_images` runs at the default `probes=1`: one list in 32. Crop query, 63 targets, live table:

  | search | top-1 | top-10 | not in top-200 |
  |---|---|---|---|
  | probes = 1 (production) | 21 | 32 | 21 |
  | probes = 4 / 10 / exact (identical to depth 200) | 30 | 40 | 10 |

  +~80 ms per query at probes=10 (543 vs 464 ms median). Fix: PR #5256 (one `ALTER FUNCTION … SET ivfflat.probes = 10`),
  verified in a rolled-back transaction (six targets exact-ranked #1 went from absent in the RPC's top-20 to #1).
  What still outranks the true image at scale (33 targets, read from catalogue descriptions, NOT by eye): 14 are
  sibling illustrations of the same book, 19 similar-looking images from other books (another botanical woodcut,
  another musical score); no covers or artwork copies.
- **Result 2: matchers, crop query, top-1 / top-10 / top-20 of 63** (paired vs CLIP on top-1, two-sided sign test):

  | pool | CLIP | DINOv2-s CLS | DINOv2-s GeM | SigLIP2 |
  |---|---|---|---|---|
  | random 1,194 | 49 / 62 / 63 | 56 / 62 / 63 (+11 −4, p=.12) | 54 / 61 / 61 | **59 / 63 / 63** (+12 −2, p=.013) |
  | hard negatives 3,716 | 34 / 46 / 47 | **52** / 56 / 58 (+21 −3, p<.001) | 50 / 56 / 57 | 47 / **61 / 63** (+16 −3, p=.004) |

  Uncropped wall photo, hard negatives, top-1: CLIP 21, DINOv2 CLS 45, SigLIP2 47 (+26 −0). Sibling stratum, crop,
  random pool: CLIP 6/12, DINOv2 CLS 11/12, SigLIP2 10/12. End to end with the Gemini rerank on the random pool every
  arm scored 63/63 — at 1.2K candidates the true image is always in the top 10, so the difference only shows at scale.
- **Result 3: quantisation kills SigLIP2's gain.** Same frozen set, q8 (`model_quantized`): 633 ms/image (2.7× faster)
  but crop top-1 49/63 against 48 for CLIP in that run and 59 at fp32. Budget fp32.
- **Decision (proposed, Derek's call).** SigLIP2 fp32 as the recall model feeding the rerank: it is the only arm with
  full top-20 recall under CLIP-mined hard negatives, and its misses are rank 2–4 (the rerank's job), where DINOv2's
  fall to rank 31–96 on maps, tables and scores. The mining bias runs AGAINST SigLIP2 (the negatives are CLIP's
  confusers and SigLIP2 is the CLIP-like model), so its margin is if anything understated. Not measured: each model's
  OWN confusers at 333K — that is what the shadow table's switch-over test is for. Plan and cost in #3193.
- **Cost.** $0 GPU. Gemini estimated at $1–2 across the five runs (describes + reranks; not metered per run). CPU: SigLIP2 fp32 ~1.3–1.4 s/image on
  the shared Hetzner box (6,160 images measured), DINOv2-small ~0.9 s.
- *Replicated?* The matcher ranking was run on two pools (random, hard-negative) of the same 63 targets; CLIP's
  numbers reproduced exactly across reruns of a frozen set. Not replicated on a second sample of targets.
- **Artifacts.** `scripts/eval/results/identify-matcher-bench-2026-09-28.json` (random pool, fp32 + reranks),
  `…-2026-09-28-siglip2-q8.json`, `…-2026-09-28-index-recall.json`, `…-2026-09-28-hardneg-set.json` (reproduce with
  `--set`), `…-2026-09-29-hardneg.json`. `run_id: identify-matcher-bench-2026-09-28`. Not an OCR cell, so no
  `benchmark-dashboard-data.mjs` entry.
