---
stage: ocr
measure: [agreement, judged]
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Seven analyses of evidence already on file, no model calls. A same-page test needs 0.70 of the pages per arm a different-pages test needs for a correction against its own draft (median phi 0.33, 57 pairs), 0.88 for a read against a correction (phi 0.13, 38 pairs). Repeats on file: 4 read repeats (236 pages) and 6 judge repeats (195 pages). The stop rule Derek took (start 20, batches of 10, win at P >= 0.99 within 8 points, stop as worse at P >= 0.90, cap 100, paired) gives a false pass of at most 3.2% at a gap of 9 points, against a 5% bar, and a tie passes 24-79% of the time at a mean of 67-86 pages. On split halves of books, gaps of 10 points or more reproduce (median 0.97); gaps of 5-10 points reproduce at a median of 0.61. Of the 3,425 judged pages behind the best agy route of each cell, 1,589 were drawn at random; 46 of 110 cells (1.07M pages waiting) have no agy evidence. On the rubric ladder, 46/60 human-typed print pages say what the page says (49/60 counting only flags both adjudicators confirm) against 40/60 of our reads of the same pages."
status: informational
decision: "Nothing wired. The stop rule passes its simulation bar as taken; the first panel's size and arms follow from sections 1, 3, 4 and 6 (below, and the #7263 comment)."
feeds: route
superseded_by: null
issue: [7263]
router_evidence: "none — reads the router table's evidence; adds no rows"
defect_rates: "none — nothing judged"
---
## 2026-11-04 · Route-free analyses before the first paid panel (#7263)

PRIOR ART:
- `scripts/eval/estimator/router-table/v3_sim.py` and `build.py` (`paired_draws`, the gate): the stop-rule simulation reuses `build.paired_draws` for the posterior; `stop_sim.py` checks it against an exact calculation on six tables (agreement within 0.004).
- `scripts/eval/experiments/2026-11-04-experiment-kinds-6553.md`: the header fields (`feeds:`) and the kinds this record sorts tests into.
- `scripts/eval/lib/paired-stats.mjs`: the paired bootstrap the tests on file used; not rerun here.

**Who it is for.** Derek named four questions on 2026-11-04: how many pages a call; whether GPU OCR plus a correction beats a fresh read; where agy Gemini 3.8 is unacceptable; and repeated measurement. These analyses use only what is on file. They decide what the first paid panel must test and how large it is.

**Method.** `scripts/eval/route-free-7263/perpage.py` loads every per-page verdict file the router table and the records cite. `analyze.py` builds sections 1, 2 and 7 (output `route-free.json`, archived with the job scratch). `scripts/eval/estimator/router-table/stop_sim.py` runs section 6 (10,000 replicates a grid point). `scripts/eval/route-free-7263/agy_map.py` builds section 5 from `current.json` (the live table and its per-cell pointers) and `rules.json`. Sections 3 and 4 are read from the records named in their tables. No Gemini, Opus or other model call; nothing written to pages, books, `rules.json` or `current.json`.

### 1. How strongly two routes on the same page are linked

For every paired test with per-page verdicts (both routes judged on the same page, 20 pages or more), the discordant-pair table and phi between the two routes' accept verdicts. "Ratio" is the pages a same-page (paired) test needs over the pages per arm a test on different pages needs for the same power: (p_a(1 - p_a) + p_b(1 - p_b) - 2 cov) / (p_a(1 - p_a) + p_b(1 - p_b)).

| pair type | pairs | sources | pages | phi median [IQR] | ratio median [IQR] |
|---|---|---|---|---|---|
| correction against its own draft | 57 | 14 | 3,148 | 0.33 [0.19-0.55] | 0.70 [0.47-0.85] |
| read against a correction | 38 | 7 | 2,527 | 0.13 [0.03-0.30] | 0.88 [0.70-0.97] |
| read against read, other engine | 38 | 16 | 2,227 | 0.30 [0.11-0.44] | 0.72 |
| read against read, same engine, other setting (per call, thinking) | 15 | 5 | 745 | 0.30 | 0.70 |
| correction against correction, same draft | 27 | 9 | 1,050 | 0.32 | 0.70 |
| correction against correction, other draft | 18 | 1 | 540 | 0.44 | 0.56 |

So a same-page test of a correction against its draft needs about 70% of the pages a test on different pages needs per arm, and a test of a fresh read against a correction needs about 88%. Pairing saves least where Derek's second question sits (read against correction).

Caveats. The Fraktur test (#7835) judged some identical texts once, which raises phi there. #7568 and Latin-250 (#5924) are 25 pages a book from 10 books on the Step T / Step C scales; their pages are not independent, and the ratio treats them as if they were.

### 2. Noise floor: every repeat on file

**The same read judged twice** (same packet, or another reader of it):

| source | judge | agree | kappa |
|---|---|---|---|
| judge-compare-7611 | Opus | 28/30 | 0.86 |
| judge-compare-7611 | Argon | 28/30 | 0.86 |
| judge-compare-7611 | Gemini Flash | 25/29 | 0.72 |
| correction-pass-7818 | Opus | 29/30 | 0.87 |
| zh-ditto-restore (not preregistered) | Opus, Step T | 66/70 | 0.885 |
| judge-cal-7866 bar | Opus | 6/6 | — |
| Fraktur-7835 duplicate texts | Opus | 5/6 | — |
| Latin-250 (#5924), another reader of another packet, 10 books | Opus, Step C | lite 210/232 (0.80); agy read 230/250 (0.57); lite>agy 205/250 (0.43); lite>opus 247/250 (0.94) | as given |

**The same route read twice, each read judged once:**

| source | task | pages | agree | discordant (first only / second only) | phi |
|---|---|---|---|---|---|
| agy-ocr-pages-per-call-6740 T1 | Siku read, 1 a call twice | 26 | 22 | 2 / 2 (5 both, 17 neither) | 0.61 |
| agy-ocr-pages-per-call-6740 T2 | German correction, 1 a call twice | 30 | 28 | — | 0.63 |
| agy-ocr-pages-per-call-7522 | German + Latin read, 1 a call twice | 60 | 56 | 0 / 4 | 0.43 |
| agy-pages-per-call-siku-7503 | Siku translation, 1 a call twice | 60 | 50 | 7 / 3 | 0.52 |

read-surface (#6740) L1 against L2 on typed references: German median |ΔCER| 0.0006 (p90 0.003), status agrees on 34/40 pages; Latin median 0.0012 (p90 0.031), 37/40, and the ≤ 2% CER status flips on 5/37.

There are few: four read repeats (236 pages, all agy Flash-low, three languages, all at 1 a call), and six judge repeats (195 pages) plus the Latin-250 cross-reader set (982 page readings in 10 books). A route read twice disagrees with itself on 4-17% of pages (4/60 to 10/60), so a gap under about 10 points between two single reads of the same route is inside what one route does twice. No repeat on file covers Opus reads, GPU drafts, manuscripts or any non-Latin, non-Chinese, non-German script.

### 3. Pages per call

All agy Gemini 3.8 Flash-low unless stated. Route judge = blind Opus with the image.

| record | task / language | per call | pages / books | result (scale) | cost per page | failure kind at the higher setting | draw |
|---|---|---|---|---|---|---|---|
| #6443 (cited in 7503, 6740) | read, Siku | 1 vs 5 | 10 pages | CER 12.1% vs 21.6% | — | one 5-page call returned text from none of its pages | not stated |
| agy-ocr-pages-per-call-6740 T1 | read, Siku | 1, 1, 2 | 30 / 15 | 8/30, 7/30 vs 8/30 (route judge); paired CER -0.6 pts [-4.5, +2.9] | quota index 0.83 | cross-page 0/30; filter blocks 4, 8, 2 | seeded |
| same T2 | correction, German | 1, 1, 2 | 30 / 15 | 27/30, 27/30 vs 23/30 | 0.76 | new errors in correct drafts (hyphen read as s; a Latin word replaced by Chinese characters) | seeded |
| agy-ocr-pages-per-call-7522 | read, German + Latin print | 1, 1, 2, 4 | 60 / 15 | usable 55, 59 vs 56 (2), 58 (4) of 60; pages with a misread word 32, 29 vs 39, 36 | tokens 0.87 (2), 0.68 (4) | cross-page 0/240; omissions 2, 1, 1, 2 | seeded |
| agy-pages-per-call-siku-7503 | translation, Siku | 1, 1, 2, 4 | 60 / 15 | usable 49, 45 vs 48, 48 | 0.70 (2), 0.55 (4) | sentence across a page break finished on the earlier page: 0 (1), 2/26 (2), 3/39 (4) | seeded, 4 consecutive pages |
| siku-percall-5600 | translation, Siku | 1 vs 4 | 30 / 30 | 19/30 vs 21/30 | 0.65 | filter refused 5 calls at 4 | seeded |
| read-surface-box-behnken-6740 | read, German | 1 / 4 / 8 | 61 books | ΔCER vs 4: 1 a call -0.02 [-0.13, +0.11]; 8 a call -0.00 [-0.09, +0.07] (CER on DTA reference) | 8 a call -45% [-58, -25] per accepted page | filter cuts longer replies; 8 a call with high thinking timed out on 4/31 calls | typed-reference frame |
| same | read, Latin | 1 / 4 / 8 | 84 books | 8 a call +2.25 pp CER [+0.05, +5.20] weighted | -56% | long s read as f | typed-reference frame |
| same | read, English (EEBO) | 4 vs 8 | 140 books | ΔCER +0.26 [-0.24, +0.82] | -27% [-44, -5] | not non-inferior in the 1600s (116 books) | typed-reference frame |
| read-surface confirmations | read, Latin / German queue | 4 vs 8 | 30; 30; 48 books | Latin 12/12 vs 13/14; German 17/25 vs 22/25; 39/45 vs 41/45 (route judge) | German 0.42 vs 0.25 calls a page | Latin: filter cut 19/40 blocks at 4 | seeded queue |
| german-cheaper-7701 | read, German | 4 vs 8 | 30 / 30 | 21/24 vs 18/22; wrong text 0 vs 1 | 0.97 vs 0.81 calls | cut replies 6 vs 4 blocks | seeded, Fraktur/Antiqua by eye |
| cheap-routes-7701 | read, French | 1 vs 4 | 30 | 20/21 vs 24/24 | 1.27 vs 0.71 calls | — (wrong text 1/21 at 1) | seeded |
| same | correction, German | 1 vs 4 | 20 | 20/20 vs 20/20 | 2.03 vs 1.39 calls | — | seeded |
| same | correction of PERO, Latin | 1 vs 4 | 18 vs 16 | 18/18 vs 14/16 | 1.03 vs 0.27 calls (plus GPU) | wrong text "½ AE" read as "1/AE" | seeded |
| opus-translation-10-pages-per-call-6690 | translation, fa / sa / zh / grc / he, Opus | 1 vs 10 | 50 / 5 | fidelity 4.78 vs 4.48, -0.30 [-0.54, -0.08] (Flash-high judge vs published translations) | $14.20 vs $5.29 per 100 pages | omission flagged 4% vs 22% | hand: 10 consecutive pages, one book a language |
| zh-ditto-pilot-5274 | correction, Siku ditto marks, Opus | 1 vs 10 | 60 / 60 | 27/30 vs 29/30 against Kanripo; misleading 10/30 vs 2/30 | $93 vs $99 per 1,000 | none found | seeded |
| zh-print-correct pilot (#7263, 2026-11-04 10:28 UTC) | correction, Chinese print, Opus | 1 vs 10 | 30 + 30 | 24/30 vs 27/30; wrong text 3 vs 3 | $0.105 vs $0.099 | apply refused 1/26 vs 21/279 | not stated |

**Does the task explain it better than the language?** The rows do not separate the two: task travels with engine, judge scale and language. The one like-for-like contrast is Opus at 10 a call: no loss in Chinese correction (two pilots), a loss of 0.30 fidelity points in translation across five languages. Within agy Flash-low, reads at 2-8 a call and Siku translation at 2-4 sit inside the noise floor of section 2; the one task row with a drop is German correction at 2 (27/30 to 23/30, n 30). Within one task and engine the language and image size move the result (Latin read at 8: +2.25 pp CER; German at 8: -0.00). The failure kind follows the task: filter cuts and letter misreads in reads; a clause carried across a page break and omissions in translation; new errors in correct drafts and apply refusals in correction.

**Never tested:** agy translation above 1 a call outside Siku (Latin, German, Greek, Hebrew, Persian, Sanskrit; the #5274 F4 arm in Chinese has no result yet); any translation at 3, 5 or 8; Opus correction at 10 outside Chinese; agy correction above 4, or above 2 outside German, French and Latin; any read above 1 a call on manuscripts, or in Greek, Hebrew, Arabic, Sanskrit, Tibetan or Cyrillic; any read at 10; Fraktur at scale (5 of 15 books in #7522); and no per-call test repeats its own arms except the 1-a-call arms in section 2.

### 4. GPU OCR plus a correction against a fresh read

"GPU + correction": a GPU draft (PERO, LightOnOCR, Paddle) corrected by an LLM with the page image. "Fresh read": an LLM read of the image with no draft, usually agy Flash-low at 4 a call (read@4). Figures as stated in the records named; the per-page verdict files were not reread for this section, so discordant counts appear only where a record gives them.

**On the same pages:**

| record | language | GPU + correction | fresh read | k/n (GPU+corr vs read) | judge scale | frame | pages / books | discordant |
|---|---|---|---|---|---|---|---|---|
| queue-routes-7853 | German print (84% Fraktur) | PERO or LightOn > agy | read@4 | 113/150 vs 123/150; severity 50.1 vs 31.3 per 1,000 words | route judge | waiting queue (PPS on pages owed) | 150 / 150 | 11 gained, 21 lost, p 0.11 |
| queue-routes-7853 | French print | LightOn > agy | read@4 | 54/60 vs 55/60 | route judge | waiting queue | 60 / 60 | 2 / 3, p 1.00 |
| german-cheaper-7701 | German (18 Fraktur, 12 Antiqua) | LightOn > agy@4; PERO > agy@4 | read@4 | 20/25; 17/22 vs 21/24 | route judge | first-read frame, face composed by eye | 30 / 30 | 2 vs 4 of 20; 1 vs 5 of 19 |
| fraktur-paired-7835 T3 | German (35 Fraktur) | PERO > agy | read@4 | 32/40 vs 34/35; mean CER 2.3% vs 5.0% (median 0.7% vs 0.5%) | route judge + CER on DTA | experiment set (typed reference) | 40 vs 35 delivered | not given |
| latin-manuscript-reader-7947 | Latin manuscripts | PERO > agy | read@4 | 47/78 vs 54/78; sense errors 4.27 vs 3.00 per 1,000 words | route judge | live manuscript census, 3 pages a book | 78 / 26 | not given |
| gpu-flash-vs-opus-7263 | Latin, English, German print | best draft > agy | agy Flash alone, 1 a call | 169/173 vs 150/173; misleading 4 vs 18 | usability (#7522 judge.mjs) | experiment set (typed references) | 173 / 173 | not given |
| zh-ditto-pilot-5274 | Chinese, ditto marks | Paddle > Opus; > Sonnet; > Flash-low | Opus fresh read | 56/60, 40/60, 36/60 vs 43/60 (Kanripo marks) | mark check + Opus | waiting queue (zero-丨 pages) | 60 / 60 | not given |
| zh-reocr-cheap-arms | Chinese print; Siku | Paddle > Flash-low | stored Gemini read (not reread) | 18/30 vs 3/30; 19/30 vs 8/30 | route judge | frame draw (#8008) | 30 + 30 | 15 / 0; 12 / 1 |

**Not on the same pages** (labelled so; not comparable as pairs): cheap-routes-7701, Latin PERO > agy 18/18 written at 1 a call and 14/16 at 4, against a separate 30-book draw where Latin read@4 had 17/19 written; the 7263 router tests, GLM-OCR > agy on Latin 22/26 delivered with no fresh-read arm; #6871 English pre-1800, LightOn alone 18/29, no correction arm.

**What it says.** Against read@4 on the same pages, GPU + correction was accepted on fewer pages in German print (113/150 vs 123/150, waiting queue), German first reads, and Latin manuscripts; French print is 54/60 against 55/60. None of these gaps clears p < 0.05. The two rows where GPU + correction is ahead compare it with a different fresh read: agy Flash at 1 a call with no draft (169/173 vs 150/173), and an Opus image-only read on Chinese ditto marks (56/60 vs 43/60). Latin print, the largest waiting queue, has no same-page test of GPU + correction against read@4. Frames: only the 7853 rows and the ditto pilot were drawn from the waiting queue; the rest are experiment sets.

**Cost per usable page**, including GPU: (agy calls a page × $0.00087 + GPU seconds × $0.0000961) / accept rate. The GPU rate is the gex45 box, $249 a month spread over its seconds (an allocation: the box is owned at a flat rate). GPU seconds a page: PERO 0.48, LightOn 0.99 (derived from #7853 timings).

| row | fresh read | GPU + correction |
|---|---|---|
| German print, 7853 | 0.34 calls → $0.00030 / 0.82 = **$0.00036** | 0.98 calls + 0.48 s → $0.00090 / 0.75 = **$0.00120** (the record's $0.00113 leaves out GPU time) |
| French print, 7853 | 0.30 calls → $0.00026 / 0.91 = **$0.00029** | 1 call + 0.99 s → $0.00097 / 0.90 = **$0.00107** |
| German first read, 7701 (record's figures) | 0.97 calls → **$0.00120** | 0.33-0.41 calls → **$0.00056** (LightOn), **$0.00069** (PERO) |
| Latin manuscripts, 7947 (calls assumed from 7853) | $0.00030 / 0.69 = **$0.00043** | $0.00090 / 0.60 = **$0.0015** |

The same read@4 route is priced at 0.97 calls a page in #7701 and 0.34 in #7853, and neither record reconciles the two; the comparison turns on which holds. At 0.34 calls, GPU + correction costs about three times as much per usable page.

### 5. agy coverage map

From the live table (`current.json` → `2026-11-01-validated-7263`, with its per-cell pointers): per row, the agy route with the highest posterior mean, its pooled k/n and wrong-text pages, the judge scale of its evidence and how its pages were drawn. No floor is applied (Derek, 2026-11-04: "unacceptable" is set from calibrated rates). Books and the random share are counted over the cell's sources, which serve every script row of the cell; k/n is the row's own.

| row | pages waiting | best agy route | k/n | wrong | mean [90%] | books | judge scale | random pages / all |
|---|---|---|---|---|---|---|---|---|
| latin-lite/print | 835,238 | gpu>agy-flash-low | 22/26 | 2 | 0.88 [0.72-0.98] | 9 | route judge | 26/26 |
| latin-flash3/print | 692,318 | 3flash>agy-flash-low | 47/60 | 7 | 0.79 [0.70-0.86] | 64 | route judge | 64/64 |
| latin-flash3/unknown | 549,086 | 3flash>agy-flash-low | 4/4 | 0 | 0.87 [0.67-0.99] | 64 | route judge | 64/64 |
| zh-paddle-dice-lt090/manuscript | 453,715 | paddle>agy-flash-high | 17/30 | 8 | 0.53 [0.40-0.67] | 30 | route judge | 30/30 |
| german-lite/print | 409,596 | agy-flash-low@4-read | 123/150 | 14 | 0.82 [0.76-0.87] | 150 | route judge | 150/150 |
| tibetan-yigdzin/manuscript | 272,550 | yigdzin>agy-flash-low | 53/59 | 5 | 0.89 [0.81-0.94] | 60 | route judge | 60/60 |
| german-flash3/unknown | 211,906 | 3flash>agy-flash-low | 7/8 | 0 | 0.80 [0.60-0.95] | 30 | route judge | 30/30 |
| french-lite/print | 143,663 | agy-flash-low@4-read | 55/60 | 2 | 0.90 [0.84-0.96] | 60 | route judge | 60/60 |
| german-flash3/print | 139,496 | 3flash>agy-flash-low | 19/22 | 1 | 0.84 [0.71-0.94] | 30 | route judge | 30/30 |
| chinese-flash3/print | 84,721 | 3flash>agy-flash-low | 6/30 | 22 | 0.27 [0.16-0.40] | 30 | route judge | 30/30 |
| zh-siku-tr/manuscript | 50,676 | agy-flash-low@1 | 26/30 | 4 (= n - k) | 0.82 [0.71-0.91] | 30 | translation MQM | 30/30 |
| sanskrit-lite/print | 36,624 | agy-flash-low-read | 125/250 | 125 (= n - k) | 0.60 [0.40-0.80] | 10 | Step T | 0/250 |
| hebrew-flash3/unknown | 31,242 | 3flash>agy-flash-low | 7/21 | 13 | 0.39 [0.24-0.55] | 28 | route judge | 28/28 |
| greek-lite/manuscript | 30,117 | agy-flash-low-read | 28/249 | 221 (= n - k) | 0.29 [0.12-0.49] | 10 | Step T | 0/250 |
| latin-lite/manuscript | 26,268 | lite>agy-flash-low | 8/9 | 0 | 0.87 [0.70-0.98] | 202 | Step C + route judge + usability (pooled) | 88/713 |
| zh-frame-6871/manuscript | 22,220 | paddle>agy-flash-low | 19/30 | 9 | 0.62 [0.48-0.75] | 30 | route judge | 30/30 |
| russian-lite/print | 18,930 | agy-flash-low-read | 15/17 | 2 (= n - k) | 0.83 [0.68-0.94] | 28 | cells (JUDGE-CELLS) | 28/28 |
| zh-lite/print | 18,547 | agy-flash-low-read | 37/71 | 34 (= n - k) | 0.53 [0.26-0.80] | 3 | Step T | 0/75 |
| arabic-lite/print | 17,312 | agy-flash-low-read-diplomatic | 27/29 | 0 | 0.60 [0.28-0.88] | 14 | usability (judge.py) | 0/55 |
| hebrew-flash3/manuscript | 14,620 | 3flash>agy-flash-low | 0/3 | 3 (= n - k) | 0.39 [0.14-0.67] | 28 | route judge | 28/28 |
| arabic-flash3/manuscript | 14,395 | 3flash>agy-flash-low | 0/2 | 2 (= n - k) | 0.34 [0.09-0.63] | 29 | route judge | 29/29 |
| greek-lite/print | 12,799 | agy-flash-low-read | 1/1 | 0 | 0.76 [0.45-0.97] | 10 | Step T | 0/250 |
| arabic-lite/manuscript | 10,347 | agy-flash-low-read-diplomatic | 8/26 | 2 | 0.35 [0.18-0.54] | 14 | usability (judge.py) | 0/55 |
| korean-lite/manuscript | 9,274 | agy-flash-low-read | 9/14 | 5 (= n - k) | 0.63 [0.45-0.80] | 28 | cells (JUDGE-CELLS) | 28/28 |
| arabic-flash3/unknown | 9,073 | 3flash>agy-flash-low | 7/18 | 10 | 0.41 [0.25-0.58] | 29 | route judge | 29/29 |
| german-lite/manuscript | 9,007 | lite>agy-flash-low | 1/2 | 1 (= n - k) | 0.70 [0.41-0.93] | 379 | route judge + usability (pooled) | 402/431 |
| korean-lite/print | 7,306 | agy-flash-low-read | 5/11 | 5 | 0.53 [0.32-0.72] | 28 | cells (JUDGE-CELLS) | 28/28 |
| arabic-flash3/print | 6,776 | 3flash>agy-flash-low | 6/9 | 1 | 0.62 [0.41-0.82] | 29 | route judge | 29/29 |
| hebrew-flash3/print | 5,497 | 3flash>agy-flash-low | 0/4 | 2 | 0.38 [0.15-0.65] | 28 | route judge | 28/28 |
| tibetan-yigdzin/unknown | 2,329 | yigdzin>agy-flash-low | 0/1 | 0 | 0.63 [0.31-0.90] | 60 | route judge | 60/60 |
| 5 rows under 1,000 pages (tamil-lite/print, zh-lite/manuscript, ottoman-lite/manuscript, hindi-lite/print, ottoman-lite/print) | 580 | agy-flash-low-read | 3/3; 1/4; 4/4; 7/8; 3/4 | | | 3-10 | cells / Step T | |

Another 29 rows have agy evidence and no pages waiting: the `*/unknown` script rows, the translation cells (tibetan-tr 22/30 on a diagnostic set; tengyur-tr 16/21 blind A/B; zh-siku-first-tr), the GPU test cells (`*-gpu-7263`: 655 pages on the usability scale, none drawn at random) and the first-read `*-blank` cells (all random, route judge). Full rows: `agy_map.py` output, archived with the job scratch.

**Judge scales are not pooled here, but the build pools them.** Five rows draw their best agy route from more than one scale: latin-lite/manuscript, latin-lite/unknown, german-lite/manuscript, german-lite/unknown and latin-gpu-7263/print (route judge with Step C or the #7522 usability scale). Their k/n mixes scales.

**Rows where wrong = n - k** (20): every page not accepted is counted as wrong text. On Step T (sanskrit-lite/print, greek-lite/manuscript, zh-lite/print and /manuscript) and the usability scales this is how the scale maps (misleading = wrong text, no middle grade), not a measured wrong-text rate. On the route-judge rows (hebrew-flash3/manuscript, arabic-flash3/manuscript, german-blank/manuscript, german-blank-antiqua/print, german-lite/manuscript, latin-gpu-7263/print) it is k/n of 4 pages or fewer, or 3 failures in 108. The rest are cells-6553 rows (korean, russian, hindi, ottoman, tamil), tengyur-tr and zh-siku-tr, where no refusal happened to occur. The 20: german-lite/manuscript, tengyur-tr/unknown, zh-siku-tr/manuscript, hebrew-flash3/manuscript, arabic-flash3/manuscript, zh-lite/print, zh-lite/manuscript, greek-lite/manuscript, sanskrit-lite/print, korean-lite/manuscript, korean-lite/unknown, russian-lite/print, hindi-lite/print, hindi-lite/unknown, ottoman-lite/print, ottoman-lite/unknown, tamil-lite/unknown, latin-gpu-7263/print, german-blank/manuscript, german-blank-antiqua/print.

**How much is random.** Counting each source once: 1,589 of 3,425 judged pages behind the best agy routes were drawn at random from a cell's frame (route judge 1,473/1,473; cells-6553 86/86; Siku translation 30/30). None of the Step T (575), Step C (500), #7522 usability (655), judge.py usability (55), diagnostic (30) or blind A/B (21) pages were. 41 rows rest on random draws only; 18 on none. Under Derek's 2026-11-04 decision that only random-draw rows decide a route, the 18 cannot decide: sanskrit-lite, greek-lite, zh-lite and arabic-lite among them, 145K pages waiting.

**No agy evidence** (46 rows, 1,070,819 pages waiting), the largest: greek-flash3/print 208,482; german-tr-flash3/print 201,915; greek-flash3/unknown 164,160; german-tr-lite/print 137,171; german-tr-flash3/unknown 98,795; latin-flash3/manuscript 76,402; greek-flash3/manuscript 46,508; italian-lite/print 45,202; spanish-lite/print 16,415; german-tr-lite/unknown 13,760; chinese-flash3/manuscript 10,501; chinese-flash3/unknown 8,656; french-lite/manuscript 7,780; german-tr-flash3/manuscript 6,074; tibetan-yigdzin/print 5,745; danish-lite/print 5,615. Greek print under Flash 3 (419K pages over three rows) and German translation (458K over six rows) are the two blocks.

### 6. Stop rule

The rule Derek took: start at 20 paired pages, add batches of 10, pass (win) when P(candidate ≥ reference - 0.08) ≥ 0.99, stop as worse when P(candidate < reference - 0.08) ≥ 0.90, stop at 100 pages. Posterior: `build.paired_draws` (Dirichlet over the four cells of the paired table), checked against an exact calculation on six tables (largest difference 0.004). 10,000 replicates per point; reference rates 0.95, 0.90, 0.80, 0.70; links phi 0, 0.13, 0.30, 0.45 (section 1's medians and upper quartile).

| reference | phi | false pass at gap 9 pts | its mean pages | stopped as worse at gap 9 | pass at a tie | tie stopped as worse | tie mean pages |
|---|---|---|---|---|---|---|---|
| 0.95 | 0 | 2.7% | 86 | 24% | 63% | 0.2% | 75 |
| 0.95 | 0.45 | 1.9% | 89 | 20% | 79% | 0% | 67 |
| 0.90 | 0 | 3.1% | 84 | 26% | 42% | 0.9% | 82 |
| 0.90 | 0.30 | 2.7% | 86 | 25% | 54% | 0.6% | 78 |
| 0.80 | 0 | 2.9% | 83 | 28% | 29% | 3.8% | 85 |
| 0.80 | 0.45 | 2.9% | 85 | 26% | 44% | 1.3% | 81 |
| 0.70 | 0 | 3.2% | 84 | 27% | 24% | 5.0% | 86 |
| 0.70 | 0.45 | 3.1% | 84 | 27% | 36% | 2.4% | 84 |

The largest false pass over the grid is 3.2% (reference 0.70, phi 0), under the 5% bar. The cost is power: a candidate exactly as good as the reference passes 24-79% of the time, and the rest mostly reach the cap undecided. A candidate 9 points worse is stopped as worse in only 20-28% of runs; the rest run to 100 pages.

Neighbouring rules (maximum false pass over the same grid): cap 150, 3.8% (more power at a tie, 33-95%); start 30, 2.9%; batches of 20, 2.7%; win at 0.995, 1.8%; win at 0.999, 0.4%; a fixed 100 pages, 0.9% (power 14-72%). Today's practice, a fixed 30 paired pages passed at P ≥ 0.90: 10.6%.

### 7. Split-half: does the winner on half the books win on the other half?

For every paired test with 20 books or more (161 route pairs), the books were split into two random halves 2,000 times; "replication" is the share of splits where the route ahead on one half is ahead on the other.

| gap between the two routes (all books) | pairs | replication median (min) |
|---|---|---|
| 5-10 points | 19 | 0.61 (0.36) |
| 10-20 points | 37 | 0.97 (0.82) |
| 20 points or more | — | about 1.0 |

A gap of exactly 0 splits evenly by construction and is left out. By kind of book: 54 pairs span more than one cell; 11 of them can be split by a recorded kind. #7568 by language (its book clustering is not in this interval); correction-pass #7818, German against French (agy correction against the Flash-Lite draft); Chinese print against Siku (paddle>agy-flash-medium; gemini>opus against paddle); the ditto pilot, Opus correction at 1 against 10 a call. These are too few, with too few books each, to say whether the gap differs by kind of book.

**What the data cannot answer.** Whether a winner holds on books outside the frame it was drawn from (no test draws a second frame); whether a gap under 10 points holds at all at 30 books (median 0.61 says it often does not); and whether the gap differs by century, face (Fraktur / Antiqua) or scan source, none of which is recorded per page in most score files.

### 8. Human-typed pages on the rubric ladder (inbox note, Derek 2026-11-04)

Derek asked for comparison to human work. The human arm already on file is the #7866-bar study (`2026-11-01-judge-calibration-7866-bar-7263.md`): 60 print pages (German, Latin, English, 20 each) with a same-edition typed edition (DTA, EEBO-TCP, CAMENA), each judged blind with #7866's prompt as the typed text and as our stored read. `gradeOf()` from `scripts/eval/confidence-7866/regrade.mjs` runs on the stored verdict fields unchanged (fidelity and the severity of each defect are all it reads), so the ladder applies without a model call (`scripts/eval/route-free-7263/human_grades.mjs`). No grade was changed.

"False flags removed": each misleads / wrong-text flag on a human page was adjudicated by Opus and by agy Gemini against a crop of the line. "Either says right" drops a flag when one adjudicator says the typed text is right; "confirmed only" keeps a flag only when both say the page prints something else. Our reads' flags in this study were not adjudicated, so they appear raw only.

| grade | human raw | human, either says right dropped | human, confirmed only | our read, raw |
|---|---|---|---|---|
| fit to quote | 32 | 32 | 35 | 32 |
| fit to read | 14 | 14 | 14 | 8 |
| search only (a reading that changes the sense) | 9 | 9 | 7 | 14 |
| wrong span | 4 | 4 | 3 | 5 |
| from elsewhere | 0 | 0 | 0 | 0 |
| mostly wrong (fidelity 2) | 1 | 1 | 1 | 0 |
| not this page (fidelity 1) | 0 | 0 | 0 | 1 |
| **says what the page says** | **46/60** | 46/60 | **49/60** | **40/60** |

By language, raw (human / ours, says what the page says): German 18 / 16, Latin 12 / 10, English 16 / 14 of 20. Latin is where the two differ most in kind: the human Latin pages carry 3 wrong spans and ours none, ours 10 search-only and the human 5.

The #7941 three-way study (`2026-11-02-three-way-ocr-archive-ours-human-7941.md`) judged the Internet Archive's OCR, ours and the human edition on the same pages, and adjudicated every arm's flags (Opus and Sonnet) on 45 pages before the cap. On those adjudicated pages, raw → confirmed only: ours 26 → 27 of 45 say what the page says; the Archive 1 → 3 of 45; the human edition 13 → 13 of the 19 of those pages that have one. Of 716 adjudicator verdicts across arms, 2 said the flagged text was right, 23 could not tell.

**What this cannot answer.** The 60 pages are those with a same-edition typed reference, not a random draw of the corpus (#7941's random stratum has no human arm). The adjudicators were shown the checker's claim, which can pull them toward agreeing, so "confirmed only" removes at most what an unanchored check would. Typed editions follow their own transcription conventions, and the ladder grades a deliberate normalisation and a typing error alike when the judge flags it. With 20 pages a language, the per-language rows above carry intervals of about ±20 points. No human comparison exists for manuscripts, for Greek, Hebrew or Chinese OCR, or for any agy route by name.

**Human comparison held for translation:**

| reference | record | language | pages / books | texts covered | draw |
|---|---|---|---|---|---|
| 84000 (Tibetan) | `2026-10-03-tengyur-84000-reference-ab-5497.md` | Tibetan (Tengyur) | 113 sides judged of 864 kept | Tengyur texts 84000 published (Toh 3808 is 582 of the 864) | stratified sample of covered sides |
| 84000 (Tibetan) | `2026-09-25-which-engine-should-retranslate-the-re-ocr-d-kanjur-4742.md` | Tibetan (Kangyur) | 21 / 21 | Kangyur texts with an 84000 translation | chosen by coverage |
| Getty Digital Florentine Codex | `2026-10-18-florentine-vs-published-6865.md` | Nahuatl | 60 leaves drawn (38 in the English table) / 3 volumes | Books 1–12 of the Florentine Codex | seeded, 5 a Book, one from each fifth |
| xlref T1 (EEBO-TCP, Gutenberg, Wikisource, archive.org PD translations) | `2026-10-03-xlref-t1-latin-vs-reference-5695.md` | Latin | 71 / 71 | books with a public-domain English translation | seeded draw among covered books |
| xlref T2 | `2026-10-03-greek-served-english-vs-published-translations-5695-t2.md` | Greek | 75 / 75 | from 85 candidate books chosen from the Greek census | candidates chosen, pages seeded |
| xlref T3 | `2026-10-03-translation-vs-reference-vernaculars-t3-5695.md` | German, French, Italian, Dutch, Spanish | 59 / 59 | books with a published translation | seeded |
| xlref T4 | `2026-10-03-translation-vs-reference-t4-hebrew-arabic-persian-5695.md` | Hebrew, Aramaic, Arabic, Persian | 52 / 52 | first page a published translation covers | seeded order within chosen books |
| xlref (5606) | `2026-10-02-translation-flash-vs-lite-sanskrit-pali-chinese-5606.md` | Sanskrit, Pali, Chinese | 57 books | books with a published translation | seeded within books |
| published translations (6690) | `2026-10-13-opus-translation-10-pages-per-call-6690.md` | Persian, Sanskrit, Chinese, Greek, Hebrew | 50 / 5 | 10 consecutive pages a book | hand-picked |

None is a random draw of the pages waiting for translation: every set is limited to texts a published translation covers, which leans to the canonical and the edited. The xlref tiers score fidelity 1–5 against the reference, 84000 and Getty score meaning errors; neither scale is the route judge's accept, and none has been run on an agy translation route at 4 a call.

### What the first panel needs to test

From the sections above:

1. **Latin print, same pages: read@4 against PERO > agy@4 against 3flash > agy (the stored Flash 3 draft corrected).** Latin print is the largest queue (latin-flash3/print 692K pages; latin-lite/print 835K is decided), it has no same-page test of GPU + correction against a fresh read (section 4), and its best agy route rests on 60 pages (47/60). Read against correction is the pair type pairing helps least (ratio 0.88, section 1), so it needs nearly the full cap.
2. **Greek print under Flash 3: read@4 against the stored 3flash text.** 419K pages over three rows with no agy evidence (section 5).
3. **German translation: agy at 1 against 4 a call against the Flash-Lite lane.** 458K pages over six rows with no agy evidence, and agy translation above 1 a call is untested outside Siku (section 3).
4. **In each cell, one arm read twice on 30 pages**, so that the cell has its own noise floor: no repeat on file covers Latin print under Flash 3, Greek, or translation outside Siku (section 2).

All draws random from the cell's waiting queue, one page a book, every arm on the same pages, judged by the route judge (one scale; section 5 shows what pooling scales does). Size: under the stop rule each arm pair runs 20 to 100 paired pages (mean 67-89 at the rates simulated), so 3 cells × up to 100 books × 2-3 arms, plus 3 × 30 repeat pages: at most about 900 arm-pages read and judged, a mean nearer 700. Only random-draw rows decide a route (Derek, 2026-11-04), so every row of this panel can. Gaps of 5-10 points reproduce on split halves at a median of 0.61 (section 7), so a win under 10 points at this size is reported with its interval, not routed on.
