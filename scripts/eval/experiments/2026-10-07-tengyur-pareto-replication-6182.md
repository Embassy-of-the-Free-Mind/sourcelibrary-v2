---
stage: translation
measure: [judged_vs_reference, judged]
languages: [bo]
scripts: [Tibt]
canons: [derge-tengyur]
n_books: null
n_pages: 113
verdict: "G38's gain replicates on 113 fresh 84000 sides (+0.15, p = 0.0005) and 70 fresh weak-section pages (findings 61 to 29 per 100); +0.23 over production misses 0.25, so no default switch."
status: undecided
decision: "Pramana + Madhyamaka re-translation recommended, pending Derek; CLI run gated, nothing written (#6361); Tibetan default unchanged"
superseded_by: null
issue: [6182, 6121, 6361]
---
## 2026-10-07 · Tengyur: does gemini-3.8-flash's gain replicate on fresh texts, and where does each Gemini model sit on cost × fidelity? (#6182)
<!-- PRIOR ART: 2026-10-07-tengyur-newer-models-6121.md (#6121 round 2: G38 and Opus pass on 2 reference texts, 58 sides; this is its preregistered replication), 2026-10-03-tengyur-quality-arms-5497.md (the 113 sides aligned to 84000, reused unchanged), 2026-10-07-tengyur-open-models-6182.md (open and non-Gemini arms on the same 171 sides, companion packet). Scorer: scripts/eval/tengyur-levers/score-ref.py, given a `--round 6182` switch; rounds 1 and 2 re-score byte-identical. -->

**Question.** Round 2 of #6121 found that `gemini-3.8-flash` (G38) beats the stored Tengyur English on two reference texts. (A) Does that replicate on texts G38 has never been tested on, and on a fresh random sample of the weak sections? That decides re-translating Pramāṇa + Madhyamaka. (B) Which Gemini model sits on the cost × fidelity frontier for Tibetan, and is any of them worth a routing change?

**Answer.**
- **Rule A replicates on both instruments, so re-translating Pramāṇa + Madhyamaka with G38 is supported.**
  - **Reference judges, 113 fresh sides of 8 texts aligned to 84000:** G38 fidelity 4.80 against the stored English's 4.65, a gain of +0.15 [+0.06, +0.29 by-text bootstrap]. A production rerun moves fidelity by 0.04 (the floor). One-sided sign-flip p = 0.0005. Inversions fall from 8 to 4 (summed over both judges).
  - **AI reviewers, 70 fresh random Pramāṇa + Madhyamaka pages** (stage 2, gate passed at re-plant 2): reversal + agent findings per 100 pages fall from 61 to 29 (−33 [−56, −11], p = 0.004). A production rerun lands on the stored English (66).
- **Rule B does not make G38 the default Tibetan engine.** Over all 171 sides, G38 is the best Gemini arm (4.79), and production (`gemini-3-flash-preview`, 4.57) is still inside the preregistered 0.25 margin, by 0.025. So the cheapest arm inside the margin is production. Against production, G38 gains +0.23 [+0.12, +0.32]. That clears zero and the A-vs-A floor (+0.00 [−0.10, +0.09]) but falls short of the 0.25 effect the decision card requires. Graded exploratory: 10 referenced texts.
- **The two answers together:** G38 is the better translator on every measure here, at $2.34 per 1,000 pages against $1.78. The evidence supports using it to re-translate the sections with measured reversal problems. It does not, under the preregistered margin, justify switching all new Tibetan translation.
- **Re-translation cost at this run's billed rate ($2.34/1K):** about $55 for Pramāṇa + Madhyamaka (round 2 quoted $52 at $2.21/1K), and about $86 with Vinaya and Jātaka. On Vinaya and Jātaka the evidence is reviewer-only and exploratory (15 pages each): Jātaka passes (120 → 33 per 100, p = 0.008), Vinaya does not (40 → 33, p = 0.50). Neither section has a reference-aligned side.

These are AI judges and reviewers (Opus), not a human review. Opus (O) is the same model family as every judge. G38 is not, and nothing above rests on O.

**Design** (preregistered at `1c6dd00bd`, `scripts/eval/pareto-6182/PREREG.md`).
- **Sides:** `tib-ref58` (#6121's 58: D4231 Pramāṇa against Stcherbatsky, 28; D3862 Madhyamaka against La Vallée Poussin, 30) and `tib-ref113` (#5497's 113 sides of Toh 3808, 1183, 1189, 4377, 4400a, 3990, 1777, 1996, against 84000). Rule A runs on the 113 only. The 58 are where round 2 chose G38, so they are in-sample.
- **Arms:** 11 per side in one blinded item: S (stored), FP and AA (two production reruns), L31, L35, G35, G36, G37, G38, PRO, and O. Production's one-page v13 request, no context, Batch.
- **Judges:** two blind Opus judges, `JUDGE-PROMPT-REF-R3.md`, labels shuffled per item. Each judge also got 8 PLANT items (FP beside FP with one planted negation flip) and 4 DUP items.
- **Gate (prereg: plant caught in ≥ 6 of 8, duplicates tie in ≥ 3 of 4):** J1 8/8 and 4/4; J2 8/8 and 4/4. Under the stricter reading (inversion listed AND lower fidelity), J1 8/8 and J2 7/8. Both judges are scored.
- **Fidelity** per side × arm is the mean of the two judges. **CIs** are two-stage by-text bootstraps (texts with replacement, then sides within each text; 2,000 draws, seed 6182), because sides of one text are not independent. With one text in a stratum this reduces to a side bootstrap. With 2–4 texts (Tantra, Miscellaneous) the intervals are unstable and not quoted.
- **Inter-judge agreement**, 1,881 side × arm pairs: exact fidelity 79.2 %, within one grade 99.9 %, Pearson 0.70. Inversion flags agree on 97.2 % (κ 0.77). J1 flagged 108, J2 132, both 94. The judges rank the arms in the same order at the top (O, G38, G37, PRO) and the bottom (L35, L31). G38 − S: J1 +0.16, J2 +0.20.

**Result** (2026-10-07; $/1K = Batch rate billed on this run; S and AA are production's engine at its price; O at the API list rate, a ceiling and never a lane):

| arm | $/1K Batch | fidelity, 113 fresh [by-text CI] | Δ vs S, 113 | fidelity, all 171 [CI] | Δ vs FP, 171 | inversion sides /100 | inversions /100 | omissions /100 | inventions /100 | Pramāṇa (28) | Madhyamaka (30) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| O | 19.1 | 4.84 [4.69, 4.92] | +0.19 [+0.06, +0.35] | 4.85 [4.77, 4.92] | +0.29 [+0.16, +0.40] | 4.7 | 4.1 | 0.6 | 7.9 | 4.91 | 4.87 |
| G38 | 2.34 | 4.80 [4.68, 4.89] | +0.15 [+0.06, +0.29] | 4.79 [4.71, 4.86] | +0.23 [+0.12, +0.32] | 2.9 | 1.8 | 2.3 | 8.8 | 4.84 | 4.73 |
| G37 | 2.33 | 4.77 [4.61, 4.85] | +0.12 [+0.00, +0.26] | 4.72 [4.58, 4.82] | +0.16 [+0.02, +0.27] | 5.8 | 5.0 | 2.6 | 8.5 | 4.75 | 4.53 |
| PRO | 15.41 | 4.67 [4.59, 4.81] | +0.02 [-0.09, +0.29] | 4.64 [4.56, 4.73] | +0.08 [-0.05, +0.21] | 2.9 | 2.3 | 4.7 | 4.4 | 4.55 | 4.63 |
| G36 | 2.36 | 4.68 [4.46, 4.79] | +0.04 [-0.10, +0.15] | 4.62 [4.47, 4.73] | +0.05 [-0.09, +0.17] | 5.8 | 5.0 | 8.5 | 17.0 | 4.52 | 4.47 |
| S | 1.78 | 4.65 [4.47, 4.74] | — | 4.61 [4.49, 4.70] | +0.05 [-0.07, +0.14] | 6.4 | 5.3 | 5.6 | 16.7 | 4.48 | 4.62 |
| AA | 1.78 | 4.61 [4.43, 4.73] | -0.04 [-0.13, +0.10] | 4.57 [4.43, 4.68] | +0.00 [-0.10, +0.09] | 6.4 | 5.6 | 5.8 | 20.2 | 4.61 | 4.38 |
| FP | 1.78 | 4.61 [4.48, 4.75] | -0.04 [-0.14, +0.13] | 4.57 [4.46, 4.68] | — | 7.0 | 5.8 | 5.6 | 15.5 | 4.52 | 4.45 |
| G35 | 5.48 | 4.59 [4.46, 4.70] | -0.05 [-0.18, +0.11] | 4.55 [4.44, 4.65] | -0.01 [-0.14, +0.10] | 8.8 | 7.3 | 5.6 | 13.7 | 4.41 | 4.53 |
| L35 | 1.27 | 4.16 [4.00, 4.38] | -0.49 [-0.67, -0.17] | 4.09 [3.97, 4.23] | -0.47 [-0.62, -0.32] | 17.0 | 14.9 | 14.0 | 23.1 | 3.95 | 4.00 |
| L31 | 0.83 | 4.15 [3.96, 4.28] | -0.50 [-0.66, -0.33] | 4.08 [3.91, 4.22] | -0.49 [-0.64, -0.35] | 17.5 | 16.1 | 26.0 | 20.8 | 3.91 | 3.95 |

Inversion sides = sides where either judge listed a reversal. Inversions, omissions and inventions = items listed per 100 sides, mean of the two judges.

- **Frontier (Gemini lanes + O):** L31 → L35 → FP → G37 → G38 → O. **Dominated:** G35, G36 and PRO, each by G38 (cheaper, or nearly the same price, and higher fidelity). PRO costs 6.6× G38 for lower fidelity and the same inversion rate.
- **Flash-Lite is not a Tibetan lane.** L31 and L35 sit about 0.5 below production, with 2.5× its inversion sides and up to 4.6× its omissions.
- **Per text (rule A at each text with ≥ 20 sides):** Toh 1183 passes (+0.16, p = 0.016). Toh 3808 gains +0.11 but production's own rerun moves it by 0.11, so it does not clear the floor. Toh 1189 gains +0.14 at p = 0.14. The pooled pass is not carried by one text.
- **Pramāṇa and Madhyamaka by reference (the 58, in-sample):** G38 +0.36 [+0.20, +0.54] on D4231 with 0 inversion sides (S: 2). On D3862, +0.12 [−0.08, +0.33] with 1 inversion side (S: 4). Round 2 measured +0.48 and +0.30 on these same sides in a 5-arm packet. The 11-arm packet compresses the gaps. Madhyamaka alone is the weakest leg: its reviewer result also does not pass on its own (27 → 17 per 100, p = 0.29, because the stored English was already low there).
- **The 84000 texts are not the weak sections.** Every arm scores higher on them (S 4.65) than on the 58 (S 4.55). The reviewer sample is drawn from the weak sections. The two instruments cover each other, as the prereg intended.

**Not done.**
- **By eye** (prereg: 20 findings per stratum read against the source): not run in this scoring job ($0, no model calls).
- **Other strata** (Latin, Greek, T3–T5): judging is still running and is scored separately (`score-xl-6182`).
- **Charts** on /quality: not part of this job.

**Decision.** Re-translate Pramāṇa + Madhyamaka with G38 (≈ $55 Batch): **Derek's call; recommended yes.** Keep production as the default for new Tibetan translation (rule B). Vinaya and Jātaka: hold until a reference-aligned or larger reviewer sample exists. Nothing has been re-translated.

**Files.** `scripts/eval/results/pareto-6182/tibjudge/scores.json` (numbers only; judge outputs and reference text stay on the box under `/root/pareto-6182/tibjudge/`). Run: `python3 scripts/eval/tengyur-levers/score-ref.py --round 6182` (calls `scripts/eval/pareto-6182/score-tib.py`). $0.
