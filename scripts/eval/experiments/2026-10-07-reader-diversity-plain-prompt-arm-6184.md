---
stage: ocr
measure: accuracy
languages: [sa]
scripts: [Deva]
canons: []
n_books: 2
n_pages: 30
verdict: "Flash with Pro's plain prompt reads 79% of 63 Sanskrit mark slots against Pro's 90%, under the 85% bar: Pro's lead is the model, not the prompt."
status: informational
decision: "By the preregistered rule 'Pro decides' stands for the Sanskrit tie-break; a Devanagari prompt clause is proposed for A/B (#6203)"
superseded_by: null
issue: [6184, 6203]
---
## 2026-10-07 · Is Pro's lead on Sanskrit marks the model or the prompt? (#6184)

PRIOR ART: `2026-10-07-reader-diversity-temperature-vs-family-6184.md` (Pro 90% vs Flash v19.1 73% on the same
63 tokens, with the caveat that Pro also ran a different prompt). Prereg: the addendum to
`PREREGISTRATION-reader-diversity-6184.md` (commit `1986ffbe6`, pushed before the first call).

- **Question.** Pro used the plain "transcribe exactly" prompt and Flash used production v19.1. If Flash gets
  the plain prompt, does it reach Pro?
- **Design.** Same 30 pages, the same 63 by-eye slots, and the same `score-lib.mjs`. FP = Flash and LP = lite,
  each with Pro's exact plain prompt, T 0.1, thinking 0, ×3 per page. That is 180 realtime calls,
  **$0.379 metered** (cap $0.50). Flash plain costs $0.0028/page against $0.0047 for v19.1, because the prompt is
  shorter. 17 FP calls first ended in RECITATION, against 3 for LP, and all of them succeeded on retry.
  `measure: accuracy` (per token, against the print).
- **Result.** Counts are k/n, 95% Clopper–Pearson CIs, reads pooled over samples.

  | reader | all 63 | disputed 36 | controls 27 |
  |---|---|---|---|
  | Flash v19.1 T 0.1 (F0) | 46/63 = 73% [60–83] | 58% | 25/27 |
  | **Flash plain T 0.1 (FP)** | **150/189 = 79% [73–85]** | 67% | 78/81 |
  | lite plain T 0.1 (LP) | 148/189 = 78% [72–84] | 68% | 75/81 |
  | Pro plain (P) | 171/189 = 90% [85–94] | 83% | 81/81 |

  | vote (strict majority = print) | all 63 |
  |---|---|
  | 3× FP | 50 = 79% [67–89] |
  | FP + LP + Pro P0 | 56 = 89% [78–95] |
  | 3× Pro | 59 = 94% [85–98] |

  Error correlation, all slots (phi; P(B wrong given A wrong)):

  - FP vs Pro: 0.18; 0.20. For comparison, F0 vs Pro is 0.13; 0.16.
  - **FP vs LP: 0.02; 0.23.** Under v19.1 at T 1.0, Flash vs lite was 0.23.
  - FP vs F0: 0.48; 0.69.
  - FP sample vs FP sample: 0.94. Plain-prompt reads at T 0.1 barely vary: 3 of 63 slots differ across the 3 samples.
- **Decision (preregistered rule): the lever is the MODEL, so "Pro decides" stands.** FP is 79.4%, below the
  85% bar (the lower bound of Pro's CI). The prompt helps Flash, but not significantly. Paired on slots, the FP
  majority is right where F0 is wrong on 8 slots, and wrong where F0 is right on 4 (exact p ≈ 0.39). Pro's lead
  over plain Flash is about 11 points, and the two CIs barely touch.
- **Decorrelation.** Changing the prompt does *not* move Flash's errors further from Pro's: phi goes from 0.13
  to 0.18. It does make Flash and lite almost independent of each other (phi 0.02). So a plain-prompt Flash + lite
  pair nominates candidates with little overlap, and a three-read majority with Pro rises from 83% to 89%. Pro
  alone ×3 still does better (94%).
- **Production implication (not changed; proposal for #6203).** v19.1 at T 0.1 is less stable on these marks
  than the plain prompt. Fresh v19.1 against the stored Batch read differs on 16 of 63 slots, while plain-prompt
  samples differ on 3 of 63. That points to the long tagged prompt, not the model, as the source of the
  sample-to-sample drift. A Devanagari-only clause in the OCR prompt ("do not correct, normalise or emend; keep
  every vowel sign, virāma and avagraha") is worth a tagged-prompt A/B. It would win at most ≈ 6 points on Flash,
  and this n cannot show even that. The prompt is not a substitute for Pro as the decider.
- **Caveats.** n = 63 slots from two volumes of one edition, and the disputed slots were selected for
  lite ≠ Flash. F0 is one read per page, while FP is three. 14 FP and 20 LP slot-reads went to the page-wide
  fallback (0 and 3 of them scored right). The plain prompt drops the structured tags production needs, so FP
  is a diagnostic arm, not a candidate production prompt.
- **Replicated?** No.
- **Artifacts.** `results/reader-diversity-6184/plain-prompt/` (`results.md` with the per-slot table,
  `results.json`, and `calls.jsonl` with per-call usage, no text). The scorer is
  `reader-diversity-6184/analyze-plain.mjs`, and the runner is `run-arms.mjs --arms=FP,LP --cap=0.48`. Read
  texts stay on Hetzner (`/root/rd-6184/reads-plain.jsonl`) because both volumes are held.
