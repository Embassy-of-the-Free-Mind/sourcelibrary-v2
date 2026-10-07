## 2026-09-24 — Can Jev judge page-break continuity? Pilot against the 48 Sonnet-judged junctions (#4681 follow-up, Derek's question)

**Headline: as an independent per-side scorer, Jev agrees with the eight Sonnet judges on 5 of 6
junctions both sides decided (AUC 0.79 over the 15 judge-decided junctions), is near-perfectly
silent on the same-lane A/A pairs (15 of 16 TIE, mean |margin| 0.04), and cost $0.006 for 192
calls. As a PAIRED comparator it leans RIGHT (7–1 on the A/A pairs, p=0.07) and agrees less
(κ 0.21). Use the side form, order-free, as the first-pass screen for large seam draws, with
Sonnet on the decided subset; do not use the paired form without scoring both orders.**

*Setup.* Calibration set = today's blinded packet (`translation-batch-shadow-judge-packet.jsonl`,
48 junctions: 32 lane vs production, 16 same-lane A/A) and the merged verdicts of eight
independent Sonnet judges. Jev (TypeSafe System One via the Vercel AI Gateway, `typesafe-ai/jev`,
noul questions, OIDC bearer) saw neither key nor verdicts. Per junction: `side_L`, `side_R` (one
call per side, "reads as one translator continuing across the break…"), and `pair_L`/`pair_R`
(one call with both sides, "LEFT continues more convincingly than RIGHT" and the reverse).
Verdict = sign of the margin with a ±0.10 tie band. Script `scripts/eval/jev/seam-continuity-pilot.mjs`;
result `results/jev-seam-continuity-pilot-2026-09-24.json`.

| design | exact agreement (3-class) | κ | judge-decided & Jev-decided | same side | AUC (margin → judge L/R, n=15) | A/A pairs (n=16) |
|---|---|---|---|---|---|---|
| side (two calls) | 77% | 0.41 | 6 | 5 (83%) | 0.79 | 15 TIE · 0 L · 1 R, mean \|m\| 0.04 |
| pair (one call) | 46% | 0.21 | 14 | 10 (71%) | 0.80 | 8 TIE · 1 L · 7 R (p=0.07) |

*Read.* The side form is conservative — it called TIE on 9 of the 15 junctions the judges decided
— but when it decides it agrees, and it does not manufacture preferences under the null, which is
the property a judge must have (memory: *a judge that cannot say TIE reports its own noise*). The
paired form sees more but carries a position lean; the fix is to score both orders and average,
which doubles its cost to a still-negligible figure. Spend: 137,540 input tokens, **$0.0058**.

*Caveats.* n=15 decided junctions is a pilot, not a validation; most of the packet's ties are
page breaks between fragments or at headings (the draw was not filtered to mid-flow seams). The
Sonnet judges are the reference here, not ground truth — the three production wins read against
the source earlier today are the only human-checked labels. Jev's "continuity" may partly be
"fluency": a leaked previous page (#5026) reads perfectly continuous, so this question cannot
catch leakage — the string scan does that.

*Use.* For the decisive seam draw (handoff `2026-09-24-batch-seam-decisive-rerun.md`): run the side
form over every junction, both lanes, order-free; report the Jev margin distribution against the
A/A floor; send Sonnet only the junctions where Jev's margin exceeds the A/A band, plus a random
tenth of the rest as its own control. For a corpus-scale seam audit of production (every block
boundary of every book), the side form at ~$0.00003 per junction is the first instrument we have
had that is affordable at that scale; calibrate it on this set before quoting any rate.
