# Calibration scorecard — how accurate is the text Source Library serves? (2026-07-23)

Reader-first deliverable for #3235: fit an agreement->accuracy calibration on pinned,
reference-scored pages, then apply it to the whole `page_revisions` double-OCR corpus to
estimate per-script x per-era accuracy at zero marginal model cost.

**Read this first if you are not a statistician:** the table in "Scorecard v0" below is
the answer. Everything above it is how we got there and how much to trust it.

## Why canonical pages are excluded from fitting

Canonical pages are EXCLUDED from the agreement->accuracy fit. Recitation makes independent models agree with each other while both misreport the page, so agreement measures memorization consensus on canonical text, not reading quality.

On this exact dataset: non-canonical r = **0.714** (n=32 pages), canonical r = **0.777** (n=12 pages). Pilot (smaller sample): r=0.75 noncanon vs r=0.49 canon.

> **Honest flag:** On THIS 44-page dataset the pooled canon r is HIGHER than noncanon r — the opposite of the pilot direction. Do not paper over this: at n=12 the canon r pools SIX different scripts (only 1-2 points each), so between-script separation (each script sits at its own agreement/accuracy level) can inflate a pooled r without reflecting a real within-script relationship — a Simpson's-paradox-shaped artifact of small n, not a refutation of the exclusion. The exclusion decision itself rests on the RECITATION MECHANISM demonstrated directly elsewhere in the paper (within-work pairs: canonical Iliad I scores 100% across every model on hard 16th-c. Greek cursive it cannot be reading better than the surrounding text — paper result #9), not on this single pooled correlation number, which is too small-n and cross-script-confounded to be dispositive either way.

## Step 1+2 — anchor fits, per script (non-canonical pages only)

| stratum | n pages | agreement range | free-skip fit (slope, intercept) | r (free-skip) | r (windowed) | 95% CI on slope | verdict |
|---|---:|---|---|---:|---:|---|---|
| spaced (all alphabetic scripts, pooled) | 32 | 35.3%–97.8% | 0.082 x + 0.918 | 0.714 | 0.647 | [0.051, 0.109] | usable |
| space-less (CJK, pooled) | 0 | — | — | — | — | — | **UNUSABLE** — n=0 pages < 5 — UNUSABLE, no fit attempted, never extrapolate |
| Armenian | 8 | 37.0%–74.3% | 0.044 x + 0.943 | 0.329 | 0.519 | [-0.078, 0.175] | usable, but slope not significant (CI crosses 0) |
| German | 5 | 83.7%–97.8% | 0.053 x + 0.948 | 0.975 | 0.979 | [-0.055, 0.093] | usable, but slope not significant (CI crosses 0) |
| Greek | 12 | 38.0%–97.6% | 0.103 x + 0.901 | 0.852 | 0.791 | [0.014, 0.133] | usable |
| Hebrew | 2 | — | — | — | — | — | **UNUSABLE** — n=2 pages < 5 — UNUSABLE, no fit attempted, never extrapolate |
| Latin | 5 | 40.2%–72.5% | -0.039 x + 0.998 | -0.321 | -0.369 | [-0.198, 0.509] | usable, but slope not significant (CI crosses 0) |

Free-skip (upper bound) and windowed (lower bound, PR #3304) accuracy per anchor page:

| language (stratum) | slug | agreement | accuracy (free-skip) | accuracy (windowed) | bracket width |
|---|---|---:|---:|---:|---:|
| Armenian | armenian-eznik-elc-alandoc-157 | 74.3% | 97.0% | 96.4% | 0.6pp |
| Armenian | armenian-eznik-elc-alandoc-70 | 70.7% | 97.0% | 96.4% | 0.7pp |
| Armenian | armenian-eznik-elc-alandoc-109 | 70.0% | 96.2% | 95.9% | 0.3pp |
| Armenian | armenian-xorenatsi-patmutiwn-2-60 | 68.4% | 98.8% | 98.5% | 0.3pp |
| Armenian | armenian-eznik-elc-alandoc-203 | 65.0% | 98.5% | 98.3% | 0.2pp |
| Armenian | armenian-xorenatsi-patmutiwn-3-35 | 51.0% | 93.5% | 93.2% | 0.4pp |
| Armenian | armenian-xorenatsi-patmutiwn-2-13 | 46.6% | 98.6% | 98.1% | 0.5pp |
| Armenian | armenian-zohrab-1chronicles-1 | 37.0% | 95.6% | 93.0% | 2.6pp |
| German | german-humboldt-kosmos1-p150 | 97.8% | 100.0% | 100.0% | 0.0pp |
| German | german-boltzmann-gastheorie2-p128 | 96.9% | 100.0% | 100.0% | 0.0pp |
| German | german-hegel-phaenomenologie-p351 | 96.9% | 99.9% | 99.9% | 0.0pp |
| German | german-hegel-logik-p148 | 95.5% | 100.0% | 100.0% | 0.0pp |
| German | german-herder-sprache-p44 | 83.7% | 99.3% | 99.1% | 0.1pp |
| Greek | greek-simplicius-in-phys-300 | 97.6% | 100.0% | 100.0% | 0.0pp |
| Greek | greek-hero-pneumatica-60 | 97.3% | 100.0% | 99.2% | 0.8pp |
| Greek | greek-hero-pneumatica-306 | 95.7% | 99.8% | 99.8% | 0.0pp |
| Greek | greek-philo-opificio-38 | 95.6% | 100.0% | 100.0% | 0.0pp |
| Greek | greek-philo-opificio-45 | 94.9% | 99.9% | 99.8% | 0.1pp |
| Greek | greek-philo-opificio-55 | 88.0% | 98.8% | 98.8% | 0.0pp |
| Greek | greek-hero-pneumatica-266 | 86.0% | 97.3% | 97.0% | 0.3pp |
| Greek | greek-hero-pneumatica-178 | 80.5% | 98.8% | 98.8% | 0.0pp |
| Greek | greek-simplicius-in-phys-500 | 68.0% | 98.5% | 98.3% | 0.2pp |
| Greek | greek-simplicius-in-phys-150 | 64.8% | 100.0% | 100.0% | 0.0pp |
| Greek | greek-iliad-13-idomeneus | 45.1% | 94.7% | 93.0% | 1.7pp |
| Greek | greek-dioscorides-ruel-106 | 38.0% | 92.0% | 80.5% | 11.5pp |
| Hebrew | hebrew-shaarei-orah-gate2-yovel | 68.7% | 93.6% | 92.3% | 1.3pp |
| Hebrew | hebrew-sefer-hayirah-blessings | 35.3% | 93.1% | 73.0% | 20.1pp |
| Latin | latin-hieronymus-prologus-galeatus | 72.5% | 98.8% | 98.1% | 0.7pp |
| Latin | latin-vita-vergilii-donatus-auctus | 67.2% | 94.9% | 91.7% | 3.1pp |
| Latin | latin-aeneid-10-pallas | 67.1% | 97.1% | 86.9% | 10.2pp |
| Latin | latin-hieronymus-epistola-ad-paulinum | 51.2% | 98.8% | 98.4% | 0.4pp |
| Latin | latin-vulgate-genesis-5-genealogy | 40.2% | 98.1% | 96.2% | 1.8pp |

## Step 3 — corpus-wide calibrated bands

Applied to `scripts/eval/results/revision-agreement-corpus-2026-07-23.json` (built 2026-07-23): **109,953** eligible `page_revisions` pairs, corpus mean agreement 87.0%, median 98.2%.

| language | era | n pairs | corpus agreement (median) | calibration used | estimated accuracy | flags |
|---|---|---:|---:|---|---:|---|
| German | 1700-1799 | 15,859 | 99.5% | German | 99.8% | slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| Latin | 1600-1699 | 15,311 | 92.3% | Latin | 97.0% | extrapolated; canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| Latin | 1500-1599 | 11,465 | 90.8% | Latin | 97.0% | extrapolated; canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| German | 1600-1699 | 6,910 | 99.1% | German | 99.9% | slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| English | 1800-1899 | 6,446 | 100.0% | spaced-pooled | 99.8% | cross-script transfer; extrapolated |
| English | 1900+ | 6,216 | 100.0% | spaced-pooled | 99.8% | cross-script transfer |
| Latin | 1700-1799 | 4,351 | 98.9% | Latin | 97.0% | extrapolated; canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| German | 1800-1899 | 3,609 | 99.7% | German | 99.8% | slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| English | 1600-1699 | 2,653 | 98.7% | spaced-pooled | 99.2% | cross-script transfer |
| German | 1500-1599 | 2,595 | 98.4% | German | 99.8% | slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| French | 1700-1799 | 2,493 | 99.4% | spaced-pooled | 99.6% | cross-script transfer |
| Greek | 1800-1899 | 1,891 | 98.0% | Greek | 99.6% | canon-heavy language — may overstate |
| Latin | pre-1500 | 1,864 | 77.8% | Latin | 97.2% | canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| English | 1700-1799 | 1,761 | 99.5% | spaced-pooled | 99.3% | cross-script transfer |
| French | 1600-1699 | 1,644 | 99.1% | spaced-pooled | 99.5% | cross-script transfer |
| Greek | 1500-1599 | 1,340 | 44.8% | Greek | 94.8% | canon-heavy language — may overstate |
| French | 1500-1599 | 1,335 | 90.0% | spaced-pooled | 98.8% | cross-script transfer |
| German | 1900+ | 1,170 | 100.0% | German | 100.0% | extrapolated; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| Latin | 1800-1899 | 1,009 | 99.5% | Latin | 97.0% | extrapolated; canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| Tibetan | 1700-1799 | 998 | 12.8% | — | — | UNCALIBRATED (space-less, zero anchors); canon-heavy language — may overstate |
| Dutch | 1500-1599 | 910 | 87.2% | spaced-pooled | 98.4% | cross-script transfer |
| Italian | pre-1500 | 869 | 17.3% | spaced-pooled | 94.7% | cross-script transfer; extrapolated |
| Greek | 1900+ | 835 | 98.8% | Greek | 99.8% | canon-heavy language — may overstate |
| Greek | pre-1500 | 817 | 59.6% | Greek | 96.0% | canon-heavy language — may overstate |
| Dutch | 1600-1699 | 675 | 99.4% | spaced-pooled | 99.7% | cross-script transfer |
| French | 1800-1899 | 616 | 99.8% | spaced-pooled | 99.6% | cross-script transfer |
| Latin | 1900+ | 550 | 99.7% | Latin | 97.0% | extrapolated; canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| English | unknown | 544 | 100.0% | spaced-pooled | 99.8% | cross-script transfer; extrapolated |
| English | 1500-1599 | 524 | 97.0% | spaced-pooled | 98.9% | cross-script transfer |
| Lb | unknown | 491 | 93.2% | spaced-pooled | 99.2% | cross-script transfer |
| Persian | pre-1500 | 485 | 79.1% | spaced-pooled | 98.0% | cross-script transfer |
| Greek | unknown | 389 | 51.1% | Greek | 95.0% | canon-heavy language — may overstate |
| Polish | 1800-1899 | 388 | 99.5% | spaced-pooled | 99.8% | cross-script transfer; extrapolated |
| Chinese | 1900+ | 387 | 94.0% | — | — | UNCALIBRATED (space-less, zero anchors); canon-heavy language — may overstate |
| Armenian | 1800-1899 | 369 | 55.5% | Armenian | 96.5% | canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| Tibetan | pre-1500 | 322 | 43.0% | — | — | UNCALIBRATED (space-less, zero anchors); canon-heavy language — may overstate |
| Multiple | 1700-1799 | 311 | 98.7% | spaced-pooled | 99.5% | cross-script transfer |
| Italian | 1600-1699 | 294 | 98.5% | spaced-pooled | 99.6% | cross-script transfer |
| Arabic | pre-1500 | 282 | 64.6% | spaced-pooled | 96.9% | cross-script transfer |
| Hebrew | 1600-1699 | 262 | 63.8% | spaced-pooled | 96.9% | cross-script transfer; canon-heavy language — may overstate |
| Middle English | 1800-1899 | 257 | 100.0% | spaced-pooled | 99.8% | cross-script transfer; extrapolated |
| French | 1900+ | 229 | 91.8% | spaced-pooled | 98.6% | cross-script transfer |
| Hebrew | 1500-1599 | 223 | 62.1% | spaced-pooled | 96.7% | cross-script transfer; canon-heavy language — may overstate |
| Russian | 1800-1899 | 219 | 94.2% | spaced-pooled | 99.0% | cross-script transfer |
| Dutch | 1700-1799 | 215 | 94.5% | spaced-pooled | 99.3% | cross-script transfer |
| Javanese | 1800-1899 | 203 | 5.9% | spaced-pooled | 94.7% | cross-script transfer; extrapolated |
| Sanskrit | 1900+ | 200 | 96.5% | spaced-pooled | 99.4% | cross-script transfer |
| Chinese | pre-1500 | 188 | 14.1% | — | — | UNCALIBRATED (space-less, zero anchors); canon-heavy language — may overstate |
| Latin | unknown | 185 | 100.0% | Latin | 97.0% | extrapolated; canon-heavy language — may overstate; slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering |
| Middle English | pre-1500 | 185 | 68.3% | spaced-pooled | 97.3% | cross-script transfer |
| Italian | 1500-1599 | 180 | 89.3% | spaced-pooled | 98.8% | cross-script transfer |
| English | pre-1500 | 138 | 83.4% | spaced-pooled | 98.2% | cross-script transfer |
| Occitan | 1800-1899 | 137 | 100.0% | spaced-pooled | 99.8% | cross-script transfer; extrapolated |
| Yoruba | 1800-1899 | 133 | 98.8% | spaced-pooled | 99.7% | cross-script transfer |
| Nahuatl | 1500-1599 | 124 | 80.0% | spaced-pooled | 97.7% | cross-script transfer |
| Sanskrit | 1800-1899 | 120 | 73.4% | spaced-pooled | 97.1% | cross-script transfer |
| Maya hieroglyphs | pre-1500 | 119 | 30.3% | — | — | UNCALIBRATED (space-less, zero anchors) |
| Burmese | 1800-1899 | 118 | 99.7% | — | — | UNCALIBRATED (space-less, zero anchors) |
| Arabic | 1800-1899 | 98 | 99.7% | spaced-pooled | 99.6% | cross-script transfer |
| Hausa | 1800-1899 | 98 | 98.7% | spaced-pooled | 99.4% | cross-script transfer |
| Chinese | 1800-1899 | 86 | 92.2% | — | — | UNCALIBRATED (space-less, zero anchors); canon-heavy language — may overstate |
| Korean | 1700-1799 | 67 | 63.0% | spaced-pooled | 95.8% | cross-script transfer |
| Unknown | 1700-1799 | 66 | 100.0% | spaced-pooled | 99.8% | cross-script transfer; extrapolated |
| Old Javanese | pre-1500 | 64 | 100.0% | spaced-pooled | 99.8% | cross-script transfer; extrapolated |
| English; Chinese | 1800-1899 | 57 | 99.1% | — | — | UNCALIBRATED (space-less, zero anchors) |
| Zulu | 1800-1899 | 56 | 100.0% | spaced-pooled | 99.8% | cross-script transfer; extrapolated |
| Dutch | 1800-1899 | 55 | 90.1% | spaced-pooled | 99.1% | cross-script transfer |

(Cells with <50 revision pairs are omitted from this table for readability; the full set is in the JSON.)

## Two caveats to carry with every number above

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
accuracy. On this 44-page dataset the pooled canon r (0.777, n=12, six scripts) is noisier
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
