# #7701 cheap routes — decision rule, fixed 2026-10-29 before the judge stage (job cheap-routes-7701)

Frame: the first-read lane's (cli-ocr-lane.mjs FIRST_READ_BOOKS + firstReadSkip; visible books held as scans only, print
route, no manuscript, no possible unsplit spread). One interior unread page per book, 30 NEW books per cell
(`judge.mjs draw --cells=de-blank-r2,fr-blank-r2,la-armc --exclude-from=<the 2026-10-29 #7701 sample.json>`), each page
read inside its block of up to 4 unread neighbours where a route reads 4 a call. Every route of a cell runs on the SAME
pages (paired).

Routes (agy gemini-3.8-flash-low through AGY_HOME=.agy-james; Opus never a route):
- German `de-blank-r2`: A = `agy-flash-low@4` (read alone); B = `A>agy-flash-low` (the live route: A, then the fc
  correction one page a call); C = `A>agy-flash-low@4` (arm C: the same correction, 4 pages a call, cli-ocr.mjs
  `--correct-prompt --per-call=4`). German n = 60 for A against B: these 30 pages plus #7701's 30 (`de-blank`, same
  routes, verdicts in results/first-read-7701-2026-10-29).
- French `fr-blank-r2`: A1 = `agy-flash-low` (the live route), A4 = `agy-flash-low@4`.
- Latin `la-armc` (arm c): c1 = `pero>agy-flash-low` (PERO-OCR GPU draft of the page, corrected by agy with the image,
  one page a call), c4 = `pero>agy-flash-low@4` (4 a call). Written through cli-ocr.mjs apply's GPU-draft guards with the
  #7695 put-back rule against the PERO draft (a flagged number / negation / expansion change put back to the draft only
  for like-for-like, tag-free substitutions; any other flag: not written).

Judge: Opus (`claude -p`), route-judge-6740 `judgePrompt` against the page image, one output per call, blind (hashed ids,
no route), shuffled across cells. Identical outputs on a page share one verdict.
Controls: per cell x route two WRONG-PAGE items (this image, another book's output of the same route): passed when both
are refused with fidelity <= 2. Per cell two PLANTED items (an output the judge accepted, one error planted by
scripts/eval/lib/plant-ocr-errors.mjs, kinds B-E): caught when refused or a defect names the plant (scorePlant). A route
whose wrong-page control fails does not count; a cell whose two plants are both missed is void.

Measures per route: (a) every drawn page (a cut / failed / unjudged read = not accepted); (b) WRITTEN = the drawn pages
the lane would write: A, A1, A4 past `apply --first-read-only --print-only` (dry run); B and C on A's written pages
(their correction where they give one, else A's read: the lane serves the first read when the correction is UNCHANGED,
CONTAIN or refused); c1, c4 past the GPU-draft apply with the put-back rule (dry run). Wrong text = a defect of severity
wrong_text.

Rule (the router's, rules.json switch: within 0.08, p 0.9, wrong-text bar 0.04; hold 0.8 / 0.9), on (b):
1. A route is ELIGIBLE when its wrong-text pages / n <= 0.04, P(acc >= 0.8) >= 0.9 under Beta(1 + k, 1 + n - k), and its
   control passed.
2. A cheaper route REPLACES the live one when it is eligible and, PAIRED on the pages both were judged on,
   P(acc_cheap >= acc_live - 0.08) >= 0.9 under Dirichlet(1 + both, 1 + cheap_only, 1 + live_only, 1 + neither).
   German: A against B on n = 60 (#7701's 24 written + these); C against B on these 30. French: A4 against A1.
   Latin: no live route (scans only): c1 schedules when eligible; c4 replaces c1 by rule 2.
3. Among the routes left, the pick is the lowest agy calls per accepted page (fee basis: $0.00087 a call; GPU drafting on
   gex45 counted at its share of $249/month).
4. A cell that does not pass names the route the router would test next; nothing is scheduled from it.
