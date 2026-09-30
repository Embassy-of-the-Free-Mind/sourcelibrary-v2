# Grading rubric — bounding boxes on historical book pages (#4747)

Who this is for: readers browsing Source Library's galleries see CROPS made from these boxes.
A box that cuts a figure in half, or drags in half a page of text, is a bad gallery image.
You are grading, by eye, how well each box would crop the picture it is on.

## What you look at
Each page has TWO sheet files: `NNN-<cls>-<pageid>-a.jpg` (panels P1–P4) and `-b.jpg` (P5–P8).
Every panel is the SAME page image; each panel shows a different (hidden, shuffled) model's boxes,
drawn in magenta and numbered 1..k in the top-left corner of each box. The panel header says
how many boxes that panel has. Panels are blinded — do not try to guess which model is which.

## First, per page: `pictures`
Count the true illustrations on the page by eye: woodcuts, engravings, plates, diagrams,
maps, figures, coats of arms, charts, drawn tables of symbols. NOT: decorative initials,
headpieces/tailpieces/ornamental bands, printer's ornaments, page borders, blank space, plain
text, stamps/library marks, a printed table of plain text. A single illustration that is one
framed unit (e.g. a plate with an engraved border and caption inside the frame) counts as 1.
A grid of small figures meant to be read together counts as 1. Separate figures in separate
places count separately. If a page has no illustration, pictures = 0.

## Then, per panel: one letter per numbered box, in number order
- **T tight** — contains the WHOLE illustration (including its own engraved frame/border and any
  caption or labels that sit INSIDE the frame), with little extra: no full lines of body text
  inside, extra margin under ~5% of the page width/height on any side.
- **L loose** — contains the whole illustration but also takes in body text lines, a running
  head, or a wide band of blank margin (more than ~5% of the page on a side).
- **C cropped** — cuts off any visible part of the illustration (an edge of the frame, a border
  column, a figure's feet, part of the caption inside the frame) by more than a hairline.
  If a box both cuts the figure AND includes text, grade C (cutting is worse).
- **W wrong** — the box is not on an illustration (text block, ornament, initial, blank, stain),
  or covers so little of one that it is not a crop of it.
- **D duplicate** — a second box on an illustration that another box in the SAME panel already
  covers (grade the better of the two normally, the other D).
One box around two separate illustrations: grade L (it contains them but is not a crop of either).

And per panel: **missed** = number of the page's true illustrations that have NO box
(T/L/C) on them in that panel.

## Calibration example (page 001, graded by the lead)
Coat-of-arms plate with side border columns of small shields and a caption scroll inside the frame;
text above and below. pictures = 1.
P1 C (cuts off right border column) · P2 C (same) · P3 L (whole plate but also the text above and
below) · P4 T · P5 C · P6 C · P7 C (bottom edge cuts through the caption inside the frame) · P8 C.
missed = 0 everywhere.
The difference between T and C here was ~one border column: look at all four edges of every box.

## Output
Write ONE JSON file (path given in your task) shaped exactly:
{ "<pageid>": { "pictures": 1, "note": "short description of the page", "panels": {
   "P1": {"grades": "T", "missed": 0}, ..., "P8": {"grades": "", "missed": 1} } }, ... }
grades must have exactly as many letters as that panel's box count (empty string for 0 boxes).
Use `grades.template.json` for each page's box counts (`panels.Pk.n_boxes`).
Open every sheet you grade (both a and b). Do not print file contents to the console —
write the JSON, then print only: pages graded, and any pages you were unsure about with one line why.
