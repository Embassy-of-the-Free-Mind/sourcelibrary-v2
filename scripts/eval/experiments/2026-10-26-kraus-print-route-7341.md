---
stage: ocr
measure: [judged, agreement]
languages: [ar]
scripts: [Arab]
canons: []
n_books: 1
n_pages: 25
verdict: "On 25 more pages of Kraus's 1935 print edition (29 with the gate's 4), every reader gives a usable page almost every time. Opus 5.5: 25/25, 0 misleading. agy Gemini 3.8 Flash low: 23/25; the other 2 were cut by Gemini's filter (fixed message, the retry cut too). Flash-Lite (production prompt): 20/25 under the stricter judge; 3 of its 5 MISLEADING grades rest only on a repeated page number. Refit with the new rows, the pooled OCR estimator now routes the cell: Opus is the only route that clears the CER bar (P = 1.00; agy 0.16, Flash-Lite 0.02). agy's P(not read) on Kraus is 0.16 [0.04, 0.40]. The router leaves the cell at 'test', because an Opus image call is still unmetered."
status: undecided
decision: "Kraus 1935 (582 pages): Opus 5.5 via claude -p, one read per page (about 1.7–8.5 weekly points of one account, by the gate's points range). The cheaper alternative the data supports: agy 3.8 Flash low, falling back to Flash-Lite on the filter's fixed message. That chain was usable on 29/29 pages, but it does not clear the router's CER bar. It strips Flash-Lite's vowel marks on the cut pages (marks CER 3.9% against 0.6%). Releasing the hold is Derek's call."
superseded_by: null
issue: [7341, 6740]
---
## 2026-10-26 · Kraus 1935: 25 more pages so the router can route the cell (#7341, #6740)

PRIOR ART: the gate `2026-10-25-arabic-manuscript-ocr-gate-jabir-7341.md` and its glue
`scripts/eval/arabic-mss-gate-7341/`. `prep.py`, `key-reads.py`, `score.py` and `judge.py score` ran unchanged, as did
#6544's `build-keys.py`, `run-lite.mjs`, `run-cli-arm.py` and `run-claude-arm.py`. The refit is
`2026-10-25-ocr-estimator-v1-arabic-charts-7341.md`, with the same model, settings and router. New glue lives in
`scripts/eval/kraus-print-7341/`:
- `draw.mjs` and `finalize-draw.mjs`: a whole-book stratified draw from one book;
- `judge_requests.py`: the gate's judge requests, with the planted controls drawn by page, because the gate drew them
  from manuscript books and would plant nothing here;
- `summarize.py`: intervals resampled by page, the 4 gate pages pooled in.

**Why.** The pooled refit (#7372) could not route Kraus (*Mukhtār rasāʾil Jābir ibn Ḥayyān*, Cairo 1935, book
6ade30b13326a0839b2d1c42, held `jabir-ocr-gate-7341`):
- 4 test pages is below the router's 5-page floor;
- the filter term learned on the alchemical manuscripts carried to Kraus: agy P(not read) 0.28 [0.07, 0.63].

Derek approved 25 more pages on 2026-10-25.

### Draw (`draw.mjs`, `finalize-draw.mjs`, `results/kraus-print-7341/draw.json`)
- **Strata.** Pages 1–582 cut into 25 equal strata. Each stratum shuffled (mulberry32, seed 7341 ^ stratum); the first
  3 candidates went onto labelled contact sheets.
- **Excluded:** the gate's pages 385, 231, 158 and 320, its blank 106, and the anchor passage (pp. 20–22 = images
  30–32).
- **The screen.** Every stratum's first candidate was a text page, so nothing was skipped. Never reached: p1 (binding),
  p4 (blank), p567 (errata), p581 (library bookplate).
- **Pages:** 16 27 65 87 112 139 152 174 190 221 252 267 283 310 331 354 383 409 440 465 475 506 534 540 563.
- **What they carry:**
  - an apparatus on all 25; heavy (a third to half the page) on 27, 252, 267, 283, 310, 331;
  - section headings on 65, 87, 267;
  - treatise openings on 283 (al-Khawāṣṣ al-kabīr) and 475 (basmala and title);
  - a list or table on 409; a short end-of-treatise page on 190;
  - vocalised words on 152; marginal folio numbers on 174.

### Arms (same as the gate's Kraus cell)
- **a. Flash-Lite, production prompt** (`production-v19.1`, hash 9d8f959e…), paid API, temperature 0.1, no thinking:
  **$0.046 for 25 pages**, the only paid call.
- **b. Gemini 3.8 Flash low via `agy -p`** (default; `AGY_ALLOW_HEAVY` not set; `--retry-refusal`): 29 calls for 25
  pages.
- **c. Opus 5.5 via the sealed `claude -p --restricted` reader:** $1.82 list-price equivalent, not billed.
- **Prompt.** b and c get the gate's print variant of #6544's diplomatic READ prompt ("all the text on this printed
  page, footnotes included").

**Filter cuts, counted by the fixed message** ("This request was blocked by Gemini's filters"):
- **agy: 2 of 25**, on p152 (text and apparatus, vocalised) and p475 (a treatise opening). Both were cut again on the
  retry.
- No other agy read failed. The retries on p331 and p354 ended in a read.
- Flash-Lite and Opus: 0.
- With the gate: **2 of 29 Kraus pages** cut, against 16 of 26 manuscript pages.

### Key (model-adjudicated; DIRECTIONAL)
- **The second reader.** `key-reads.py` fills the Gemini slot with the agy read on 23 pages, and with the Flash-Lite
  read on the 2 cut pages.
- **Spans.** `build-keys.py` found 327 disputed spans; 24 one-letter controls were planted on 14 pages.
- **KEY-O** (Opus referee) and **KEY-G** (agy 3.8 Flash low referee) each caught **24/24** controls.
- **The keys agree on 286 of 351 spans (81%).** No Fable step, as in the gate.
- **Self-keying.** The key is built from the Opus and agy reads, so both are self-keyed on 23 pages and Flash-Lite on
  2. The model's `key_self` term takes this out; the raw CERs below do not.

### Usability (two-family judges, `judge.py` prompt and score; the deciding measure in the gate)

| arm | usable (stricter judge) | USABLE only | misleading | failed | Opus judge usable | Gemini judge usable |
|---|---|---|---|---|---|---|
| Flash-Lite | **20/25** (80% [64, 96]) | 9 | 5 | 0 | 24 | 20 |
| agy 3.8 Flash low | **23/25** (92% [80, 100]) | 18 | 0 | **2** (filter) | 23 | 23 |
| Opus 5.5 | **25/25** | 22 | 0 | 0 | 25 | 25 |
| *pooled with the gate's 4 pages (29)* | Flash-Lite 24/29 · agy 27/29 · Opus 29/29 | | | | | |
| *agy, Flash-Lite on a filter cut* | **25/25** (29/29 pooled) | | | | | |

Intervals are 95%, resampled by page. With one book they are too narrow.

- **Flash-Lite's 5 MISLEADING grades all come from the Gemini judge.**
  - Three (pp. 27, 190, 252) cite only a page number that Flash-Lite writes a second time. The production envelope
    leaves it in after the tags are stripped; the Opus judge calls it "repeated" and grades the read USABLE.
  - p65 is real, and both judges see it: Kraus's editorial addition ⟨إما⟩ ماء الجماع was dropped.
  - p139: the Gemini judge cites a misread number phrase; the Opus judge calls the read USABLE.
  - Not counting the page-number repeat, Flash-Lite is usable on 23 of 25.
- **Plants:** 6 copies (3 Opus reads, 3 agy reads, six pages), each with a word swap, an invented 4-word clause from
  another Kraus page, and a dropped line.
  - The Opus judge caught 17 of 18 (it missed 1 swap). The Gemini judge caught 12 of 18 (it missed 3 swaps, 1 clause
    and 2 dropped lines).
  - The Opus judge graded all six planted copies MISLEADING; the Gemini judge five, and one NOTICEABLE.
  - On another book's clause the gate's Gemini judge caught 16 of 18. Here the clause comes from the same book, which
    makes the plants harder to catch.
- **Judge agreement:** 54 of 73 graded reads exactly.

### CER against the keys (secondary; letters only, mean page CER %)
The normalisations are the gate's:
- **skel:** marks dropped; alef, hamza, yāʾ and tāʾ marbūṭa folded;
- **marks:** vowel marks, shadda and hamza seats kept.

Intervals are by page.

| arm | read | KEY-O skel | KEY-O marks | KEY-G skel | fail=1, KEY-O skel |
|---|---|---|---|---|---|
| Flash-Lite | 25/25 | 0.53 [0.36, 0.73] | **3.89** [3.15, 4.66] | 0.48 | 0.53 |
| agy 3.8 Flash low | 23/25 | 0.19 [0.10, 0.30] | 0.63 [0.43, 0.88] | 0.13 | 8.2 |
| Opus 5.5 | 25/25 | 0.12 [0.01, 0.32] | 0.96 [0.73, 1.22] | 0.19 | 0.12 |

- **Vowel marks.** Production's prompt drops Kraus's vocalisation. Flash-Lite's marks-minus-skel gap is 3.4 points,
  against 0.4 for agy and 0.8 for Opus; the gate's 4 pages showed the same, at 3.7. On the skeleton, all three
  readers are within half a point of the key.
- **Where Opus erred most:** p409, a list of terms (2.5% skeleton). On every other page Opus is at most 0.15% under
  KEY-O.

### Refit (`fit_ocr_v1_arabic.py --only full`, then `report`; the #7372 settings: SVI AutoNormal, 15,000 steps, 400 draws, `ext`)
**The table.** `build-arabic-rows.py --kraus-only` adds 75 rows (source `kraus-7341`, panel `jabir-7341`, alchemy 1,
model key) to `results/arabic-rows.jsonl`: 232 → 307 rows.
- **The v1 table had to be rebuilt.** #7372 fit on a v1 table kept on main's volume, which this box cannot reach. It
  was rebuilt from `estimator-v2-6740/ocr-table-v1-gpu.jsonl` with the #4763 GPU arms dropped: 12,178 rows.
- **What is missing.** The 122 #4763 English rows of agy 3.8 Flash low (`agy-scores.jsonl`, on main only) are not in
  it. So the agy engine has 122 fewer English reads.
- **Control.** A reproduction fit on this table with the committed Arabic rows:
  - reproduces every committed Arabic E[CER] to within about 5% relative;
  - does not reproduce agy's P(not read) on Kraus: 0.12 [0.01, 0.47], against the committed 0.28 [0.07, 0.63].

  The refusal part is therefore sensitive to those rows, or to SVI's noise. **"Before" and "after" below are both fits
  on the rebuilt table.**
- **Posterior predictive check.**
  - Level bias over 161 chart × engine cells: +0.0077 [−0.016, +0.031] (#7372: +0.0074).
  - Fitted against observed on the new rows: agy did-not-read 0.096 fitted against 2/25 observed. CER is fitted 2–4×
    the observed (0.001–0.005), the same direction as the gate's clean pages.

**Kraus cell, new page, expert key** (the posterior table; median [90%]):

| engine | pages read in chart | E[CER] before (4 Kraus pages) | E[CER] after (29) | P(not read) before | P(not read) after |
|---|---|---|---|---|---|
| Opus 5.5 | 29 | 0.052 [0.029, 0.103] | **0.032 [0.020, 0.066]** | 0.003 | 0.002 [0.000, 0.048] |
| agy 3.8 Flash low | 27 | 0.070 [0.044, 0.123] | 0.058 [0.040, 0.090] | 0.12 [0.01, 0.47] | **0.16 [0.04, 0.40]** |
| Flash-Lite | 38 | 0.083 [0.052, 0.139] | 0.074 [0.055, 0.112] | 0.002 | 0.001 |
| 3 Flash (API, disabled) | 11 | 0.054 | 0.041 | 0.010 | 0.010 |

P(lowest CER) among measured engines: Opus 0.80, 3 Flash 0.18, agy 0.03, Flash-Lite 0.00.

**Why agy's P(not read) did not fall to the observed 2/29.** The pooled model has a single alchemy × CLI-family term
(+3.9 [3.0, 5.2] logit). The 16 manuscript cuts set it, so Kraus and the manuscripts share it: the fit cannot tell
an alchemical print page from an alchemical manuscript page. The 25 pages narrowed the interval from [0.01, 0.47] to
[0.04, 0.40]. The observed rate on Kraus (2/29 = 7%) sits inside that interval, at its low end.

### Route (`route_ocr_v1.py --charts arabic-print`, current `route-costs.json` and `quality-bars.json`; `results/ocr-v1-kraus-routes.{json,md}`)
The router's own quantities (its key handling, one new page): E[CER] and P(read) are medians [90%].

| route | basis | P(read) | E[CER] | P(clears bar) | cost per usable page (fallback) | P(best) |
|---|---|---|---|---|---|---|
| **claude -p Opus 5.5** | measured, 29 pp | 0.998 | **0.024** [0.015, 0.040] | **1.00** | unmetered in `route-costs.json`; the gate's range is 0.003–0.015 weekly points a page | **0.81** |
| agy 3.8 Flash low | measured, 27 pp | **0.84** [0.61, 0.96] | 0.046 [0.032, 0.069] | 0.16 | 6.5e-6 of a month's agy allowance | 0.01 |
| Flash-Lite, Batch | measured, 38 pp | 0.999 | 0.058 [0.044, 0.081] | 0.02 | $0.0015 | 0.00 |
| 3 Flash, realtime (disabled) | measured, 11 pp | 0.99 | 0.032 | 0.63 | $0.0038 | 0.19 |
| agy 3.8 Flash high / 3.7 low, Sonnet 5.5 | pooled | 0.80 / 0.81 / 1.00 | 0.044 / 0.043 / 0.036 | 0.20 / 0.19 / 0.42 | (not routable: pooled) | — |

- **Route for Kraus: Opus 5.5.**
  - It is the only route, measured or pooled, that clears the bar with P ≥ 0.9. The bar is within max(0.01, 15%) of
    the best route.
  - Its choice does not change at margins ×0.5 or ×2.
  - The router prints "none clears the bar" (answer `test`, nearest Opus, `nearest_unmetered`). Since 2026-10-26 an
    unmetered Claude route can be the best quality but is never chosen on cost. The cost goes on the metering job
    (route-judge-run-6740), not on Kraus.
- **Before the 25 pages,** on the same rebuilt table and the current router code (`results/ocr-v1-kraus-routes-before.json`):
  the router chose Flash-Lite Batch. It was the only measured, enabled route at the 5-page floor (P(clears bar) 0.96
  against itself, P(best) 0.12).
- **Cost of the whole book (582 pages):**

  | route | cost |
  |---|---|
  | Opus | 1.7–8.5 weekly points of one account ($0.073 list-price equivalent a page × 0.04–0.2 points per list dollar, the gate's range); about 2 h at 2 parallel calls (20 s a page) |
  | agy → Flash-Lite | about 0.3% of a month's agy allowance (1.16 calls a page), plus Flash-Lite Batch on the cut pages: $0.07 at the observed 7%, $0.14 at the fitted 16% |
  | Flash-Lite alone | $0.86 |

**CER model against usability.**
- On the deciding measure of the gate, agy with a Flash-Lite fallback was usable on every one of 29 pages, at a
  fraction of Opus's cost.
- On the CER model it does not clear the bar. Two things put it there:
  - a 0.02 expert-key CER gap that the model extrapolates from 0.1–0.2% observed;
  - the filter, which costs 16% of reads in the fit (7% observed).
- The two measures disagree on *how much* Opus is better, not on the order: Opus is first on both.
- Two observable costs of the cheaper chain:
  - the cut pages lose Kraus's vocalisation (Flash-Lite marks CER 3.9%);
  - a lane on it must detect the filter message (`run-cli-arm.py` `safety_filter`).

### What this does not show
- **One book, 29 pages.** Intervals are by page and too narrow.
- **The keys and judges are models,** in the families being judged. Opus and agy both build the key, and both are
  self-keyed on 23 of 25 pages.
- **The refit's table lacks 122 English agy rows** (above). The agy refusal estimate moved 0.12 → 0.28 between this
  table and #7372's with no Kraus data changed, so its level should be quoted with the table it came from.
- **The filter's trigger is the recipe text, not the book.** Two cuts in 29 pages say little about which of Kraus's
  later extracts (al-Khawāṣṣ, al-Sabʿīn) cut more often. 475 and 152 were cut; 283, the al-Khawāṣṣ opening, was not.
- **No human read.**

### Calls and spend
| route | calls |
|---|---|
| paid API (Flash-Lite) | 25 pages, **$0.046** (ceiling $1) |
| agy (subscription) | 29 reads (incl. retries), 25 referee, 79 judge |
| `claude -p` Opus (subscription) | 25 reads, 25 referee, 79 judge |

Nothing was written to `pages` or `books`; the hold was not released.

### Files
- **Glue:** `scripts/eval/kraus-print-7341/` (`draw.mjs`, `finalize-draw.mjs`, `judge_requests.py`, `summarize.py`).
- **Results:** `scripts/eval/results/kraus-print-7341/`.
  - `kraus-rows.jsonl` holds 75 rows in the gate's row shape, with `stratum`, `features`, `failure_kind` and `calls`.
  - The other files: `summary.json`, `cer-scores.json`, `judge-scores.json`, `keys-report.json`, `draw.json`.
  - No page text is committed.
- **Estimator:**
  - `build-arabic-rows.py`: the `kraus-7341` source and `--kraus-only`;
  - `fit_ocr_v1_arabic.py`: `ARABIC` includes `kraus-7341`;
  - `provenance-legacy.json`: the `arabic-rows/kraus-7341` entry;
  - `results/arabic-rows.jsonl`: 307 rows;
  - `results/ocr-v1-kraus-fit.json`, `results/ocr-v1-kraus-routes{,-before}.json`, `results/ocr-v1-kraus-routes.md`.
- **Scratch** (gex45 `/root/jobs/kraus-print-test-7341/`): reads, keys, judge replies, the rebuilt table
  (`refit/ocr-table-v1.jsonl`), the fit pickles (`refit/fit-new`, `refit/fit-repro`) and the dollar route table.
