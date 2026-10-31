# read-surface-6740 — figure captions

<!-- PRIOR ART: none for this study; the figures are made by ../figures6.py and ../figure_f6.py from ../results and the analysis JSON. -->

Made by `figures6.py` (matplotlib 3.11.2) from `analysis6.py`'s output, and `figure_f6.py` for F6. SVG and PNG
(220 dpi). Colours: orange `#eb6834` marks today's (live) setting, blue `#2a78d6` the optimum or the efficiency
frontier; magnitudes on one blue ramp (light = low); CER differences on a blue–grey–orange diverging ramp with grey at
zero. The two marker hues pass the dataviz palette validator (light mode: CVD ΔE 24.7, normal-vision ΔE 33.6, contrast
≥ 3:1); every marked point is also labelled or distinguished by shape (diamond = live, star = optimum). Numbers:
weighted to the queue frame (Amendment 6.8(b)) unless a file name says `unweighted`. Cost is quota cost: agy's token
usage at gemini-3.8-flash list rates, US $ a 1,000 pages (a list-price equivalent, not a bill). Data: 31 October 2026.

**F1 (`f1-design`).** The design. (a) The Box-Behnken cube over pages a call, image long edge and thinking: the 12
edge midpoints and the centre (read three times); filled, made; hollow, not made (stopped by Amendment 6, second
form); dashed, the two corner runs added by Amendment 3; orange diamond, live (4 a call, image as served ≈ 2,350 px,
low). (b) The screen: the 3 × 3 cells of pages a call × thinking at the served image, with the number of books read in
each cell per language (incomplete blocks: every book at live and at 3 of the other 8 cells).

**F2 (`f2-cer-contours`).** Predicted difference in character error rate from live (percentage points) over pages a
call × thinking, by language; book-level within-book fit, 2,000 bootstrap resamples. Hatched, beyond the dashed line:
the upper 95 % bound exceeds +1 pp (not shown non-inferior). Dots: the nine cells read.

**F3 (`f3-cost-contours`).** Predicted quota cost a 1,000 accepted pages over the same grid (log colour scale).

**F4 (`f4-feasible-cost`, `f4u-…-unweighted`).** The money figure: cost a 1,000 accepted pages with the cells not
shown non-inferior in CER hatched; orange diamond live, blue star the cheapest non-inferior cell. German: the star sits
at 8 a call, low. Latin: no star (live is the cheapest non-inferior cell).

**F4c (`f4c-by-century`).** Small multiples by language and century (strata with ≥ 10 books): each cell's cost a
1,000 accepted pages; hatched cells are not non-inferior within that stratum.

**F5 (`f5-cost-vs-accuracy`).** Every cell as a point: cost a 1,000 accepted pages (log) against δ CER from live, with
95 % book-bootstrap intervals on both axes. Grey band: the A-vs-A detectable difference (largest over the identical-
setting pairs). Dashed: the +1 pp margin. Blue line: the Pareto front.

**F6 (`f6-corners`).** What the corners look like. The first lines of a German page (Rohr, *Einleitung zur
Ceremoniel-Wissenschaft*, 1729, p. 697; Internet Archive, public domain) and a Latin page (Rossi, *Pinacotheca
imaginum*, p. 18; Internet Archive, CC0), each read at live, 8 a call / low and 8 a call / high; highlighted words
differ from the typed edition (long s, æ and œ folded before comparing). Latin at 8 a call / low reads the long s as f.

**F7 (`f7-efficiency-frontier`).** The efficiency frontier: absolute CER (from zero) against cost a 1,000 accepted
pages; blue, cells no other beats on both; the arrow, live's distance to the cheapest frontier cell.

**F8 (`f8-backlog`).** Weeks of the whole agy pool needed to give each scans-only queue a first reading at live and at
the best setting, at most: the pool's weekly worth is bounded below by $1,869 of list-price tokens from the account's
own meter (other jobs shared the pool), so the weeks are an upper bound. Queue page counts measured 2026-10-31.

**F9 (`f9-half-normal`).** Half-normal plot of |t| for the terms of the mixed models (logit CER, log cost), by
language; dotted, |t| = 1.96. The cost terms of thinking and pages a call stand far out; no CER term does in German.
