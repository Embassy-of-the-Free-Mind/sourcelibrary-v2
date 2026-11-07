# #7701 router cell test — decision rule, fixed 2026-10-29T14:07:54Z, BEFORE the judge stage
Cells: la-blank, de-blank (agy-flash-low@4), fr-blank (agy-flash-low@1). n = 30 drawn pages, one per book.
Measures per cell, from the route-judge score (Opus, image, blind, wrong-page controls):
 (a) all drawn pages; a cut / failed / unjudged read counts NOT accepted (the #7517 convention).
 (b) WRITTEN: the drawn pages the lane would write (delivered AND passes cli-ocr apply --first-read-only --print-only,
     dry run on the read dir). A page not written stays scans-only, as today: no reader-facing change.
Router rule (rules.json, no competing measured route in a no-stored-text cell, so the route is its own reference):
 - absolute wrong-text bar: wrong-text pages / n <= switch.wrong_text_max (0.04) — on (b) and on (a);
 - HOLD rule: P(acc >= 0.8) >= 0.9 under Beta(1 + k, 1 + n - k), on (b).
 - a failed wrong-page control voids the cell (not scheduled).
SCHEDULE a language iff its cell passes the wrong-text bar and is not HOLD on (b), and its control passes. Else not
scheduled; name the route that would need testing instead.
