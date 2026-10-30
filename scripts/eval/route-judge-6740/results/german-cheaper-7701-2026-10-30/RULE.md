# #7701 German cheaper routes — decision rule, fixed 2026-10-30 before any read or judge call (job german-cheaper-7701)

Frame: the first-read lane's (cli-ocr-lane.mjs FIRST_READ_BOOKS + firstReadSkip languages=deu + spreadReason; visible
books held as scans only, print route, no manuscript, no possible unsplit spread). `judge.mjs draw --cells=de-cheap
--n=170 --exclude-from=<the #7701 first-read and cheap-routes sample.json>`: 170 NEW books in a seeded order, one interior
unread page each, in its block of up to 8 consecutive unread pages. Each drawn page's face was labelled BY EYE from its
image (`script-faces.json`): 141 Fraktur (any blackletter body face), 12 Antiqua, 17 other (blank, binding, plate, bare
table, non-Latin script). Antiqua is 7% of the frame, so the test takes ALL 12 Antiqua pages and the first 18 Fraktur
pages in draw order: 30 pages, 30 books. Blank and other pages are left out (the live lane reads them; this test does not
measure them).

Routes, every one on the SAME 30 pages (paired), agy = gemini-3.8-flash-low through AGY_HOME=.agy-james, Opus never a route:
- `agy-flash-low@4` — A, the LIVE route (read alone, 4 a call; cli-ocr-lane.mjs since #7752).
- `agy-flash-low@8` — R8: the same read, 8 a call (cli-ocr.mjs --per-call now allows up to 8).
- `lighton` — G: LightOnOCR-3-1B on gex45 (vLLM, the euro-draft / #7567 recipe) ALONE, no agy call.
- `pero` — G: PERO-OCR `pero_eu_cz_print_newspapers_2022-09-26` (European print incl. Fraktur) ALONE, no agy call.
- `lighton>agy-flash-low@4`, `pero>agy-flash-low@4` — GC: the GPU draft corrected by agy Flash-low with the image, 4
  pages a call (arm C's shape: cli-ocr.mjs read --correct-prompt --gpu-draft --per-call=4).

Written (what the lane would write): A and R8 past `apply --first-read-only --print-only` (dry run); GC past the GPU-draft
apply with the #7695 put-back rule against the draft (`--diff-guard=gpu-draft --print-only`, dry run); G alone when the
draft has >= 30 word characters, was not cut at the token limit and does not repeat a line 4 times (run.mjs
gpuAloneWritten). A page not written stays scans-only and counts as not accepted over the drawn pages.

Judge: Opus (`claude -p`), route-judge-6740 `judgePrompt` against the page image, one output per call, blind (hashed ids,
no route), shuffled. Identical outputs on a page share one verdict.
Controls: per route two WRONG-PAGE items (this image, another book's output of the same route): the route's control passes
when both are refused with fidelity <= 2. Per face two PLANTED items (an accepted output, one error planted by
plant-ocr-errors.mjs, kinds B-E): caught when refused or a defect names the plant. A route whose control fails does not
count; a face whose two plants are both missed is void.

Measures per route, on the written pages, pooled and per face: accepted k/n, wrong-text pages (a defect of severity
wrong_text), invented or wrong-leaf pages (an I-class defect, or a defect naming invented / wrong-page / wrong-leaf
text), agy calls a page (every call, block re-reads and one-page fallbacks included, over the pages read), GPU seconds a
page (the engine's own wall time over its pages), $ per accepted page = (agy calls a page x $0.00087 + GPU s a page x
$249 / 30 days) / the share of DRAWN pages accepted.

Rule (the router's: within 0.08, p 0.9, wrong-text bar 0.04; ZERO tolerance for invented or wrong-leaf text):
1. A route is ELIGIBLE when its written wrong-text pages / n <= 0.04, it has NO invented or wrong-leaf page, P(acc >= 0.8)
   >= 0.9 under Beta(1 + k, 1 + n - k), and its wrong-page control passed.
2. A cheaper route REPLACES the live A when it is eligible and, PAIRED on the pages both wrote and the judge read,
   P(acc_route >= acc_A - 0.08) >= 0.9 under Dirichlet(1 + both, 1 + route_only, 1 + A_only, 1 + neither).
3. The pick is the cheapest per accepted page among A and the routes that replace it, on the POOLED 30 pages.
4. Per face: the pooled pick applies to a face unless, on that face, it has a wrong-text or invented page, or loses more
   than one page net to A paired (A_only - route_only > 1); then that face keeps A. A face whose plants were both missed
   keeps A.
5. A switch of the live German route is made only by a PR, and only when 3 picks a route other than A. Otherwise the cell
   names the route the router would test next; nothing is scheduled.

Budget: under 800 agy calls (judge.mjs correct --agy-max=800). Nothing is written to Mongo before the score; then each
page's best accepted agy read (A or R8) is written under the lane's guards, holds kept.
