## 2026-10-06 · How accurate is our Chinese and Pali transcription against typed editions, and can it be extrapolated to pages nobody checked? (#5935, phase 1)
<!-- PRIOR ART: quality-covariates.mjs (#5623/#5643) models judged translation pages by covariate, unpooled, with no reference CER and no held-out test; zh-skqs-5568-kanripo.mjs and the #5600 lane's Kanripo Dice screen (which Kanripo page, not how many characters differ); the #5566 CBETA fit (spans, not scored against our reads independently). This run is the first ground-truth CER over those references, with a floor, a pooled model and leave-one-reference-out. -->

**Question.** Where a typed edition of the same text exists, how many characters does our reading get wrong? Does a model fitted on those pages predict a reference it has not seen? This is so /quality (#5918) can say "measured" or "estimated" instead of "unknown".

**Design.** Run on 2026-10-06. $0: no model calls. Read-only on Mongo and R2.
- **Unit.** Body CER after alignment. The page's reading is fitted inside a reference window with free window edges. Insertions are charged, and text the reading left out beyond 10 % of the reference page is charged too. Margins are excluded (header, leaf number, signatures, catchwords, marginalia, PTS footnote apparatus). Han variant forms are folded. For Pali, niggahita (ṃ/ṁ/ŋ/m) and circumflex vowels are folded. One seeded interior page per book. Catastrophic means CER > 0.5. `measure = accuracy`.
- **(a) Kanripo WYG vs PaddleOCR-VL on the Siku Quanshu.**
  - Draw: 1,201 books, seed 5935, from 12,203 books with a Kanripo work id. 919 had no Kanripo-screened page; 67 had no trusted leaf.
  - Leaf: the page's own #5600 screen match where Dice ≥ 0.6, otherwise its neighbours' matches.
- **(b) CBETA vs Gemini on the three Chan texts we already held (#5566 mode 1).**
  - `page_revisions` holds no earlier OCR for these books, so the brief's source does not exist. The readings are the served OCR the fit never overwrote (flash-lite 838 pages, flash 128) and #5566's flash-lite column reads (1,757 pages, never served).
  - Reference: the CBETA text between the two neighbouring pages' fitted spans. This is not the page's own span, which was placed using the page's reading and would make the score circular.
  - 2,723 pages in 22 books are scored. Another 2,723 have no two fitted neighbours and are not scored.
- **(c) VRI CSCD (`vipassanatech/tipitaka-xml` @05d5d3c) vs our Pali reading.**
  - Located by k-gram offset voting over the whole VRI stream (roman, Devanagari, Sinhala). The reference is the text between the two neighbours where both locate.
  - Of 62 Pali-text books: 35 scored, 21 found no VRI match, 6 have no OCR.
- **Floor.** For the 30 highest-CER pages per reference, every difference was sorted into ours / theirs / variant against the page image. This was read from the image by three Claude subagents, one per reference. Verdicts: `scripts/eval/ground-truth-5935/floor-verdicts.json`.
- **Model.** Partial pooling on log(CER + 0.005), shrinking script → kind → engine → period → resolution band. The catastrophic share is shrunk with a 20-page Beta prior. Leave-one-reference-out across (a), (b) and (c). A corpus cell gets an estimate only if its script × kind holds ≥ 10 referenced books.

**Result: ground truth with the floor.**

| reference | books | median CER | typical CER | catastrophic | differences on the 30 worst pages that are **not ours** | floor-adjusted typical CER (ours) | reviewed catastrophic pages that are ours |
|---|---:|---:|---:|---|---:|---:|---|
| Kanripo WYG · PaddleOCR-VL · Siku MS | 1,201 | 3.3 % | 3.3 % | 11 (0.9 %, CI 0.5–1.6) | 40 % (variant glyphs, gaiji the reference drops; plus 4 diagram pages Kanripo does not transcribe) | ≈ 2.0 % | 3 of 11 |
| CBETA · Gemini (21 flash-lite, 1 flash) · Chan prints and MS | 22 | 1.9 % | 2.6 % | 1 (4.5 %, CI 0.8–21.8) | 4 % | ≈ 2.5 % | 2 of 2 |
| VRI · Gemini flash-lite (33) · PTS and other prints | 35 | 4.0 % | 4.7 % | 1 (2.9 %, CI 0.5–14.5) | 68 % (PTS vs Sixth Council readings: -o/-ā, dd/ḍḍ, peyyāla vs "…la…") | ≈ 1.5 % | 0 of 1 |

All CBETA pages, not one per book: flash-lite served 2.98 % median (838 pages), flash 1.23 % (128 pages), on the same books.

**What the floor found, by reference.**
- **CBETA:** almost all of it is ours. Flash-lite drops the small double-line notes and whole columns, and it repeats look-alike misreads (溈→爲, 迢→迥).
- **Kanripo:** Paddle drops 丨 ditto marks and double-line sub-columns on dictionary pages (佩文韻府, 駢字類編). There is one runaway repetition. Kanripo itself is wrong on about 42 characters.
- **Pali:** the headline is mostly edition difference. Our real errors are dropped verses, footnote text leaking into the body on 4 pages, and misreads on the two blurry Sinhala Buddha Jayanti prints.

**Result: leave one reference out.**

| held out | trained on | predicted typical CER (95 %) | measured | inside? | predicted catastrophic (95 %) | measured | inside? |
|---|---|---|---:|---|---|---:|---|
| Kanripo | CBETA + VRI | 2.8 % (1.8–4.1) | 3.3 % | yes | 2.7 % (0.9–23.6) | 0.9 % | yes |
| CBETA | Kanripo + VRI | 3.4 % (2.6–4.4) | 2.6 % | yes, at the edge | 0.6 % (0–16.1) | 4.5 % | yes |
| VRI | Kanripo + CBETA | **no support** (no Pali script cell) | 4.7 % | — | — | 2.9 % | — |
| VRI, forced from the root | | 3.3 % (2.6–4.1) | 4.7 % | **no** | | | |

- **Verdict.** Within Chinese, extrapolation held. A Gemini-trained cell predicted Paddle on the Siku manuscripts, and Paddle predicted Gemini on the Chan texts, across engines and print/manuscript.
- Across scripts it failed. Forcing Pali from Chinese misses its own interval, so the support rule is what keeps that number off the page.
- The catastrophic intervals are wide enough that "inside" says little.

**Support.**
- Estimates cover 21 % of live corpus pages (1.87M of 8.82M; corpus profile 2026-10-02): 27 Chinese cells and 4 Pali roman-print cells.
- Every other language, and Pali manuscripts, are "outside what we can estimate".
- The largest Chinese cell, Gemini flash on print (11,008 books), has no referenced page from that engine. Its 3.5 % (2.1–5.6) is pooled across engines and is labelled as such in the file.
- The 21 Pali books with no VRI match include 15 Manchester palm-leaf manuscripts (3 more have no OCR). On the two inspected, the served "OCR" is a flash-lite description or refusal ("highly specialized script"; one calls Sinhala script Khmer), not a reading. That is a finding for #5700, not a missing reference. The other 6 are an index volume, a mixed anthology and editions whose sampled pages did not locate.

**External check (#5914).** Not possible per stratum. The 30-book canon-shelf spot check reports no per-tradition rates, and its per-page data is in the private ops repo. Its qualitative "PTS Pali texts strong" agrees with this run. The comparison belongs to the #5301 monthly arm once it records script strata.

**Limits.**
- The typed references cover canonical, clean texts, so they are easier than the corpus by construction.
- The floor comes from the 30 worst pages, so the floor-adjusted figures are approximate.
- The CBETA arm is 22 books (exploratory under §3.1); its all-pages figures are book-clustered, not independent.
- Kanripo SKQS books have no publication date. Their period is set from the edition (1773–1782) and labelled.
- The reviewers are AI reading images, not scholars.

**Replicated?** No.

**Artifacts.**
- Code: `scripts/eval/ground-truth-5935/` (`kanripo.mjs`, `cbeta.mjs`, `pali.mjs`, `floor.mjs`, `model.mjs`).
- Per page: `scripts/eval/output/ground-truth-5935-2026-10-06.jsonl.gz`.
- Per stratum, read by #5918 at build time: `scripts/eval/output/ground-truth-5935-2026-10-06.estimates.json`.
- Floor verdicts: `scripts/eval/ground-truth-5935/floor-verdicts.json`.
- Phase 2 adds references as rows: GRETIL, Sefaria, OpenITI, Wikisource.
