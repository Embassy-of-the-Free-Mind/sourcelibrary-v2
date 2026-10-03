# By-eye cause pass (#5695 T5, Addendum 3) — read fully

For each page id you are given a bundle /data/scratch/sl/xlref-t5-private/imgpass/<id>.json with: the page's OCR
transcription (`ocr`), the English our site serves (`served_english`), what two blind judges found wrong with it
(`judges_on_served`), a published reference translation, and the page IMAGE (`image`) plus overlapping `tiles` of it
(zoomed crops; `tile_layout` says how they are arranged).

Task, per page:
1. OPEN THE IMAGE: Read the full `image` once for layout, then Read every tile (the tiles are what is legible).
2. Compare the OCR with the image where it matters: at every place the judges flagged a defect, and wherever the
   OCR looks suspect (non-words, garble, missing lines, wrong order). Read the image yourself; do not assume the OCR
   is right, and do not assume it is wrong. If a passage is not legible to you at this resolution, say so — never guess.
3. For EACH defect the judges listed on the served English, decide its cause:
   - "ocr_misread"     the image has a different character/word than the OCR, and the English follows the OCR
   - "translation"     the OCR matches the image there; the English is wrong anyway
   - "page_seam"       text belongs to the previous/next page, or a sentence broken at the page edge was guessed/dropped
   - "reading_order"   columns, verse/commentary blocks, interlinear notes or marginalia were read in the wrong order or merged
   - "language_label"  the page (or part) is in another language/script than the book is labelled (e.g. Hindi/Bengali gloss, Prakrit)
   - "reference_or_judge"  you find the served English is defensible and the reference/judge is the one that is off
   - "cant_tell"       image not legible enough there
   Quote the IMAGE reading (in the source script) beside the OCR reading for every ocr_misread / reading_order call.
4. Give the page ONE primary cause (the one behind most of the lost fidelity), or "none" if the served English is fine.
5. If (and only if) you found OCR errors you can fix confidently from the image, write a CORRECTED transcription:
   the full `ocr` text with only those fixes applied (keep its tags and layout otherwise). Do not "improve" by memory of
   the canonical text where the image is illegible; fix only what you can read.

Output: write ONE JSON file per page to /data/scratch/sl/xlref-t5-private/imgpass-out/<id>.json (Write tool, valid JSON):
{"id":"...","legibility":"good|partial|poor","primary_cause":"ocr_misread|translation|page_seam|reading_order|language_label|reference_or_judge|none|cant_tell",
 "secondary_causes":[...],
 "defects":[{"judge_defect":"short quote of the judge's detail","cause":"...","image_reading":"…","ocr_reading":"…","note":"one line"}],
 "ocr_errors_found":<count of distinct OCR errors you verified in the image>,
 "ocr_error_examples":[{"image":"…","ocr":"…","effect_on_english":"one line or 'none'"}],
 "corrected_ocr": "<full corrected transcription>" or null,
 "corrected_scope":"what you fixed, what you could not check",
 "diagnosis":"one sentence a reader can check against the page"}
Rules: read-only except that output directory; no web, no database, no other files. When done print only: DONE <n> pages.
