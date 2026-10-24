---
stage: ocr
measure: agreement
languages: [zh]
scripts: [Hant]
canons: []
n_books: 92
n_pages: 100
verdict: "No engine clears the preregistered bar in any class of the Chinese held residue. The nearest is Paddle as already run in production (PaddleOCR-VL-1.6, layout off): it ties agy Gemini 3.8 Flash on table (7.0% vs 5.8% bag CER, paired Δ 0.0, CI −0.7 to +3.2) and mixed (4.0% vs 4.0%), and beats it on seal gloss text (5.6% vs 11.5%, Δ −3.1, CI −14.9 to −1.5). It fails the hallucination check: it loops 3,983 characters on a blank leaf. It also gets 41% of seal head glyphs right (Flash 65%) and misses the dense ephemeris tables. Layout-on Paddle, MinerU 2.5 Pro, GLM-OCR, Qwen2.5-VL-7B and Qwen3-VL-8B are all worse than Paddle as-is. The held-by-title premise ('Paddle cannot read these') is wrong for gloss and prose text, but right for seal heads, dense tables and blank-leaf loops."
status: rejected
decision: "No new reader for any class. Keep the 47,420 pages held. Paddle as-is plus an output-length guard is the candidate to confirm on a fresh draw for table and mixed (see DECISION lines on #6871)"
superseded_by: null
issue: [6871, 5660]
---
PRIOR ART: `2026-10-18-zh-residue-bakeoff-prereg-6871.md` (the preregistration this scores, committed in a38ec2bd0 before any output was scored). `2026-10-17-zh-residue-reference-set-6871.md` / `scripts/eval/zh-residue-refs-6871/` (the 100 Opus reference pages and their scoring rules). gex45 job `gpu-bench-6871` (the engine installs and serve flags, reused).

## 2026-10-18 · Does any engine give the Chinese held residue a reader worth applying, per class? (#6871 item 3)

**No, under the bar as preregistered.** No arm clears all three criteria in any class. The one class where an
engine clears the CI and noise-floor criteria is seal, and that engine is Paddle exactly as production already
runs it.

**Design.** As preregistered. 100 reference pages (`zh-residue-refs-6871/refs.jsonl`). Scored n: table 20,
mixed 17, seal 19, reverted 8. Each class leaves out its 清文鑑 pages, and pages under 20 Han characters are
not scored. Every arm got the same image, the IIIF full image capped at a long side of 2,744 px.
- Table: bag CER (order-insensitive).
- Mixed and reverted: CER.
- Seal: gloss CER, with head glyphs `⟨…⟩` scored apart.
- Hallucination check: the 20 unclassed pages.
- GPU arms: one `flock /root/gpu.lock` hold each on the gex45 RTX PRO 4000 Blackwell SFF, vLLM at
  `--gpu-memory-utilization 0.6`. The card read 2 MiB after every hold.
- Noise floor: B1 run again at temperature 1 (B1r).

**Result: primary metric, class median % (95% bootstrap CI); lower is better.**

| arm | table (bag CER) | mixed (CER) | seal gloss CER | seal heads right | reverted (CER, n=8) | unclassed: hallucinated pages (prereg / 19 textless) |
|---|---|---|---|---|---|---|
| P0 Paddle-VL 1.6, layout off (production as run) | 7.0 (4.2–23.5) | **4.0** (0.8–49.2) | **5.6** (4.7–13.2) | 41% | **19.6** (6.0–63.4) | 2 / 1 |
| P1 Paddle-VL 1.6, layout + tables | 9.5 (5.7–21.8) | 13.9 (1.6–64.5) | 13.9 (10.1–18.2) | 42% | 26.6 | 2 / 1 |
| M MinerU 2.5 Pro | 7.3 (5.5–24.9) | 23.6 (9.4–50.7) | 32.2 (17.3–42.3) | 14% | 59.1 | 4 / 3 |
| G GLM-OCR | 11.4 (8.7–18.0) | 6.2 (3.1–47.0) | 21.7 (9.6–40.9) | 20% | 59.5 | 1 / 0 |
| Q2 Qwen2.5-VL-7B AWQ | 13.1 (6.2–31.8) | 16.9 (5.1–61.7) | 45.8 (11.5–98.7) | 3% | 497 | 2 / 1 |
| Q3 Qwen3-VL-8B FP8 | 8.4 (1.4–26.0) | 7.9 (1.6–99.1) | 27.0 (3.1–51.7) | 29% | 41.8 | 4 / 3 |
| B1 gemini-3.1-flash-lite (paid) | 11.8 (4.6–18.9) | 6.9 (1.6–57.4) | 39.0 (8.2–49.0) | 10% | 65.1 | 2 / 1 |
| B1r same, temperature 1 | 9.9 | 22.0 | 42.9 | 5% | 68.1 | 2 / 1 |
| **B2 Gemini 3.8 Flash low (agy)**, best baseline in every class | **5.8** (2.2–16.4) | **4.0** (0.6–37.7) | 11.5 (7.6–31.0) | **65%** | 45.2 (20.1–70.7) | 1 / **0** |

**Paired against the best baseline (B2):** median per-page Δ, 95% CI.

| arm | table | mixed | seal gloss | reverted |
|---|---|---|---|---|
| P0 | 0.0 (−0.7, +3.2) | 0.0 (0.0, +6.5) | **−3.1 (−14.9, −1.5)** | −9.3 (−40.7, +24.9) |
| P1 | +3.0 (+0.3, +4.7) | +4.8 (0.0, +18.9) | 0.0 (−7.5, +10.4) | +2.6 |
| M | +3.7 (+2.1, +9.0) | +8.4 (+2.4, +17.9) | +5.5 (+1.4, +19.0) | +17.3 |
| G | +3.0 (+1.5, +6.9) | +4.6 (+2.2, +9.0) | +2.6 (−2.3, +17.6) | +30.4 |
| Q2 | +4.0 (+0.7, +9.6) | +11.9 (+5.1, +35.8) | +38.2 (0.0, +62.4) | +449 |
| Q3 | +1.0 (−0.6, +3.9) | +2.6 (0.0, +41.4) | 0.0 (−5.4, +11.5) | +1.8 |
| noise floor (median abs B1−B1r) | 0.8 | 1.8 | 2.3 | 5.4 |

Not preregistered, descriptive. **Overrun** = output longer than 1.5× the reference plus 20 characters, i.e. a
loop or a repeated block. **Bad** = primary metric over 50%. Counts are pages, out of table 20 / mixed 17 /
seal 19 / reverted 8:

| arm | overrun | bad |
|---|---|---|
| P0 | 3 / 1 / 0 / 1 | 3 / 4 / 0 / 2 |
| B2 | 2 / 0 / 0 / 0 | 4 / 2 / 2 / 2 |
| Q3 | 4 / 3 / 2 / 2 | 5 / 6 / 6 / 4 |

**Per class:**
- **Seal (5,878 pp).** P0 clears criterion 1 (CI below 0) and criterion 2 (|Δ| 3.1 > noise 2.3). It fails
  criterion 3: on a blank leaf of 御纂周易折中 it wrote 欽定四庫全書 卷一 卷二 … for 3,983 characters. Its gloss
  text is good: no page above 50%, median 5.6%. It gets 41% of head glyphs right, against Flash's 65%. The
  head references are provisional (README §4), but the gap matches the reason these books were held (Paddle
  misreads seal heads, and no guard sees it). **No reader for the heads.** Applying P0 would put wrong head
  characters in front of readers at the start of each entry.
- **Table (15,280 pp).** No arm beats Flash. P0 ties it at $0 and 3,400 pp/h, but it fails on exactly the
  dense ephemeris tables that make up much of this class (御製歷象考成·表):
  - one 710-character table came out as 1 character;
  - one 707-character table came out as 2,049, a loop.

  Flash loses 2 table pages to its filter and reads a 律呂闡微 page as 6 characters.
- **Mixed, 清文鑑 excluded (≈15,400 pp).** P0 = Flash at 4.0%. GLM-OCR is next at 6.2%, but worse paired
  (+4.6, CI excludes 0). Manchu/Mongolian script is not scored: there is no reference.
- **Reverted, 清文鑑 excluded (8 pages scored).** P0 is best at 19.6%, but nothing is significant at n = 8, and
  every arm scores badly on the 康熙字典 / 佩文韻府 double-note pages. **Needs a larger reference** before any
  claim.
- **Unclassed (8,106 pp).** No engine is needed (19/20 textless, #6884). Flash and GLM invented nothing (no page with ≥ 5 excess
  characters) on the 19 textless pages. Paddle as-is wrote a 4-character false heading (晉書卷一) on one blank leaf and the 3,983-character
  loop on another. MinerU and Qwen3-VL invented text on 3.

**Deviation found in the preregistration (stated, not fixed after the fact).** Criterion 3 counts any page with
≥ 5 Han characters beyond the reference. One of the 20 unclassed pages is a real 300-character text page
(欽定音韻述微). There, ordinary misreadings exceed 5, so **every arm, the baselines included, fails criterion 3
as written.** The "19 textless" column is the reading I would have preregistered. It changes no verdict: P0
still fails on it, and no other arm clears criteria 1 and 2 anywhere. The secondary rule (name a baseline when
its median ≤ 10% and it has 0 hallucinations) fails for Flash as written (1 page). Read on the 19 textless
pages, it would name Flash for table (5.8%) and mixed (4.0%). Flash also loses 7 of 80 real body pages to its
filter (`reply cut before <<<END>>>`): 3 reverted, 2 table, 2 mixed.

**Throughput on this card (100 pages, model loaded, 16 clients / 8 Paddle runners, util 0.6) and GPU-days to read
each class in full:**

| arm | pages/h | peak MiB | table | mixed ≈15.4K | seal | reverted |
|---|---:|---:|---:|---:|---:|---:|
| P0 Paddle, layout off | 3,399 | 9,448 | 0.19 d | 0.19 d | 0.07 d | <0.01 d |
| P1 Paddle, layout on | 4,009 | 16,818 | 0.16 | 0.16 | 0.06 | <0.01 |
| M MinerU 2.5 Pro | 3,963 | 14,162 | 0.16 | 0.16 | 0.06 | <0.01 |
| G GLM-OCR | 1,477 | 15,506 | 0.43 | 0.43 | 0.17 | 0.01 |
| Q2 Qwen2.5-VL-7B AWQ | 552 | 14,968 | 1.15 | 1.16 | 0.44 | 0.03 |
| Q3 Qwen3-VL-8B FP8 | 185 | 15,072 | 3.43 | 3.46 | 1.32 | 0.08 |
| B2 agy Flash (2 parallel, not GPU) | ≈120 | — | 5.3 days of calls | 5.3 | 2.0 | 0.1 |

**Notes on the arms.**
- P1's peak (layout model plus genai server) is above what 0.6 util budgets.
- Q3 is FP8, because no AWQ build was cached. Its DeepGEMM kernels need nvcc 13 and the box has 12.9, so it
  ran with `VLLM_USE_DEEP_GEMM=0`. At 0.6 util it gets 1.27 GiB of KV (9,216 tokens), which is why it is
  slow. It took two holds (47 + 53 pages).
- Paid spend: B1 + B1r = 241,912 input + 203,959 output tokens on gemini-3.1-flash-lite, **$0.37**, logged
  through `gemini-script-client.mjs`. B2 was $0, on the agy subscription.

**What this does not show.**
- The reference is Opus (two reads + resolver), not a human. CER below about 2–7% per class is inside
  reference noise.
- Medians hide tails. Read the overrun and bad counts before applying anything.
- Order CER penalises a reading-order convention on 圖書編 diagram pages (bag 5% vs order 78% for B1).
- n = 8 for reverted.

*Replicated?* No. B1r is a noise floor, not a replication.
*Artifacts:* `scripts/eval/zh-residue-bakeoff-6871/`:
- `reads/*.jsonl.gz`: every arm's full text;
- `results.json`: `python3 score.py reads --noise B1 B1r`, reproduces byte for byte;
- `read.py` / `drive.sh` / `gemini-arm.mjs`: the runs.
