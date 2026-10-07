## 2026-10-07 · Temperature and best-of-3 for translation, against published references (#6202)
<!-- PRIOR ART: scripts/eval/xlref-t1 — reused (arms.mjs: the production request replayed to files; its page set and references). Also reused unchanged: scripts/eval/translation-vs-reference/ (JUDGE-PROMPT.md, build-packet.mjs, score.mjs), the #5695 T4 set (2026-10-03-translation-vs-reference-t4-hebrew-arabic-persian-5695.md, which measured the temperature-1 noise floor), the Tengyur 84000 set (2026-10-04-tengyur-stored-draft-vs-84000-5797.md) and the margin rule of 2026-10-04-routing-eval-tool-replay-5828.md. No earlier run had temperature or best-of-N as an arm (2026-10-01-chinese-skqs-followup-5568.md: "Worth its own run"). -->

**Status: PREREGISTERED 2026-10-07, before any paid call. Results are filled in below the line "Results" after the run; the design above it is not edited afterwards (deviations are listed under "Deviations").**

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

*(to be filled in after the run)*
