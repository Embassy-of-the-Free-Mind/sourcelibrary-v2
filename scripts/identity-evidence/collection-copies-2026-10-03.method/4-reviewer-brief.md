# Duplicate-copy review — Source Library collection grids

WHO THIS IS FOR: a reader browsing a collection page sees several cards that look like the same book (same title page). We keep ONE card per work-volume. You decide, by looking, whether the members of each cluster are truly copies of the same edition AND same volume, and which copy is best for a reader.

Each sheet image has up to 3 clusters (#N). Each member (A/B/C/D) shows: label (library, year, pages), OCR % and TR (translation) %, then its COVER image (left) and a MID-BOOK text page (right).

For each cluster decide:
- verdict "copies": same edition and same volume/part. Pick keeper.
- verdict "not_same": different volume/tome/part (read the title page: TOM. I vs TOM. XVII, Vol 1 vs Vol 2, Pars), different edition/printing visible on the title page, a translation vs an original, or one is a fragment/subset (page count under ~70% of the other). Year metadata in the label can be WRONG; trust the title page.
- verdict "unsure": can't tell from the images.

Keeper ranking for "copies", in order:
1. Translation completeness (TR %): a clearly higher TR wins (difference >5 points).
2. OCR completeness.
3. Scan completeness: more pages when the other seems to be missing leaves (e.g. no title page).
4. Scan quality by eye: legible, sharp, not cropped, not grey/washed out, in colour over bad greyscale.
5. Better cover image (a real title page or frontispiece beats a text page, a blank, a stamp, or a binding).
If TR/OCR are within 5 points, decide on 3-5.

OUTPUT: append one JSON object per cluster, one per line, to the file given in your task, using a single Bash heredoc per sheet (or batched):
{"cluster":N,"verdict":"copies|not_same|unsure","keeper":"A","reason":"<= 20 words: what you saw"}
(keeper only for copies). Use Read on each sheet image. Do not cat other files. Do not print the JSON back. Finish by printing only: done <count>.
