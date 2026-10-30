---
stage: ocr
measure: [judged, judged_vs_reference, preference]
languages: [de, fr]
scripts: [Latn]
canons: []
n_books: 183
n_pages: 183
verdict: "Preregistered 2026-10-30, before any judge call. Results are not in yet."
status: undecided
decision: "None yet. The correction-cron decision is Derek's (#7809); this test gives the measured default."
superseded_by: null
issue: [7818, 7611, 7558, 7263, 7809]
router_evidence: "none — preregistration only; the Arm P export lands with the results (#7818)"
---
## 2026-10-31 · Does the cheap correction pass help? A paired blind test on production pages and Wikisource ground truth (#7818)

PRIOR ART:
- `scripts/eval/route-judge-6740/judge.mjs`: the router's judge. `judgePrompt`, `opusCall`, `parseVerdict` and `clusterCI` are imported unchanged.
- `scripts/eval/lane-judge-sampler.mjs`: the live-lane sampler. Its pace guard, `scriptClass` and `exportScore` are imported. Its frame cannot answer H1: the lane writes only pages it CHANGED, so the sampler never sees a page the corrector left.
- `2026-10-28-lane-judge-sampler-first-run-7611.md` and `2026-10-29-judge-planted-controls-7611.md`: the conditioned first run (German +0.35 fidelity on 20 changed pages) and the planted-error validation (143/144 caught).
- `scripts/eval/flash-reread-5924/PREREGISTRATION-flash-correct.md`, `pairs.mjs`, `score.mjs`, `C-TASK.md`: the pairwise words, the X/Y key and the "worse" rule.
- `scripts/eval/harvest-wikisource-gt.mjs`: the Wikisource harvest. One flag is added: `--ref-chars=0` keeps the whole page as the reference. The default of 2,000 characters is unchanged.
- `.claude/docs/eval-design.md`: shared pages, accuracy ≠ agreement, one page per book.

Code: `scripts/eval/correction-pass-7818/` (`lib.mjs`, `frame.mjs`, `armw.mjs`, `judge.mjs`, `analyze.mjs`, `writeback.mjs`). The analysis script, `analyze.mjs score`, is committed in this PR, before any verdict exists.

**Why.** Three numbers disagree about the #7558 correction lane (lite > agy Flash-low, German and French print). The router test (#7263) accepted German 28/30 corrected pages. The live sampler (#7611) accepted German 16/25 corrected against 14/21 drafts. The sampler's paired run gave +0.35 fidelity. The sampler sees only pages the lane changed, so none of these is the population effect. The population effect is the share of all processed pages served correctly with the pass against without it. About 550K waiting German and French pages ride on that number (#7809).

### Questions

- **H1 (primary, production).** Take one page per book from the pages the lane PROCESSED, changed or not. Is the Opus judge's acceptance higher on the served text than on the Flash-Lite draft? German and French are tested separately.
  - Test: exact McNemar, the two-sided binomial on the discordant pairs, at α 0.05.
  - Effect of interest: +10 points. The 95% interval is reported against it.
  - Secondary measures: paired fidelity (Wilcoxon signed-rank) and wrong-text pages before and after.
- **H2 (model-free).** On human-proofread Wikisource pages we do not hold, does the lane's correction lower body CER and WER against the Flash-Lite draft? Measured per language by the Wilcoxon signed-rank test on paired CER.
  - Added words not explained by the draft are counted. These are words of the correction found in neither the reference nor the draft. Runs of 3 or more such words are counted as invented phrases.
- **H3 (instrument).**
  - Test-retest: 30 items judged twice, Cohen's κ on accept. This is the A-vs-A noise floor, and it runs FIRST.
  - Acceptance against CER on the Arm W texts: the AUC (an accepted text has lower CER than a rejected one), and the CER at which acceptance falls to 50% (a logistic fit, with a page bootstrap).
  - Agreement with a second judge, Gemini via agy. It is reported only and never decides anything.
- **H4 (exploratory).** Why did the router test read higher than the live lane? This compares models, CLI, mode and prompt between the lane's reads and the test. It also compares page covariates (century, draft length, draft acceptance) and records whether Fraktur or Antiqua is recorded anywhere.
- **H5 (exploratory).** The latin-blank 35/76 in `lane_judge_verdicts` is split by sampler stratum (flagged against random), by route and lane, and by script, before anyone quotes it against arm c's 18/18.

### Arm P (production)

- **Frame.** The lane's own ledger on gex45 (`/root/jobs/cli-ocr-correct/correct-ledger.jsonl`), rows dated before **2026-10-30T12:00Z**.
  - The ledger has one row per page tried, with outcome `written` / `unchanged` / `contain` / `other`. `other` is mostly the apply guard's 25% word-change refusal.
  - The copy used here has sha256 `852cf844…b323` and 27,119 rows.
  - Books in German (`/^German/`) and French (`/^French/`, French/Greek included) only. The Latin rows are the Claude fallback lane, a different route.
  - The sampler store is never the frame. Pages it already judged are skipped, so this export never double-counts them.
- **Frame shares.**

  | language | processed pages | books | written | unchanged | contain | other | changed share (pages) | changed share (book mean) |
  |---|---|---|---|---|---|---|---|---|
  | German | 18,065 | 90 | 13,868 | 680 | 26 | 3,491 | 0.765 | 0.711 |
  | French | 8,827 | 45 | 5,932 | 1,625 | 8 | 1,262 | 0.672 | 0.544 |
- **Draw (`frame.mjs draw`, seed 7818).**
  - Books are sorted by id and shuffled with `makeRng(7818 + 1)` for German and `+ 2` for French. In each book the ledgered pages are shuffled with the same stream. The first eligible page is taken, one per book, up to 60 books per language.
  - Eligible means all of the following:
    - The book is visible, has pages and is not held.
    - The page is print by `scriptClass` (print or mixed).
    - For a `written` page: the newest `page_revisions` row with reason `#7558 correction lane…` has a `next_hash` that is still the page's text, and its `data` (the draft) is a Flash-Lite read.
    - For any other outcome: the stored OCR is still a Flash-Lite read, not updated since the ledger row. The draft is the served text.
  - **French has 45 books in the frame, so n = 43, not 60.** Two books had no eligible page (5 pages not print, 1 judged by the sampler).
  - The draw ran while this file was written, to check the code. It reads no verdict.
    - German: 60 pages, 47 written, 1 contain, 12 other; 14 pages serve the draft text unchanged.
    - French: 43 pages, 28 written, 5 unchanged, 10 other; 15 serve the draft.
- **Items.**
  - Where served ≠ draft, the page gives two items: the draft (route `lite`) and the served text (route `lite>agy-flash-low` as readers get it).
  - Where they are equal, the page gives one item, which stands for both. The judge.mjs rule is that a text is judged once.
- **Population effect.** One page per book makes the sample estimate book-weighted. It is reported as is. The page-weighted effect is also reported: (changed share of the frame's pages) × (effect on the sample's changed pages), with the bootstrap interval of the second factor.

### Arm W (Wikisource ground truth)

- **W1. Harvest (`armw.mjs harvest`).**
  - Command: `harvest-wikisource-gt.mjs --wiki=de|fr --from=1500 --to=1850 --max=80 --seed=20261031 --ref-chars=0`, run at `--level=4` and at `--level=3`.
  - One page per work, from the middle 35–75% of the work, with at least 600 characters. This is the harvester's standing rule.
  - Pages are taken level-4 first, in harvest order, then level-3 pages of works not yet taken. The first 40 per language are used.
  - A work is dropped as HELD when a book in `books` (any visibility) has a year within 2 of it and shares at least 60% (and at least 2) of the first six 4+-letter title words. Drops are listed in `ws/set.json`.
  - Known biases (the harvester's CAVEAT 2) select easier pages: volunteer-chosen works, pages of 600+ characters, middle of the book, the first ~6,000 index titles before the seeded shuffle. Every Arm W number is quoted with this.
- **W2. Draft.** The production Flash-Lite request, as `realtime-ocr.mjs` sends it:
  - `gemini-3.1-flash-lite` on the paid API, through `gemini-script-client.mjs callGemini`, which meters it;
  - the live OCR prompt (`liveOcrPrompt`), temperature 0.1, 16,384 output tokens, thinking budget 0, the Commons 1800 px page image;
  - a hard cap of **$3**, counted at $0.25 / $1.50 per million tokens. Nothing other than flash-lite touches the paid API.
- **W3. Correction.**
  - The template is the lane's own: `fc-prompt.mjs`, built as `cli-ocr-lane.mjs correct` builds it. It refuses if the live prompt moved. Its content hash is recorded.
  - The read is the lane's request byte for byte: `template.split('{draft}').join(draft) + ' @./<key>.jpg'`, `agy -p --model gemini-3.8-flash-low` with `CLI_SAFE_ARGS` and the tool gate. Like `cli-ocr.mjs read`, it nudges once on a denied tool and re-reads once on a wrapper, chatter or truncation problem.
  - The served text follows `cli-ocr.mjs apply`'s correct-mode guards: UNCHANGED, CONTAIN, refusal, chatter, loop, the truncation guard, foreign script, extra headers, and the 25% word-change refusal. Where one fires, the draft is served.
  - **Deviation from the brief, declared.** `cli-ocr.mjs` is a top-level script and cannot be imported, so the call and the served-text rule are restated in `lib.mjs` (`correctionRead`, `servedCorrection`). Every guard that lives in a library is imported. Only the REFUSAL regex and the 25% word count are restated.
    - The check: `servedCorrection` was run on the lane's OWN reads, 400 seeded ledger rows. 320 had their read files and an outcome decided by the read; the rest were pages whose OCR changed under the lane, or reads no longer on disk.
    - It reproduced the ledger outcome on **320/320** (`frame/replica-check.json`: written 229, unchanged 28, other 63).
- **W4. Scoring (`lib.mjs scoreText`, normalisation fixed here).**
  - From every OCR text, these tags are removed WITH their content: header, page-num, sig, catchword, catch, meta, vocab, summary, keywords, language, script, page-type, scan-quality, columns, warning, note. Wikisource keeps running heads, page numbers and footnotes out of the page body.
  - ß and ẞ fold to ss on both sides.
  - Then `scoreAgainstReference(reference, ocr, 'latin')` (`normalizeForScript` v4): lowercase, diacritics folded, ſ→s, u/v and i/j folded, & → et, letters and digits only, line-break hyphens rejoined.
  - **CER** is the windowed CER (interior insertions charged, leading and trailing text free).
  - **WER** is `subsequenceWER`.
  - A page whose DRAFT fails the guard (WER > 0.35) has no clean reference on the image (a page offset between Wikisource and Commons, say). It is excluded from every Arm W roll-up and listed.

### Judging (`judge.mjs`)

- **Absolute.** `judgePrompt` (task ocr), unchanged, with the page image as `./page.jpg`. Opus via `claude -p --model opus` on this box's subscription (`opusCall`; the env is scrubbed of API keys).
  - One text per call, so the judge never sees the other arm.
  - Items are queued in a seeded shuffle (78185), 3 at a time.
  - A call counts once parsed. A quota reply stops the run.
- **Pairwise.** Pages whose two texts differ, in both arms. Both texts are inline with the image under X/Y.
  - The order is fixed per page by `mulberry32(78182)` in sorted page-key order. The key file is opened only by `analyze.mjs`.
  - The words are C-TASK.md's (misleading / flawed / sound; prefer X / Y / tie; loser material), with the language named.
  - "Worse" (served misleading where the draft is not, or the draft preferred with a material loss) and "better" (the mirror) follow `score.mjs`.
- **Noise floor first (H3).** 30 Arm P items, 15 per language, drawn with `mulberry32(78181)`, each judged twice in separate calls.
  - κ on accept is computed and posted to #7818 BEFORE any other item is judged.
  - The first judgment of each is its verdict.
- **Controls.**
  - **Wrong-page:** 2 per language × arm. The image of one page is shown with another book's served text (`mulberry32(78184)`). A control passes when the judge does not accept it and gives fidelity ≤ 2.
  - **Planted:** 4 per language on Arm P served texts the judge accepted, one error each. The kinds B, C, D, E rotate (`plantError`, seed 78183). A plant is caught by `scorePlant`.
  - The judge is **valid for this study** when every wrong-page control passes and at least 0.80 of plants are caught (the sampler's bar). If it is not valid, H1 and H2's judged numbers are reported as invalid, not as results.
- **Second judge.** The same `judgePrompt` through agy's default model (`gemini-3.8-flash-low`), one call per item, with the JSON between markers. It covers every absolute item the pool allows. It is reported as κ against Opus and decides nothing.
  - Note: it is the same model family and tier as the corrector, so self-preference is possible.
- **Budget.** At most **650** Opus calls for the study, counted from the verdict files. Planned:
  - Arm P: 177 absolute + 74 pairwise;
  - Arm W: about 150 absolute + about 70 pairwise;
  - noise: 30; controls: 16.

  Pace: the run stops at weekly ≥ 85% or 5-hour ≥ 95% (the sampler's guard) and never probes after a limit. If the meter shows the plan will not fit, Arm P German is cut to its first 40 books in draw order, and the cut is reported.

### Analysis (`analyze.mjs score`, committed here)

- **Rules.** Wilson 95% intervals for every k/n. Page-bootstrap 95% intervals (4,000 resamples, `clusterCI`; one page per book or work, so the page is the cluster) for differences.
- **H1 supported** in a language if the exact McNemar p < 0.05 and gained > lost. Below that, the effect and its interval are reported, not "no effect". The +10-point effect of interest is reported as above, below, or inside the interval.
- **H2 supported** in a language if the Wilcoxon p < 0.05 and the mean CER difference is negative.
- **H3.** κ is reported with its n. AUC and the CER at 50% acceptance (logistic fit; bootstrap over pages, 2,000 resamples) are computed on Arm W texts with a clean reference: each draft, plus each served text the lane changed.
- **Router evidence.** The Arm P verdicts are exported in the route-judge score.json format, through the sampler's own `exportScore`, as `results/router-evidence.score.json`: served as `item` on `lite>agy-flash-low`, draft as `draft` on `lite`, with the controls.
- **Recommendation rule** for the correction cron (#7809), per language, fixed now:
  - **ON** if H1 is supported, or if H2 is supported with H1's interval lower bound above −5 points and no more wrong-text pages added than removed.
  - **OFF** if lost > gained at p < 0.05, or CER is worse at p < 0.05, or wrong text is added on at least 2 more pages than it is removed.
  - Otherwise **OFF** (no measured gain at this n; the pass spends the agy pool the first-read lane could use). The one-line note gives the interval.

### Write-back (the only production write)

An Arm P page is restored to its draft when all of the following hold:
- the lane WROTE it;
- the judge accepted the draft;
- the judge rejected the correction;
- the judge tagged `wrong_text` in the correction.

The restore uses `scripts/maintenance/revert-run.mjs --run-id <the lane run> --page-ids-file=<that page>`. That is the lane's named undo: it restores only while the page still holds the run's text, and it leaves a revision row. Nothing else is written. Wikisource pages are not ours and are never written.

### Seeds

| purpose | seed |
|---|---|
| frame | 7818 |
| noise | 78181 |
| X/Y | 78182 |
| planted | 78183 |
| wrong-page | 78184 |
| queue | 78185 |
| Wikisource harvest | 20261031 |
| bootstrap | 7818–7822 |

## Amendment 1 (2026-10-30, 22:00Z; Derek's notes of 20:57Z–21:18Z, which arrived after #7819 merged)

Made before any judge call on the arms it adds, and before any CER, WER, FCA or span scoring of any arm.

**What existed when this was written:**
- every preregistered absolute Opus verdict: 295 Arm P and Arm W items, plus the 30 noise-floor repeats;
- 290 of 295 second-judge (agy) verdicts;
- 25 of 114 preregistered pairwise verdicts;
- no controls;
- PERO drafts of the Wikisource pages, still being made.

Severity outcomes computed from those verdicts are allowed, because the judge output already carries severity. Everything below is reported **apart** from the preregistered outcomes. Code: `lib.mjs` (`severityScore`, `spanSeverity`, `fca`, `servedArmc`), `armw.mjs gpu-collect | gpu-correct`, `judge.mjs items` (arm WG), `analyze.mjs` (`amendment_1`).

**A1. Severity from the judge's own tags.** Every arm and route (Arm P draft / served; Arm W lite, lite+correct, gpu, gpu+correct).
- **(a) Severity-weighted error per 100 words.** MQM-style weights are applied to the judge's defect severities: cosmetic 1, misleads 5, wrong_text 25. Freitag et al. (2021) weight a minor error 1, a major error 5 and a non-translation 25; 25 is their non-translation weight, not a "critical" one (RELATED-WORK-SOURCES.md). Words are the judged text's whitespace tokens holding a letter or digit, tags removed.
  - Reported as paired differences, with page-bootstrap 95% CIs (one page per book or work) and the Wilcoxon signed-rank test.
  - Sensitivity sets: 1/5/10 and 1/10/100.
- **(b) Share of pages with ANY wrong_text, paired.** Exact McNemar.
- **(c) Made worse, by severity.** Pages where the correction has more wrong_text, misleads or cosmetic defects than its draft. A correction that ADDS a wrong_text defect is listed page by page, apart.

**A2. Model-free severity of every reference diff (Arm W).**
- **Alignment.** The text and the reference are aligned word by word on folded keys (`normalizeForScript` 'latin'). A span is a run of words that are unaligned or unequal. OCR-only words before the first aligned word or after the last are free; reference words missing there count.
- **wrong_text:**
  - a span with a digit on either side;
  - an inserted run (no reference words) holding a word found in neither the reference nor the draft. For the corrections, the draft is lite for lite+correct, and lite plus gpu for gpu+correct;
  - a dropped run of 5 or more reference words (a line);
  - French only: a substituted reference word that is capitalised and not sentence-initial (a name).
  - **German capitalises every noun, so names are not detected in German.** This is a declared limitation.
- **misleads:** every other substitution or insertion, and a dropped run of under 5 words.
- **cosmetic:** an aligned word whose folded key matches but whose spelling differs (long-s, ligature, case, accent, u/v, attached punctuation).
- **Score.** Severity-weighted error per 100 reference words, with A1's weights, reported beside CER.

**A3. Flexible Character Accuracy beside CER (Arm W).** An order-independent accuracy after Clausner, Pletschacher and Antonacopoulos (2020).
- The reference is cut into chunks: its lines, with a line over 120 characters cut into pieces of about 80 characters at word breaks.
- Each chunk, longest first, is matched to its best substring among the OCR characters not yet used (fitting alignment). Those characters are then used up.
- OCR characters left over count as insertions.
- FCA = 1 − (chunk distances + leftover) / reference characters, floored at 0.
- This is not Clausner's exact chunking, and it is declared as such.

**A4. Normalisation level (OCR-D).** Scoring folds more than OCR-D Level 1: long-s, ligatures and u/v, i/j, and also case, diacritics, punctuation and line-break hyphens. The German Wikisource references are word-faithful: the harvest found no long-s in any de reference. So no diplomatic (Level 2/3) score can be computed on this set, and none is claimed.

**A5. H3 on REAL errors.** On every judged Arm W text whose lite draft has a clean reference:
- the page-level confusion of the judge's wrong_text against the span rule's wrong_text;
- the judge's recall of span-rule wrong_text pages (the judge rejects the page or tags wrong_text) and its precision;
- the AUC of accept against span severity, and against CER;
- per span kind (number / invented / dropped line / name): the share of span-rule wrong_text spans the judge NAMED (a defect quote holds a word of 3+ letters of the span).

This answers #5647's warning: planted catch (143/144) is not real recall.

**A6. Agreement as κ and Krippendorff's α.** For the Opus test-retest (accept nominal, fidelity ordinal) and for Opus against agy (accept; wrong_text).

**A7. Arm W-G, the GPU route, and H6.**
- **Draft.** PERO-OCR `pero_eu_cz_print_newspapers_2022-09-26` drafts the same Wikisource images on gex45, through `scripts/batch/pero-draft.py --device=cpu`. That is the #7263 TEST's configuration. The arm-c lane uses the same model on the card, with a config that differs only in USE_CPU.
  - TAKEN: it is run directly on gex45's CPU (no cost) rather than through the GPU queue, whose order other jobs reshuffle.
  - A draft under 30 word characters is dropped, as the GPU-draft read does.
- **Correction.** The lane's GPU template (`GPU_TEMPLATE`, hash 0601ef30e816f7a7, checked) through the same agy Flash-low call.
- **Served text.** `servedArmc`: `cli-ocr.mjs apply`'s gpu + `--over-stored` rules, restated:
  - print only;
  - the 40% shared-words floor against the stored lite draft;
  - the long-s pass;
  - every flagged number, negation and expansion put back to the lite reading (#7567 E3 / #7695);
  - a page refused at any step serves the lite draft.
- **Rows.** Four per page: lite, lite+correct, gpu, gpu+correct. All are scored by CER, WER, FCA and span severity, and judged the same way: absolute Opus, one text per call. A text identical to one already judged for that page is not judged again.
- **Budget.** The study's 650 Opus calls stand. If W-G does not fit, it is judged in seeded queue order as far as it goes, and the cut is reported.
- **H6.** In a language, gpu+correct REACHES lite+correct when both hold:
  - the 95% CI upper bound of the mean paired CER difference (gpu+correct − lite+correct) is ≤ +0.005;
  - the 95% CI lower bound of the paired accept difference is ≥ −10 points.
- **Fraktur rule.** If raw PERO's median CER on a language's pages exceeds 0.25, the engine is recorded as unable to read that language's type. Most German Wikisource pages of 1500–1850 are Fraktur, and typeface is not recorded per page. H6 is then reported for the other language.
- **Arm P GPU comparison: not possible.** Production has arm-c-written pages only in Latin (103) and Italian (102), and none in German or French (Mongo `ocr.pipeline = gpu-agy-correct-lite-7567`, 2026-10-30). This is recorded as a result.

**A8. Not done.** The ICDAR 2019 post-OCR benchmark arm (optional) is listed as future work.

**A9. Docs.** `scripts/eval/correction-pass-7818/METHODS-REVIEW.md` and `RELATED-WORK-SOURCES.md` are Derek's review, committed with each kept citation checked against the paper itself. A citation that could not be opened is dropped.

## Amendment 2 (2026-10-30, 23:50Z; Derek's note of 23:30Z: align, do not duplicate)

**What existed when this was written:**
- every preregistered verdict: absolute, pairwise and controls;
- the W-G absolute verdicts, about 130 of 137;
- the agy verdicts.

`analyze.mjs score` had run once, at about 23:20Z, for the preregistered outcomes. Its `amendment_1` block was written to disk but not read. No severity outcome had been looked at.

**B1. The severity unit is #7824's.** Defects per 1,000 words, by class (misleads, wrong_text), counted as PR #7824 counts them (`scripts/eval/route-judge-6740/defect-rate.mjs` `words()`, job defect-rate-6740). That way the router and this paper use one unit.
- Per arm and row: the pooled rate (Σ defects / Σ words × 1,000), with a page-bootstrap 95% CI (4,000 resamples; one page per book or work).
- Paired: the per-page rate difference (corrected − draft), with its CI and the Wilcoxon test.
- `words()` is restated in `lib.mjs` (`words7824`) because #7824 is not on main yet. It is to be replaced by the import when #7824 lands.
- #7824's gamma-Poisson model is not re-fitted here.
- **A1(a)'s MQM-weighted score is now the sensitivity analysis**, not an outcome.
- The MQM mapping is the one in `.claude/docs/quality-rubric-and-sampling.md` §3.1: cosmetic → minor (1), misleads → major (5), wrong_text → critical (25). These are the 0-1-5-25 defaults of Lommel et al. 2024. A1(b), any wrong_text paired, and A1(c), made worse by severity, stand.

**B2. Rubric and level names come from `quality-rubric-and-sampling.md` (#5984).** In its §4.2 terms, A4's scoring fold is **"Level 1 + case/punctuation + diacritics"** (the #5939 fold, `normalizeForScript` v4). It is not called Level 1:
- diacritics are folded, which the rubric never folds;
- ſ read as f stays an error (f ≠ s).

The Wikisource references carry no ſ. So no Level 2 CER is possible on this set, and the table says so.

**B3. Cross-family judging.** PR #7807 (judge-compare-7611; Gemini vs Opus as the lane judge, preregistered, results pending) is the measure of cross-family agreement. This study's Opus-vs-agy κ/α is reported only as a figure on these items, to be read beside #7807's when it lands.

**B4. H5 check (Derek's hint).** Read-only, `lane_judge_verdicts`, 2026-10-30. All 74 latin-blank item records (72 with a verdict) are:
- in the **flagged** stratum (drawn because the corrector changed ≥ 27% of the PERO draft);
- from 4 books;
- on route `pero>agy-flash-low-written` (lane `pero-agy-first-read-7701`);
- written 2026-10-29 23:43Z – 2026-10-30 00:37Z, **after** #7567 / #7695 (the put-back fix) merged at 2026-10-29 20:46Z.

So 35/72 is a check-flagged, post-fix, 4-book sample. It is not a random-draw rate and is not comparable to arm c's 18/18.

**B5. Prior paired result, cited.** #7269 / #5924: Flash-low correction of Latin lite drafts, misleading 100 → 30 pages, 11 pages worse.

## Results

Not yet: they are added below this line after judging. Preregistered and amended outcomes are reported apart.
