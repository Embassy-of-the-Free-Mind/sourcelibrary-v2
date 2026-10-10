---
stage: ocr
measure: accuracy
languages: [sa]
scripts: [Deva]
canons: []
n_books: 2
n_pages: 30
verdict: "Temperature samples share errors (Flash vs Flash phi 0.55) where Flash vs Pro is 0.09; a 5x Flash T1.0 vote reads 65% of 63 Sanskrit mark slots, 3x Pro 94%."
status: rejected
decision: "Temperature sampling not used as a detector or voter; recipe proposed as Pro decides, Flash and lite nominate (#6184)"
superseded_by: null
issue: 6184
---
## 2026-10-07 · Do temperature samples find Sanskrit OCR errors as well as a second model family? (#6184)

PRIOR ART: the #6184 tie-break (majority of Flash + lite + Pro, 9/10 right when it added a mark and 6/12
when it removed one). Prereg: `PREREGISTRATION-reader-diversity-6184.md` (commit `4a6ef6289`, written before any paid call).

- **Question.** (a) Is a typical error *confident* (the same wrong token in every sample) or *uncertain*
  (it varies at temperature 1.0)? (b) Are errors less correlated across families (Flash, lite, Pro) than
  across temperature samples of one model?
- **Design.** Tattvasaṃgraha vols I/II, 30 pages, 63 token slots read by eye against the scan: 36 disputed
  (lite ≠ Flash) and 27 seeded controls (lite = Flash). 6 unreadable slots were dropped. Arms: Flash v19.1
  prompt at the served T 0.1 (F0, ×1); Flash T 1.0 (F1, ×5); lite T 1.0 (L1, ×5); Pro
  `gemini-3.1-pro-preview` with the plain "transcribe exactly" prompt and thinking 128 (stored T 0 read
  + 2 at T 1.0). The stored served Flash and lite reads (Fs, Ls) were scored too. All realtime, 390 calls,
  **$2.13 metered** at list price (cap $3). `measure: accuracy` (per token, against the print).
- **Result.** Counts are k/n, 95 % Clopper–Pearson CIs.

  | reader | per-read accuracy, all 63 | disputed 36 | controls 27 |
  |---|---|---|---|
  | Flash T 0.1, fresh (F0) | 46/63 = 73% [60–83] | 58% | 25/27 |
  | Flash T 0.1, stored served (Fs) | 39/63 = 62% [49–74] | 39% | 25/27 |
  | Flash T 1.0 (F1, 315 reads) | 67% [62–72] | 49% | 91% |
  | lite T 1.0 (L1, 315 reads) | 68% [63–73] | 53% | 88% |
  | Pro, plain prompt (189 reads) | **90% [85–94]** | 83% | **81/81** |

  | vote (strict majority = print) | all 63 | disputed 36 |
  |---|---|---|
  | F0 alone | 46 = 73% | 21 |
  | 5× Flash T 1.0 | 41 = 65% [52–77] | 16 |
  | Flash + lite + Pro, one each (fresh) | 52 = 83% [71–91] | 26 |
  | 3× Flash T 1.0 + Pro | 40 = 63% | 15 |
  | 3× Pro | **59 = 94% [85–98]** | 32 |

  Pairwise error correlation, all slots (phi; P(B wrong | A wrong)): Flash sample vs Flash sample
  **0.55; 0.64**. lite vs lite 0.61; 0.74. Flash vs lite 0.23; 0.47. Flash vs Pro **0.09; 0.13**. lite vs
  Pro 0.23; 0.20. Pro vs Pro 0.26; 0.29.

  Errors are mostly omissions in every arm. Flash: 56 omissions, 28 insertions, 19 substitutions. lite:
  64 / 20 / 16. Pro: 15 / 3 / 0.

  Two Flash reads at the served config (fresh realtime F0 vs the stored Batch read) differ on **16 of 63
  slots**.
- **(a), by the preregistered rule: errors are typically uncertain.** Of the 17 slots where F0 is wrong,
  the 5 Flash samples vary on 10/17 = 59% [33–82], all repeat the same wrong token on 3/17, and all are
  right on 4. For the stored served read the split is 18/24 = 75% [53–90]; for lite, 16/19. **But the
  flag is not usable.** "Any sample differs" catches 59% of F0's errors (below the preregistered 70%) at
  33% precision. Temperature 1.0 also *invents* errors F0 does not make: II p91 सकल्पनत्वाच्च → सकल्पनात्वाच्च
  in all five samples, and II p300 कारणभेदप्रतिनियमोऽस्ति garbled five different ways. The flag also fires
  on 6 of the 27 controls, of which only 2 are wrong.
- **(b), by the preregistered rule: family decorrelates errors; temperature does not.** Within-Flash phi
  is 0.55, against 0.09 for Flash vs Pro, so the gap is far above the 0.10 margin. When a Flash sample is
  wrong, another Flash sample is wrong 64% of the time and Pro 13% of the time. lite sits between the two
  (0.23 with Flash, and the same slips Pro makes: 0.23 with Pro). Lite and Flash are one family here; Pro
  is the different reader. Voting over Flash samples is *worse* than the single T 0.1 read (65% vs 73%),
  because T 1.0 lowers per-read accuracy.
- **What it implies for the reader recipe.** For Devanagari length marks, virāma and negation, the lever
  is a Pro read, not more samples. One Pro read is right 89–92% of the time. It cost $0.0155/page realtime here,
  and $0.007 on Batch in the tie-break. That beats every Flash/lite combination, and costs less than 5× Flash at
  T 1.0 ($0.024/page measured).
  The tie-break's "Pro + two Gemini reads" majority should become "**Pro decides; Flash and lite only nominate
  candidates**". Do not use temperature sampling as a detector or a voter.
- **Caveats.** Pro ran a different prompt (plain "transcribe exactly" against v19.1 with tags), so the
  gap is model + prompt. A Flash arm with the plain prompt is the cheap test that separates the two
  (≈ $0.15). n = 63 slots on two volumes of one Sanskrit edition; the disputed slots were selected for
  lite ≠ Flash. No non-Gemini reader: the Hetzner Anthropic key is 401, so that arm is missing. 128 of
  1,008 slot-reads were decided page-wide, because the read held a third variant that the window could
  not match. Only 3 of those were scored right.
- **Replicated?** No. The A-vs-A at the served config (16/63 slots differ) says a single served read is
  itself a sample on these marks.
- **Artifacts.** `results/reader-diversity-6184/` (`results.md` with the per-slot table, `results.json`
  with per-read spans, `gt-eye.jsonl` by-eye ground truth, `calls.jsonl` with the usage per call),
  scripts in `reader-diversity-6184/`. The full read texts stay off the repo (`/root/rd-6184/reads.jsonl`
  on Hetzner), because both volumes are hidden and held.
