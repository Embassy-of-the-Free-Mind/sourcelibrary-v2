---
stage: ocr
measure: agreement
languages: [la, en, lzh]
scripts: [Latn, Hani]
canons: []
n_books: 90
n_pages: 90
verdict: "Keeping digits moves no panel stratum by more than 0.2 pt and 1 of 90 pages by more than 1 pt; the new digits-only channel finds 5.5% of 397 key digits wrong in Latin print and 0.8% of 4,370 in English print."
status: adopted
decision: "normalizeForScript v4 keeps digits in Latin-script text; the dashboard reports failures, median CER on pages with text, and a digits channel (#6203)"
superseded_by: null
issue: 6203
---
## 2026-10-12 · What does the served-text CER say once digits count? The 90 panel pages re-scored (#6203 repair 1)
<!-- PRIOR ART: 2026-10-10 #6388 results (scripts/eval/ocr-prereg-6388/results.md: the panel and its key, scored with digits dropped); numbers-5224.mjs (#5224: which engine misreads printed numbers, image as truth, English only). Neither re-scores the panel with digits kept or reports digits as their own rate. -->

**Question.** The validity audit (`.claude/docs/measurement-validity.md`, PR #6520) found that `normalizeForScript(…, 'latin')` kept `[a-z]` only, so `"p. 239 n. 25; | 2.54,3 |"` scored as `"p n"`, and that one mean per stratum hid a failure count. What do the numbers become with digits kept, and with failures and typical error reported apart?

**Design.** $0, no model call. `scripts/eval/ocr-prereg-6388/rescore-digits.mjs --live`.
- The 90-page #6388 panel (30 Latin print, 30 Chinese manuscript, 30 English print; one page per book), scored against the same AI-consensus key (readers G, S, O; no human has checked it) under v3 (digits dropped) and v4 (digits kept). Served text: the 2026-10-10 `reads/P` file and `pages.ocr.data` on 2026-10-12. They are identical: no panel page was re-read in between.
- A page FAILED when the served read is empty, a refusal, text on a leaf the key calls blank, or its capped CER is above 0.3.
- Digits channel: the same plurality key built over each reader's ASCII digits alone; errors pooled over pages whose key has at least 5 digits.
- Reference tiers of the benchmark: the 19 Latin-script `ground-truth/` pages' SERVED text under both versions; for the 95 Latin-script `ground-truth-ws/` pages only a bound (the reference's digit share), because the engines' outputs are with the run on the main box.

**Result.** Full tables: `scripts/eval/results/digits-kept-6203/rescore-digits.md`.

| stratum | mean CER v3 → v4 | failed | median CER, pages with text, v3 → v4 | digits wrong |
|---|---|---|---|---|
| Latin print | 3.5% → 3.6% | 1 of 30 | 1.0% → 1.2% (n=30) | 5.5% of 397 key digits, 15 pages |
| Chinese manuscript | 9.3% → 9.3% | 1 of 30 | 6.4% → 6.4% (n=30) | too few ASCII digits |
| English print | 13.3% → 13.4% | 6 of 30 (5 over 30%, 1 empty) | 0.2% → 0.3% (n=29) | 0.8% of 4,370 key digits, 10 pages |

- **One page of 90 moves by more than 1 pt**: Latin `69c833d26c6f3cc53c84e345` p.57, 7.8% → 9.4% (10 of its 13 digits differ from the key).
- **The English mean was a failure count.** 13.4% is 6 failed pages; the median page with text is at 0.3%.
- **The numeric table** (`69d14ba11c2a66dc094b503f` p.289, 4,258 digits) goes from CER 0.0% to 0.7%: 26 digit errors against the key. The all-character CER still barely sees them, which is why digits have their own channel.
- **Digit errors are found on 11 of the 25 pages that have enough digits to score.**
- **Benchmark, pareto and by-language figures.** The audit said every Latin-script CER shares this normaliser. Checked against the code, that is true only of the two reference tiers scored by `scoreAgainstReference` (`ref-pinned`, `ref-ws`). The whole-page benchmark strata (`benchmark-score.mjs normAlpha`) and the English reference strata (`en-ocr-ref-normalise@3`) already keep digits (`\p{L}\p{N}`), so they do not move.
  - `ref-pinned`: none of the 19 Latin-script references carries a digit. Scored naively, v4 charged the printed verse numbers as insertions (Vulgate Genesis 5, served text, 1.1% → 3.7% with no misread), so `scoreAgainstReference` scores digits only when the reference has some (`digitsScored`). With that rule 0 of 19 pages move.
  - `ref-ws` and `ref-pinned`, engine outputs: the five CLI arms whose reads are committed (`results/ocr-pareto-6293/outputs-*.jsonl`, 319 Latin-script reads, 13 tier × language × engine cells) were scored both ways. **No cell's median or mean moves by more than 1 pt** (largest: `ref-ws` Latin means, +0.1 to +0.2 pt), and no alignment verdict flips. **Two pages move by more than 1 pt**: *Mercurius Gallobelgicus* 1592 p.20 (27 reference digits), 8.8% → 15.1–15.4% for all five arms, and *Delitiae sapientiae de amore conjugiali* p.2 (11 digits), about 5.2% → 6.2% for two arms. Five arms moving by the same amount on one page points at the reference's numerals, not at five identical misreads; not checked by eye.
  - The API engines (flash-lite, flash, Kraken) on those tiers were not re-scored: their outputs are with the run on the main box. Bound: the median digit share of a `ref-ws` reference is 0.0% (German 30 pages, max 2.5%; Latin 65 pages, max 2.8%), and a page's CER can move by about its digit share, so their cell medians cannot move by 1 pt either. **No benchmark, pareto or by-language figure moves by more than 1 pt.**
  - The committed pareto re-scores (`ocr-pareto-6293/rescore-*.mjs`) stay pinned to v3 digit handling (`{ digits: false }`) so they still reproduce the committed scores 779 of 779. To move the ref tiers to v4, re-score on the main box (`benchmark-score.mjs --root <bench> --stratum=ref-ws,ref-pinned`) and drop the pin.

**Limits.** The key is AI consensus, so a digit all three readers misread the same way is scored correct; the digits channel is agreement, not accuracy. One page per book, 30 per stratum: a failure rate of 6 of 30 has a Wilson 95% interval of 10% to 37%. Only ASCII digits are counted; Chinese numerals are characters and were always scored.

**Replicated?** No. **Artifact:** `scripts/eval/results/digits-kept-6203/`.
