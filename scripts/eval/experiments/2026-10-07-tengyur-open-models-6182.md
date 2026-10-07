## 2026-10-07 · Tengyur: do open and non-Gemini models (Gemma 4, Qwen 3.6, DeepSeek V4) belong on the translation frontier? (#6182)
<!-- PRIOR ART: 2026-10-07-tengyur-newer-models-6121.md (round 2: G38 and Opus on the 58 sides, the judge prompt and controls reused here) and scripts/eval/pareto-6182/PREREG.md (the #6182 Pareto set, its pages, request and rule B). This adds non-Gemini arms on the same pages and request, per PREREG-open-arms.md. -->

**Question.** Derek, 2026-10-07: "we should run qwen or some other model on it maybe? didn't google output a new gemma?" Does any open or non-Gemini model translate the Tengyur well enough, or cheaply enough, to sit on the cost × fidelity frontier next to `gemini-3-flash-preview` (production, FP) and `gemini-3.8-flash` (G38)?

**Answer.** **No.** All six arms are far below production on the 171 Tengyur sides that have a published reference (58 Stcherbatsky / La Vallée Poussin + 113 84000). None is within PREREG.md's 0.25 margin, and none can be a routing proposal.

- The best is `deepseek/deepseek-v4-pro`, at −0.71 [−0.87, −0.56] fidelity against FP.
  - It has 16 inversion pages per 100 against FP's 5.
  - It breaks the output contract on 15 of 171 sides (echoes the Tibetan, or answers outside English).
- The Gemma 4 arms are the cheapest points, but they are 1.5–1.9 fidelity points down. They are not usable for this canon.
- Every Qwen 3.6 arm is dominated.

| arm | model (exact id, 2026-10-07) | weights | fidelity [95 % CI] | Δ vs FP [95 % CI] | inversion pages /100 | $ / 1,000 pages |
|---|---|---|---|---|---|---|
| G38 | `gemini-3.8-flash` (anchor) | closed | 4.87 [4.83, 4.92] | +0.14 [+0.08, +0.20] | 2.3 | 2.34 Batch |
| FP | `gemini-3-flash-preview` (production, anchor) | closed | 4.73 [4.67, 4.80] | — | 4.7 | 1.78 Batch |
| DSP | `deepseek/deepseek-v4-pro` | open | 4.02 [3.88, 4.15] | −0.71 [−0.87, −0.56] | 16.4 | 0.45 StreamLake (1.55 as routed) |
| QMX | `qwen/qwen3.6-max-preview` | closed, preview | 3.91 [3.81, 4.01] | −0.82 [−0.94, −0.71] | 26.9 | 7.84 |
| QPL | `qwen/qwen3.6-plus` | closed | 3.83 [3.75, 3.92] | −0.90 [−1.00, −0.80] | 26.3 | 2.44 |
| GM31 | `gemma-4-31b-it` | open | 3.27 [3.20, 3.36] | −1.46 [−1.55, −1.36] | 35.1 | 0.48 list ($0 billed, Gemini API) |
| GM26 | `gemma-4-26b-a4b-it` | open | 2.81 [2.72, 2.89] | −1.93 [−2.04, −1.82] | 50.9 | 0.46 list ($0 billed, Gemini API) |
| Q27 | `qwen/qwen3.6-27b` | open | 2.55 [2.46, 2.64] | −2.19 [−2.29, −2.08] | 45.6 | 3.59 |

- **Frontier, inside this packet:** GM26 → GM31 → DSP → FP → G38.
  - Dominated: QMX and QPL (by DSP), Q27 (by GM26).
  - Best: G38. Inside the margin: FP and G38 only. Recommended: FP, which is production. The open arms change nothing.
- **Same in both page sets.** On the 58 sides alone, DSP is −0.67 and GM31 −1.51. On the 113 alone, they are −0.73 and −1.43.

**How it was measured.**
- **Request.** Each arm got the same request as pareto-6182's arms:
  - production's one-page v13 prompt string, from `/root/pareto-6182/units.jsonl`, as the only user message;
  - temperature 1.0, thinking/reasoning off.
  - Gemma 4 thinks by default: 2–4K thought tokens a page, and MAX_TOKENS on the Tengyur. It refuses `thinkingBudget` and runs at 0 thoughts with `thinkingLevel: minimal`.
  - Every judged row billed 0 reasoning tokens.
- **Format check, 3 off-sample pages per arm.**
  - QMX and DSP echoed the Greek source on 1 of 3 pages. One system-line wrapper fixed both.
  - `deepseek/deepseek-v4-flash` still echoed after the wrapper and was **dropped**.
- **Judging.** A companion packet (`build-open-packet.py`, seed 6182) put the six open arms plus FP and G38 in each item (8 candidates).
  - Two blind Opus judges used `JUDGE-PROMPT-REF-R3.md` verbatim.
  - **Gate passed:** both judges caught 8 of 8 planted reversals and tied 4 of 4 duplicates. The two judges' fidelity scores were within 1 point of each other on every candidate.
- **Cost.** OpenRouter's billed `usage.cost`, realtime; these models have no Batch tier.
  - Gemma bills $0 on the Gemini API. Its point is plotted at OpenRouter's list price on its measured tokens.
  - DSP: OpenRouter sent 25 of its first 101 calls to Novita at 15× StreamLake's price before the provider was pinned. Both figures are shown.
- **Self-hosted cost: not measured.** H100 and L40S were in shortage in every Scaleway zone. The available L4 (24 GB) cannot hold any of the open arms unquantized.
- **Tibetan-adapted model: none qualifies.**
  - The ACL 2026 continual-pretraining Tibetan models have no public weights or endpoint.
  - The public `pkupie/*-bo-cpt` checkpoints are 1.5–4B base models with no instruction tuning.
  - MITRA-MT was not re-run (#4742).

**Threats.**
- This is a companion packet, not pareto-6182's own items. Absolute fidelity here is anchored only by FP and G38 being in every item. The Δ against FP is the primary measure.
- Anchored fidelity (pareto-6182's FP score + Δ) is pending its Tengyur scores. They were stopped by the subscription limit on 2026-10-07.
- The judges are Opus. No arm here is Claude, so self-preference does not favour these arms.

**Not done.**
- **Other languages (xl, 365 pages).** GM31, GM26, QPL and DSP outputs exist in `/root/po6182/arms/`; Q27 and QMX did not fit the $5 cap. The records for the #5695 harness are built (`build-open-xl.py`).
- xl judging (~60 Opus runs) was not started: the shared subscription window was exhausted, and pareto-6182's own judging comes first.
- Reviewer rates: no open arm landed inside the margin, so per the amendment none went to the reviewers.

**Spend.** $3.73 OpenRouter (cap $5, ledger `/root/po6182/ledger.jsonl`), $0 Gemini. Judges ran on the subscription (48 runs, ≈ 7.4M tokens).

Files: `scripts/eval/pareto-6182/{PREREG-open-arms.md, run-open-arms.mjs, build-open-packet.py, score-open.py, build-open-xl.py}`, `scripts/eval/results/pareto-6182/open/{refjudge/key.json, refjudge/scores.json, frontier-points.json}`. Branch `eval/pareto-open-6182`.
