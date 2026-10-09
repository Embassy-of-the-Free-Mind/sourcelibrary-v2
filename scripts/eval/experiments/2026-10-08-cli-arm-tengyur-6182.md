## 2026-10-08 · Can the Tengyur re-translation run through the Antigravity CLI (subscription) instead of the API? (#6182) — gate PASSED

PRIOR ART: `scripts/eval/tengyur-levers/PREREG-R2.md` (#6121 round 2) and `scripts/eval/pareto-6182/PREREG.md`. Same 58
reference-aligned sides, same judge prompt (`JUDGE-PROMPT-REF-R2.md`, verbatim), same packet builder and scorer
(`build-ref-packet.py --round cli6182`, `score-ref.py --round cli6182`), same two-stage by-text bootstrap as
`pareto-6182/score-tib.py`. Nothing redrawn.

**Question.** Arm **C38** is `gemini-3.8-flash-low` through `agy -p` (Google subscription sign-in, no API key), the
identical v13 one-page prompt string arm O used, one page per call. Does it translate the Tengyur as well as the API's
`gemini-3.8-flash` (**G38**), so the re-translation could run on subscription quota instead of the ~$55 API job?

**Preregistered gate** (#6182 comment, 2026-10-08 07:13 UTC, before any judging):
pass only if C38 − G38 mean fidelity has a by-text bootstrap 95% lower bound above −0.15 (the A-vs-A interval was
[−0.10, +0.09]) **and** C38 inversion sides ≤ G38 inversion sides + 2. Judge gate as round 2: each judge catches
≥ 5 of 6 planted reversals and ties ≥ 3 of 4 duplicates.

**Design.** 58 sides (28 Pramāṇa = D4231 against Stcherbatsky 1930; 30 Madhyamaka = D3862 against La Vallée Poussin
1907). Each item: C38, G38 and FP (production `gemini-3-flash-preview`; on these sides round 1's `A`) in random
order, plus 6 PLANT items (FP beside FP with one planted reversal, seed 6183) and 4 DUP items (stored English beside
itself) — 68 items. Two blind Opus judges (claude-opus-5-5 subagents on the subscription), 6 parts each, at most 6 at
a time; judges saw T1–T3 labels only. Fidelity per side = mean of the two judges; an inversion side = either judge
listed an inversion. $0 billed; no Gemini call, no database write.

**Judge gate: PASS.** J1 6/6 plants, 4/4 duplicates tied; J2 6/6, 4/4. The judges' fidelity scores agree within 1
point on 100% of side × arm pairs.

**Result** (58 sides; fidelity 1–5; inversion / omission / invention sides = either judge):

| | fidelity | inversion sides | omission sides | invention sides | span off |
|---|---|---|---|---|---|
| C38 (CLI) | 4.72 | 2 | 4 | 4 | 1 |
| G38 (API) | 4.66 | 3 | 3 | 3 | 0 |
| FP (production) | 4.27 | 6 | 10 | 11 | 3 |

| difference | pooled (58) | Pramāṇa (28) | Madhyamaka (30) |
|---|---|---|---|
| C38 − G38 | **+0.06 [−0.10, +0.23]** | −0.02 [−0.18, +0.14] | +0.13 [−0.05, +0.33] |
| C38 − FP | +0.46 [+0.28, +0.64] | +0.54 [+0.30, +0.75] | +0.38 [+0.17, +0.58] |
| G38 − FP | +0.40 [+0.16, +0.64] | +0.55 [+0.38, +0.73] | +0.25 [+0.07, +0.43] |

C38 − G38 per side: 11 higher, 8 lower, 39 tied. Per section, C38 / G38 fidelity: Pramāṇa 4.75 / 4.77
(inversion sides 1 / 1), Madhyamaka 4.70 / 4.57 (1 / 2).

**Verdict.** Lower bound −0.10 > −0.15, and C38 inversion sides 2 ≤ 3 + 2: **the gate passes.** On this measure the
CLI arm is not distinguishable from the API arm, and both beat production by about 0.4–0.5.

**Limits.**
- AI judges (Opus), not a human reader; the reference anchors them, the arms are unlabelled.
- 58 sides from **2 texts**, both already used in #6121 round 2 and #6182's tib-ref58 stratum, so this is not a fresh
  sample. With 2 texts the by-text bootstrap is a coarse interval; within one section it reduces to a by-side
  bootstrap. Taken alone, the Pramāṇa lower bound (−0.18) would not clear −0.15; the preregistered gate is the pooled one.
- Not measured: the subscription quota ceiling for the full job (~23.5K pages), CLI reliability at that scale,
  and the CLI's ~11.6K-token system prompt riding on every call. The gate writes nothing to pages.

**Replicated?** No.

**Artifacts.** `scripts/eval/results/cli-arm-6182/refjudge/key.json` (blinding key), `scores.json` (numbers only).
The judge packets and outputs quote the copyrighted references and stay on the box (`/root/tlev3/refjudge/`).
Arm output: `/root/tlev/arms/C38-ref.jsonl`.
