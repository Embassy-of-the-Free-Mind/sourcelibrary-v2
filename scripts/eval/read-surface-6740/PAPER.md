# Tuning a vision-language first read by response-surface methods: pages a call, image size and thinking, priced in tokens

<!-- PRIOR ART: scripts/eval/experiments/2026-10-30-read-surface-box-behnken-6740.md (the record this section is written
from; every number here is in it or in results/); .claude/docs/ocr-memorization-paper.md (the #4916 paper programme this
folds into). This file is the paper section, not the record. -->

*Section draft for the #4916 paper programme. Source Library, 2026-10-31. Data: dataset `read-surface-6740 v1`
(`dataset/`, files in R2 `eval-artifacts/read-surface-6740/dataset-v1/`). Figures: `figures/` (captions in
`figures/CAPTIONS.md`).*

## 1. Question

About 23,700 visible books in the library are page images with no text. Their first reading is a call to Gemini Flash
through the Antigravity CLI (agy), on a subscription whose weekly allowance is charged by token cost, not by calls. Three
settings of that call are free to choose: how many consecutive pages of one book go into a call (1, 4 or 8), how large
each image is (fitted to a long edge of 1,024, 1,600 or 2,400 px, or sent as served), and how much the model thinks
(low, medium or high). The question is which combination reads a page at the lowest quota cost without a loss of
accuracy against the setting in use (4 pages a call, image as served, thinking low).

## 2. Design

**References.** Accuracy is measured against human-typed editions of the same pages: the Deutsches Textarchiv (German),
CAMENA (neo-Latin) and EEBO-TCP (early English), aligned to our scans in #6012. One target page per book; each target has
an 8-page window of its own book, so a setting reads the target alone, with 3 neighbours or with 7.

**Stage 0 (the first run, preregistered).** A Box-Behnken design over the three factors (12 edge midpoints, 3 centre
replicates) plus two runs at the live setting, on the same 40 German and 40 Latin target pages in every run (blocking by
page). The first ten runs a language were made sequentially (a Bayesian surface chose the next batch); the remaining
runs were added after those ten had been seen (Amendment 6), so that fit is exploratory.

**Stage 1 (the screen).** Before any screen read, a simulation from the stage-0 runs (the power gate) gave the smallest
main effect a 10-setting screen could detect. Image size and a one-line script instruction in the prompt had plausible
effects below that on both accuracy and cost and were dropped; image preprocessing had been dropped on prior evidence
(#5250). The screen is the 3 × 3 factorial of pages a call × thinking at the served image, in **incomplete blocks**:
every book of the typed-reference frame (a census: 61 German, 84 Latin; 140 of 204 English) is read at the live setting
and at 3 of the 8 other cells, allocated so that every pair of cells shares about the same number of books. Every new
read used one agy account.

**Stage 2 and confirmation.** The screen nominates; it does not decide. The cheapest cell that is non-inferior in CER is
confirmed on fresh pages from the German first-read queue (30 books, era-stratified to the queue, seed named in the
rule), read by the live setting and the candidate as the production lane would run them and judged blind by Opus against
the page image, under a rule committed before the first read.

## 3. Responses

- **CER**: the windowed character error rate of the target page against the typed page (letters and digits, the read's
  header tags removed; long s and combining marks folded). *measure: accuracy.*
- **Quota cost a page**: agy's own token counts for every call a page needed (block calls, refused and cut blocks,
  retries, one-a-call fallbacks), priced at gemini-3.8-flash list rates ($0.75 / M input, $0.075 / M cached input,
  $3.75 / M output, thinking included in output). Pages a refused block left unread are priced at the one-a-call cost of
  the same thinking level, as production reads them alone. A list-price equivalent, not a bill.
- **Yield and cost per accepted page**: a target is accepted when its read is usable and not wrong text; cost per
  accepted page = cost a page ÷ yield.
- Calls a page, wall seconds a page (box load disclosed), filter cuts, wrong-text and invented flags.

## 4. Analysis

The unit is the target page of a book within a run. Linear mixed models with a random intercept for book (REML,
statsmodels 0.15) carry the full quadratic in pages a call and thinking, the image size and agy account of the stage-0
runs, and century. CER enters on the logit scale for inference (raw-scale residuals have kurtosis near 200); the
decision uses the raw scale in percentage points, with intervals from 2,000 book-level bootstrap resamples of the
within-book fit. A cell is non-inferior when the upper 95 % bound of its CER difference from live is at most 1 pp (the
registered margin for a cheaper route). The optimum is the non-inferior cell with the lowest predicted cost per accepted
page, and only if it saves at least 10 %. Results are reported unweighted and post-stratified to the queue by era and
typeface (the weighted result decides). Lack of fit compares the quadratic to a cell-means model within book; the noise
floor is the spread of identical runs (A-vs-A).

## 5. Results

**Cost is driven by thinking, accuracy by almost nothing.** On the log scale a coded step of thinking adds 0.95
(German) and 0.93 (Latin) to quota cost a page (REML SE 0.03–0.05), and a step of pages a call removes 0.52 and 0.81.
A medium- or high-thinking page carries 5,500–7,500 tokens of reasoning against 700–1,000 of text. At 4 pages a call,
medium thinking costs 3.8× (German) and 4.8× (Latin) the live setting; high 6.4× and 6.6× (Table 1, Figure F3).
Counted in calls the order reverses: high thinking needs slightly fewer calls a page, which is why the stage-0 pick by
calls (Latin 8 a call, high) costs 2.7× live in tokens.

German CER does not respond to either setting: every term of the logit-scale model has |t| < 1, and every cell lies
within 0.1 pp of live (Figure F2). The A-vs-A pairs (identical settings, 40 books) differ by −0.04 to +0.07 pp and the
smallest paired CER difference 40 books detect at 80 % power is 0.09–0.12 pp, so this null is a bound: no setting
changes German CER by more than about a tenth of a point. In Latin, thinking at 4 a call lowers CER by 0.7–0.9 pp
(intervals exclude zero, beyond the 0.6–0.7 pp floor), and 8 a call at low thinking raises it by 2.25 pp [+0.05,
+5.20] (weighted; unweighted +0.80 [−0.05, +1.94]): with eight images in one call the model reads the long s as f
(Figure F6). The interaction is environmental: Latin pages are smaller roman type, often with heavy long-s use.

**Optimum.** German: 8 pages a call, image as served, thinking low, 45 % cheaper a 1,000 accepted pages than live
(95 % interval 25–58 %; unweighted 40 %, 21–53 %), CER −0.00 pp [−0.09, +0.07], non-inferior in every century with
≥ 10 books (Figures F4, F7). Latin: live (no cheaper cell is non-inferior). Across both languages and every century
with ≥ 10 books the robust setting is live. Weighted and unweighted fits agree on every decision. The quadratic does
not fit the German cell means (lack of fit F(3, 161) = 4.29, p 0.006) or either language's cost; since all nine cells
were read, the decision rests on cell means and the surface is descriptive.

**Efficiency.** Five readings of the account's own meter, taken while other jobs also used it, bound a week of the
pool at no less than $1,869 of list-price tokens. At that bound the German queue (797,772 pages, 3,131 books, measured
2026-10-31) needs at most 4.9 pool-weeks at live and 2.7 at 8 a call; the Latin queue (4,741,905 pages) 25.5 at live
(Figure F8). Wall time a page does not fall with 8 a call (39 against 24 s a page at the box's load), because refused
8-page blocks are re-read one page at a time.

## 6. Confirmation

Thirty German queue pages (one per book, era-stratified to the queue), read as the lane reads them by live and by
8 a call, judged blind by Opus against the image with wrong-page and planted controls (4/4 and 2/2 passed). Of the pages
each wrote, live was accepted on 17/25 and 8 a call on 22/25; paired, 8 a call was the better reading on 5 pages and
the worse on none (P(acc₈ ≥ acc₄ − 0.08) = 0.998). Quota a 1,000 accepted pages: $8.78 against $25.93. But 8 a call
had 2 wrong-text pages of 25, over the preregistered absolute bar of 0.04, and P(acc ≥ 0.8) = 0.79 < 0.9, so by the
rule it fails. Live fails the same bar by more (5/25), and both of 8 a call's wrong-text pages are misread identically
by live. Under the newer rule that sets the bar at the live route (defects no worse than live's), it would pass. The
confirmation therefore supports 8 a call against live and leaves a single question of policy open: whether a first
read must clear an absolute wrong-text bar that the live read itself does not clear.

## 7. Limitations

- **Memorisation.** DTA, CAMENA and EEBO-TCP texts are on the open web; the model may partly recall them, which flatters
  CER and can mask effects of image size and thinking (the memorisation subsidy, #3212). The confirmation is on queue
  pages with no public transcription for that reason.
- **The panel is not the queue.** It holds the books that have a typed edition. German: the queue is 56 % pre-1700
  pages and 93 % Fraktur; the census panel is 18 % pre-1700. English: the queue is 74 % nineteenth- and twentieth-century
  roman print; EEBO-TCP covers 1500–1700 only, so English results speak for early print. Post-stratification corrects
  only what the panel contains.
- **Post hoc completion.** Stage 0 was completed after ten runs a language had been seen; the screen's design and the
  power gate were written before their reads, but after stage 0. The confirmation is the clean test.
- **Account.** Identical runs on two agy accounts differed by 0.09–0.11 calls a page in filter cuts; the stage-0
  low-thinking runs were on a second account and are a pool contrast, not part of the thinking effect.
- **Load.** Wall time depends on the shared box's load; calls that hit the CLI's 300 s limit were re-run once at lower
  concurrency.
- **Price, not quota.** Quota is priced from token counts at list rates. The account's own meter could not be read
  alone (other jobs share the pool), so the quota a dollar is a bound, not a measurement.
- CAMENA targets start from page 4 (alignment covered the first pages); Latin is roman type only.
