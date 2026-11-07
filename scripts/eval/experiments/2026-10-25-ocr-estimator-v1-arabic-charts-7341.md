---
stage: ocr
measure: [accuracy, none]
languages: [ar, fa, ms]
scripts: [Arab]
canons: []
n_books: 40
n_pages: 65
verdict: "Pooled with every other chart, the Arabic-manuscript posterior agrees with the #7341 gate: Opus 5.5 is the only route that clears the bar (P = 1.00; next best agy 3.8 Flash high at 0.36), P(lowest CER) 0.56, and agy 3.8 Flash low loses 0.57 [0.32, 0.82] of alchemical manuscript pages to the CLI filter. Before the gate the pooled model got the engine order right (Opus < agy < Flash-Lite) but put every level 2–6× too high, and it predicted 1 [0, 3] filter-cut pages where 16 of 26 were observed. For Kraus's print edition the pooled posterior does not support the gate's agy-first route: the filter term learned on the manuscripts carries to Kraus (P(not read) 0.28 [0.07, 0.63]), and with 4 pages agy and Opus are both below the router's 5-page floor."
status: informational
decision: "Jabir manuscripts: Opus, as the gate decided (the pooled fit agrees). Kraus 1935: test agy 3.8 Flash low on ~25 more Kraus pages before routing it there; the router cannot route that cell from 4 pages (#7341)."
superseded_by: null
issue: [7341, 6740, 6544, 5700]
---
## 2026-10-25 · OCR estimator v1 with Arabic charts: does the pooled posterior agree with the Jābir gate? (#7341)

PRIOR ART: `2026-10-24-ocr-estimator-v1-cost-per-usable-page-6740.md` (the model, the router, the bar, the costs; all
reused) and `2026-10-25-arabic-manuscript-ocr-gate-jabir-7341.md` (the gate; its rows were already in v1's table
shape). The #4763 holdout in the v1 file (§7) is the reason this file adds a script-group term: a chart the fit never
saw was predicted at the average of every script. No model calls; $0; CPU only.

**Question (Derek, 2026-10-25).** The gate was reported as a standalone 26-page result. Read it as an update to a
posterior that borrows from every language's OCR evidence: what did the pooled estimator predict before the gate,
and does the posterior after it agree with the gate's routes?

### Data: every Arabic-script OCR observation on main (`results/arabic-rows.jsonl`, `build-arabic-rows.py`)

| source | chart | pages / works | engines | key | rows |
|---|---|---|---|---|---|
| #7341 gate | arabic-manuscript | 26 / 13 | Flash-Lite (production prompt), agy 3.8 Flash low, Opus | **model** (KEY-O, Opus referee); skeleton CER | 78 |
| #7341 gate | arabic-print | 4 / 1 (Kraus 1935) | same | model | 12 |
| #6544 Set A | arabic-manuscript | 18 / 9 (RASAM, Maghrebi) | Flash-Lite, agy 3.8 low / high, agy 3.1 Pro, Opus | **expert** (BULAC lines) | 90 |
| #6544 Set B | arabic-manuscript | 6 / 6 (2 Arabic, 3 Persian, 1 Malay Jawi) | same | model (KEY-O) | 30 |
| #5700 | arabic-print | 11 / 11 | served Flash-Lite or 3 Flash, fresh 3 Flash | **corrected-served** (by-eye correction of the served read) | 22 |

- #6544's per-page counts are recomputed with its own `score.py` (imported) from the job's reads. The per-engine means
  reproduce the committed `score-setA.json` / `score-setB.json` exactly (RASAM Opus 13.4, 3.8 low 15.5, Pro 17.1,
  Flash-Lite 24.0).
- **Skipped**, every other experiment tagged `ar`: #5870 (engine contest), #3186 (hi-res re-read), #5795,
  #6694, #6871 score OCR by a judge of the English it yields, by preference, or by eye; #6420 and #5828 by agreement;
  the rest are translation, metadata or search. None has a per-page CER the model can take.
- **Key columns.** `key_type` (reference / model / corrected-served) and `key_self` (the read is one the key was
  built from: Opus on KEY-O always; agy on the 10 gate pages it read; Flash-Lite on the 16 where agy was cut; Pro and
  Opus in Set B; the served read in #5700). Gate CER is KEY-O skeleton letters; #6544's is `score.py`'s fold (marks
  dropped, alef variants kept), so the gate's normalisation is the more lenient of the two.

### Model change (`model_ocr_v1.py`, `ext=True`; v1 without it is unchanged)

Both parts add `grp[g] + kind[k] + eg[e, g] + ek[e, k]`: g is the chart's script group (Arabic, Hebrew/Rashi and
Syriac form one group of right-to-left abjads), k is manuscript or print. Accuracy adds `kt[key_type] + b_self ·
key_self`. Did-not-read adds `alchemy · (b_alch + ba[family])`. A cell's prediction is for an expert key and a read
the key did not come from. Same inference as v1 (SVI AutoNormal, 15,000 steps, 400 draws; ELBO flat over the last
10% in all seven fits). The v1 router run on v1's own fit with the changed code reproduces `ocr-v1-routes.md`
exactly.

**What the data supported:**
- **Script group:** right-to-left abjads +0.58 [0.54, 0.62] logit on CER against Latin −0.84; τ_grp 0.56.
- **Engine × script group, engine × kind, kind:** SVI collapsed all three scales to < 0.02. Engine differences on
  the Arabic charts are carried by v1's engine × chart term, so a new Arabic chart borrows the engine's overall
  strength and the group level, nothing finer. AutoNormal is known to shrink scale parameters, so this says the
  data did not force the terms, not that they are zero.
- **Key:** model key −0.51 [−0.63, −0.39] logit (a model key reads lower CER than an expert reference would); a
  self-keyed read −0.54 [−0.67, −0.37]. corrected-served −0.22 [−0.52, +0.07].
- **Alchemy × engine family (did-not-read):** agy CLI (gemini-cli) +3.36 [2.31, 4.87]; Flash-Lite −0.40 [−2.86,
  +1.14]; Claude +0.29 [−2.10, +2.28]. The other families sit at their prior. So the filter cut is a CLI × content
  term, as the gate saw.

### Posterior predictive check (full fit)

- **The other charts did not move:** v1's level-bias statistic over 163 chart × engine cells is +0.0074 [−0.017,
  +0.031] (v1: +0.007), pair-sign agreement 753/796.
- **Arabic, observed against fitted mean CER per source × engine (rows' own effects):** RASAM Opus 0.134 / 0.161,
  Flash-Lite 0.240 / 0.275; Set B Flash-Lite 0.53 / 0.36 (4 reads, 2 failed); gate Opus 0.019 / 0.046, Flash-Lite
  0.079 / 0.104, agy 0.055 / 0.050; #5700 3 Flash 0.129 / 0.111. The fit runs 0.01–0.03 high on the clean gate pages.
- **Did not read:** gate agy 16/30 observed, 0.55 fitted; every other Arabic source × engine within 2 pages.

### Leave-one-source-out: the gate predicted before it ran

Each gate cell predicted for new pages under the gate's own key (model key, the observed share of self-keyed reads).
CER is mean page CER among reads; "fail" is the predicted count of pages not read, median [90%].

| fit | cell | engine | observed CER | predicted CER [90%] | observed not read | predicted not read |
|---|---|---|---|---|---|---|
| no Arabic at all | manuscript | Flash-Lite | 0.090 | 0.41 [0.08, 0.83] | 0/26 | 0 [0, 1] |
| | | agy 3.8 low | 0.074 | 0.39 [0.06, 0.85] | **16/26** | **0 [0, 1]** |
| | | Opus | 0.022 | 0.35 [0.05, 0.84] | 0/26 | 0 [0, 1] |
| everything but the gate | manuscript | Flash-Lite | 0.090 | **0.29 [0.22, 0.37]** | 0/26 | 0 [0, 3] |
| | | agy 3.8 low | 0.074 | **0.15 [0.11, 0.22]** | **16/26** | **1 [0, 3]** (with the alchemy term at its prior: 1 [0, 9]) |
| | | Opus | 0.022 | **0.13 [0.08, 0.21]** | 0/26 | 0 [0, 1] |
| | print (Kraus) | Flash-Lite / agy / Opus | 0.011 / 0.005 / 0.002 | 0.35 / 0.16 / 0.14 | 0/4 each | 0 [0, 0–1] |
| full (gate added) | manuscript | Flash-Lite / agy / Opus | 0.090 / 0.074 / 0.022 | 0.11 / 0.06 / 0.05 | 0 / 16 / 0 | 0 / **15 [8, 22]** / 0 |

- **With no Arabic data** the pooled model says nothing useful: every engine centres on 0.35–0.41 with intervals over
  most of [0, 1], the same failure as the #4763 holdout. The script-group term moves the level, but the engine terms
  that could carry Opus's Hebrew lead to Arabic collapsed (above).
- **With the 24 earlier Arabic manuscript pages** (RASAM + Set B) the ORDER was right: Opus < agy < Flash-Lite, the
  gate's order. Every LEVEL was 2–6× too high (0 of 3 manuscript cells covered). The earlier pages are harder hands
  (Maghrebi; Persian nastaʿlīq; Jawi) than the Jābir set, which is mostly 1920s Berlin hand copies, and they were
  scored with a stricter fold.
- **The filter cut was not predictable from pooled evidence.** Before the gate, agy had failed 1 of 24 Arabic
  manuscript reads and no row carried alchemical content, so the model predicted 1 [0, 3] cut pages against 16
  observed. The content term exists now only because the gate measured it.
- **Kraus:** the pre-gate print chart was #5700's 11 pages (one 3 Flash read at 100% error); it put Kraus at 0.14–0.35
  where 0.002–0.011 was observed.

### Posterior per engine (full fit; expert key, new page of the cell)

| cell | engine | pages read in chart | E[CER] [90%] | P(not read) [90%] | P(lowest CER), measured engines |
|---|---|---|---|---|---|
| **Jābir manuscripts** (alchemy, gate panel) | **Opus 5.5** | 50 | **0.117 [0.086, 0.159]** | 0.002 [0.000, 0.038] | **0.56** |
| | agy 3.1 Pro (no longer on agy) | 24 | 0.122 [0.089, 0.171] | 0.05 [0.00, 0.31] | 0.37 |
| | agy 3.8 Flash high | 22 | 0.142 [0.113, 0.192] | 0.34 [0.11, 0.72] | 0.05 |
| | agy 3.8 Flash low | 33 | 0.148 [0.120, 0.184] | **0.57 [0.32, 0.82]** | 0.02 |
| | Flash-Lite | 48 | 0.206 [0.169, 0.258] | 0.01 [0.00, 0.06] | 0.00 |
| **other Arabic-script manuscripts** (new panel) | Opus 5.5 | 50 | 0.211 [0.165, 0.261] | 0.002 | 0.58 |
| | agy 3.1 Pro | 24 | 0.219 | 0.002 | 0.38 |
| | agy 3.8 Flash high / low | 22 / 33 | 0.249 / 0.257 | 0.03 / 0.08 | 0.03 / 0.02 |
| | Flash-Lite | 48 | 0.345 [0.300, 0.392] | 0.02 | 0.00 |
| **Kraus 1935** (alchemy, print) | Opus 5.5 | 4 | 0.048 [0.027, 0.097] | 0.004 | — (below floor) |
| | 3 Flash (API, disabled) | 11 | 0.051 [0.032, 0.112] | 0.02 | 0.89 |
| | agy 3.8 Flash low | 4 | 0.065 [0.040, 0.113] | **0.28 [0.07, 0.63]** | — (below floor) |
| | Flash-Lite | 13 | 0.077 [0.049, 0.131] | 0.003 | 0.12 |
| **other Arabic print** | Opus / 3 Flash / agy 3.8 low / Flash-Lite | 4 / 11 / 4 / 13 | 0.093 / 0.099 / 0.124 / 0.143 | 0.003 / 0.006 / 0.02 / 0.005 | — / 0.92 / — / 0.08 |

The two manuscript cells differ only in panel and content: the gate's Jābir panel reads cleaner than the average
Arabic-script manuscript panel (RASAM, Set B). The expert-key level is above the gate's KEY-O figures by design: the
model-key and self-key shifts are taken out.

**Key-type sensitivity** (accuracy refit with only the expert-keyed Arabic rows, RASAM): Arabic manuscripts Opus
0.210, agy 3.8 high 0.257, agy 3.8 low 0.259, Pro 0.272, Flash-Lite 0.353; P(lowest) Opus **0.87**. The order is
the same; the model-keyed rows raised Pro's standing (Set B's KEY-O was built from the Pro read), not Opus's.

### Routes (`route_ocr_v1.py --charts arabic-manuscript,arabic-print`; `results/ocr-v1-arabic-routes{,-floor4}.md`)

Same rule, bar and costs as v1: the cheapest MEASURED route (≥ 5 pages read in the chart) that clears the bar
(within max(0.01, 15% of the best route's E[CER]) with P ≥ 0.9).

| cell | choice | P(clears bar) | E[CER] | P(read) | P(best) | next cheaper route's P(clears bar) | margins ×0.5 / ×2 |
|---|---|---|---|---|---|---|---|
| Jābir manuscripts | **Opus 5.5** | 1.00 | 0.117 | 1.00 | 0.81 | agy 3.7 low (pooled) 0.44, agy 3.8 high 0.36, agy 3.8 low 0.28, Flash-Lite 0.005 | Opus / Opus |
| other Arabic manuscripts | **Opus 5.5** | 1.00 | 0.211 | 1.00 | 0.83 | agy 3.7 low (pooled) 0.46, 3.8 high 0.39, 3.8 low 0.32, Flash-Lite 0.01 | Opus / Opus |
| Kraus 1935, 5-page floor | Flash-Lite Batch | 1.00 | 0.077 | 1.00 | 0.12 | (the only measured, enabled route: it sets the bar) | Flash-Lite / Flash-Lite |
| Kraus 1935, 4-page floor | **Opus 5.5** | 1.00 | 0.048 | 1.00 | 0.54 | agy 3.8 low 0.34, 3 Flash (disabled) 0.66, Flash-Lite 0.18 | Opus / Opus |
| other Arabic print, 4-page floor | Opus 5.5 | 1.00 | 0.093 | 1.00 | 0.54 | agy 3.8 low 0.32, 3 Flash (disabled) 0.61, Flash-Lite 0.15 | Opus / Opus |

- **Cost per usable page.** Opus is priced at `route-costs.json`'s 0.0303 Claude points a call, a Sonnet *text*-call
  reading; the gate's own bound for an Opus image call is 0.003–0.014. On the manuscripts Opus is the only route
  that clears the bar, so the price does not change the choice.
- **Could more testing flip it? Manuscripts: unlikely.** The cheaper routes have P(clears bar) 0.28–0.44, but each
  agy route also loses a third to a half of the alchemical pages to the filter: if the cheapest one cleared, its
  cost per usable page would include the Opus fallback on every cut page. 3.7 Flash is no longer offered on agy.
  Gemini 4 Argon low is the agy model nobody has tried on Arabic: it is not listed because no Gemini 4 read is in
  either Arabic chart, and it would meet the same CLI filter.
- **Kraus: yes.** The cell rests on 4 pages. The share agy would not read is 0.28 [0.07, 0.63], and its P(clears
  bar) is 0.34. Twenty-five more Kraus pages through agy 3.8 Flash low (about 0.02% of a month's agy quota) would
  settle both the filter rate on Kraus's alchemical extracts and whether agy is within a point of Opus.

**Does the pooled posterior agree with the gate?**
- **13 manuscripts → Opus: agrees.** Same choice under every margin and both key treatments.
- **Kraus → agy 3.8 Flash low, Flash-Lite fallback: not supported yet.** The router cannot route agy from 4 pages.
  Allowing 4, it picks Opus: the filter term learned on the manuscripts says agy would lose 0.28 [0.07, 0.63] of
  Kraus's pages (the gate's 0/4 is weak evidence against that), and agy is not within the bar of Opus with
  P ≥ 0.9. The gate's own reason (all three readers usable on 4/4) is a usability judgement the CER model does not
  take. Both say Flash-Lite is the weakest on print. A fallback chain (agy → Flash-Lite) still yields a page on every
  call, so the gate's route is safe to run; the question is quality, and 4 pages cannot answer it.

### Translation side (estimator v2, `report-v2-2026-10-25.json` `what_we_know`, ar)

| engine | route | posterior [90%] (1–5) | pages | basis | P(best) |
|---|---|---|---|---|---|
| Opus 5.5 | api | **4.79 [4.66, 4.89]** | 7 | thin | **0.96** |
| G4L (Gemini 4 Argon low) | cli | 4.58 [4.34, 4.79] | 0 | pooled | 0.03 |
| 3.8 Flash | cli | 4.47 [4.31, 4.61] | 24 | measured | 0.00 |
| 3.1 Pro high | cli | 4.47 [4.24, 4.67] | 0 | pooled | 0.00 |
| 3.1 Pro t128 | api | 4.35 [4.15, 4.53] | 24 | measured | 0.00 |
| Sonnet 5.5 | api | 4.30 [4.10, 4.47] | 24 | measured | 0.00 |
| 3 Flash | api | 4.10 [3.92, 4.28] | 27 | measured | 0.00 |
| Flash-Lite 3.1 | api | 3.82 [3.61, 4.03] | 27 | measured | 0.00 |

- **Evidence the fit missed:** #6750 (Gemini 4 Argon XL-365, 2026-10-15) judged 23 Arabic pages: G4L 4.48, 3.8 Flash
  CLI 4.24, production 3.94. The v2 table does not read it (G4L has 0 Arabic pages above). It would turn G4L from
  pooled to measured; its 3.8 Flash and production figures agree with the posterior. No Opus arm in #6750, so it
  does not touch Opus's thin 7 pages. The Jābir gate ran no translation.
- Opus leads Arabic translation as it leads Arabic manuscript OCR. Its translation evidence (7 pages) is thinner than
  its OCR evidence (50 pages).

### The rest of our Arabic holdings (Mongo, `bookstore`, read-only, 2026-10-25)

- **Arabic-language books classed handwritten** (`book_class.class`): 299 books, about 28,300 pages not OCR'd
  (`pages_count − pages_ocr − pages_blank`).
  - Visible: 5,732. Of these, 4,513 sit in the scans-only hold (#7270) and 626 in the 2026-10 acquisition-wave hold.
  - Hidden: 22,537, of which 22,161 are in the acquisition-wave images-only hold.
- **Plus:** the 14 Jābir books (2,834 pages, no `book_class` yet), and 94K unread pages of Arabic-language books with
  no `book_class` (81K of them acquisition wave), some unknown share handwritten.
- **Already OCR'd** Arabic-language manuscript pages: 26,793. By the stored `ocr.model`: 3 Flash 18,402, Flash-Lite
  8,348 (8,017 visible), Opus 33. The posterior puts Flash-Lite at 0.345 CER on a non-alchemical Arabic-script
  manuscript and Opus at 0.211. The 8,017 visible Flash-Lite pages are the re-read candidates this posterior names.
  3 Flash has no manuscript measurement (0 pages), so the 18,402 cannot be placed.

### Limits

- **SVI, not NUTS**, as v1. Intervals are narrower than the posterior's, and the engine × group / kind scales
  collapsed.
- **Thin and mixed Arabic data:** 65 pages, 40 works, three key types. Only 18 pages have an expert key. Set B mixes
  Persian and Malay into the Arabic-script manuscript chart.
- **CER only.** The gate's deciding measure (two-family usability) is not in the model. The router's bar is a CER
  margin.
- **Kraus is 4 pages from 1 book**, and the print chart is otherwise #5700's corrected-served pages.
- **`alchemy` is a book-level flag** that only the gate sets. Other alchemical Arabic books in the holdings carry 0,
  and the filter's trigger is the recipe text, not the label.

Artifacts (`scripts/eval/estimator/ocr/`):
- code: `build-arabic-rows.py`, `fit_ocr_v1_arabic.py`, `model_ocr_v1.py` (`ext`), `route_ocr_v1.py` (`--arabic`,
  `--charts`, `--min-pages`, alchemy cells);
- results: `results/arabic-rows.jsonl`, `results/ocr-v1-arabic-fit.json` (checks, terms, every prediction),
  `results/ocr-v1-arabic-routes{,-floor4}.{json,md}`.

Posterior pickles are in the job scratch (`/mnt/HC_Volume_105839809/jobs/arabic-cell-refit-7341/fit-ar/`). To
rebuild: `build-arabic-rows.py --mss6544 <#6544 scratch>`. Then run `fit_ocr_v1_arabic.py --only` with `full`,
`holdout-gate`, `holdout-arabic` and `expert-keys` (about 6 min each), then with `report`. Then run
`route_ocr_v1.py --arabic … --charts arabic-manuscript,arabic-print --fees <private>`.
