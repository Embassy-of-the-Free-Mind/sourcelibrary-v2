# Leaf identity over the translation-audit sample (#5274 follow-up)

PRIOR ART: `scripts/eval/results/translation-corpus-audit-2026-09-30/eye-notes.md` (the 20-page hand read that found the first two cases; reused here, not redone); `scripts/audit/ia-ocr-leaf-drift.mjs` and `scripts/audit/ia-ocr-page-plausibility.mjs` (they check `ocr.source: 'ia_djvu'` text only, so they cannot see any of the six cases below, which are all Gemini OCR).

**Question.** A reader sees a page image next to a translation. Is the image the same printed page the translation was made from? Every fidelity number in the corpus audit depends on the answer being yes.

**Answer. In 6 of 298 decidable pages (2.0%, Wilson 95% CI 0.9–4.3%), they are different leaves. All 6 are Internet Archive books: 6 of 156 decidable IA pages (3.8%, CI 1.8–8.1%). Every other provider: 0 of 142 (CI 0–2.6%).** Thirteen pages could not be decided: 11 are non-IA and 2 are IA, mostly Tibetan pecha and cursive manuscripts with no legible anchor. Counting all 13 as wrong-leaf gives an upper bound of 6.1% overall.

**Which side is wrong: the TEXT.** For all six, the image the reader sees (`display_photo`) was opened next to the Archive leaf that `pages.photo` points at. Both show the same printed page every time. The OCR text, and so the translation, belongs to a different page: the previous leaf in five cases, and five pages earlier in *Historia de Yucatán*. The images are right and the text lane is misaligned. The repair is a re-OCR of the shifted pages against the served image, not an image repair. This is #4790's class A, but in Gemini-OCR text, which no detector covers.

| book | page | shown (image = IA leaf) | text is | OCR run |
|---|---|---|---|---|
| [Oxyrhynchus Papyri V](https://sourcelibrary.org/book/69cf7bb9878f40c5945f1eea?page=240) | 240 | p.224 | p.223 | batch_api, flash-lite |
| [Don Quixote 1605](https://sourcelibrary.org/book/69e7938b80b52390feb18721?page=269) | 269 | p.120 | Cardenio/Luscinda passage, another leaf | batch_api, flash-lite |
| [Strutt, Sports and Pastimes](https://sourcelibrary.org/book/6a09e9ef3ca4edcd1ef01c3b?page=82) | 82 | p.14 | p.13 | batch_api, flash |
| [Coomaraswamy, Rajput Painting I](https://sourcelibrary.org/book/69e41fab4fc48a88423e0693?page=26) | 26 | p.14 | p.13 | batch_api, flash |
| [Geronimo's Story of His Life](https://sourcelibrary.org/book/6a08f9349c1b82475e159a8d?page=153) | 153 | p.91 | p.90 | batch_api, flash |
| [López Cogolludo, Historia de Yucatán I](https://sourcelibrary.org/book/69f8c1030c0c281d4bd321fd?page=371) | 371 | p.359 | p.354 | ai (realtime), flash-lite |

Within IA, by OCR run: `batch_api` 5 of 86 sampled pages, `ai` 1 of 64. The realtime lane is not immune: Yucatán is realtime OCR throughout, and it is five pages off. That conflicts with the #4790 finding that the preview/realtime run was aligned.

## Method

- **Sample.** The 311 `main` items of the corpus audit (`manifest.jsonl`), one page per book, not redrawn. The draw is quota-stratified by language and model arm, not by provider. So the by-provider rates are the conditional rates to use, and the overall 2.0% describes this sample, not the corpus.
- **Display image.** `pages.display_photo`, which is what the reader shows and what `manifest.image` recorded. It was re-read from Mongo, and 310 of 311 were identical to the draw. The other page has no `display_photo`, so the reader falls back to `cropped_photo` or `photo`.
- **First pass.** 291 pages (the 311 minus the 20 already hand-read). Eight Sonnet subagents ($0, subscription) each took a packet of about 37 pages. Each opened the image and compared printed page number, running header, first and last lines and catchword against the start and end of the OCR text. Verdicts were `match`, `mismatch` or `uncertain`. A same-leaf page with OCR errors, a spread transcribed on one side, or a misread page number counts as a match.
- **The 20 eye-subset pages.** Carried over from `eye-notes.md`: 18 ok, 2 mismatches.
- **Arbitration.** Every mismatch, plus the one uncertain Gallica case, was re-opened by the orchestrator: the display image AND the source leaf (IA `page/nN`, Gallica IIIF) side by side. Each is labelled *read from image (display AND source leaf opened)* in `verdicts.jsonl`.
- **Not done.** Book-wide extent. The eye-notes show that Oxyrhynchus pages 238–242 are shifted in sequence, so the shift is probably a run of pages, not one page. How many pages per book, and how many IA books, needs a detector. Follow-up is linked in the PR.

## Files

- `verdicts.jsonl`: one row per page (311), with verdict, anchor, provider, OCR run, and arbitration where done.
- `summary.json`: rates overall, by provider and non-IA, with Wilson intervals and all-uncertain bounds, plus the mismatch list.
