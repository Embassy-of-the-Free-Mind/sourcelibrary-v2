# English print before 1800 on the GPU print lane — decision rule, fixed 2026-10-30 before the read (job gpu-next-frame-6871, #6871)

Frame (`en-pre1800-gpu-6871/run.mjs draw`): visible English books with `year` 1400-1799, held under a GPU-lane hold
(gpu-print-6871 or cli-ocr-lane GPU_LANE_HOLDS) or not held (`pipeline_auto.held` excluded), not a manuscript
(cli-ocr-lane `manuscriptReason`), not an unsplit spread (`needs_splitting`), not in the 1800+ frame, with pages that
have no text (the 1800+ lane's page filter). 2026-10-30: 319 books, 41,224 pages; 72 books (25,858 pages) are
POSSIBLE spreads (not `split_checked`, no crop data: cli-ocr-lane `spreadReason`). One interior page with no text per
book, 30 books in a seeded order (salt `en-pre1800-6871`), possible spreads NOT excluded from the draw (11 of 30).

Route: `lighton` = LightOnOCR-3-1B exactly as the 1800+ lane reads (scripts/gpu/gpu-print-gpu.sh, FP8, util 0.85,
2,400 px, gpu-print-read.py's early stops). Written set = the drawn pages `scripts/lib/gpu-print-lane.mjs pageVerdict`
writes (loop, textless, other_script, engine_commentary, transliteration guards); a page not written stays scans only.

Judge: Opus (`claude -p`), route-judge-6740 `judgePrompt` against the page image, one output per call, blind (hashed
ids), shuffled. Controls: two WRONG-PAGE items (this image, another book's written read): passed when both are refused
with fidelity <= 2 (else the route does not count). Two PLANTED items (plant-ocr-errors.mjs on accepted outputs): the
cell is void if both are missed. Wrong text = a defect of severity wrong_text.

Rule (the router's hold bar for a no-stored-text cell, as #7701's cells; rules.json: wrong-text bar 0.04, hold 0.8 / 0.9),
on the WRITTEN pages:
1. PASS when wrong-text pages / n <= 0.04, P(acc >= 0.8) >= 0.9 under Beta(1 + k, 1 + n - k), the wrong-page control
   passed and the plants are not both missed. PASS schedules the frame on the GPU print lane, LightOnOCR alone, books
   held `gpu-print-6871` (or keeping their GPU-lane hold), as the 1800+ lane.
2. Possible spreads: if the cell passes but a written possible-spread page carries an I3 (spread not split) or a
   wrong-text defect, the queued frame leaves out the possible-spread books (72 / 25,858 pages) until split-checked.
3. FAIL keeps the cell on its current route (scans only); test next: gpu>agy-flash-low. Nothing is queued from it.
