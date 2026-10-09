---
stage: ocr
measure: agreement
languages: [en]
scripts: [Latn]
canons: []
n_books: 150
n_pages: 150
verdict: "A tags-only Gemini pass over GLM-OCR text recovers every tag but marginalia (margin F1 0.64) at $0.43 per 1,000 pages, 47% of a full lite OCR ($0.91); $0 rules give only language and script."
status: undecided
decision: null
superseded_by: null
issue: 5830
---
## 2026-10-04 · If GLM-OCR reads the text, how much Gemini do we need to get the page-structure tags back, and what does it cost? (#5830)
<!-- PRIOR ART: 2026-10-04-ocr-bakeoff-round-3-5660.md (PR #5786) produced the GLM-OCR text and JPEGs reused here. It scored body CER with the tags stripped, so it never measured what an open engine loses. ocr-v18-ab.mjs (#4195) supplies the Batch stages and the production OCR request, imported unchanged. Nothing before this measured the tags themselves. -->

**Question.** GLM-OCR, Paddle and Kraken return plain text. Our Gemini OCR (Standard OCR v19.1) also writes the tags that translatability, citations, marginalia, image detection and language routing read. Which cheap option gets which tags back, and at what $/1,000 pages, compared with a full flash-lite OCR? Derek, 2026-10-04: "what do we lose when we use non-gemini ocr? and how could we use a little bit of gemini to get that back?"

**Design.** Rule: `PREREGISTRATION-ocr-tags-5830.md`, pushed before any submit (`5ad1f881f`). `measure: agreement`; the reference is a model. Its own error is read from the image on 20 pages.
- **Pages.** All 195 pages in the #5660 English cells (EEBO-TCP 1600–1699 and English 1700+) that have a GLM-OCR output. Every arm reads the same JPEG GLM read.
- **Arms.** All on `gemini-3.1-flash-lite`, Batch API, thinking off.
  - **R:** full v19.1 OCR. This is the reference.
  - **R2:** the same request again, as the ceiling.
  - **D:** $0 rules over the GLM text, plus the catalogue language.
  - **T:** a tags-only pass. Image + GLM text in, tags out, with an `anchor` copied from the GLM text. Gemini never rewrites the GLM text. It does transcribe headers, page numbers and margin notes, because GLM drops them.
  - **L:** a 512 px image at `mediaResolution: LOW`, for page-type and the largest illustration.
  - **L2:** `image-desc` at full resolution, only where L found a medium or large or high-significance picture.
- **Scored n = 150.** R refused **45 of 195 pages (23%)** with `RECITATION`. R2 refused 41. T and L refused none.
- **Spend: $0.445** of the $1 cap. All five Batch jobs are registered in `batch_jobs` as `external_eval`. Nothing was written to `pages` or `books`.

**Result.** **T recovers everything but marginalia at $0.43 per 1,000 pages, 47% of a full lite OCR ($0.91 measured).** Two prompt defects must be fixed first. Margins do not pass. D gives language and script for $0 and nothing else. L classifies page-type for $0.08, but the class it exists to find had only 6 positive pages here.

| tag group (vs R, 150 pages) | R2 ceiling | **D** $0 | **L** $0.08 | **L+L2** $0.08 | **T** $0.43 |
|---|---|---|---|---|---|
| page-type, accuracy | 1.00 | 0.96 (always "text": finds 0 of 6 non-text) | **0.97** (non-text F1 0.71*) | 0.97 | 0.97 (non-text F1 0.67*) |
| page-num, F1 | 0.99 | 0.19 | — | — | **0.97** |
| header, F1 | 1.00 | 0.12 | — | — | **0.96** (value ≥ 0.8 similar: 0.97) |
| sig, F1 | 0.98 | 0.33 | — | — | 0.90 (by eye: same as R) |
| margin, F1 | 0.96 | 0 | — | — | **0.64 ✗** (P 0.49, R 0.92; anchors 0.62 vs ≥ 0.8 rule) |
| catchword (`meta`), F1 vs R | 0.97 | 0 | — | — | 0.29 vs R, but **by eye T 0.80, R 0.50** |
| illustration present (any / high)* | 1.00 / 1.00 | 0 | 0.32 / 0.67 | 0.33 / 0.67 | 0.36 / 1.00 |
| columns ≥ 2, F1* | 1.00 | 0 | — | — | 0.67 (recall 3/6) |
| language, accuracy | 1.00 | **1.00** (catalogue) | — | — | 0 as written: ISO codes ("en"). **150/150** once mapped |
| script, accuracy | 1.00 | **0.98** | — | — | 0.99 |
| scan-quality, accuracy | 1.00 | — | — | — | **0.97** |
| vocab, F1 | 1.00 | — | — | — | **1.00** |
| output tokens / page | 492 (R) | 0 | 22 | 22 + 0.8 | **181** |
| $ / 1,000 pages, Batch, measured | 0.91 (R) | 0 | 0.076 | 0.078 | **0.43** |

\* Fewer than 10 positive reference pages: descriptive only (image 5 and 2, non-text 6, multi-column 6; gloss, insert, unclear, term ≤ 1).

- **Why the $0 option fails:** GLM's "Text Recognition:" output drops page furniture. Only **7%** of the reference's page numbers, **32%** of headers, **12%** of signatures and **24%** of margin notes appear anywhere in the GLM text. No repetition rule can recover what is not in the text. Repetition across a book's pages could not be tested anyway: the cells hold one page per book.
- **Why T costs half a full OCR, not "a little":** T must see the image to place the furniture. The image is about 1,100 input tokens of T's 2,356. v19.1's prompt is about 3,000 of R's 4,343, and its output is 492 tokens. A low-resolution T was not tested; at 512 px, page numbers and marginal notes are unlikely to stay legible.
- **A full lite OCR costs twice what #5660 quoted.** #5660 put it at $0.45/1,000 on Batch. Measured here with v19.1 (4,343 input and 492 output tokens per page), it is $0.91. The comparisons above use the measured figure.
- **The R2 ceiling is stability, not accuracy.** Lite agrees with itself at 0.96–1.00 on every tag, so "within 0.05 of the ceiling" is a strict bar.

**Read from image (20 pages, seed 5830, 10 per stratum).** Correct per page:

| field | R (the reference) | T | D |
|---|---|---|---|
| page-type | 20/20 | 20/20 | 19/20 |
| page number | 20/20 | 20/20 | 4/20 |
| header | 19/20 | 19/20 | 9/20 |
| signature | 19/20 | 19/20 | 18/20 |
| margin count | 19/20 | 15/20 | 19/20 |
| catchword (not preregistered) | 10/20 | 16/20 | 9/20 |

Notes on the read:
- **The reference misses catchwords:** it caught 1 of the 11 on the page.
- **The reference has one margin error:** on one page it took the facing page's line-ends for a margin note.
- **T's margin errors:** 11 margin tags on 20 pages that hold one real margin note. It tags **footnotes as margins** (4 pages) and the facing page's edge as a margin (1 page).
- **T's catchword errors:** it calls the last body word of a 19th-century page a catchword (3 pages), and it put one catchword in `insert`.
- **Both arms** call the act heading "Act. ij." a signature.
- **T's margin anchors:** where R placed a note mid-page, T's anchor is within 0.15 of it on 23 of 32. On the other 17, R parked the note at the top or bottom of the page.

**Implication (a recommendation; no routing or writer change).** For an open-engine lane, use:
- **D for language and script** ($0, from the catalogue);
- **T for everything else**: page-type, page-num, header, sig, catchword, scan-quality, image-desc, vocab.

GLM on the GEX45 ($0.19/1,000) plus T ($0.43) comes to **$0.62/1,000 pages**, against $0.91 for a full lite OCR. It also skips lite's RECITATION refusals (23% of these pages), because T never writes the text. Three things come before any lane uses it:
1. T writes `<language>` as ISO codes. The prompt needs v19.1's "e.g. Latin" example, or the #4781 readers must map codes.
2. **Margins are not recovered.** The prompt must say footnotes are not margins, and that the facing page's edge is not a margin. Re-measure margins on a cell that has real marginalia, such as EEBO 1600s with ≥ 10 positive pages by eye.
3. Catchwords: tell T that 19th-century books have none, or gate catchwords on the book's date.

L is not worth a separate pass: T already returns page-type and image-desc for the same pages.

**Replicated?** No: one run per arm. R vs R2 is the stability floor. **Artifact:**
- driver `scripts/eval/ocr-tags-5830.mjs`
- prompts `scripts/eval/prompts/ocr-{tags-only,lowres-classify,image-desc-only}-5830.txt`
- results `scripts/eval/results/ocr-tags-5830.json`
- raw reads `results/ocr-tags-5830/reads.jsonl.gz`
- by-eye truth `results/ocr-tags-5830/eye-truth.json`
- Batch jobs `batches/8njrrrslo2z0…` (R), `32m8ectca6t1…` (R2), `cfc394msonh9…` (T), `v2yft1fmu7s1…` (L), `o0rulnx2tuui…` (L2)
