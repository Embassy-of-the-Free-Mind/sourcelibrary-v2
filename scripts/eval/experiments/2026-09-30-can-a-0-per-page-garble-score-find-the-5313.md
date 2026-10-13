---
stage: ocr
measure: judged
languages: []
scripts: []
canons: []
n_books: 327
n_pages: 327
verdict: "A $0 lexicon and repetition garble score reaches precision 0.24-0.60 and recall 0.09-0.19 against the judge's 32 positives; corpus precision about 15-20%."
status: rejected
decision: "Gate (P >= 0.8) not met; no ocr.read_quality field written, reader note unchanged (#5313)"
superseded_by: null
issue: 5313
---
## 2026-09-30 — Can a $0 per-page garble score find the audit's "fluent prose over garbled OCR" pages? No: precision 0.24–0.60, recall 0.09–0.19; no field written (#5313)

**Question.** The reader note (#5315) reaches only pages whose OCR admitted difficulty (1.08%); the #5274 judge found 6.6% garble passthrough. Can lexicon, token-garbage and repetition features over `ocr.data` flag those pages with precision ≥ 0.8, enough to store `ocr.read_quality`?
**Design.** Lexicon derived from the corpus (a unit is a word if it occurs in ≥ 3 books; Tibetan syllable bigrams; CJK character bigrams), built from 60 pages per book over 41.7K live books in the local mirror. Features: OOV rate relative to the page's catalogue-language distribution, vowel-less and mixed-script tokens, fragment runs, filler token, non-periodic 5-gram repeat, and the exact loop from `ocr-loop-guard`. Reference: 327 `main` pages, one per book, from the #5274 audit and the monthly run (#5319), where positive means the Opus judge's `garble_passthrough` flag (32 positive, 15 major). `measure: judged`.
**Result.** @1 (OOV + filler + repeat + loop): P 0.24 / R 0.19. @2 (OOV > p90 and ≥ median + 0.30, or loop ≥ 0.5): P 0.60 / R 0.09 on 5 flags. AUC 0.74 raw OOV, 0.61 relative to language median. `pageReadCaution` alone: 1 of 32. On the whole mirror, @2 flags 0.56% of translated pages (25,851 pages / 2,301 books), but a hand read of 20 (OCR text, not images) found 3 garbled, 1 ambiguous and 16 clean, so corpus precision is about 15–20%. **The gate is not met; nothing is written and the reader note is unchanged.** Causes: the judge's garble is mostly phrase-level (17/32 minor); the catalogue language is often not the page's language; lists, tables and rare languages miss any lexicon; and refrains read as filler or repeat (16 of @1's 19 false positives). The reference is also the tuning set, so @2's 0.60 is optimistic.
**Replicated?** No; single reference set. **Artifact:** `results/garble-detector-5313-2026-09-30/` (README, P/R JSON, corpus summary, hand-read sample); code `scripts/lib/ocr-garble-{score,verdict}.mjs`, `scripts/audit/ocr-garble-{lexicon,corpus}.mjs`, `scripts/eval/garble-detector-5313.mjs`. Cost $0.
