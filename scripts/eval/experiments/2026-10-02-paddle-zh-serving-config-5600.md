## 2026-10-02 · Which PaddleOCR-VL-1.6 serving configuration reads the held Siku Quanshu cohort cheapest without reading it worse? (#5600)

**Question.** #5600 reads ≈ 1.054M pages (7,006 non-redundant books of the 7,894 held Wenyuange SKQS manuscripts) with PaddleOCR-VL-1.6. The #5547 pilot recipe (native pipeline, 2 runners per L4) costs ≈ €0.0007–0.0009/page, ≈ €940 for the cohort, at the €1,000 cap. Can a serving backend, more concurrency or another GPU cut that without losing accuracy?

**Design.** Pre-registered in `scripts/eval/PREREGISTRATION-paddle-zh-optimize-5600.md` (+ amendments: anchors, a catastrophic gate measured against base, RunPod arms) before any arm ran. Accuracy set: 100 held manuscript-regular pages drawn with `makeRng(5600)` (`results/paddle-zh-5600/sample.json`), 95 with a usable Kanripo reference after the scorer's mismatch guard. Gate: median per-page ΔCER vs base ≤ 0.01 AND catastrophic pages (CER > 0.5 or no output) ≤ max(2 %, base's). Throughput set: the first 400 book pages of the #5547 pilot manifest, wall time after model load. Same stack everywhere (paddle 3.2.1 / paddleocr 3.7.0 / paddlex 3.7.2, full-size images ≤ 2400 px wide, layout on). The server arms are `paddlex_genai_server --backend vllm` (VL recognition behind vLLM) with N pipeline clients. Scorer `scripts/eval/paddle-zh-5600-optimize.mjs score` → `benchmark-score.mjs --ref=base`.

**Result.**

| arm | GPU | s/page | €/page | median CER | catastrophic | W/L/T vs base | tput errors | gate |
|---|---|---|---|---|---|---|---|---|
| base (#5547 pilot) | Scaleway L4 | 3.35 | 0.00073 | 0.205 | 2/95 | — | — | baseline |
| sl4-native-w2 | Scaleway L4 | 4.21 | 0.00092 | 0.205 | 1/95 | 12/9/74 | 1 | PASS |
| sl4-vllm-c4 | Scaleway L4 | 0.72 | 0.00016 | 0.205 | 1/95 | 15/11/69 | 0 | PASS |
| **sl4-vllm-c8** | Scaleway L4 | 0.47 | 0.00010 | 0.205 | 1/95 | 14/8/73 | 0 | PASS |
| sl4-vllm-c16 | Scaleway L4 | 0.36 | 0.00008 | 0.205 | 1/95 | 16/10/69 | 0 | PASS |
| rp4090-native-w2 | RunPod 4090 secure | 4.92 | 0.00087 | 0.205 | 1/95 | 13/12/70 | 8 | PASS |
| rp4090-vllm-c8 | RunPod 4090 secure | 0.46 | 0.00008 | 0.205 | 1/95 | 15/9/71 | 0 | PASS |
| rp4090-vllm-c16 | RunPod 4090 secure | — | — | 0.204 | 5/95 | 16/9/66 | **343/400** | FAIL |
| *anchor: gemini-3.1-flash-lite* | — | — | — | 0.287 | 10/95 | — | — | — |

1. **The serving backend is the whole win: vLLM with 8 clients reads 9× faster than the pilot recipe on the same L4, at the same accuracy** (median CER 0.205 on every passing arm; 73 of 95 pages tie base exactly, the rest split 14 better / 8 worse). €/page falls from ≈ €0.0009 to ≈ €0.0001.
2. **Concurrency changes readings only as much as batching noise does.** On the 400 throughput pages, c4 vs c8 and c8 vs c16 each give 319/400 byte-identical texts; the differing pages are ≥ 0.91 similar, except one page that c4 and c8 read as a single character and c16 and native read in full (395 chars). The 4090 vs L4 at c8: 78/100 identical. So c16 is not a different reader, it is a different batch.
3. **c16 is unstable on the 4090** (343 of 400 throughput pages errored: client timeouts behind a saturated server) **and clean on the L4** (0 errors, 400 pages). The choice for the fleet is therefore **Scaleway L4, vLLM, 8 clients**, with 16 adopted only after a production-size canary chunk shows 0 errors.
4. **Projection (corrected).** The 12:33Z table on #5600 said "29.3 L4-hours ≈ €23"; that is an arithmetic slip. 1.054M pages × 0.47 s = **139 L4-hours ≈ €110** at c8 (× 0.36 s = 107 h ≈ €84 at c16), plus ≈ 25 min of setup per box. Either way the cohort fits the €1,000 cap ≈ 9× over, and **GPU stock, not price, now binds the run.**

**Replicated?** Partly. Two GPU classes agree (L4 and 4090 at c8, same accuracy row). Each arm ran once; throughput is one 400-page set per arm. The c16 L4 canary on a production chunk (#5600) is the replication of the L4 c16 throughput number.

**Not measured.** Smaller images (MAX_SIDE) and layout off were in the prereg but were not run before the job died; with c8 already ≈ 9× under the cap there is no budget reason to trade accuracy for them. Native batching (`--page-batch`) likewise.

**Artifact.** `scripts/eval/results/paddle-zh-5600/optimize.json`; raw arms on Hetzner `/root/paddle-zh-5600/bench/arms/` (outputs, `arm.json`, `arm-run.json`, timings); prereg `scripts/eval/PREREGISTRATION-paddle-zh-optimize-5600.md`.
