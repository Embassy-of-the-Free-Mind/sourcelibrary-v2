---
stage: ocr
measure: judged
languages: []
scripts: []
canons: []
n_books: 298
n_pages: 298
verdict: "The shown image is a different leaf from the translated text on 6 of 298 decidable pages (2.0%), all Internet Archive (3.8% of IA pages); the image is right, the Gemini OCR text is shifted."
status: informational
decision: null
superseded_by: null
issue: [5274, 4790]
---
## 2026-09-30 — Leaf identity: is the page image a reader sees the page that was translated? (#5274 follow-up, #4790)

- **Design.** The 311 audit pages (one per book, the same draw, not redrawn). Each served `display_photo` was compared with its OCR text on page number, header and first/last lines. Eight Sonnet subagents read 291 pages ($0). The 20 eye-subset pages were reused. Every mismatch was arbitrated by opening the display image AND the source leaf `pages.photo` points at.
- **Result. Wrong leaf on 6 of 298 decidable pages: 2.0% (Wilson 95% CI 0.9–4.3%). All 6 are Internet Archive: 6 of 156 = 3.8% (CI 1.8–8.1%). Non-IA: 0 of 142 (CI 0–2.6%).** 13 pages were undecidable (Tibetan, cursive MSS), so the upper bound is 6.1%.
- **The image is right in all six; the TEXT is shifted.** The display image equals the IA leaf; the OCR is the previous page (5 cases) or 5 pages earlier (1 case).
- **The OCR run does not protect.** All six are Gemini OCR: 5 `batch_api`, 1 realtime `ai`. So the existing `ia_djvu`-only detectors (`ia-ocr-leaf-drift`, `ia-ocr-page-plausibility`) are blind to them.
- **Consequence.** The #4790 concern is IA-specific in this sample, not corpus-wide. But it extends beyond `ia_djvu` text to Gemini-OCR'd IA books.
- *Replicated?* No. Book-wide extent is unmeasured and needs a detector.
- **Artifact.** `scripts/eval/results/leaf-identity-2026-09-30/` (README, verdicts.jsonl, summary.json, worker-instructions.md).
