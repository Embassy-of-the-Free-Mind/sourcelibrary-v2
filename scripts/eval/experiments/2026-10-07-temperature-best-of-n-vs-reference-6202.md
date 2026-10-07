## 2026-10-07 · Temperature and best-of-3 for translation, against published references (#6202)
<!-- PRIOR ART: scripts/eval/xlref-t1 — reused (arms.mjs: the production request replayed to files; its page set and references). Also reused unchanged: scripts/eval/translation-vs-reference/ (JUDGE-PROMPT.md, build-packet.mjs, score.mjs), the #5695 T4 set (2026-10-03-translation-vs-reference-t4-hebrew-arabic-persian-5695.md, which measured the temperature-1 noise floor), the Tengyur 84000 set (2026-10-04-tengyur-stored-draft-vs-84000-5797.md) and the margin rule of 2026-10-04-routing-eval-tool-replay-5828.md. No earlier run had temperature or best-of-N as an arm (2026-10-01-chinese-skqs-followup-5568.md: "Worth its own run"). -->

**Status: preregistered 2026-10-07 at `fdb2df8db`, before any paid call; run the same day. The design down to "Results" is as registered (deviations are listed at the end).**

**Question.** Production translates at temperature 1 (`translate-worker.mjs` and `translate-batch-chained.mjs` send no temperature; the API default is 1). Against published human translations, does temperature 0.2 or 0, or best-of-3 at temperature 1 with a blind picker, give more faithful English with fewer reversed statements than one draw at temperature 1? Is the gain larger than the difference between two draws of production itself?

**What the result decides.**
- (a) Which temperature `translate-worker.mjs` should send (a recommendation on #6202; this PR does not change the worker).
- (b) Whether best-of-3 is worth about 3× the cost on the Tengyur (#6121).
- (c) Whether evaluations that ran at temperature 0 describe production.

### Design

**Pages: 150, all from existing reference sets. No page is drawn or aligned here** (`scripts/eval/temp-6202/build-records.mjs`, seed 6202; ids in `results/temp-6202-2026-10/pages.json`).
- **Tengyur vs 84000, 50 sides:** a seeded 50 of the 354 sides of #5797 (Toh 3808 26, Toh 1183 12, Toh 1189 11, Toh 3990 1). The 84000 cuts were rebuilt with `tengyur-ref/fetch-84000.py` + `build-reference.py` (864 sides kept, as in #5797) because the earlier work directory is gone. They are CC BY-NC-ND and stay outside the repo.
- **Hebrew / Aramaic / Arabic / Persian, 50 pages:** the 52 pages of #5695 T4 minus the 2 whose reference sits in the translator's context (Hebrew 15, Aramaic 4, Arabic 20, Persian 11).
- **Latin, 50 pages:** a seeded 50 of the 71 pages of #5695 T1.
- Every arm translates the same stored OCR text the earlier runs used.

**Arms, on `gemini-3.1-flash-lite` and on `gemini-3-flash-preview`** (`run-arms.mjs`):

| arm | temperature | draws |
|---|---|---|
| T1a, T1b | 1 (production; the pair is the noise floor) | 2 |
| T02a, T02b | 0.2 | 2 |
| T0a, T0b | 0 | 2 |
| BO3 | 1 | T1a, T1b and a third draw T1c; a picker chooses one |

- **The request is production's.** Prompt v13 through `buildTranslationPrompt` with `PAGE_BREAK_SCOPED`, `BLOCK_NONE` safety settings, thinking budget 0, `maxOutputTokensFor`. The run asserts prompt version 13 and content hash `516510147237b6a79d9d3f6e797bba7f` on every page.
  - Latin and T4 use `translate-worker.mjs`'s shape: the previous page's served translation and the neighbouring pages' OCR as context (as `xlref-t1/arms.mjs` does).
  - The Tengyur uses the shape its draft was made with: one page, no context (`translate-batch-chained.mjs`, `context.mode: none`; as `tengyur-levers/run-arms.mjs` does).
  - Each page's prompt is built once and frozen, so all 14 calls for a page send the same bytes. Only `temperature` differs.
- **Checked before the run:** `translate-worker.mjs` line 304 builds `generationConfig` with `maxOutputTokens` and `thinkingConfig` only. No temperature is sent. `gemini-script-client` always sends one, so the T1 arms send `temperature: 1` explicitly, which is the API default.
- **Realtime, not Batch.** The harness's arm runners are realtime. Batch-equivalent cost is half of what is reported.
- **Empty answers.** An empty answer (RECITATION, blank) is resent once at the same settings. If it is empty again the page is dropped from every arm of that model (complete cases), and counted.
- **BO3 picker** (`pick.mjs`): `gemini-3-flash-preview`, temperature 0, thinking 0. It sees the source text and the three draws in a seeded random order under labels A/B/C. It does not see the reference or how the draws were made. It lists up to four differences of meaning and names one. If the three draws are identical no call is made. An unusable answer falls back to the first shuffled draw and is flagged.
  - BO3's score on a page is the judges' score of the draw the picker chose. BO3's cost is the three draws plus the picker call.

**Scoring: the existing reference judge, unchanged** (`scripts/eval/translation-vs-reference/`: `JUDGE-PROMPT.md`, `build-packet.mjs`, `score.mjs`).
- **Judges: two blind Opus judges**, each a separate `claude -p --model opus` session on the subscription (the Hetzner Anthropic API key returns 401; #5695 T4 ran its judges the same way). Not a human review.
- One packet per model. An item is one page with that model's draws as unlabelled candidates. Byte-identical draws are merged into one candidate and share its score.
- Each judge gets its own label shuffle and item order, so every page is read twice, in two independent candidate orders. Judges do not know the arms, the temperatures or that a temperature test is being run.
- Controls per packet: 3 wrong-page, 3 planted meaning changes, 3 duplicates. **If a packet's gate fails, that model's result is "instrument failed"** and no verdict is drawn from it.
- Per page and arm: **fidelity** = mean of the two judges (1–5); **reversal** = either judge quotes a reversal. Reversals are reported per 100 pages.

**Decision rule** (per model; pooled over the three sets, and per set). All intervals are 95 %, paired by page, seeded bootstrap (seed 6202, 4,000 resamples), the #5828 `margin-v1` construction.
- **Noise floor:** F_fid = |fid(T1b) − fid(T1a)|; F_rev = |rev(T1b) − rev(T1a)|. Also reported: pages moving ≥ 1 grade between the two draws, at each temperature.
- **An arm X "beats production"** if either holds:
  - *fidelity:* fid(X) − fid(T1a) > F_fid, **and** the interval's lower bound is above 0, **and** the upper bound of rev(X) − rev(T1a) is ≤ 0.10 (the `margin-v1` margin);
  - *reversals:* rev(T1a) − rev(X) > F_rev, **and** the upper bound of rev(X) − rev(T1a) is below 0, **and** the lower bound of fid(X) − fid(T1a) is ≥ −0.15.
- **X is "not worse than production"** if the lower bound of fid(X) − fid(T1a) is ≥ −0.15 and the upper bound of rev(X) − rev(T1a) is ≤ 0.10.
- For T02 and T0 the tested draw is the `a` draw against T1a. The two-draw contrast, mean(Xa, Xb) − mean(T1a, T1b), is reported beside it as the less noisy estimate; if the two disagree the verdict is "not shown".
- `margin-v1`'s "+1 page" count clause is not used: it was written for n = 30, and at n = 150 two draws of production differ by more than one page.
- **Headline for (a): production routing.** Each page counts under the model `getTranslateModelForBook` gives its book (Flash 106 pages, Lite 44). Lite and Flash are also reported on all 150.
  - A temperature is recommended over 1 only if it beats production on the production-routed pool and is not worse than production on either model alone.
  - If no temperature beats production: recommend sending an explicit value. Among arms that are not worse than production, pick the one with the fewest pages moving ≥ 1 grade between its two draws; if none qualifies, send 1.
- **(b) BO3** is "worth its cost" on the Tengyur only if BO3 beats production on the Tengyur set with Flash (the Tengyur's production model). Also reported: picker lift = fid(picked) − mean fid of the three draws; the oracle (the best of the three by the judges), which bounds what any picker could do; how often the picker chose a draw the judges ranked lowest.
- **(c) Temperature-0 evaluations "transfer"** if, per model, the interval of mean(T0a, T0b) − mean(T1a, T1b) lies inside ±0.15 for fidelity and inside ±0.10 for the reversal rate, **and** the Flash − Lite gap measured at T0 differs from the gap measured at T1 by an interval that includes 0. Otherwise they do not, and the direction and size are given.

**Spend.** Cap **$10** in total, re-runs included. Dry-run estimate for the arms: $8.15 (a character-count estimate; earlier runs billed about two thirds of theirs). Picker: about $0.6. Every call goes through the metered `gemini-script-client` with `book_id` `temp-6202` and `triggered_by` `temp-6202:<model>-<arm>`; a local ledger enforces the cap before each call.
- Order: the Tengyur set first, on all arms. Then the spend is read and the total projected.
- If the projection passes $9.00, in this order: (1) for a model whose T0a and T0b were byte-identical on ≥ 90 % of Tengyur pages, T0b is not run on the other sets and is taken to equal T0a; (2) BO3 (T1c and the picker) is not run on Lite for T4 and Latin.

**Limits known in advance.**
- The Tengyur references are 84000's texts, where the draft already scores 4.46 with 6 reversals per 100 pages (#5797). #6121's weak sections (Pramāṇa, Madhyamaka) have 58 hand-aligned reference sides, but those alignments were on a work directory that no longer exists. So (b) is answered for the referenced Tengyur and is only an indication for the weak sections.
- The judges read the OCR transcription as the source (#5695 T4's blind spot). Every arm shares it, so differences between arms are not affected.
- n = 50 per set. A per-set verdict can separate large effects only.
- Opus judges an Opus-free contest here (all arms are Gemini), so judge-family bias does not favour an arm.

**Not planned: the OCR rising-temperature retry.** It runs only if the translation run ends at or under $8.50, and then with a $1 cap.

### OCR addendum (registered 2026-10-07 after the translation arms had cost $6.77, before any OCR call)

The condition above is met, so the optional arm runs (`ocr-retry.mjs`, cap $1).
- **Pages:** the 20 sealed pages of `benchmark/refused-en-4686.json` (#4686): *Philosophical Transactions* and Birch, all stamped `ocr.recitation_blocked` with no text. No page is drawn. Looping pages (#3878) are not included: no sealed set of them exists.
- **Arms:** the production OCR request (default OCR prompt, the archived image, thinking 0, `maxOutputTokens` 16384) on Lite and on Flash at temperature 0, 0.4 and 0.8. Production sends 0.1.
- **Measure:** a page is "answered" if the reply has ≥ 200 characters and `loopVerdict` does not call it a loop. Reported: pages answered at each temperature, and pages answered at any step of the ladder. Outputs are not scored for accuracy.
- **Reading:** if the ladder answers fewer than 5 of 20 pages per model, a rising-temperature retry is not worth adding for refusals.

### Results

**Answer.**
- **(a) Temperature.** Lower temperatures score a little higher than 1, but **no temperature passes the registered test on the production-routed pool**: the first draw at 0.2 gains +0.10 [+0.01, +0.19] over T1a, and the floor there is also 0.10. By the registered fallback the recommendation is to **send an explicit `temperature: 0`**: it is not worse than production on Lite, on Flash and on the routed pool, and it has the fewest pages that change grade between two runs (7 of 149, against 15 at 0.2 and 37 at 1).
  - The less noisy two-draw contrast says both low settings are better than 1: 0.2 by +0.13 [+0.06, +0.20] and 0 by +0.10 [+0.03, +0.17] in fidelity, with 3.7 [0.3, 7.7] and 4.7 [1.3, 8.7] fewer reversal pages per 100.
  - 0.2 and 0 cannot be separated: 0.2 − 0 is +0.03 [−0.02, +0.08] in fidelity and +1.0 [−0.3, +2.7] reversal pages per 100.
- **(b) Best-of-3 is not worth its cost on the Tengyur.** With Flash on the 50 Tengyur sides, BO3 − T1a is +0.06 [−0.08, +0.21] at 3.6× the cost ($0.0129 against $0.0036 per page, realtime). The picker does add something over a random draw (+0.08 [+0.04, +0.13] on the routed pool), but a lower temperature gives the same gain for nothing.
- **(c) Temperature-0 evaluations transfer for comparisons, not for levels.** The Flash − Lite gap is the same at 0 and at 1 (+0.18 against +0.21; difference −0.04 [−0.15, +0.08]). But a temperature-0 run scores about 0.1 grade higher than production and shows 3 to 4 fewer reversal pages per 100. Lite fails the registered ±0.15 bound (+0.11 [+0.03, +0.20]); Flash passes it (+0.08 [+0.01, +0.15]). A temperature-0 run also hides the run-to-run noise: at temperature 1 a quarter of pages change by a grade or more between two draws.

These are AI judges (Opus). No page was checked by eye in this run.

**The run.**
- 2,100 translations (150 pages × 7 draws × 2 models), 300 picker calls. All 14 draws exist for all 150 pages. Prompt v13 with the registered hash on every page; 0 thinking tokens billed.
- Production routing of the 150 pages: Flash 106 (all 50 Tengyur, all 50 T4, 6 Latin), Lite 44 (all Latin).
- **Judging:** two packets (Lite 899 candidates, Flash 975, after merging identical draws). Both gates passed for both judges: wrong page 3/3, planted change 3/3 caught and located, duplicate 3/3 tied. Agreement: exact 84 % (Lite) and 82 % (Flash), within one grade 100 %, weighted κ 0.86 and 0.83. Reference cuts were rated exact on 78 to 82 % of judge-pages, never wrong. 124 judge sessions.
- **One registered exclusion:** a Latin page came back empty twice (RECITATION) in Flash's T02a, so it leaves every Flash analysis (n = 149). It was later answered and judged; keeping it changes no verdict (`analyze.mjs --keep-empty-twice`).
- **Empty answers:** 3 pages on the first try (2 RECITATION, 1 PROHIBITED_CONTENT), all in Flash T02a, within a few minutes of each other. No other arm had one.

**Fidelity (1–5) and reversal pages per 100, by temperature** (two draws averaged; BO3 is one pick). Bracketed: 95 % interval of the first draw.

| pool | T 1 (production) | T 0.2 | T 0 | BO3 | oracle best-of-3 |
|---|---|---|---|---|---|
| **Production-routed, 149 pages** | 3.96 · 12.1 (T1a 4.01 [3.90, 4.13]; T1b 3.91) | 4.09 · 8.4 | 4.06 · 7.4 | 4.04 · 8.7 | 4.20 · 6.0 |
| Lite, 150 | 3.82 · 9.0 (T1a 3.84 [3.73, 3.95]) | 3.92 · 7.0 | 3.93 · 4.7 | 3.95 · 7.3 | 4.11 · 2.7 |
| Flash, 149 | 4.03 · 10.4 (T1a 4.05 [3.93, 4.17]) | 4.15 · 9.1 | 4.11 · 7.4 | 4.10 · 8.1 | 4.26 · 5.4 |

**The registered test: first draw against T1a** (Δ fidelity [95 %]; Δ reversal pages per 100 [95 %]).

| pool | floor (T1b − T1a) | T02a − T1a | T0a − T1a | BO3 − T1a |
|---|---|---|---|---|
| **Production-routed, 149** | −0.10 [−0.20, −0.00]; 0.0 | +0.10 [+0.01, +0.19]; −4.0 [−8.7, +0.7] — **equals the floor: no** | +0.04 [−0.05, +0.13]; −4.0 [−9.4, +0.7] — no | +0.02 [−0.04, +0.09]; −3.4 [−7.4, 0.0] — no |
| Lite, 150 | −0.04 [−0.15, +0.07]; +2.0 | +0.06 [−0.03, +0.16]; 0.0 — no | +0.09 [−0.00, +0.19]; −3.3 [−8.0, +0.7] — no | +0.11 [+0.04, +0.19]; −0.7 — **beats** |
| Flash, 149 | −0.05 [−0.14, +0.04]; +0.7 | +0.13 [+0.04, +0.22]; −1.3 [−6.7, +4.0] — **beats** | +0.05 [−0.03, +0.14]; −2.0 — no | +0.05 [−0.02, +0.12]; −2.0 — no |

- Every low-temperature arm and BO3 is "not worse than production" on all three pools.
- On the routed pool T1a happened to be the better of production's two draws by 0.10 (interval excludes 0). Two identical requests differing by that much is what the floor is for; it makes the first-draw test strict here.

**The two-draw contrast** (mean of two draws at X minus mean of two at 1; less noisy, secondary).

| pool | T 0.2 − T 1 | T 0 − T 1 |
|---|---|---|
| Production-routed, 149 | +0.13 [+0.06, +0.20]; −3.7 [−7.7, −0.3] | +0.10 [+0.03, +0.17]; −4.7 [−8.7, −1.3] |
| Lite, 150 | +0.09 [+0.01, +0.18]; −2.0 [−5.3, +1.3] | +0.11 [+0.03, +0.20]; −4.3 [−7.7, −1.3] |
| Flash, 149 | +0.12 [+0.05, +0.20]; −1.3 [−5.4, +2.7] | +0.08 [+0.01, +0.15]; −3.0 [−7.0, +1.3] |
| Flash, Tengyur 50 | +0.12 [+0.01, +0.23]; −1.0 | +0.02 [−0.09, +0.14]; −2.0 |
| Flash, T4 50 | +0.14 [+0.03, +0.25]; −6.0 [−15, +2] | +0.12 [+0.01, +0.22]; −7.0 [−16, +1] |
| Flash, Latin 49 | +0.12 [−0.03, +0.25]; +3.1 | +0.10 [−0.04, +0.24]; 0.0 |
| Lite, Tengyur 50 | +0.05 [−0.10, +0.19]; 0.0 | +0.10 [−0.05, +0.24]; −1.0 |
| Lite, T4 50 | +0.08 [−0.04, +0.20]; −2.0 | +0.06 [−0.10, +0.22]; −7.0 [−14, −1] |
| Lite, Latin 50 | +0.15 [+0.02, +0.30]; −4.0 | +0.18 [+0.02, +0.33]; −5.0 [−10, −1] |

The fidelity difference is positive in all 18 cells. The effect is about a tenth of a grade: small beside Flash − Lite (+0.21) or a corrected transcription (+0.7 to +1.8, #5695).

**Run-to-run noise** (two draws of the same request).

| | pages moving ≥ 1 grade, Lite | Flash | reversal verdict flips, Lite / Flash | byte-identical pairs, Lite / Flash |
|---|---|---|---|---|
| T 1 | 39 of 150 (26 %) | 37 of 149 (25 %) | 15 / 15 | 0 / 0 |
| T 0.2 | 14 (9 %) | 20 (13 %) | 7 / 7 | 1 / 0 |
| T 0 | 0 | 8 (5 %) | 0 / 2 | **150 of 150** / 74 of 150 |

- This answers #5568's open question: 0.2 cuts the moving pages by half or more, and 0 removes them on Lite.
- **`gemini-3-flash-preview` is not deterministic at temperature 0**: half its page pairs differ.
- Identical pairs were judged once, so their movement is zero by construction. The judges' own retest noise is the duplicate control (6 of 6 tied per packet).

**Best-of-3.**
- Cost per page, realtime: Lite $0.0078 against $0.0019 (4.2×; the Flash picker costs more than a Lite draw). Flash $0.0141 against $0.0039 (3.6×).
- The picker chose a draw the judges put on top on 114 of 149 routed pages, and one they put at the bottom on 26 of the 89 pages where the three draws differed.
- Picker lift over the mean of the three draws: +0.13 [+0.08, +0.18] on Lite, +0.08 [+0.03, +0.12] on Flash. The oracle shows the room: +0.27 and +0.20 over T1a, with reversals halved or better. This picker takes about a third to a half of it.
- Tengyur, Flash: BO3 4.17 against T1a 4.11 and T02a 4.27; reversal pages 2 of 50 against 3 of 50.

**OCR addendum: a rising temperature on pages Gemini refuses** (`ocr-retry.json`; $0.52).

| 24 refused pages (#4686) | T 0 | T 0.1 (production; added after the fact) | T 0.4 | T 0.8 | any of 0 → 0.4 → 0.8 | refused at all four |
|---|---|---|---|---|---|---|
| Lite answered | 18 | 14 | 15 | 18 | 19 | 5 |
| Flash answered | 21 | 17 | 20 | 18 | 21 | 3 |

- **The ladder adds almost nothing** (one page for Lite, none for Flash, after the first try at 0). Temperature is not what releases a refusal.
- **But the refusals are not stable.** Every one of these pages is stamped `ocr.recitation_blocked` with no text, and today one plain request answers 14 to 21 of 24. No answer was a loop. The texts were not checked for accuracy. This belongs to #4686: a re-send may recover most of these pages before any other engine is needed.

**Deviations from the registration.**
- Flash returned 429 (quota) during the first set. The run was restarted at lower concurrency, and calls that had failed on quota were sent again. No answered call was discarded.
- The registered resend rule was broken once: the page that was empty twice was sent a third and fourth time by that restart and answered. It is excluded as registered.
- A bug in `analyze.mjs` compared a rounded gain with an unrounded floor and briefly reported T02a as beating production on the routed pool (0.1007 against 0.1007). It was fixed before this write-up; the numbers above use unrounded values.
- The spend fallbacks were not needed. Batch was not used.
- OCR addendum: the sealed file lists 24 pages (20 drawn and 4 spares), and all 24 were run. The 0.1 column was added after the ladder's result was seen.

**Threats.**
- One run, AI judges, n = 150. The effect is near the size of the floor; the registered first-draw test and the two-draw contrast disagree on whether it is "shown".
- The Tengyur level here (Flash T1a 4.11) is not comparable with #5797's 4.46: this run used the general reference judge, #5797 the Tengyur's own prompt.
- The weak Tengyur sections (#6121) were not tested: no reference for them was available on this box.
- T4 and Latin replay `translate-worker.mjs`'s one-page request. Most pages are translated by the chained Batch lane in blocks of pages; temperature was not tested on that shape.
- Temperature 0 on Lite repeats itself exactly, so a retry of a failed page at 0 will fail the same way.

**Decision.** None taken here; `translate-worker.mjs` is unchanged. Recommendation on #6202: send `temperature: 0` (or 0.2; the two are not separable) from the worker and from `translate-batch-chained.mjs`, record it in provenance (#4613), and do not adopt best-of-3.

- **measure:** judged against a human reference (fidelity of meaning). **Grade:** 104 referenced books, 150 pages. **Cost:** $7.29 metered of the $10 cap (arms $6.11, picker $0.67, OCR addendum $0.52), realtime.
- **Files.** `scripts/eval/results/temp-6202-2026-10/`: `summary.json`, `analysis.txt`, `rows.jsonl` (one row per page × model × arm), `results-lite.json` / `results-flash.json` (the harness's output, references clipped), `arms/` (every draw), `picks-*.jsonl`, `aliases-*.json` (merged identical draws), `spend.json`, `ocr-retry.json`, `pages.json`. Tools in `scripts/eval/temp-6202/`. Judge packets hold reference text and stay off the repo.
- *run_id:* `temp-6202-2026-10`. *Replicated?* No.
