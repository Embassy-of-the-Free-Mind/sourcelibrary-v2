# Calibration scorecard — how accurate is the text Source Library serves? (2026-07-31)

Reader-first deliverable for #3235: fit an agreement->accuracy calibration on pinned,
reference-scored pages, then apply it to the whole `page_revisions` double-OCR corpus to
estimate per-script x per-era accuracy at zero marginal model cost.

**Read this first if you are not a statistician:** the table in "Scorecard v0" below is
the answer. Everything above it is how we got there and how much to trust it.

## Why canonical pages are excluded from fitting

Canonical pages are EXCLUDED from the agreement->accuracy fit. Recitation makes independent models agree with each other while both misreport the page, so agreement measures memorization consensus on canonical text, not reading quality.

On this exact dataset: non-canonical r = **0.711** (n=32 pages), canonical r = **0.442** (n=12 pages). Pilot (smaller sample): r=0.75 noncanon vs r=0.49 canon.

## Step 1+2 — anchor fits, per script (non-canonical pages only)

| stratum | n pages | agreement range | free-skip fit (slope, intercept) | r (free-skip) | r (windowed) | 95% CI on slope | verdict |
|---|---:|---|---|---:|---:|---|---|
| spaced (all alphabetic scripts, pooled) | 32 | 35.3%–97.8% | 0.073 x + 0.92 | 0.711 | 0.647 | [0.047, 0.097] | usable |
| space-less (CJK, pooled) | 0 | — | — | — | — | — | **UNUSABLE** — n=0 pages < 5 — UNUSABLE, no fit attempted, never extrapolate |
| Armenian | 8 | 37.0%–74.3% | 0.027 x + 0.95 | 0.254 | 0.519 | [-0.089, 0.098] | usable, but slope not significant (CI crosses 0) |
| German | 5 | 83.7%–97.8% | 0.051 x + 0.948 | 0.754 | 0.979 | [0.024, 0.389] | usable |
| Greek | 12 | 38.0%–97.6% | 0.09 x + 0.906 | 0.888 | 0.791 | [0.026, 0.116] | usable |
| Hebrew | 2 | — | — | — | — | — | **UNUSABLE** — n=2 pages < 5 — UNUSABLE, no fit attempted, never extrapolate |
| Latin | 5 | 40.2%–72.5% | -0.036 x + 0.992 | -0.269 | -0.369 | [-0.218, 0.592] | usable, but slope not significant (CI crosses 0) |

Free-skip (upper bound) and windowed (lower bound, PR #3304) accuracy per anchor page:

| language (stratum) | slug | agreement | accuracy (free-skip) | accuracy (windowed) | bracket width |
|---|---|---:|---:|---:|---:|
| Armenian | armenian-eznik-elc-alandoc-157 | 74.3% | 96.5% | 96.4% | 0.0pp |
| Armenian | armenian-eznik-elc-alandoc-70 | 70.7% | 97.0% | 96.4% | 0.6pp |
| Armenian | armenian-eznik-elc-alandoc-109 | 70.0% | 95.2% | 95.9% | -0.6pp |
| Armenian | armenian-xorenatsi-patmutiwn-2-60 | 68.4% | 98.5% | 98.5% | -0.1pp |
| Armenian | armenian-eznik-elc-alandoc-203 | 65.0% | 97.3% | 98.3% | -1.0pp |
| Armenian | armenian-xorenatsi-patmutiwn-3-35 | 51.0% | 94.8% | 93.2% | 1.6pp |
| Armenian | armenian-xorenatsi-patmutiwn-2-13 | 46.6% | 98.3% | 98.1% | 0.2pp |
| Armenian | armenian-zohrab-1chronicles-1 | 37.0% | 95.1% | 93.0% | 2.1pp |
| German | german-humboldt-kosmos1-p150 | 97.8% | 99.9% | 100.0% | -0.1pp |
| German | german-boltzmann-gastheorie2-p128 | 96.9% | 100.0% | 100.0% | 0.0pp |
| German | german-hegel-phaenomenologie-p351 | 96.9% | 99.5% | 99.9% | -0.4pp |
| German | german-hegel-logik-p148 | 95.5% | 99.3% | 100.0% | -0.7pp |
| German | german-herder-sprache-p44 | 83.7% | 99.1% | 99.1% | 0.0pp |
| Greek | greek-simplicius-in-phys-300 | 97.6% | 99.2% | 100.0% | -0.7pp |
| Greek | greek-hero-pneumatica-60 | 97.3% | 99.5% | 99.2% | 0.3pp |
| Greek | greek-hero-pneumatica-306 | 95.7% | 99.0% | 99.8% | -0.9pp |
| Greek | greek-philo-opificio-38 | 95.6% | 98.9% | 100.0% | -1.1pp |
| Greek | greek-philo-opificio-45 | 94.9% | 98.8% | 99.8% | -1.0pp |
| Greek | greek-philo-opificio-55 | 88.0% | 98.2% | 98.8% | -0.6pp |
| Greek | greek-hero-pneumatica-266 | 86.0% | 97.6% | 97.0% | 0.6pp |
| Greek | greek-hero-pneumatica-178 | 80.5% | 97.5% | 98.8% | -1.3pp |
| Greek | greek-simplicius-in-phys-500 | 68.0% | 98.1% | 98.3% | -0.1pp |
| Greek | greek-simplicius-in-phys-150 | 64.8% | 98.5% | 100.0% | -1.5pp |
| Greek | greek-iliad-13-idomeneus | 45.1% | 94.8% | 93.0% | 1.8pp |
| Greek | greek-dioscorides-ruel-106 | 38.0% | 92.3% | 80.5% | 11.8pp |
| Hebrew | hebrew-shaarei-orah-gate2-yovel | 68.7% | 93.3% | 92.3% | 1.0pp |
| Hebrew | hebrew-sefer-hayirah-blessings | 35.3% | 93.1% | 73.0% | 20.1pp |
| Latin | latin-hieronymus-prologus-galeatus | 72.5% | 98.7% | 98.1% | 0.6pp |
| Latin | latin-vita-vergilii-donatus-auctus | 67.2% | 94.3% | 91.7% | 2.6pp |
| Latin | latin-aeneid-10-pallas | 67.1% | 96.6% | 86.9% | 9.6pp |
| Latin | latin-hieronymus-epistola-ad-paulinum | 51.2% | 98.5% | 98.4% | 0.1pp |
| Latin | latin-vulgate-genesis-5-genealogy | 40.2% | 97.5% | 96.2% | 1.3pp |

## Step 3 — corpus-wide calibrated bands

Applied to `scripts/eval/results/revision-agreement-corpus-2026-07-30.json` (built 2026-07-31): **171,279** eligible `page_revisions` pairs, corpus mean agreement 57.5%, median 83.2%.

| language | era | n pairs | corpus agreement (median) | calibration used | estimated accuracy | flags |
|---|---|---:|---:|---|---:|---|
| Latin | 1600-1699 | 36,870 | 4.3% | Latin | 97.8% | extrapolated; canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| Latin | 1500-1599 | 31,362 | 3.5% | Latin | 97.8% | extrapolated; canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| German | 1700-1799 | 19,721 | 98.6% | German | 99.1% | extrapolated |
| Latin | 1700-1799 | 8,695 | 27.9% | Latin | 97.5% | canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| English | 1900+ | 7,776 | 99.9% | spaced-pooled | 97.8% | cross-script transfer |
| German | 1600-1699 | 7,716 | 98.8% | German | 99.2% | — |
| English | 1800-1899 | 6,446 | 100.0% | spaced-pooled | 99.1% | cross-script transfer; extrapolated |
| German | 1800-1899 | 4,322 | 99.4% | German | 99.1% | extrapolated |
| Latin | pre-1500 | 3,867 | 66.3% | Latin | 97.3% | canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| English | 1600-1699 | 3,037 | 97.5% | spaced-pooled | 97.8% | cross-script transfer |
| German | 1500-1599 | 2,961 | 97.5% | German | 99.1% | extrapolated |
| French | 1600-1699 | 2,528 | 88.8% | spaced-pooled | 96.5% | cross-script transfer |
| French | 1700-1799 | 2,493 | 99.4% | spaced-pooled | 99.0% | cross-script transfer |
| Sanskrit | 1900+ | 2,277 | 0.1% | spaced-pooled | 94.6% | cross-script transfer; extrapolated |
| Greek | 1800-1899 | 1,891 | 98.0% | Greek | 98.9% | canon-heavy language — may overstate |
| English | 1700-1799 | 1,761 | 99.5% | spaced-pooled | 98.7% | cross-script transfer |
| Greek | 1500-1599 | 1,679 | 33.6% | Greek | 94.0% | extrapolated; canon-heavy language — may overstate |
| French | 1500-1599 | 1,335 | 90.0% | spaced-pooled | 98.3% | cross-script transfer |
| German | 1900+ | 1,170 | 100.0% | German | 99.8% | extrapolated |
| French | 1800-1899 | 1,109 | 88.8% | spaced-pooled | 95.9% | cross-script transfer |
| Latin | 1800-1899 | 1,009 | 99.5% | Latin | 96.6% | extrapolated; canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| Tibetan | 1700-1799 | 998 | 12.8% | — | — | UNCALIBRATED (space-less, zero anchors); canon-heavy language — may overstate |
| Dutch | 1500-1599 | 910 | 87.2% | spaced-pooled | 97.9% | cross-script transfer |
| Italian | pre-1500 | 869 | 17.3% | spaced-pooled | 94.6% | cross-script transfer; extrapolated |
| Greek | 1900+ | 835 | 98.8% | Greek | 99.1% | canon-heavy language — may overstate |
| Greek | pre-1500 | 817 | 59.6% | Greek | 95.8% | canon-heavy language — may overstate |
| Sanskrit | 1800-1899 | 761 | 0.1% | spaced-pooled | 94.6% | cross-script transfer; extrapolated |
| Greek | 1600-1699 | 711 | 0.9% | Greek | 94.0% | extrapolated; canon-heavy language — may overstate |
| Dutch | 1600-1699 | 675 | 99.4% | spaced-pooled | 99.1% | cross-script transfer |
| Italian | 1500-1599 | 672 | 4.8% | spaced-pooled | 94.6% | cross-script transfer; extrapolated |
| Latin | 1900+ | 550 | 99.7% | Latin | 96.6% | extrapolated; canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| English | unknown | 544 | 100.0% | spaced-pooled | 99.1% | cross-script transfer; extrapolated |
| English | 1500-1599 | 524 | 97.0% | spaced-pooled | 98.3% | cross-script transfer |
| Lb | unknown | 491 | 93.2% | spaced-pooled | 98.6% | cross-script transfer |
| Persian | pre-1500 | 485 | 79.1% | spaced-pooled | 97.5% | cross-script transfer |
| Greek | unknown | 389 | 51.1% | Greek | 94.9% | canon-heavy language — may overstate |
| Polish | 1800-1899 | 388 | 99.5% | spaced-pooled | 99.1% | cross-script transfer; extrapolated |
| Chinese | 1900+ | 387 | 94.0% | — | — | UNCALIBRATED (space-less, zero anchors); canon-heavy language — may overstate |
| Armenian | 1800-1899 | 369 | 55.5% | Armenian | 96.4% | canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| Tibetan | pre-1500 | 322 | 43.0% | — | — | UNCALIBRATED (space-less, zero anchors); canon-heavy language — may overstate |
| Russian | 1800-1899 | 314 | 82.3% | spaced-pooled | 96.5% | cross-script transfer |
| Multiple | 1700-1799 | 311 | 98.7% | spaced-pooled | 98.8% | cross-script transfer |
| Italian | 1600-1699 | 294 | 98.5% | spaced-pooled | 98.9% | cross-script transfer |
| Arabic | pre-1500 | 282 | 64.6% | spaced-pooled | 96.5% | cross-script transfer |
| Hebrew | 1600-1699 | 262 | 63.8% | spaced-pooled | 96.5% | cross-script transfer; canon-heavy language — may overstate |
| Middle English | 1800-1899 | 257 | 100.0% | spaced-pooled | 99.1% | cross-script transfer; extrapolated |
| French | 1900+ | 229 | 91.8% | spaced-pooled | 98.1% | cross-script transfer |
| Hebrew | 1500-1599 | 223 | 62.1% | spaced-pooled | 96.3% | cross-script transfer; canon-heavy language — may overstate |
| Dutch | 1700-1799 | 215 | 94.5% | spaced-pooled | 98.6% | cross-script transfer |
| Javanese | 1800-1899 | 203 | 5.9% | spaced-pooled | 94.6% | cross-script transfer; extrapolated |
| Chinese | pre-1500 | 188 | 14.1% | — | — | UNCALIBRATED (space-less, zero anchors); canon-heavy language — may overstate |
| Latin | unknown | 185 | 100.0% | Latin | 96.6% | extrapolated; canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| Middle English | pre-1500 | 185 | 68.3% | spaced-pooled | 96.9% | cross-script transfer |
| English | pre-1500 | 138 | 83.4% | spaced-pooled | 97.7% | cross-script transfer |
| Occitan | 1800-1899 | 137 | 100.0% | spaced-pooled | 99.1% | cross-script transfer; extrapolated |
| Yoruba | 1800-1899 | 133 | 98.8% | spaced-pooled | 99.0% | cross-script transfer |
| Nahuatl | 1500-1599 | 124 | 80.0% | spaced-pooled | 97.3% | cross-script transfer |
| Maya hieroglyphs | pre-1500 | 119 | 30.3% | — | — | UNCALIBRATED (space-less, zero anchors) |
| Burmese | 1800-1899 | 118 | 99.7% | — | — | UNCALIBRATED (space-less, zero anchors) |
| Pahlavi | 1800-1899 | 111 | 0.1% | spaced-pooled | 94.6% | cross-script transfer; extrapolated |
| Arabic | 1800-1899 | 98 | 99.7% | spaced-pooled | 99.0% | cross-script transfer |
| Hausa | 1800-1899 | 98 | 98.7% | spaced-pooled | 98.8% | cross-script transfer |
| Chinese | 1800-1899 | 86 | 92.2% | — | — | UNCALIBRATED (space-less, zero anchors); canon-heavy language — may overstate |
| Korean | 1700-1799 | 67 | 63.0% | spaced-pooled | 95.5% | cross-script transfer |
| Unknown | 1700-1799 | 66 | 100.0% | spaced-pooled | 99.1% | cross-script transfer; extrapolated |
| Old Javanese | pre-1500 | 64 | 100.0% | spaced-pooled | 99.1% | cross-script transfer; extrapolated |
| English; Chinese | 1800-1899 | 57 | 99.1% | — | — | UNCALIBRATED (space-less, zero anchors) |
| Zulu | 1800-1899 | 56 | 100.0% | spaced-pooled | 99.1% | cross-script transfer; extrapolated |
| Dutch | 1800-1899 | 55 | 90.1% | spaced-pooled | 98.5% | cross-script transfer |

(Cells with <50 revision pairs are omitted from this table for readability; the full set is in the JSON.)

## Step 3b — the same-leaf re-fit (#3473)

The bands above assume both sides of a revision pair read the same page image. Often
they did not. The printed page number is transcribed *from the leaf the model was shown*, so
two passes printing different numbers looked at different leaves — their disagreement is
re-archiving, not reading difficulty.

Corpus-wide: **68,323** same-leaf pairs, **42,445** shifted, **60,511** unmeasurable (no printed number on one side). Median agreement 99.5% same-leaf vs 2.5% shifted.

| language | era | n (all) | n (same leaf) | kept | agreement all → same | est. accuracy all → same | Δ |
|---|---|---:|---:|---:|---|---|---:|
| Latin | 1600-1699 | 36,870 | 7,793 | 21% | 36.0% → 90.7% | 97.8% → 96.6% | -1.2pp |
| Latin | 1500-1599 | 31,362 | 5,750 | 18% | 32.3% → 89.1% | 97.8% → 96.6% | -1.2pp |
| German | 1700-1799 | 19,721 | 10,600 | 54% | 77.4% → 96.6% | 99.1% → 99.7% | +0.7pp |
| Latin | 1700-1799 | 8,695 | 3,119 | 36% | 48.7% → 93.9% | 97.5% → 96.6% | -0.9pp |
| English | 1900+ | 7,776 | 5,543 | 71% | 79.0% → 98.0% | 97.8% → 99.1% | +1.4pp |
| German | 1600-1699 | 7,716 | 4,445 | 58% | 86.5% → 96.9% | 99.2% → 99.7% | +0.5pp |
| English | 1800-1899 | 6,446 | 5,750 | 89% | 98.1% → 98.5% | 99.1% → 99.1% | 0.0pp |
| German | 1800-1899 | 4,322 | 3,075 | 71% | 79.3% → 97.0% | 99.1% → 99.8% | +0.7pp |
| Latin | pre-1500 | 3,867 | 626 | 16% | 53.0% → 78.5% | 97.3% → 96.6% | -0.7pp |
| English | 1600-1699 | 3,037 | 1,665 | 55% | 79.9% → 97.0% | 97.8% → 99.1% | +1.3pp |
| German | 1500-1599 | 2,961 | 794 | 27% | 83.3% → 94.5% | 99.1% → 99.6% | +0.5pp |
| French | 1600-1699 | 2,528 | 1,135 | 45% | 62.3% → 94.5% | 96.5% → 98.9% | +2.4pp |
| French | 1700-1799 | 2,493 | 1,891 | 76% | 95.3% → 96.5% | 99.0% → 99.1% | +0.1pp |
| Sanskrit | 1900+ | 2,277 | 127 | 6% | 12.1% → 93.9% | 94.6% → 98.9% | +4.3pp |
| Greek | 1800-1899 | 1,891 | 1,317 | 70% | 92.5% → 96.9% | 98.9% → 99.3% | +0.4pp |
| English | 1700-1799 | 1,761 | 1,132 | 64% | 91.5% → 96.1% | 98.7% → 99.0% | +0.3pp |
| Greek | 1500-1599 | 1,679 | 247 | 15% | 37.2% → 68.7% | 94.0% → 96.8% | +2.8pp |
| French | 1500-1599 | 1,335 | 734 | 55% | 85.7% → 93.8% | 98.3% → 98.9% | +0.6pp |
| German | 1900+ | 1,170 | 1,075 | 92% | 98.2% → 99.2% | 99.8% → 99.8% | 0.0pp |
| French | 1800-1899 | 1,109 | 503 | 45% | 53.2% → 97.5% | 95.9% → 99.1% | +3.2pp |
| Latin | 1800-1899 | 1,009 | 788 | 78% | 92.9% → 92.8% | 96.6% → 96.6% | 0.0pp |
| Tibetan | 1700-1799 | 998 | 1 | 0% | 13.4% → 41.7% | — → — | — |
| Dutch | 1500-1599 | 910 | 108 | 12% | 80.7% → 50.8% | 97.9% → 95.7% | -2.2pp |
| Italian | pre-1500 | 869 | 143 | 17% | 34.5% → 71.9% | 94.6% → 97.3% | +2.7pp |
| Greek | 1900+ | 835 | 565 | 68% | 94.5% → 94.7% | 99.1% → 99.1% | +0.0pp |
| Greek | pre-1500 | 817 | 386 | 47% | 57.3% → 58.7% | 95.8% → 95.9% | +0.1pp |
| Sanskrit | 1800-1899 | 761 | 17 | 2% | 10.6% → 54.1% | 94.6% → 96.0% | +1.4pp |
| Greek | 1600-1699 | 711 | 28 | 4% | 5.6% → 60.0% | 94.0% → 96.0% | +2.0pp |
| Dutch | 1600-1699 | 675 | 439 | 65% | 96.7% → 97.7% | 99.1% → 99.1% | +0.1pp |
| Italian | 1500-1599 | 672 | 95 | 14% | 25.5% → 83.7% | 94.6% → 98.1% | +3.5pp |


**Sensitivity check (117 cells with both bands).** Excluding shifted pairs moves mean agreement by **-30.1 to 81.8pp**, and moves estimated accuracy by **-2.2 to 4.3pp**.

That ratio is the finding. A calibration whose output barely responds to a large swing in
its own input is mostly reporting its intercept — the pooled spaced fit is
`0.073·x + 0.92`, so the whole 0–100%
agreement range spans only 7.3 points of accuracy.
Leaf contamination was real and worth removing, but it was not what was wrong here.

Per-script fits that cannot carry a band, and why any number derived from them is not one:

- **Armenian** — slope `0.027` (r 0.254, n=8 pages), 95% CI crosses zero.
- **Latin** — slope `-0.036` (r -0.269, n=5 pages), **negative**: higher agreement predicts LOWER accuracy, 95% CI crosses zero.

This is why some cells move *down* when contaminated pairs are removed: the sign of the
fit, not a property of the text.

**Neither column is the answer on its own.** The all-pairs column mixes image churn into
"illegibility". The same-leaf column is a *biased subpopulation*: requiring a printed page number
on both sides selects pages legible enough to print one twice. Read the delta and the `kept`
column together — a cell that kept 20% of its pairs is describing a different population, not a
cleaner measurement of the same one.

## Two caveats to carry with every number above

- A large share of revision pairs did not read the same LEAF (#3473): the two passes printed different page numbers, so their disagreement is re-archiving, not reading difficulty. `corpus_wide_calibration_same_leaf` re-applies the fit to same-leaf pairs only. Treat neither column as the answer on its own: the all-pairs column mixes image churn into "illegibility", and the same-leaf column is a BIASED subpopulation — requiring a printed page number on both sides selects pages legible enough to print one twice. Read the delta, and read `same_leaf_retention` before trusting any cell.
- Revision pairs are mostly within-Gemini-family transitions (flash->current, lite->current), NOT independent readings across engines — calibrated numbers are estimates CONDITIONAL on the anchor fit (built from a small, multi-engine anchor set) transferring to same-family re-runs. They are not validated against an independent OCR engine.
- Canonical-heavy strata inflate agreement without the fit knowing it: recitation makes independent runs agree while both misreport the page. Strata in Hebrew, Latin, Greek, Armenian, Tibetan, Chinese plausibly contain a mix of liturgical/scriptural/classical works alongside ordinary prose; a calibrated estimate for these languages may read HIGHER than true reading accuracy to the extent canonical passages are present. Flagged, not corrected — no per-book canonicity score exists corpus-wide yet.
- Space-less scripts (Tibetan, Chinese) have ZERO non-canonical anchor pages in this dataset (all 6 Chinese anchor pages are canonical ctext works) — there is no fit to apply, and none is reported. Corpus agreement for these languages is descriptive only.
- Per-script fits use n=5-12 PAGES (not runs) — small-sample estimates. Bootstrap CIs are reported and are WIDE; treat point estimates as indicative, not precise.
- Applying any fit outside its anchor agreement range is extrapolation and is flagged per-cell (`extrapolated_beyond_anchor_range`) rather than silently clamped as fact.

## Scorecard v0 (paper-ready subsection)

_Drop-in for `.claude/docs/ocr-memorization-paper.md`, "Experiments planned" ->
"Calibration scorecard" entry, once reviewed._

We fit a monotone agreement->accuracy calibration on the 32 non-canonical anchor pages
(canonical pages excluded — recitation inflates agreement without inflating true reading
accuracy. On this 44-page dataset the pooled canon r (0.442, n=12, six scripts) is noisier
and cross-script-confounded rather than confirmatory; the exclusion rests on the recitation
mechanism itself, demonstrated directly by the within-work pairs (paper result #9), not on this
single correlation). Usable
per-script fits exist for Armenian, Greek, Latin and German (n=5-12 pages each, wide bootstrap
CIs); Hebrew (n=2) and all space-less scripts (Chinese, Tibetan — zero non-canonical anchor
pages) are UNUSABLE and reported as such, never extrapolated. Applied to the 109,953-pair
`page_revisions` corpus (PR #3273), this produces calibrated per-script x per-era accuracy
estimates at zero marginal model cost — with two standing caveats: the corpus is mostly
within-Gemini-family re-OCR (not an independent-engine validation of the fit), and languages
whose corpus includes liturgical/classical canonical works may read the calibration high.
Product form: a per-script x per-century scorecard on /research, eventually a per-page
confidence surface in the reader.
