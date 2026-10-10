---
stage: ocr
measure: accuracy
languages: [sa]
scripts: [Deva]
canons: []
n_books: null
n_pages: null
verdict: "Neither Clef (61% on 36 disputed one-mark Sanskrit slots, 22% order flips) nor Jev (39%) meets the 80% bar as an independent tie-break reader."
status: rejected
decision: "Neither adopted as the #6203 tie-break; it stays a person or a transcribing reader (#6203)"
superseded_by: null
issue: [6184, 6203]
---
## 2026-10-07 · Can Clef or Jev decide a one-mark Sanskrit reading, independently of Gemini? (#6184, #6203)

PRIOR ART: `2026-10-07-reader-diversity-temperature-vs-family-6184.md` (same 63 by-eye slots, Gemini arms);
`2026-10-04-clef-page-image-screens.md` (Clef's page-level text↔image AUC was 0.996); #6062 (Jev caught 21/21 planted
negation flips). Prereg: `PREREGISTRATION-clef-jev-6184.md` (first committed as commit `f24fd5ede`,
written before any call).

- **Design.** The question was a pair: which of two candidates is printed (Clef, given the image) or reads as
  coherent Sanskrit (Jev, text only, about 300 characters of context). Every item ran in both orders, and it
  counts as right only if both orders pick the print reading. Disputed items pit the Flash token against the
  lite token. Controls pit the print against a foil missing one ā (for c51 and c56, against the stored
  Flash error). The arms were `clef` on the by-eye line-band crop, `clef-flash` on the same crop, `clef` on the
  whole page (1,024 px), and `clef` on a tight 3-line window (exploratory). Jev was `typesafe-ai/jev` through the
  AI Gateway. 630 calls, **$0.086**. `measure: accuracy` (per token, against the print).
- **Result** (95% Clopper–Pearson CIs):

  | reader | disputed 36 | controls 27 | flips (orders disagree), all 63 | phi of wrongness with P0 |
  |---|---|---|---|---|
  | Clef, line crop | 22/36 = 61% [43–77] | 19/27 | 14/63 = 22% | −0.05 |
  | clef-flash, line crop | 15/36 = 42% [26–59] | 23/27 | 18/63 = 29% | 0.23 |
  | Clef, whole page | 19/36 = 53% [35–70] | 19/27 | 16/63 = 25% | 0.13 |
  | Clef, tight window | 20/36 = 56% [38–72] | 20/27 | 13/63 = 21% | −0.06 |
  | Jev, text only | 14/36 = 39% [23–57] | 24/27 | 16/63 = 25% | 0.23 |
  | *ref: Pro P0 / Pro-3 majority* | *29/36 = 81% / 32/36 = 89%* | *27/27* | — | — |
  | *ref: stored lite read* | *22/36 = 61%* | *25/27* | — | — |

  On the 31 slots where the Gemini arms split (F0/L1/P0), Clef on the line crop scored 20/31 = 65% and P0 25/31 = 81%.
  Exploratory check: using Clef as the tie-break wherever the three Pro reads split gives 59/63, the same as the
  Pro-3 majority alone.
- **Conclusion.** **Neither model qualifies as the independent tie-break reader for #6203.** The preregistered
  bar was ≥ 80% on the disputed slots, ≤ 10% flips and phi with P0 ≤ 0.2. Clef's errors are independent of Pro's
  (phi ≈ 0), and it is right on 5 of the 7 slots P0 gets wrong. But it is barely above chance on the disputed
  slots, and in a fifth of items its answer depends on the order of the candidates, so the independence buys
  nothing. Cropping hardly matters (line 61%, tight 56%, page 53%): at this one-mark grain Clef is not reading
  the glyph. Jev is below chance on real disputes (39%). It does well on the ā-drop foils (24/27), probably
  from morphology, so it is at most a weak coherence prior on synthetic foils, not a reader. The non-Gemini
  tie-break still has to be a person, or a reader that can transcribe (Claude, once the Hetzner key works).
- **Files.** `results/reader-diversity-6184/clef-jev/` (calls, results, per-slot table);
  `reader-diversity-6184/clef-jev-arms.mjs`, `clef-jev-analyze.mjs`.
