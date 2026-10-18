---
stage: ocr
measure: agreement
languages: [zh]
scripts: [Hant]
canons: []
n_books: 92
n_pages: 100
verdict: "Preregistration only: open OCR engines on the GEX45 (PaddleOCR-VL-1.6 with layout, MinerU 2.5 Pro, Qwen3-VL-8B, Qwen2.5-VL-7B AWQ, GLM-OCR) against gemini-3.1-flash-lite (paid) and Gemini 3.8 Flash (agy) on the 100 Opus reference pages of the Chinese held residue, per failure class. No result here."
status: undecided
decision: null
superseded_by: null
issue: [6871, 5660]
---
PRIOR ART: `2026-10-17-zh-residue-reference-set-6871.md` and `scripts/eval/zh-residue-refs-6871/README.md` (the reference set this scores against, and its scoring rules); `scripts/eval/zh-residue-refs-6871/compare.py` (the Han-string extraction, reused unchanged); job `gpu-bench-6871` on gex45 (the engine installs and serve flags, reused; speed only, no quality); `2026-10-17-local-seam-screener-prereg-6742.md` (the prereg-then-score shape).

## 2026-10-18 · Preregistration: does any engine give the Chinese held residue a reader, per class? (#6871 item 3)

Written and committed before any engine output on these pages was scored.

**Pages.** `scripts/eval/zh-residue-refs-6871/refs.jsonl`, 100 pages: table 20, mixed 20, seal 20, reverted 20,
unclassed ("other") 20. **Scored pages** = classes table/mixed/seal/reverted, title without 清文鑑 (no credible
reference, README §4), reference Han count ≥ 20 after the exclusions below. Expected n (checked with score.py on the reference itself): table 20, mixed 17,
seal 19, reverted 8. Reverted at n = 8 is reported but cannot clear a CI bar unless the effect is large.

**Input.** The IIIF full image from the reference row, downscaled once to a long side of at most 2,744 px (the
reference readers' size); the same file goes to every arm.

**Arms.**
| arm | engine | how |
|---|---|---|
| P0 | PaddleOCR-VL-1.6, layout off | the #5660 fleet configuration (`paddle-zh-run.py --layout 0`), comparator only |
| P1 | PaddleOCR-VL-1.6, layout + table on | `PaddleOCRVL()` defaults: PP-DocLayout blocks, tables read as tables |
| M | MinerU 2.5 Pro (`MinerU2.5-Pro-2605-1.2B`) | `mineru_vl_utils` two-step extract, HTML stripped |
| Q3 | Qwen3-VL-8B-Instruct (FP8; no AWQ build cached) | vLLM, plain OCR prompt (below), temperature 0 |
| Q2 | Qwen2.5-VL-7B-Instruct-AWQ | same prompt |
| G | GLM-OCR | its own `Text Recognition:` prompt, whole page |
| B1 | gemini-3.1-flash-lite, paid API | same prompt, thinking 0 |
| B2 | Gemini 3.8 Flash low, `agy -p` | same prompt, `run-cli-arm.py` (plan mode, tool gate) |
| B1r | B1 again | **noise floor** (independent second run, default temperature) |

GPU arms: vLLM `--gpu-memory-utilization 0.6`, each load under `flock /root/gpu.lock`, ≤ 20 min per hold.
Plain prompt (Q3, Q2, B1, B2): transcribe all Chinese text exactly as printed, traditional and variant forms kept,
columns right to left, one line per column, no punctuation added, no translation, non-Chinese script as `[滿文]`
/`[蒙文]`/`[藏文]`, nothing at all if the page has no text. (Full text in the run script.)

**Strings.** Han string = `compare.py`'s `han()` with □ removed: CJK ideographs plus 〇 (○ folded). Excluded from
the reference: ▣, the script placeholders (`[滿文]` etc., which contain Han characters), `□`. The fold strip /
running title is the reference's `margin`, not its `text`: an output line whose Han characters are ≥ 80% drawn
from the margin's characters (as a multiset, ≥ 2 chars) is dropped from the hypothesis before scoring. HTML and
markdown are stripped. Nothing else is normalised (no simplified↔traditional folding: printing a 簡體 form is an
error).

**Metric per page.**
- table: **bag CER** = 1 − |ref ∩ hyp| (multiset) / max(|ref|, |hyp|). Reading order in tables is a convention.
- mixed, reverted: **CER** = Levenshtein(ref, hyp) / |ref| (uncapped).
- seal: **gloss CER** = errors on the reference's characters outside `⟨…⟩` (substitutions + deletions from the
  alignment of the full reference string to the hypothesis, plus all insertions) / gloss length. **Head
  accuracy** (the `⟨…⟩` characters matched in that alignment / heads) is reported apart and does not decide.
- every class also gets bag CER and order CER, reported, not deciding.

**Per class.** Median per-page metric with a 95% percentile bootstrap CI (10,000 resamples of pages, seed 6871).

**The bar** ("a reader worth applying" for class Y), all three:
1. paired per-page difference d = metric(arm) − metric(best baseline), where best baseline = whichever of B1/B2
   has the lower class median; the 95% bootstrap CI of median(d) lies entirely below 0;
2. that improvement is larger than the noise floor: |median(d)| > median per-page |B1 − B1r| in that class;
3. hallucination on the 20 unclassed pages no worse than Paddle's stored empty output, i.e. **0 hallucinated
   pages**. A hallucinated page = the output has ≥ 5 Han characters in excess (multiset) of the reference's
   `text` + `margin` (so a correctly read closing title or fold strip is not a hallucination).

**Secondary (decides only if no GPU arm passes).** If a baseline has class median ≤ 10% and 0 hallucinated pages,
it is named as the reader for the class ("apply B-x"), with its cost. Otherwise the class is "no reader yet".
Mixed's Manchu/Mongolian script and the 清文鑑 pages are "needs reference" whatever the scores (README §4).

**Throughput.** Pages/h per GPU arm = 100 pages / wall time of the timed pass at 16 concurrent clients (8 Paddle
runners), measured on this card with the model loaded; GPU-days per class = unread pages (recount 2026-10-17:
table 15,280 · mixed 17,784, of which 清文鑑 pages excluded per title · seal 5,878 · reverted 372) / pages per
hour / 24.

**Reference noise.** The reference is Opus (two reads + resolver), not a human; a per-class A→final distance of
2–7% (README §4) is the floor below which an engine's CER is not distinguishable from reference error.

**Writes.** Nothing to `pages` or any production store; outputs live on gex45 `/root/jobs/zh-bakeoff-6871/` and in
the job's scratch.
