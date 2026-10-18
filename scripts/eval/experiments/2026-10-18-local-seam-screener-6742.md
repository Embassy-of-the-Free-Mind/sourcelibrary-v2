---
stage: translation
measure: agreement
languages: []
scripts: []
canons: []
n_books: 300
n_pages: 600
verdict: "Qwen3-14B-AWQ on the GEX45 cannot replace the agy Flash screener for page joins: 59% agreement with Opus on 240 real joins (κ 0.17) against Flash's 91% (κ 0.82), Δ −32 points (paired 95% CI −39 to −25); it misses 9 of 30 planted breaks and keeps only 66 of Flash's 110 verified repairs, so it fails as a pre-filter too. Its own repeat agreement is 73% (κ 0.45)."
status: rejected
decision: "Don't adopt: the agy Flash call stays the seam screener; GEX45 moves to #6871 item 3"
superseded_by: null
issue: [6742, 6871]
---
PRIOR ART: `2026-10-17-local-seam-screener-prereg-6742.md` (the preregistration this scores, committed in d824198d6 before any local output was read). `2026-10-16-seam-repair-lean-6742.md` (Test B: the agy Flash labels used as the bar). `2026-10-15-seams-scale-opus-flashlite-6742.md` (the 300 junctions and the Opus labels).

## 2026-10-18 · Can an open model on the GEX45 replace the agy Flash screener for page joins? (#6742, #6871 item 1)

**No.** Each preregistered rule fails by a wide margin, and the secondary arms fail too.

**Design.** As preregistered. The 300 junctions of #6742 were sent as text with the identical single-join prompt
(`itemPrompt`). The model was `Qwen/Qwen3-14B-AWQ` on vLLM 0.10.2 (`awq_marlin`), on the GEX45's RTX PRO 4000
Blackwell at `--gpu-memory-utilization 0.6`. That left 3.19 GiB for KV, which is 20,912 tokens. The run held
`flock /root/gpu.lock` throughout and the card read 2 MiB at the end. Binary score: defective = label ≠ ok. An
unparsed reply counts as flagged. The reference is the Opus labels, and the bar is the agy Flash screener (Gemini 3.8
Flash low, Test B) on the same joins.

**Result, the 240 real joins** (random 120 + flagged 120; Opus calls 99 defective):

| arm | agreement (95%) | κ | sensitivity: Opus defect kept | specificity: Opus-ok cleared | flag rate | Δ agreement vs Flash (paired 95%) | plants caught | presumed-good flagged |
|---|---|---|---|---|---|---|---|---|
| **agy Flash (bar)** | **91.2% (87.0–94.2)** | **0.82** | 91/99 (85–96) | 128/141 (85–95) | 43% | — | 30/30 | 2/30 |
| **P: Qwen3-14B-AWQ, thinking** | **59.2% (52.9–65.2)** | 0.17 | 54/99 (45–64) | 88/141 (54–70) | 45% | **−32.1 (−38.8 to −25.4)** | 21/30 | 8/30 |
| R: P again, seed 6743 | 60.8% (54.5–66.8) | 0.20 | 55/99 | 91/141 | 44% | −30.4 (−37.1 to −23.7) | 20/30 | 5/30 |
| S: same model, thinking off | 48.3% (42.1–54.6) | 0.07 | 86/99 | 30/141 | 82% | −42.9 (−50.4 to −35.8) | 23/30 | 25/30 |

Both directions fail for P. On misses (it clears a join Opus marks), Δsensitivity is −37 points (−48 to −27). On
false adds (it flags a join Opus calls ok), Δspecificity is −28 points (−37 to −20). Stratum by stratum, P agrees on
69/120 random joins (κ 0.11) and 73/120 flagged joins (κ 0.22). Flash agrees on 107/120 and 112/120.

**Against the decision rules:**
1. *Screener.* This needs Δagreement ≥ 0 with a lower bound above −5 points, Δsens ≥ −3, Δspec ≥ −5, and plants
   ≥ 28/30. P fails all four.
2. *Pre-filter* (a local "ok" skips agy). This needs ≥ 95% of Flash's 110 verified repairs kept, with ≥ 30% of joins
   cleared. P keeps **66/110 (60%)** and clears 55%, so it fails.
3. S is exploratory. It keeps 92/110, but only because it flags 82% of joins, so it would save few agy calls. It also
   flags 25 of 30 presumed-good joins, and 45 of its 240 replies did not parse. It parrots the JSON template
   (`"severity":"major|minor|..."`, `"evidence":"…"`), and 30 replies ran to the token cap.

**Noise floors.**
- *Local model:* P against R, same model and prompt with a different seed, agrees on **218/300 = 72.7% (κ 0.45)**.
  Its labels are mostly sampling noise; the model has no stable view of these joins.
- *Flash:* no designed repeat exists. The one incidental repeat is 30 tranche joins scored in both 2026-10-16 dry
  runs, with the same hashes. It agrees 29/30.
- *Opus:* no repeat on these 300.
- We did not spend the preregistered agy repeat, because P did not land within the bar's CI.

**What the misses look like.** The model reads the turn as English prose; it does not align the English with the
source.
- It missed 9 of the 30 planted breaks: 7 of the 15 "last sentence dropped" plants and 2 of the 15 duplicates. To
  catch a dropped sentence, you must notice that a source sentence has no English on either page.
- Its misses are mostly Opus `broken_syntax`, `drift` and `catchword` (minor). It also missed 4 major omissions.
- Its false adds are mostly running heads or titles that the prompt says are not defects: `APPENDIX clxxxiv`,
  `THE INSTRUCTOR, BOOK III.`, `KERMARIO.`. These come out as `broken_syntax`, `drift` or `other`.

**Throughput on this card** (KV-bound at 0.6 utilisation; the prompt averages 2,531 tokens):

| arm | in flight | joins/s | mean s/join | output tokens/join | ~330K tranche | 4.40M prose frame |
|---|---|---|---|---|---|---|
| P (thinking) | 8 | 0.12 | 66 | 1,395 | ~32 days | ~14 months |
| S (no thinking) | 16 | 0.51 | 31 | 232 | ~7.5 days | ~100 days |

At 0.12 joins/s, P is no faster than agy at 4 in flight (460 joins/h ≈ 0.13/s, lean dry run), and it would hold the
card for a month for the tranche alone.

**Not tested.**
- A VLM arm. Flash and Opus judged these joins from text, so an image adds nothing to the comparison.
- Page QC, the other half of the queue line. No Opus-labelled page-QC set exists to score it against. A 30-point gap
  on the easier, text-only join task leaves no reason to expect this model to do better there.
- Newer open checkpoints (Qwen3.5/3.8 class). They need a newer vLLM than `/root/pz/srv` has, and the 27B ones do not
  fit 0.6 × 24 GB at 8-bit.

**Spend.** $0. GPU time was about 1 h 45 min over three model loads (22:11–00:02Z), and the card read 2 MiB after each.
There were no agy, Claude or Gemini calls. Nothing was written to `pages` or any production store, and Mongo was not
read.

**Replicated?** The null result is replicated within this run: R reproduces P to within 2 points. The positive bar
(Flash ≈ Opus) is a single run.

**Artifacts.**
- Data: `scripts/eval/results/gpu-screener-6742/`. Per-join rows: `arm-{P,S,R}.jsonl.gz`. Every number above:
  `score.json`. Also `drive.sh` and `drive.log`.
- Script: `scripts/eval/seams-6742/local-screener.mjs` (`stage` / `run` / `score`).
- To re-score: gunzip the arms, then `node scripts/eval/seams-6742/local-screener.mjs score --arm=P=arm-P.jsonl
  --arm=S=arm-S.jsonl --arm=R=arm-R.jsonl`.
