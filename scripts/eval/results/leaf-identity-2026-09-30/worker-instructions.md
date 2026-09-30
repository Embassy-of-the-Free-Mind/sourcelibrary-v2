# Leaf-identity check — worker instructions

Question per item: does the page IMAGE a reader sees (`local_image`, a downloaded copy of `display_image`) show the SAME printed page as the OCR text (`ocr_head` = start of the transcription, `ocr_tail` = end)?

This is NOT a transcription-quality check. Small OCR errors, missing words, a spread where the OCR covers only one side, or a page the OCR says is blank/plate — all still count as `match` if it is the same leaf. The failure we hunt is a DIFFERENT page: the image shows page 224 while the text is page 223, or a whole different passage.

For each item in your packet:
1. `Read` the `local_image` (read up to 5 images per turn, in parallel, to stay within your turn budget).
2. Compare with `ocr_head` / `ocr_tail`: printed page number (`<page-num>`), running header, first line(s), last line(s), catchword, distinctive words, illustrations. For scripts you cannot read line-by-line (Tibetan, kuzushiji, Arabic manuscript), compare layout, folio numbers, line count, headings, and any legible distinctive tokens; say so.
3. Verdict:
   - `match` — at least one concrete anchor agrees (page number, header, first/last line, distinctive word) and nothing contradicts.
   - `mismatch` — a concrete anchor contradicts (different printed page number, or the image's visible text is plainly not the OCR text). Quote what the image shows vs what the OCR says.
   - `uncertain` — cannot tell (illegible image, blank, unreadable script with no anchors). Say why.

Output: append ONE JSON line per item to your results file (given in your prompt) with Bash, e.g.
`cat >> RESULTS <<'EOF'` … `EOF`, fields:
`{"id":..., "verdict":"match|mismatch|uncertain", "image_page_num": string|null, "ocr_page_num": string|null, "anchor": "what agreed or disagreed, ≤200 chars", "label": "read from image"}`
Write results in batches as you go (not all at the end). Do not print images or long text back. Never write to any database. Finish with one line: counts of match/mismatch/uncertain and the ids of any mismatches.
