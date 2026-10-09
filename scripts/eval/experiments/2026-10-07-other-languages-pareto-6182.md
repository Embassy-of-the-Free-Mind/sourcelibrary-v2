## 2026-10-07 · Every language but Tibetan: which Gemini model sits on the cost × fidelity frontier, and is any worth a routing change? (#6182, rule B)
<!-- PRIOR ART: 2026-10-07-tengyur-pareto-replication-6182.md (the Tibetan half of the same preregistration: rule A + rule B on 171 Tengyur sides), the five #5695 reference tracks and the #5873 top-up (the 365 pages and references reused unchanged; build-translation-pareto.mjs plots their original arms). Scorer: scripts/eval/tengyur-levers/score-ref.py gains a `--round 6182xl` switch that calls scripts/eval/pareto-6182/score-xl.py; the Tibetan rounds re-score unchanged. -->

**Question.** On the #5695 reference tracks (Latin; Greek; the T3 vernaculars; Hebrew, Aramaic, Arabic, Persian; Sanskrit, Pali, Chinese), which Gemini model gives the most fidelity per dollar, and does any of them clear the preregistered bar for replacing today's engine? (Preregistration `scripts/eval/pareto-6182/PREREG.md`, rule B; rule A is the Tengyur replication and is scored in the Tibetan file.)

**Answer** (2026-10-07; two blind Opus judges; 365 pages, one per book, each against a published human translation; AI judges, not a scholar's review).
- **Latin (70 books, decision grade): route to `gemini-3.7-flash`.** Fidelity 4.69 against production's 4.24 (`gemini-3.1-flash-lite` on 62 books), +0.45 [+0.26, +0.63] by-book bootstrap; production's own rerun moves it by −0.02 [−0.15, +0.09]. Reversal pages fall from 12.9 to 2.9 per 100 and omission pages from 14.3 to 7.1. Cost rises from $0.89 to $2.21 per 1,000 pages (Batch, billed on this run), 2.5×.
- **Greek (69 books, decision grade): route to `gemini-3.7-flash`.** 4.23 against production's 3.95 (`gemini-3-flash-preview`), +0.28 [+0.13, +0.44]; floor +0.02 [−0.10, +0.14]. Omission pages fall from 29.0 to 14.5 per 100; reversal pages 8.7 → 7.2. Cost $1.92 → $2.58 per 1,000 pages.
- **Sanskrit, Pali, Chinese (T5 pool, 84 books, decision grade): `gemini-3.7-flash` passes, narrowly.** +0.26 [+0.11, +0.41] against production (FP), floor +0.00 [−0.12, +0.12]; the pool's heterogeneity check passes (Sanskrit +0.28, Pali +0.33, Chinese +0.16, every interval holds the pooled value). With J1 alone the gain is +0.24, under the 0.25 effect the card requires, so this proposal rests on 0.01. Cost $1.81 → $2.40.
- **Hebrew, Aramaic, Arabic, Persian (T4 pool, 80 books): keep `gemini-3-flash-preview`.** The best arm, `gemini-3.8-flash`, gains +0.14 [+0.03, +0.26]; production is inside the 0.25 margin, so the cheapest arm inside it is production.
- **German, French, Italian, Dutch, Spanish (T3 pool, 59 books): keep `gemini-3.1-flash-lite`.** Rule B picks FP (the cheapest arm inside the margin), whose +0.19 [+0.04, +0.33] falls short of 0.25; and the pool fails its heterogeneity check (French: −0.04 for FP and for G38, against +0.2 to +0.6 in German and Italian), so it is reported per language, all exploratory (< 30 books): G38 gains +0.39 in German (22 books) and G37 +0.65 in Italian (10).
- **The Flash-Lite models are below production everywhere they are not production:** −0.34 to −0.67 in Greek, T4 and T5, with 2–3× the reversal pages. `gemini-3.5-flash-lite` is dominated by `gemini-3.1-flash-lite` in every stratum.
- **`gemini-3.7-flash` and `gemini-3.8-flash` cannot be told apart** in any stratum (G37 − G38: Latin +0.06 [−0.03, +0.15], Greek −0.06 [−0.17, +0.07], T3 −0.07, T4 −0.04, T5 −0.06, all intervals across 0). G37 is the rule's pick because it is the cheaper by at most $0.05 per 1,000 pages. One engine for both (G38, the Tengyur re-translation choice) would cost the same within that margin.
- **Pro (`gemini-3.1-pro-preview`, budget 128) is dominated in four of five strata** by G37 or G38, at 6–10× their price; in T5 it is on the frontier (+0.36) at $15.65 per 1,000 pages.

**Design.**
- **Pages:** 365 xl pages (PREREG `xl`), one per book, production's one-page v13 request, no context, every arm on Batch. Arms are compared on shared pages: 3 pages lose an arm to a refusal after retry (G36 2, G38 1, FP 1, L35 1) and drop out of their stratum (Latin 1, T4 1, T5 1).
- **Production** per page is today's `getTranslateModelForBook`: L31 for most Latin and T3 books, FP for Greek, T4, T5 and 18 Latin/T3 books. AA is a second run of that engine (the A-vs-A floor).
- **Judges:** two blind Opus judges (`claude -p --model opus`, subscription), `translation-vs-reference/JUDGE-PROMPT.md` verbatim (sha256 b0b98c17…), all arms of a page in one item, labels shuffled per item.
- **Prereg amendment (2026-10-07, recorded here):** J1 judged every item (377); J2 judged every control plus a seeded quarter of pages (103 items: `random.Random(6182).sample` of the sorted ARMS ids, n/4; ids in `/root/pareto-6182/xljudge/J2-subset.json`, sha256 of the comma-joined ids `e3413c8bb1ed6b57…`, fixed before any score was read). A page's fidelity is the mean of the judges that scored it; a reversal page is one where either judge quoted a reversal. Every rule was re-run with J1 alone (`sensitivity_J1_only` in scores.json): every verdict holds except T5, noted above.
- **Gate** (prereg: plant caught = reversal quoted or lower fidelity than its twin, ≥ 6 of 8; duplicates tie, ≥ 3 of 4): **J1 7/8 and 4/4, J2 8/8 and 4/4; both pass and both are scored.** J1's miss gave a planted "is → is not" the same 4 as its twin.
- **Agreement** on the 91 pages both judged (834 page × arm pairs): same grade 83.2 %, within one 99.8 %, Pearson 0.86; reversal flags agree on 95.3 % (κ 0.62; J1 46, J2 63, both 35). Both judges put G37/G38/PRO at the top and L31/L35 at the bottom.
- **CIs:** clustered bootstrap by book (2,000 draws, seed 6182); with one page per book it is a page bootstrap.
- **Cost:** each arm's billed Batch dollars on that stratum's pages (`usd_batch` per response in the arm files, thinking included), per 1,000 pages. O, the tracks' own Opus arm, is quoted at the API list rate from #6121 ($19.1/1K) and ran with context on a subset, so it is a ceiling beside the chart, never a lane; the judges are also Opus.
- **Rule B** as preregistered: best = highest-fidelity Gemini arm; inside the margin = fidelity ≥ best − 0.25 and reversal pages ≤ best + 8 per 100; recommended = cheapest inside; a routing proposal only if, against production, a costlier arm's Δ CI excludes 0, Δ lies above the A-vs-A floor's interval and Δ ≥ 0.25. Pools are used only if every language with ≥ 10 books has the pool's sign and its 95 % interval holds the pooled Δ.

**Result.** Δ is against production (PROD) on the same pages; reversal / omission / invention pages = pages where either judge listed one, per 100 (invention excludes `added_fact` notes, #5695's convention).

**Latin** — 70 pages / 70 books, production {'L31': 62, 'FP': 8}, 70 referenced books: decision

| arm | $/1K Batch | fidelity [by-book CI] | Δ vs production [CI] | reversal pages /100 | omission pages /100 | invention pages /100 | frontier |
|---|---|---|---|---|---|---|---|
| G37 | 2.21 | 4.69 [4.55, 4.81] | +0.45 [+0.26, +0.63] | 2.9 | 7.1 | 21.4 | yes |
| G38 | 2.21 | 4.63 [4.49, 4.76] | +0.39 [+0.19, +0.59] | 2.9 | 5.7 | 18.6 | dominated by G37 |
| PRO | 16.83 | 4.61 [4.48, 4.73] | +0.37 [+0.19, +0.56] | 2.9 | 1.4 | 27.1 | dominated by G37 |
| G36 | 2.24 | 4.48 [4.32, 4.64] | +0.24 [+0.08, +0.40] | 8.6 | 8.6 | 35.7 | dominated by G37 |
| G35 | 5.21 | 4.41 [4.26, 4.56] | +0.18 [+0.00, +0.34] | 5.7 | 2.9 | 34.3 | dominated by G37 |
| FP | 1.72 | 4.37 [4.23, 4.51] | +0.14 [-0.04, +0.30] | 5.7 | 1.4 | 51.4 | yes |
| PROD | 0.89 | 4.24 [4.06, 4.41] | — | 12.9 | 14.3 | 24.3 | — |
| L31 | 0.81 | 4.21 [4.04, 4.39] | -0.02 [-0.07, +0.01] | 12.9 | 14.3 | 24.3 | yes |
| AA | 0.89 | 4.21 [4.03, 4.39] | -0.02 [-0.15, +0.09] | 11.4 | 14.3 | 28.6 | — |
| L35 | 1.21 | 4.06 [3.86, 4.26] | -0.17 [-0.37, +0.02] | 18.6 | 14.3 | 32.9 | dominated by L31 |
| O (track's Opus, context request, 20 pages) | 19.1 list | 4.83 (production 4.12 on the same pages) | +0.70 [+0.35, +1.10] | 0.0 | 15.0 | 25.0 | off the frontier |

**Greek** — 69 pages / 69 books, production {'L31': 0, 'FP': 69}, 69 referenced books: decision

| arm | $/1K Batch | fidelity [by-book CI] | Δ vs production [CI] | reversal pages /100 | omission pages /100 | invention pages /100 | frontier |
|---|---|---|---|---|---|---|---|
| G38 | 2.63 | 4.29 [4.08, 4.49] | +0.34 [+0.17, +0.51] | 10.1 | 11.6 | 36.2 | yes |
| G37 | 2.58 | 4.23 [4.01, 4.43] | +0.28 [+0.13, +0.44] | 7.2 | 14.5 | 31.9 | yes |
| PRO | 18.29 | 4.20 [3.97, 4.41] | +0.25 [+0.09, +0.42] | 5.8 | 11.6 | 18.8 | dominated by G38 |
| G36 | 2.58 | 3.99 [3.78, 4.20] | +0.04 [-0.12, +0.20] | 5.8 | 17.4 | 36.2 | dominated by G37 |
| AA | 1.93 | 3.97 [3.77, 4.17] | +0.02 [-0.10, +0.14] | 4.3 | 26.1 | 44.9 | — |
| FP | 1.92 | 3.95 [3.73, 4.17] | +0.00 [+0.00, +0.00] | 8.7 | 29.0 | 43.5 | yes |
| PROD | 1.92 | 3.95 [3.73, 4.17] | — | 8.7 | 29.0 | 43.5 | — |
| G35 | 6.10 | 3.92 [3.72, 4.12] | -0.03 [-0.19, +0.12] | 10.1 | 15.9 | 37.7 | dominated by G38 |
| L31 | 0.94 | 3.61 [3.40, 3.83] | -0.34 [-0.53, -0.14] | 18.8 | 26.1 | 30.4 | yes |
| L35 | 1.41 | 3.53 [3.33, 3.72] | -0.42 [-0.62, -0.24] | 26.1 | 18.8 | 26.1 | dominated by L31 |
| O (track's Opus, context request, 9 pages) | 19.1 list | 4.56 (production 3.89 on the same pages) | +0.67 [+0.22, +1.11] | 0.0 | 0.0 | 22.2 | off the frontier |

**T3 pool** — 59 pages / 59 books, production {'L31': 49, 'FP': 10}, 59 referenced books: decision

| arm | $/1K Batch | fidelity [by-book CI] | Δ vs production [CI] | reversal pages /100 | omission pages /100 | invention pages /100 | frontier |
|---|---|---|---|---|---|---|---|
| G38 | 1.88 | 4.82 [4.72, 4.92] | +0.34 [+0.18, +0.51] | 1.7 | 0.0 | 16.9 | yes |
| PRO | 17.91 | 4.81 [4.71, 4.92] | +0.33 [+0.16, +0.51] | 1.7 | 0.0 | 23.7 | dominated by G38 |
| G35 | 4.24 | 4.80 [4.69, 4.90] | +0.31 [+0.14, +0.49] | 1.7 | 3.4 | 28.8 | dominated by G38 |
| G37 | 1.88 | 4.75 [4.64, 4.86] | +0.27 [+0.11, +0.44] | 0.0 | 1.7 | 15.3 | dominated by G38 |
| FP | 1.42 | 4.67 [4.54, 4.80] | +0.19 [+0.04, +0.33] | 3.4 | 1.7 | 42.4 | yes |
| G36 | 1.88 | 4.65 [4.52, 4.79] | +0.17 [+0.00, +0.34] | 3.4 | 1.7 | 23.7 | dominated by G38 |
| PROD | 0.79 | 4.48 [4.32, 4.64] | — | 8.5 | 6.8 | 22.0 | — |
| L31 | 0.68 | 4.47 [4.31, 4.61] | -0.02 [-0.09, +0.05] | 6.8 | 10.2 | 18.6 | yes |
| AA | 0.79 | 4.41 [4.25, 4.56] | -0.08 [-0.17, +0.02] | 8.5 | 3.4 | 27.1 | — |
| L35 | 1.01 | 4.32 [4.15, 4.49] | -0.16 [-0.36, +0.03] | 10.2 | 6.8 | 27.1 | dominated by L31 |
| O (track's Opus, context request, 20 pages) | 19.1 list | 4.95 (production 4.53 on the same pages) | +0.42 [+0.10, +0.72] | 0.0 | 0.0 | 25.0 | off the frontier |

**T4 pool** — 80 pages / 80 books, production {'L31': 0, 'FP': 80}, 80 referenced books: decision

| arm | $/1K Batch | fidelity [by-book CI] | Δ vs production [CI] | reversal pages /100 | omission pages /100 | invention pages /100 | frontier |
|---|---|---|---|---|---|---|---|
| G38 | 2.65 | 4.37 [4.21, 4.53] | +0.14 [+0.03, +0.26] | 5.0 | 8.8 | 31.2 | yes |
| G37 | 2.59 | 4.33 [4.16, 4.48] | +0.10 [-0.01, +0.21] | 3.8 | 15.0 | 31.2 | yes |
| PRO | 16.29 | 4.26 [4.08, 4.44] | +0.04 [-0.07, +0.15] | 8.8 | 11.2 | 25.0 | dominated by G38 |
| FP | 1.97 | 4.22 [4.06, 4.40] | +0.00 [+0.00, +0.00] | 10.0 | 15.0 | 36.2 | yes |
| PROD | 1.97 | 4.22 [4.06, 4.40] | — | 10.0 | 15.0 | 36.2 | — |
| G35 | 6.20 | 4.11 [3.94, 4.29] | -0.11 [-0.23, +0.00] | 11.2 | 11.2 | 42.5 | dominated by G38 |
| G36 | 2.61 | 4.10 [3.92, 4.29] | -0.12 [-0.24, +0.00] | 13.8 | 18.8 | 42.5 | dominated by G37 |
| AA | 1.97 | 4.05 [3.87, 4.25] | -0.17 [-0.29, -0.07] | 15.0 | 10.0 | 33.8 | — |
| L31 | 0.94 | 3.76 [3.56, 3.98] | -0.46 [-0.62, -0.31] | 18.8 | 17.5 | 27.5 | yes |
| L35 | 1.51 | 3.56 [3.34, 3.78] | -0.67 [-0.83, -0.51] | 25.0 | 20.0 | 32.5 | dominated by L31 |
| O (track's Opus, context request, 18 pages) | 19.1 list | 4.67 (production 3.94 on the same pages) | +0.72 [+0.39, +1.00] | 0.0 | 11.1 | 33.3 | off the frontier |

**T5 pool** — 84 pages / 84 books, production {'L31': 0, 'FP': 84}, 84 referenced books: decision

| arm | $/1K Batch | fidelity [by-book CI] | Δ vs production [CI] | reversal pages /100 | omission pages /100 | invention pages /100 | frontier |
|---|---|---|---|---|---|---|---|
| PRO | 15.65 | 4.46 [4.32, 4.59] | +0.36 [+0.18, +0.52] | 4.8 | 8.3 | 26.2 | yes |
| G38 | 2.41 | 4.43 [4.32, 4.55] | +0.32 [+0.17, +0.46] | 3.6 | 14.3 | 26.2 | yes |
| G37 | 2.40 | 4.37 [4.23, 4.49] | +0.26 [+0.11, +0.41] | 4.8 | 19.0 | 23.8 | yes |
| G36 | 2.40 | 4.20 [4.07, 4.33] | +0.09 [-0.05, +0.23] | 6.0 | 27.4 | 31.0 | dominated by G37 |
| FP | 1.81 | 4.11 [3.98, 4.24] | +0.00 [+0.00, +0.00] | 8.3 | 29.8 | 38.1 | yes |
| PROD | 1.81 | 4.11 [3.98, 4.24] | — | 8.3 | 29.8 | 38.1 | — |
| AA | 1.79 | 4.11 [3.96, 4.26] | +0.00 [-0.12, +0.12] | 8.3 | 35.7 | 34.5 | — |
| G35 | 5.57 | 4.04 [3.89, 4.18] | -0.07 [-0.23, +0.08] | 10.7 | 26.2 | 38.1 | dominated by G38 |
| L31 | 0.84 | 3.59 [3.42, 3.76] | -0.52 [-0.69, -0.34] | 23.8 | 38.1 | 19.0 | yes |
| L35 | 1.35 | 3.57 [3.40, 3.74] | -0.54 [-0.71, -0.37] | 23.8 | 29.8 | 25.0 | dominated by L31 |
| O (track's Opus, context request, 20 pages) | 19.1 list | 4.90 (production 3.95 on the same pages) | +0.95 [+0.70, +1.25] | 0.0 | 0.0 | 25.0 | off the frontier |

**Per language** (rule B within each language; under 30 books = exploratory)

| language | books | production | prod fid | best arm | best fid | Δ best vs prod [CI] | recommended | inside the margin |
|---|---|---|---|---|---|---|---|---|
| Arabic | 24 | FP 24 | 4.29 | G38 | 4.52 | +0.23 [+0.04, +0.42] | FP | FP, G37, G38, PRO |
| Aramaic | 5 | FP 5 | 3.40 | PRO | 3.60 | +0.20 [-0.40, +0.80] | PRO | PRO |
| Chinese | 25 | FP 25 | 4.18 | G38 | 4.38 | +0.20 [-0.08, +0.48] | G38 | G38, G37, G36, PRO |
| Dutch | 7 | L31 6/FP 1 | 4.14 | G38 | 4.71 | +0.57 [+0.14, +1.14] | G38 | G38, PRO |
| French | 14 | L31 9/FP 5 | 4.82 | G37 | 4.93 | +0.11 [+0.00, +0.32] | L31 | L31, FP, G36, G37, G38, G35, PRO |
| German | 22 | L31 18/FP 4 | 4.52 | G38 | 4.91 | +0.39 [+0.14, +0.64] | FP | FP, G36, G37, G38, G35, PRO |
| Greek | 69 | FP 69 | 3.95 | G38 | 4.29 | +0.34 [+0.17, +0.51] | G37 | G37, G38, PRO |
| Hebrew | 28 | FP 28 | 4.38 | G38 | 4.54 | +0.16 [-0.05, +0.38] | FP | FP, G37, G38, G36, PRO |
| Italian | 10 | L31 10 | 4.15 | G37 | 4.80 | +0.65 [+0.20, +1.20] | G37 | G37 |
| Latin | 70 | L31 62/FP 8 | 4.24 | G37 | 4.69 | +0.45 [+0.26, +0.63] | G37 | G37, G38, G36, PRO |
| Pali | 29 | FP 29 | 4.29 | PRO | 4.74 | +0.45 [+0.24, +0.66] | G37 | G37, G38, PRO |
| Persian | 23 | FP 23 | 4.15 | G37 | 4.33 | +0.17 [-0.02, +0.39] | G37 | G37, G38 |
| Sanskrit | 30 | FP 30 | 3.87 | PRO | 4.32 | +0.45 [+0.12, +0.77] | G38 | G38, G37, PRO |
| Spanish | 6 | L31 6 | 4.50 | PRO | 5.00 | +0.50 [+0.17, +0.83] | FP | FP, G38, G36, G37, G35, PRO |

**Measured shortcomings and limits.**
- **One page per book, and AI judges.** Every figure is two Opus judges against one published translation per page, 2026-10-07; no scholar has read these pages.
- **The A-vs-A floor is wide in T4:** production's own rerun scores −0.17 [−0.29, −0.07] against production, the same model on the same pages. Single-page differences of that size are run-to-run noise.
- **No context.** Production sends the previous page's English on these lanes; every arm here did not, so arms differ only by model (context was measured as noise in #6121).
- **Invention pages stay high for every Flash arm** (15–51 per 100; FP highest in Latin at 51): mostly glosses and unreadable fills, not added facts.
- **By eye** (prereg: 20 judge findings per stratum read against the source): not run in this scoring job ($0, no model calls).
- **Charts:** each language with ≥ 10 books gets an "Eight Gemini models, 7 Oct 2026 (#6182)" panel on /quality (`build-translation-pareto.mjs`), in a separate PR stacked on this one (branch `eval/pareto-6182-charts`).

**Decision (Derek's; nothing has been re-routed).** Route Latin and Greek to `gemini-3.7-flash` (or `gemini-3.8-flash`, indistinguishable at the same price); Sanskrit, Pali and Chinese to the same, with the caveat that the effect clears the card's 0.25 by 0.01. Keep production for the T3 vernaculars and the T4 pool. Tibetan: production stays the default (the Tibetan file).

**Files.** `scripts/eval/results/pareto-6182/xljudge/scores.json` (numbers only; judge outputs, packets and reference text stay on the box under `/root/pareto-6182/xljudge/`). Run: `python3 scripts/eval/tengyur-levers/score-ref.py --round 6182xl`. $0.
