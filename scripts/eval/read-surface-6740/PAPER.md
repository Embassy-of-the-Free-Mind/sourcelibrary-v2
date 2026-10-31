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

*(filled from analysis6.json at the end of the run)*

## 6. Confirmation

*(filled from confirm-de/score.json)*

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
