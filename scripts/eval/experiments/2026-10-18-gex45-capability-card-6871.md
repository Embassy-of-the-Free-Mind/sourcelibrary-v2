---
stage: pipeline
measure: none
languages: []
scripts: [Latn, Hani, Grek, Tibt]
canons: []
n_books: 100
n_pages: 100
verdict: "On the GEX45 (RTX PRO 4000 SFF, 24 GB, 70 W), PaddleOCR-VL and MinerU2.5-Pro read ~3,500 pages/h, GLM-OCR 1,460, olmOCR-2 1,090; the 7.5M-page Latin backlog is ~90–100 GPU-days on the fastest, 230 on GLM-OCR. Re-embedding the translated corpus is 1–5 days, CLIP over every page image ~2 days."
status: informational
decision: "None. Prices the #6871 queue in GPU-days; each queue item still owes its own quality gate"
superseded_by: null
issue: [6871, 5660]
---
<!-- PRIOR ART: #5660 bench300 (Paddle on 300 SKQS fleet pages on this card, 0.32 s/page: reproduced here on the Chinese stratum, 0.31 s/page), PR #5807 ($/1K pages on the same GPU model, for a Qwen3-8B student only), 2026-10-03-later-the-second-open-engine-olmocr-2-7b-fp8-5660.md (olmOCR 2.71 s/page on a RunPod RTX PRO 4000). None priced every candidate on one fixed page set on the owned box. -->
## 2026-10-18 · What can the GEX45 GPU do per hour, and what does each #6871 queue item cost in GPU-days? (#6871)

- **Question.** For each candidate open model, how many pages (or items) per hour does the GEX45's card process, and how much VRAM does it use? Can it run beside a neighbour that holds 0.6 of the card? This prices every #6871 queue item, and the "OCR every book" goal, in GPU-days before anyone runs one. **This measures speed and memory only.** Quality is not measured: each queue item scores its engine against references at its own gate. A fast engine here is not a good one.
- **Card.** NVIDIA RTX PRO 4000 Blackwell **SFF**, 24,467 MiB, **70 W cap**, driver 595.91.07. The card is **power-bound**: every VLM/LLM arm ran at 99–100 % utilisation and 70 W (MinerU 76 % / 57 W and Paddle 81 % / 66 W, because their clients do CPU work between calls). olmOCR here is 3.30 s/page at 16 clients, against 2.71 s/page at 8 clients on RunPod's RTX PRO 4000 Blackwell (#5750). The rates below are for this box; do not reuse them for another card.
- **Input.** The same files for every arm:
  - 100 real page images, one page per book, drawn at random from interior pages with an archived master. Strata: Latin before 1700 (25), Latin 1700+ (15), German/English/French/Italian/Dutch print (15), Greek (5), Chinese (20), Tibetan (4), manuscript by title (8), and pages whose stored OCR holds a table (8). Long side capped at 2,400 px (median 1,499 × 2,400). Manifest: `scripts/eval/results/gex45-capability-card-6871/pages.tsv`.
  - 2,000 translated page texts for the embedding arms (≤ 4 pages per book, 1,565 books; median 791–893 tokens, depending on the tokenizer). They are not committed (8 MB); they were drawn by the committed `build-manifest.mjs`.
- **Method.** Each model was loaded on its own, under `/root/gpu.lock`. Four warm-up items (mirrored images, so the prefix cache cannot hit) were run and not timed. Then the timed pass ran over all 100 pages, and the model was stopped. Peak VRAM is `nvidia-smi` sampled every 0.5 s, so it is the whole process, not vLLM's budget. Clients: 16 for OCR, 32 for the text LLM. Temperature 0. Each engine used its own documented prompt (the `vlm-run.py` prompts from #5660 round 3; olmOCR's v4 prompt). Max tokens: 4,500, or 8,000 for dots.ocr.
- **"Fits beside a 0.6 neighbour" is decided by measured peak ≤ 9,189 MiB**: the card's 24,467 MiB minus the 15,278 MiB that gpu-screener-6742's Qwen3-14B used at util 0.6. vLLM's util setting under-counts the real footprint by ~1 GB: GLM-OCR at util 0.38 (9.3 GB budget) peaked at 10.7 GB. So the verdict was read off the measured peak. Where 0.38 did not fit, the arm was re-run lower.

### The card

| model | task | batch / concurrency | items/h (alone) | peak VRAM alone | fits beside a 0.6 neighbour? (items/h, peak there) | install notes |
|---|---|---|---|---|---|---|
| PaddleOCR-VL-1.6 0.9B, layout off (fleet recipe) | OCR | 8 runners → genai server | **3,715** (0.97 s/p) | 9,448 MiB (server util 0.5) | **y** at server util 0.33: 3,589/h, 5,380 MiB | `/root/pz` as installed (vLLM 0.10.2). `paddle-zh-box.sh arm` hangs on a bare `wait` if it starts the server itself; card.sh starts the server first. |
| PaddleOCR-VL-1.6, layout on | OCR + layout/tables | 8 runners | 3,163 | 16,904 MiB | n (layout models on the GPU in every runner) | same |
| MinerU2.5-Pro-2605 1.2B | OCR (two-step layout + content) | 16 clients | **3,488** | 20,164 MiB (util 0.85) | **y** at 0.38: 3,410/h, 9,026 MiB | Needs `VLLM_USE_V2_MODEL_RUNNER=0`: vLLM 0.31's V2 runner rejects mineru-vl-utils' n-gram logits processor. `max_model_len` ≤ 8,192. |
| GLM-OCR 0.9B (MTP speculative) | OCR | 16 | 1,462 | 21,516 MiB | **y** at 0.30: 1,232/h, 8,792 MiB (at 0.38: 10,710 MiB, n) | 13 of 100 pages ran to the 4,500-token cap (loops); a loop guard or a lower cap would raise the rate |
| olmOCR-2-7B-1025 FP8 | OCR | 16 | 1,092 | 20,656 MiB | **n**: 9.56 GiB of weights alone; no KV room at 0.38, even capped to 8 sequences and 8K context | 0 cap hits |
| dots.ocr (dots-studio) | OCR + layout JSON | 16 | 725 | 20,136 MiB | **n**: at 0.38 with a 1.6 MP image cap, 8 sequences and a 10K context it runs at 998/h, but peaks at 9,960 MiB | 11 of 100 pages ran to the 8,000-token cap (7 of 100 when capped). 5.87 GiB of weights; at 0.38 the max-image profile leaves no KV room |
| Qwen2.5-VL-7B-Instruct AWQ | OCR (generic prompt) | 16 | 853 | 20,494 MiB | **n**: at 0.38 with an image cap of 1.6 MP, 8 sequences and 8K context it runs (849/h) but peaks at 10,278 MiB | vLLM profiles a *video* at max size unless `video: 0`; 13–15 of 100 to the cap |
| Qwen2.5-VL-7B AWQ, likelihood pass (#6871 row A) | stored OCR scored with the image, then without (prompt logprobs, prefill only) | 16 | 1,541 with image, 10,249 without, so **≈ 1,340 pages/h for the pair** | 20,160 MiB | not tried (same 7B as above: n) | 85 pages (15 have no stored OCR). Sanity check only: the image raises the transcript's likelihood on 98 % of pages (median +2.25 nats/token, last 200 tokens) |
| Qwen3-8B AWQ, thinking off | QC screen: page text in (median 840 tok), short JSON out (median 36 tok) | 32 | 11,004 | 19,768 MiB | **y** at 0.36 with a 4K context: 8,725/h, 8,012 MiB (1 of 400 prompts was longer than 4K and was refused). At 0.38 with 16K: 10,384/h but 9,522 MiB, 333 over. At 0.34 and below there is no KV room for 8K | |
| Qwen3-14B AWQ, thinking off | same | 32 | 5,644 | 19,488 MiB | n: it *is* the 0.6 neighbour (15,278 MiB at 0.6 in gpu-screener-6742) | |
| BGE-M3 (dense) | text embedding, 1,024 tok | batch 32 | 191,086 | 2,652 MiB | y | 42 % of pages are longer than 1,024 tokens |
| BGE-M3 | text embedding, 2,048 tok | 32 | **111,570** | 3,614 MiB | y | 13 % still longer |
| Qwen3-Embedding-0.6B | 1,024 / 2,048 tok | 32 | 83,886 / **46,919** | 6,534 / 11,880 MiB | y at 1K; n at 2K, batch 32 (a smaller batch would fit) | |
| Qwen3-Embedding-4B | 1,024 tok batch 32 / 2,048 tok batch 8 | 32 / 8 | 18,737 / **13,370** | 17,182 / 12,994 MiB | n | 2K at batch 32 OOMs (22.8 GB) |
| CLIP ViT-B/32 (the model behind `clip_embeddings`) | image embedding | batch 64, 8 CPU decode workers | 736,358 (204/s) | 802 MiB | y | **CPU-bound**: GPU-only 3,098/s at 9 % GPU. The rate is JPEG decode of 2,400 px pages |
| SigLIP2-base-patch16-224 | image embedding | 64 / 8 | 789,919 (219/s) | 1,432 MiB | y | CPU-bound (GPU-only 844/s) |
| SigLIP2-so400m-patch14-384 | image embedding | 64 / 8 | 150,212 (42/s) | 4,164 MiB | y | GPU-bound (GPU-only 45/s) |

Not installed and nothing skipped: every candidate in the brief installed on sm_120 / CUDA 12.9 in under 30 min. vLLM 0.31.0, torch 2.13.0+cu132 and transformers 5.17.0 install as one `uv pip install -U vllm` (`/root/bench/vl`), with sm_120 in the arch list. Paddle stays on its own stack in `/root/pz`. Versions and HF snapshot hashes: `versions.txt`.

**Page mix matters by up to 3×.** Relative to this 100-page mix, the Latin pages run at 0.8–1.0× the mix rate on every OCR engine. Chinese pages run 1.4–3.3× faster, because they produce less text. Table pages run 0.45–0.94×, because they produce more. (Factors are a latency-share approximation; `stratum-factors.json`.) Paddle's Chinese pages ran at 0.31 s/page, the same as #5660's bench300 on this card (0.32), which cross-checks the harness.

### What the queue costs in GPU-days

GPU-day = 24 h of this card alone. At $249/month the box costs ≈ $8.18 a day whether it runs or not. So $/1,000 pages = $8.18 ÷ (rate × 24) × 1,000. For comparison, flash-lite Batch is ≈ $0.45 per 1,000 pages (#5660).

| workload | pages | engine (rate used) | GPU-days | $/1K pages on the box |
|---|---|---|---|---|
| **Latin print backlog** (#5924) | ~7.5M | PaddleOCR-VL, layout off (3,715 × 0.95) | **89** | $0.092 |
| | | MinerU2.5-Pro (3,488 × 0.90) | **100** | $0.098 |
| | | GLM-OCR (1,462 × 0.94) | 227 | $0.233 |
| | | olmOCR-2 FP8 (1,092 × 0.80) | 358 | $0.312 |
| | | Qwen2.5-VL-7B AWQ / dots.ocr | 352 / 435 | $0.40 / $0.47 |
| **Chinese held residue** (tables, mixed script, seal, reverted) | 47,420 | Paddle layout on: table rate .. Chinese rate | 0.21–0.82 | |
| | | MinerU2.5-Pro | 0.41–0.60 | |
| | | GLM-OCR / olmOCR-2 / Qwen2.5-VL / dots.ocr | 0.4–2.3 / 0.9–3.1 / 1.4–3.9 / 1.3–4.7 | |
| **Re-embed the translated corpus** (#5729, bf16) | 5.66M translated pages (Mongo `pages_translated` sum, 2026-10-18) | BGE-M3 at 2,048 / 1,024 tok | **2.1** / 1.2 | |
| | | Qwen3-Embedding-0.6B at 2,048 / 1,024 | 5.0 / 2.8 | |
| | | Qwen3-Embedding-4B at 2,048 / 1,024 | 17.6 / 12.6 | |
| **CLIP over every page image** | 28.9M pages (20.7M with an archived master) | CLIP-B/32 or SigLIP2-base | **≈ 1.6** (1.2 for the archived masters), if the decode keeps up | |
| | | SigLIP2-so400m | 8.0 (5.8) | |
| QC screen every translated page once | 5.66M | Qwen3-8B / 14B AWQ | 21 / 42 | |
| Grounding check (#6871 row A) on every OCRed page | 9.33M | Qwen2.5-VL-7B likelihood pair (≈ 1,340/h) | ≈ 290 | |
| **"OCR every book"**: pages with no OCR yet | 19.6M (28.9M − 9.33M `pages_ocr`) | Paddle / MinerU / GLM-OCR / olmOCR at the mix rate | **220 / 234 / 558 / 747** | |

How to read this:
- **The Latin backlog is a quarter of a year of box time on the fastest engines, and two-thirds of a year to a year on the 7B VLMs.** Each of those engines must still pass #5924's per-century gate; Paddle has already lost to lite on Latin 1500–1699 (#5684).
- **"OCR every book" does not fit on one card on any engine:** it is 7+ months on the fastest and about 1.5–2 years on the 7B models. The goal needs either the fast engines, after they pass their gates, or more cards.
- **Every embedding and CLIP job is days, not weeks.** The image jobs are bound by fetching and decoding, not by the GPU. At ~0.9 MB per archived master, a 20.7–28.9M-image pull is ~19–26 TB: about 1.7–2.4 days at 1 Gbit/s. 224 px CLIP can read the `-thumb.jpg` derivatives instead.
- **Five things fit in memory beside the screener at 0.6:** Paddle (layout off), MinerU, GLM-OCR at util 0.30, Qwen3-8B AWQ at 0.36 with a 4K context, and every embedding model except Qwen3-Embedding-4B. The 7B VLMs do not fit. The "beside" rates were measured at the lower util on an otherwise empty card, so they show the cost of the smaller KV cache (2–21 %), not of sharing. The card is power-bound, so two busy tenants split the 70 W, and each should expect roughly half its solo rate. Co-tenancy buys concurrency, not throughput.

### Threats and limits
- **Speed only.** Nothing here says an engine reads well. The loops counted above (pages that ran to the token cap) are a speed cost here. In a lane they are a quality failure.
- **One draw of 100 pages.** The rates carry the mix's composition. The stratum factors are approximations from per-request latency, not separate runs.
- **Token caps change the rate.** GLM-OCR, Qwen2.5-VL and dots.ocr spend much of their time on the 11–15 % of pages that loop to the cap. A lane with a lower cap or a loop guard would run faster than this.
- **Concurrency was not swept.** 16 clients for the VLMs and 32 for the LLM keep the card at 99–100 % utilisation and 70 W, so more clients would mostly add latency. MinerU and Paddle sit at 76–81 % and might gain a little from more clients.
- **The embedding rates use sentence-transformers.** vLLM's pooling runner was not tried and could be faster for the Qwen3 embedders.

Artifacts: `scripts/eval/results/gex45-capability-card-6871/` holds `pages.tsv` (the manifest), `card.json` (every arm's run record and peaks), `stratum-factors.json`, `versions.txt` and `card.log`. Harness: `scripts/gpu/gex45-bench-6871/` (`build-manifest.mjs`, `card.sh`, `run-all.sh`, `vlm-bench.py`, `embed-bench.py`, `card-table.py`). Raw per-item timings stay on gex45 in `/root/jobs/gpu-bench-6871/arms/`. Nothing was written to `pages` or to any production store. No Gemini, no Claude, no paid GPU.
