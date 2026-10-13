---
stage: ocr
measure: accuracy
languages: [lzh]
scripts: [Hani]
canons: []
n_books: null
n_pages: 190
verdict: "PaddleOCR-VL-1.6 with no layout stage reads the SKQS manuscripts no worse than with it (fresh 95 pages: median dCER -0.007, 0 catastrophic): PASS by the pre-registered rule."
status: informational
decision: null
superseded_by: null
issue: [5600]
---
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

**Not measured in the first pass.** Smaller images (MAX_SIDE) and layout off were not run before the job died. They were run later the same day (below). Native batching (`--page-batch`) is still unmeasured.

### Later arms, same day (session cn-ocr, run by hand, and job `nolayout-5600e`)

**Other GPUs.**

| arm | GPU | result |
|---|---|---|
| RunPod 4090 secure, native | RTX 4090 (secure, $0.74/h) | **3.09 s/page per runner** (manual fleet runner). The native recipe was no faster on a 4090 than on an L4. |
| RunPod 3090 Ti community | RTX 3090 Ti ($0.27/h) | **no result.** The host pulled at ≈ 30 KB/s and setup never finished. |
| RunPod 5090 community | RTX 5090 ($0.69/h) | **no result.** The host dropped the connection mid-setup. |
| | | the two community attempts cost **≈ $0.80 for nothing** |
| RunPod RTX PRO 4000 Blackwell secure | RTX PRO 4000 Blackwell ($0.57/h) | vLLM runs as shipped. Paddle's layout predictor fails with `RuntimeError: Unsupported GPU architecture` on the **cu126** wheel of paddlepaddle-gpu 3.2.1. `pip install --force-reinstall --no-deps paddlepaddle-gpu==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu129/` fixes it. Any Blackwell box (including a Hetzner GEX45) needs the **cu129** wheel. |

**Blackwell throughput** (400-page set, vLLM c8, wall time after load, 0 errors on every arm): full size **0.34 s/page**, 1,600 px 0.33, 1,280 px 0.32, **no layout 0.27**. The L4 does 0.47 at c8. On the 100 accuracy pages, `o4000b-c8` (full size) **FAILS** (8/95 catastrophic). That is a warm-up artefact, not a reading: 8 pages hit the 90 s timeout right after the wheel swap and came back empty. 1,600 and 1,280 PASS (median CER 0.205, 1/95 catastrophic). Image size buys only 3–6 % speed, which is not worth a resize step.

**Warm-up hang (seen twice on Blackwell).** On the confirmation pod (below), the first 16-page warm-up arm timed out on every page. vLLM showed 33 requests "running" at 0 tokens/s for 10+ minutes, with `/v1/models` still answering, so a health probe passes. Killing the client processes (not the server) cleared it, and the next 16 pages read in 7.5 s with 0 errors. The 8 warm-up timeouts on the first Blackwell pod were probably the same thing. **A Blackwell box needs a throwaway warm-up batch, and a liveness check on tokens/s, not on `/v1/models`.**

**c16 canary on a production chunk** (Scaleway L4, chunk `c0001-w1`, 3,036 pages): 30 errors (10 layout-predictor failures in the first 10 s, then 20 × 90 s page timeouts), at ≈ 0.33 s/page. The rule allowed c16 only with 0 errors, so **c16 was rejected and the fleet runs c8.**

**Real fleet cost vs the benchmark.** At 2026-10-02 21:44Z the fleet had written ≈ 112K pages (115,121 including the 20-book pilot) for ≈ €31 of fleet spend (Scaleway €26.33 + RunPod €4.94). That is **≈ €0.00028/page, ≈ 3× the benchmark's €0.00010.** The gap is box boot and setup (≈ 25 min per box), boxes idle between chunks, pods' setup minutes, and the retry wave. Neither the 400-page throughput set nor the per-box overhead line in the projection captures it. **Project a fleet from the benchmark × 3**, not × 1.

### No layout stage (`LAYOUT=0`): selected on the 95, confirmed on 100 fresh pages

On the original 95 pages, no-layout was the only arm that scored *better* than base: median CER 0.175 vs 0.205, 0/95 catastrophic, W/L/T 69/11/15. Those 95 chose the arm, though, and the Kanripo references leave out the 版心 margin (fold strip 欽定四庫全書, juan line, leaf number). An arm that only drops margins would lower CER without reading the body any better. So a confirmation was pre-registered first (prereg amendment ~21:40Z): fresh pages, body recall, by eye.

**Body recall.** For each page, recall is the share of reference characters the reading contains, order-free, so extra margin text cannot lower it. Both columns are layout on vs no layout, with the median per page. Original 95: layout on = `o4000b-c8-1280`, the same pod. Fresh 100: same pod, same images, vLLM c8.

| | original 95: layout on | original 95: no layout | fresh 95: layout on | fresh 95: no layout |
|---|---|---|---|---|
| median CER | 0.205 | **0.175** | 0.196 | **0.172** |
| paired Δ CER (no layout − layout on), median | | −0.011 | | **−0.007** |
| W/L/T on CER | | 68/12/15 | | **61/15/19** |
| catastrophic | 1 | 0 | 0 | **0** |
| median body recall | 0.824 | 0.840 | 0.835 | **0.843** |
| pages losing > 0.05 recall | | 0 | | 1 |
| pages with a `<header>` line (lane writer) | 78 | 18 | 74 | 28 |
| pages with a `<page-num>` line | 31 | 7 | 26 | 12 |
| fold strip (四庫/全書) present | 32 | 6 | 36 | 14 |
| juan line (`卷…`) present | 45 | 12 | 48 | 19 |

The fresh pages were drawn with `makeRng(56001)` from the same pool, minus the original 100, the 20 pilot books and the 922 books the fleet had already applied (147 eligible). Of the 100, 95 have a usable reference. 16 pages were used only as a discarded warm-up. Throughput on the fresh 100: layout on 30.7 s, no layout 26.9 s, after load.

**By eye** (`read-from-image`, the 5 pre-registered pages from the original 95):
- **1670d3-p111, the largest win.** This is a catalogue page whose entries carry small double-line notes (京兆/田氏, 廬江/李氏). Layout on breaks them into one-character lines (`主 父 己 足 跡 彝`, `李廬 / 氏江`). No layout reads them in the reference's order, and it also keeps the margin title 六藝之一錄 and leaf 十五. Layout on misread the fold strip as kana (`んっつっ…`). This is a genuine body win, the same interlinear-note defect the QA screen flagged on 古音駢字續編 and 普濟方.
- **34fcf9-p24, the second win.** The body is the same, but the vertical ditto mark is `一` (U+4E00) in the layout-on reading and `丨` in the no-layout reading. The image has vertical strokes, and the reference writes `丨`. This is a real reading difference.
- **1de6e7-p38, a loss** (+0.011). No layout *kept* the fold strip (`釣定四庫全書`), which the reference omits, and wrote ○ as 〇. Layout on emitted kana noise there. The body is identical.
- **49bd9d-p134 and 1afcd4-p94, random.** The body is identical. No layout drops the fold strip and the juan line (卷四十九, 卷七).

No body text is dropped on the five. **Not pre-registered:** the one fresh page that lost recall, **e2ee51-p64** (−0.058), was also read by eye. There no layout *does* drop body text: 8 ditto marks `丨丨` and a column-top `年`. Its misreads go both ways (雲 / 萬 / 頓 / 榮 / 萊 worse; 衒 / 麤 better).

**Verdict: PASS by the pre-registered rule.** On the fresh pages: Δ −0.007 ≤ 0, catastrophic 0 ≤ 0, recall 0.843 ≥ 0.835 − 0.01, and the five pre-registered pages show no dropped body text. The paired gain shrinks on fresh pages (median Δ −0.007, vs −0.011 on the pages that chose the arm; the difference of medians shrinks from −0.030 to −0.024), which is regression to the mean, as expected. Most of the fresh gain is real body reading: double-line notes and the ditto mark.

**What the reader loses.** The lane writer (`convertPaddle`) still tags whatever margin text the model reads as `<header>`/`<page-num>`, but with no layout the model reads it on far fewer pages. The juan line falls from 48 to 19 of 95 pages and the leaf number from 26 to 12. A reader of a no-layout page usually does not see which 卷 the page belongs to or the printed leaf number, both of which are citable page marks. The body text is unchanged or better.

**Fleet change** (2026-10-02 22:02Z). `/root/paddle-zh-5600/fleet-cron.sh` now passes `BOX_ENV="BACKEND=server CLIENTS=8 LAYOUT=0"`. A box keeps the env it was **started** with for its whole loop, so the switch takes effect **per box, not per chunk.** The four L4s live at 22:02Z (zh1, f84, f96, f101) keep layout on for the rest of their lives, together with every chunk they are assigned. The first box created after 22:02Z (`f107`/`p107` onward) reads with no layout. Pages already written stay as they are. Every page records `ocr.engine.serving.layout` from its own box's `box.json`. Before the switch, the fleet's no-hash re-collect used *today's* BOX_ENV, and a hardcoded pod env, so after a change it could have stamped an old box with a config it never ran. It now uses the env each box was started with (fix on PR #5607, `e068d110e`).

**Replicated?** Yes for the accuracy direction: two independent page sets (95 + 95) with the same sign and the same catastrophic result. Throughput for no layout was measured on Blackwell only. The L4 speed-up is unmeasured; the fleet's first no-layout box will measure it.

**Artifact.** `scripts/eval/results/paddle-zh-5600/optimize.json`, `optimize-fresh.json`, `recall.json`, `recall-fresh.json`, `sample-fresh.json`. Raw arms are on Hetzner in `/root/paddle-zh-5600/bench/arms/` and `/root/paddle-zh-5600/fresh5600e/bench/arms/` (outputs, `arm.json`, `arm-run.json`, timings). Prereg: `scripts/eval/PREREGISTRATION-paddle-zh-optimize-5600.md`. Body recall and margins: `paddle-zh-5600-optimize.mjs recall [--sample=fresh] --pair=a,b`. Confirmation pod spend: **$0.31**.
