## 2026-10-04 — Which page-image questions can Clef answer well enough to use? — RESULT

PRIOR ART: scripts/eval/experiments/2026-10-04-clef-vs-jev-instruction-page-screen.md — the text-only comparison; this is Clef's image input, scored against labels people made by eye (no new labels).

**Headline: one clear yes (does this text belong to this image?), two maybes (page language, spread), three no's.**
Clef (27B) and Clef-flash (9B) ran on Workers AI, with 1024px JPEG page images (~900 image tokens each).
Total $0.50 for ~2,300 calls. #5776 tracks the follow-ups.

| question | labels | result | verdict |
|---|---|---|---|
| **Text ↔ image match**: does this OCR transcribe this page? | 60 books, one page each; the page's own OCR vs the NEXT page's OCR (same hand/type) vs another book's OCR. Labels are constructed. | AUC match-vs-next: **Clef 0.996**, flash 0.990; match-vs-other: 1.00. At a 0.9 threshold Clef catches **60/60** next-page texts and flags 4/60 matched pages. Flash at 0.5: 34/34 caught with 0 false alarms on Latin-script pages, weaker on other scripts. | **Yes.** ~$0.0002/page (Clef) |
| Page language | 720 pages from #5122 / `benchmark/script-class/` (73% Chinese, 17% Greek) | Clef 95%, flash 92%. The catalogue disagrees with the eye label on 11%; Clef gets 62% of those right. When Clef disagrees with the catalogue at ≥0.5 confidence it is right 45/60. | **Maybe**: the sample is too narrow to generalise |
| Spread vs single page | the same 720 pages; **only 5 spreads** | AUC 0.999 (Clef), 0.996 (flash) | **Maybe**: 5 positives is a hint, not evidence |
| Script class (typeset / manuscript / woodblock) | the same 720 | 25%. 504/526 Chinese manuscripts called woodblock; outside CJK, 161/187 (86%) | **No** |
| White / show-through / real ink | 161 by-eye labels (`ocr-v19-labels.jsonl`) | Clef 76%, but **18/45 real-ink pages called show-through**; AUC for "carries text to OCR" is 0.74 | **No**: it misses real text |
| Produced before/after 1900 | 199 read-from-image labels (`ia-date-check`) | AUC 0.93, but the existing rule is 96% where it decides and Clef 89%; on the 36 the rule leaves unknown, Clef gets 69% | **No**: nothing gained over the rule |

**The four flagged "matched" pages are not obviously false alarms.** All four are Tibetan, Persian, Syriac or
classical-Chinese multi-folio scans. One was opened (read from image): `69e789124a6785cfd60d2a48` p66 holds three
Tibetan folios in one photo. The stored p66 OCR uses the ༔ punctuation of the first folio; p67's OCR opens with the
། punctuation of folios two and three. So the text may cover one folio of three. **Unverified**: Tibetan was not read.

**Not shown.** The match test pairs a page with its neighbour's text: a constructed off-by-one, not the real
wrong-leaf population (#3368, #5683). Real defects can be partial (one folio of three), and their rate on a real
suspect list is unmeasured. The next step is the #5309 controls (6 positive / 8 control books) plus a 200-page
random sample, human-read at the top.

**Artifacts.** `scripts/eval/jev/clef-leaf-match.mjs`, `scripts/eval/jev/clef-image-screens.mjs`; summaries
`scripts/eval/results/clef-leaf-match-2026-10-04.json`, `scripts/eval/results/clef-image-screens-2026-10-04.json`.
Rows stayed in the session scratchpad. Gotcha: a 1600px page is refused (~170K estimated tokens against a 64K window);
1024px works.
