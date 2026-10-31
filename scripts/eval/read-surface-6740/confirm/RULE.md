# #6740 read-surface — confirmation rule for the Latin optimum, fixed 2026-10-31 before any confirmation read or judge call

The response surface (experiment file `2026-10-30-read-surface-box-behnken-6740.md`) picked, for Latin, **8 pages a
call, image fitted to a 1,600 px long edge, thinking low** (`agy-flash-low@8-1600px`): 0.174 agy calls a page against
the live setting's 0.306 on the 40 CAMENA books, CER +0.21 pp [−0.35, +0.85] paired. This test asks whether that holds
on real queue pages, judged against the image, before anything changes.

Frame: the first-read lane's (cli-ocr-lane.mjs FIRST_READ_BOOKS + firstReadSkip languages=lat + spreadReason; visible
books held as scans only, print route, no manuscript, no possible unsplit spread). `judge.mjs draw --cells=la-surface
--n=30 --exclude-from=<the #7701 first-read and cheap-routes draws>`: 30 NEW books in a seeded order, one interior unread
page each, inside its block of up to 8 consecutive unread pages. No page of the design's panel is in this frame (the
panel's CAMENA books all have OCR).

Routes, both on the SAME 30 drawn pages (paired), agy = gemini-3.8-flash-low through AGY_HOME=.agy-james:
- `agy-flash-low@4` — A: the read at the live knobs (4 a call, image as served, low), on the 4-page piece of the block
  that holds the drawn page (`blockPages: 4`), as the lane cuts it.
- `agy-flash-low@8-1600px` — O: the optimum: the whole block (up to 8) in one call, each image fitted to 1,600 px
  (`cli-ocr.mjs read --per-call=8 --long-edge=1600`).
Both read with production's fallback (a twice-refused block is read one page a call): this is the setting as the lane
would run it, so calls a page include the fallback.

Written: both past `apply --first-read-only --print-only` (dry run). A page not written stays scans-only and counts as
not accepted over the drawn pages.

Judge: Opus (`claude -p`), route-judge-6740 `judgePrompt` against the page image (the served image, not the fitted
copy), one output per call, blind, shuffled; identical outputs on a page share one verdict. Controls as #7701: per route
two wrong-page items (refused with fidelity <= 2 to pass), two planted items on accepted outputs (caught when refused or
a defect names the plant); a route whose control fails does not count; both plants missed voids the test.

Measures per route, on the written pages: accepted k/n, wrong-text pages, invented or wrong-leaf pages, agy calls a page
(every call, block re-reads and one-page fallbacks included, over the pages read).

Rule (the router's: within 0.08, p 0.9, wrong-text bar 0.04, zero tolerance for invented or wrong-leaf text):
1. O is ELIGIBLE when its written wrong-text pages / n <= 0.04, it has NO invented or wrong-leaf page, P(acc >= 0.8) >=
   0.9 under Beta(1 + k, 1 + n - k), and its wrong-page control passed.
2. O PASSES when it is eligible and, PAIRED on the pages both wrote and the judge read, P(acc_O >= acc_A - 0.08) >= 0.9
   under Dirichlet(1 + both, 1 + O_only, 1 + A_only, 1 + neither), and its calls a page here are below A's.
3. If O passes, the router cell `la-blank` gains the route `agy-flash-low@8-1600px-written` with this evidence. Latin
   first reads are now arm c (PERO draft > agy, #7752), so a pass does NOT switch the Latin lane: the switch needs O paired
   against arm c on the same pages (gex45's GPU), which is a follow-up brief. If O passes, the knobs that DO change are
   proposed in a PR for the plain agy first read wherever it runs Latin (the `FIRST_READ_PER_CALL_LANGUAGES` lane), only
   if that PR's tier and Derek allow.
4. If O fails, nothing changes; the record says which clause failed.

Budget: at most 250 agy calls (judge.mjs correct --agy-max=250).
