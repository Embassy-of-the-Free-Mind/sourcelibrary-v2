# #6740 read-surface — German confirmation rule, fixed 2026-10-31 before any confirmation read or judge call

<!-- PRIOR ART: ../confirm/RULE.md (the Latin confirmation of the first run: same frame, judge, controls and paired gate;
this one is German, era-stratified, on the default agy pool, priced in quota cost, and writes the accepted reads). -->

The screen of Amendment 6 (third form; experiment file `2026-10-30-read-surface-box-behnken-6740.md`) found, for German,
on the 61-book typed-reference census plus the 40-book panel (post-stratified to the queue by era × face; 8 of 9 cells
complete at 12:30Z, the ninth, 8 a call / high, costing about 4.6× live where read): **8 pages a call, image as served,
thinking low** (`agy-flash-low@8`) at $6.38 a 1,000 accepted pages against live's $11.48 (44 % cheaper, book-bootstrap
95 % interval 22–56 %), CER difference from live −0.00 pp [−0.08, +0.07] (`measure: accuracy`). This test asks whether
that holds on real queue pages, judged against the image, before anything changes.

**Frame.** The German first-read lane's (`cli-ocr-lane.mjs` FIRST_READ_BOOKS + firstReadSkip languages=deu +
spreadReason: visible books held as scans only, print route, no manuscript, no possible unsplit spread).
`judge.mjs draw --cells=de-surface --n=30`: 30 books in a seeded order (salt `rt-de-surface`), **era-stratified** to the
frame's unread pages (Amendment 6.8(c)): before 1700 **17**, 1700s **11**, 1800 on **2** (shares 0.559 / 0.370 / 0.071,
`frame.mjs` 2026-10-31); one interior unread page per book, inside its block of up to 8 consecutive unread pages. Books
of the #7701 first-read, cheap-routes and german-cheaper draws and of the Latin read-surface confirmation are left out.
No book of the panel or the census is in this frame (each has OCR). The face of each drawn page is labelled by eye after
the draw and reported (no face quota: 93 % of the frame sample is Fraktur).

**Routes**, both on the SAME 30 pages (paired), `gemini-3.8-flash-low` through agy on the **default pool** (the pool of
every screen read):
- `agy-flash-low@4` — A, live: 4 a call, image as served, on the 4-page piece of the block that holds the drawn page.
- `agy-flash-low@8` — O: the whole block (up to 8) in one call, image as served.
Both read with production's fallback (a twice-refused block is read one page a call), so cost includes it.

**Written**: both past `apply --first-read-only --print-only` (dry run). A page not written stays scans-only and counts
as not accepted over the drawn pages.

**Judge**: Opus (`claude -p`), route-judge-6740 `judgePrompt` against the served page image, one output per call, blind,
shuffled; identical outputs on a page share one verdict. Controls: per route two wrong-page items (refused with fidelity
≤ 2 to pass) and two planted errors on accepted outputs; a route whose wrong-page control fails does not count; both
plants missed voids the test.

**Measures** per route on the drawn pages: accepted k/n of written pages, wrong-text pages, invented or wrong-leaf
pages, agy calls a page, and **quota cost a page** (agy's usage on every call the route made for these pages, priced at
gemini-3.8-flash list rates as in Amendment 6.2, ÷ pages read) and quota cost per accepted page.

**Rule** (the router's: within 0.08, p 0.9, wrong-text bar 0.04, zero tolerance for invented or wrong-leaf text):
1. O is ELIGIBLE when its written wrong-text pages / n ≤ 0.04, it has NO invented or wrong-leaf page, P(acc ≥ 0.8) ≥
   0.9 under Beta(1 + k, 1 + n − k), and its wrong-page control passed.
2. O PASSES when it is eligible and, PAIRED on the pages both wrote and the judge read, P(acc_O ≥ acc_A − 0.08) ≥ 0.9
   under Dirichlet(1 + both, 1 + O_only, 1 + A_only, 1 + neither), **and its quota cost per accepted page here is at
   least 10 % below A's**.
3. If O passes: the router cell `de-blank` gains `agy-flash-low@8-written` with this evidence, and the knob change
   (German first reads at 8 pages a call) is PROPOSED in a separate small PR; the tier and Derek decide. This job
   applies nothing to the lane.
4. If O fails, nothing changes; the record says which clause failed.

**Useful pages** (Amendment 6, third form, item 6). After scoring, each drawn page's best judged accepted read is written
through the normal first-read apply path (`cli-ocr.mjs apply --first-read-only`, guards on, reason naming #6740 and
job read-surface-2-6740): the accepted read with the higher judged fidelity; a tie goes to A (the live route). A page
neither route had accepted is not written. Controls and planted items are never written.

**Budget**: at most 300 agy calls (`judge.mjs correct --agy-max=300`); before the judge, `climits status` under 85 %.
