<!-- PRIOR ART: src/data/quality-methods.json (the public /quality/methods register: what each instrument asks and what it is blind to, not whether it has been shown to measure that); .claude/docs/eval-design.md (the rules a measure must follow: accuracy ≠ agreement ≠ stability); .claude/docs/invariants/measurement-instruments.md (incident-shaped rules for instruments); .claude/docs/page-error-taxonomy.md (the defect classes); .claude/docs/quality-statements.md (how to say a number to readers). None of them grades each measure we actually report against those rules, with evidence. This file does that, and nothing else. -->

# Measurement validity: does each quality number measure what it says?

**Read this when** you quote, chart or act on a quality number (CER, "serious", "invented", "readable", a gate verdict, a detector count), add a new one, or change how one is drawn or scored. The rules live in `eval-design.md`. This file is the audit of each measure against those rules, with evidence and the cheapest fix.

**Status.** Audit of 2026-10-11 (#6203, job measure-validity-6203). Verdicts are as of that date. When a fix lands, update the row and its date. Do not delete a row.

## Verdict scale

| verdict | meaning |
|---|---|
| **valid** | Measures the stated construct, and a by-eye read agrees with it (n given). |
| **valid-with-caveat** | Measures the construct, but a named limit (frame, unit, lumping, scope) changes how the number may be read. |
| **proxy-only** | Measures agreement, stability, coverage or a model's self-report. Usable as a screen or worklist, never as quality. |
| **unvalidated** | May measure the construct, but nothing has checked it: no by-eye read with n, no positive control. |
| **misleading** | As shown or quoted, a reader would draw a wrong conclusion. |

**Read every verdict with this caveat.** "By eye" below and in every study cited here means a Claude model reading the page image, not a person. **No measure in this file has been checked by a human reader (#5406: 0 verdicts).** So "valid" means "a careful model read of the image agrees". That is the strongest check available, and it is not a human reference.

## The $0 checks run for this audit (2026-10-11)

Evidence: `scripts/eval/results/measure-validity-2026-10-11/`. Experiment entry: `scripts/eval/experiments/2026-10-11-measure-validity-byeye-checks-6203.md`.

**1. Dashboard served-text CER, 3 strata × 10 pages.** Pages were taken at fixed rank positions across the stored-CER range of the #6388 panel. An Opus subagent, blind to the CER, scored each page against its image.

| stratum | Spearman (CER vs by-eye CER) | worst 3 by CER | worst 3 by eye |
|---|---|---|---|
| latin-print | 0.64 | la04 (34%), la05 (8.4%), la07 (5.4%) | la01, la07, la04 |
| zh-manuscript | 0.40 | zh04 (72%), zh05 (20%), zh07 (11.5%) | zh04, zh05, zh03 |
| english-print | 0.47 | en04 (100%), en05 (69%), en07 (7.0%) | en04, en05, en02 |

- **Catastrophes rank right.** Every page the eye scored severity ≥4 (empty page, text cut off at 35%, invented hexagram diagram) is in the top 2 by CER.
- **Below about 10%, CER ranks conventions, not errors.**
  - la04 is the worst Latin page by CER (34%). Its print is accurate; only handwritten marginalia are guessed.
  - la05 (8.4%) is exact. Its footnote abbreviations are expanded.
  - zh07 (11.5%) and zh01 (7.0%) are exact: a running header is untranscribed, or the denominator is two columns.
  - en07 (7.0%) is exact.
- **CER is blind to numbers.** en02 is a 60-row numeric table with about 22 wrong cells (a row of 18s read as 17s), and its CER is **0**. `normalizeForScript(…, 'latin')` (`scripts/eval/lib/metrics.mjs:410`) keeps letters only: digits, punctuation and table markup are stripped, so this page scores on 38 letters. Every Latin-script CER in the project shares this normaliser: the dashboard, `ocr-benchmark-evidence.json`, `ocr-pareto.json`, `quality-by-language.json` and the #6388 results. Wrong numbers, the error class #6203 step 0 calls most salient, are invisible to all of them. Text past 6,000 characters is also unscored (`MAX_CHARS`, `panel-key.mjs`).
- **The stratum mean is mostly a failure count.** English print's mean of 13.4% comes from 6 of 30 pages with CER ≥ 30%. The two of those read here are an empty page and a page cut off at 35%. The other 24 average 0.4%.

**2. #5826 quality gate, 10 pages re-read** (8 with recorded findings, 2 recorded clean).
- **10/10 overall agree.** Of 16 claims: 13 confirmed, 1 partly confirmed, 0 refuted, 2 not checkable (English withheld).
- The partly confirmed claim is the Hebrew MS (O1, "invented"). It is a line-aligned reading with about half the words wrong, not free invention. The blocking label is still right; the class name is not.
- The gate **under-calls** list and catalogue losses:
  - a dropped handwritten entry, not recorded;
  - a lost bibliographic entry whose imprint is attached to the wrong author, rated minor;
  - binding-abbreviation glosses invented on p36, the same T10 class the gate flagged on p35, not recorded.
- The gate's precision holds; its recall on minor classes is partial.

**3. #6420 convergent review, 10 adjudications re-read blind** (4 keep, 3 residual, 3 contain).
- The re-reader's serious / not-serious call on the stored text matched the adjudicator on **8/10**, and the outcome matched on 8/10.
- **One miss (c07, Fludd plate).** The stored text adds five labels that are not on the plate ("Sulphur", "Argentum vivum", …). The adjudicator called neither text serious.
- **One stricter call (c10).** The adjudicator contained the page; the re-read found the CLI text usable.
- The re-reader is also Opus, so this is an upper bound on agreement, not independent validation (#6338 measured Opus–Gemini Pro κ −0.13).

**4. Coordination.** The list of measures that inflate "invented" (job invented-qual-6420, comment on #6203, 2026-10-11) is used below, not redone. A uniform by-eye draw of 40 served pages found invented content on **0** (Wilson 0–8.8%).

## The verdict table

The columns follow the brief:
- **(a) construct**: reader-facing, or a proxy?
- **(b) sampling**
- **(c) instrument and controls**: "+ctl" = a positive control (planted or known-bad); "−ctl" = a negative control (A-vs-A or known-good).
- **(d) lumping**
- **(e) served vs stored**
- **(f) by-eye evidence, with n**

### OCR and translation quality

| measure (where shown) | verdict | evidence (a–f) | cheapest fix |
|---|---|---|---|
| **Served-text CER by stratum** (`/admin/quality` 1a, `trends.mjs measureStoredText`, #6388/#6429) | **misleading** | (a) Agreement with an AI-consensus key (G, S, O readers), OCR only. (b) Seeded, 1 page/book, 30/stratum, no `$sample`. (c) Key includes a Gemini reader scoring mostly-Gemini text. −ctl: A-vs-A band. +ctl: none on the live key; the 10 hand-key pages were never keyed. (d) One capped number: an empty page, a wrong leaf and a long-s convention all count as CER. Digits are dropped. (e) Daily re-measure ignores holds and withheld pages. (f) This audit: Spearman 0.64 / 0.40 / 0.47. Catastrophes are right. Of the 9 "worst 3 by CER" slots, 3 are pages the eye found exact (la05, zh07, en07), and la04 is accurate print with guessed marginalia. A 22-wrong-cell table scores 0. | Report two numbers per stratum: the **failure rate** (empty / refusal / CER > 0.3) and the **median CER among text pages**. Add a digits-and-numbers channel (same alignment, digits kept). Land the adjudicated key (#6440). Key the 10 control pages by eye ($0). |
| **Served-text CER, today's config** (1b, `rerun-config.mjs`) | **misleading** | Same instrument as 1a. About $0.20/month. | Same as above. |
| **Monthly translation corpus audit** ("14.3% major", `/quality/methods`, `/admin/quality`; #5301) | **valid-with-caveat** | (a) Judged: Opus rates the English against our transcription with no image, so a wrong leaf or a faithfully translated misread passes. (b) Seeded, 1 interior page/book, post-stratified. Frame `visible ≠ false` (looser than canonical); truncation at page ends unscorable by design. (c) Opus judges Gemini output (cross-family). +ctl swap 15/15, drop 15/15; −ctl repeat 15/15 within one point. (d) "Any major" lumps omission, invention, reversal and wrong page. Of 45 "invention" flags, 6 were real fabrication. (e) Withheld pages are not filtered. (f) Model read of 20 pages: 20/21 flags confirmed, 2/20 on the wrong leaf. Human n = 0. | Show the image to the judge (the spot-check reviewer already does), or pair each run with a 10-page image read. Split "major" into the taxonomy kinds. Use the canonical live filter. |
| **"Rated 4–5 by a model judge"** (89% headline; by-language column on `/quality`, `/research/quality`) | **valid-with-caveat** | Same instrument as the monthly audit. The paper and grid label it "model judgement, not accuracy". The Latin and Chinese OCR cells in `quality-by-language.json` are stale (built 2026-10-01: Latin 3.7% vs 6.8% in the current evidence table). | Regenerate `quality-by-language.json` on a schedule, or have the grid read the evidence table live. |
| **Image-and-book spot check** ("21 of 91 serious", #5914) | **valid-with-caveat** | (a) Reader-facing: Opus reads each page against its image. (b) Month 0: 30 books of **any visibility**, 3 consecutive pages each, so 30 observations, not 91. `draw.mjs` still admits pages numbered ≤ 0. (c) No +ctl, no −ctl. Opus vs Opus κ 0.85–0.92 (`reruns-6174/agreement.md`); Opus vs Gemini Pro κ −0.13, α 0.02 (#6338, 16 pages). (d) "Serious" lumps reversal, invention, dropped passage, wrong leaf and wrong number. (e) Includes hidden books. (f) Human n = 0. | Draw from served books only. Report by book. Plant 3 known-bad pages per draw (a wrong leaf, a dropped line, a flipped negation). Record the defect kind. |
| **Shelf-overview verdicts / `book_checks`** (show / caveat / fix; reader warnings #6199) | **unvalidated** | Within-family stability is high (κ about 0.9 on page flags) but class labels are unstable (Jaccard 0.55–0.67), and the reader-facing warning text rests on the class. Cross-family agreement is at chance (#6338). No +ctl. Hand-picked frames (Eternity: 107 books) are correctly called "never a rate". | Add the planted-page controls above. Make warnings name the verdict only until class labels reach Jaccard ≥ 0.8 on reruns. |
| **Reference-translation comparison** (#5695; `/quality/methods`, `/quality/pareto`, `/research/canon-quality`) | **valid-with-caveat** | (a) Judged against a published translation: fidelity, not accuracy. The register labels it `kind: "accuracy"` (`quality-methods.json`), and the synthesis says it is not. (b) Frame: works that have a published translation, so famous texts. (c) Two blind Opus judges, κw 0.79–0.92. +ctl wrong page + planted meaning change; −ctl duplicate. A-vs-A: fidelity ±0.07, but reversals swing 11–19 per 100. Claude engines in the Pareto panel are judged by Claude. (d) "Reversal" lumps negation, number, speaker and condition. (f) Human n = 0. | Relabel `kind` to `judged` (a public-copy change: Derek). **Done 2026-10-12.** Report reversals with the A-vs-A band beside them. |
| **Tengyur section quality** (reader note, `/research/canon-quality`, `tengyur-section-quality.json`) | **misleading** | The 75% "light" verdict has a negative control that is not disclosed: the same reviewers rated 84000's published human English light on 32/40 verdicts, so "light" does not separate draft from human translation at this n. Only the reversal/agent rate does, at about 2.4×. Mixed units: "38 per 100" is findings, not pages. Section rows are unadjusted; the "all" row is adjusted. Prajñāpāramitā shows 100% light, CI [100, 100], at n = 10. | Drop the light/work split from the reader note, or print the 84000 control next to it. Show reversal/agent per 100 pages with its unit. Suppress intervals at n < 20 (quality-statements rule). **Reader note done 2026-10-12:** it leads with reversal/agent per 100 pages with n and date, and the light split is gone; `/research/canon-quality` is not yet changed. |
| **Typed-edition CER** (Kanripo / CBETA / VRI, #5935; Kanripo screen on `/quality/methods`) | **valid-with-caveat** | (a) Accuracy against a human-typed edition, where the edition matches. VRI is a different edition: 68% of differences on the worst pages are edition differences. Kanripo: 40%. (b) Frames are easier than the corpus by construction (pre-screened pages only). (c) The Kanripo leaf is chosen by the page's own Dice score, which is circular. No ±ctl. (e) Includes hidden books and unserved reads. The "6.6% of 992,881 flagged" on `/quality/methods` is disagreement, filed under `accuracy`. | Choose the leaf by neighbours (as CBETA does). Report the Kanripo screen as `screen`. Run the edition-difference sort over a random 30, not the worst 30. |
| **Benchmark CER** (`ocr-benchmark-evidence.json` → `/quality` by-language, `/admin/quality` by script, `ocr-pareto.json`) | **valid-with-caveat** | (a) Accuracy against a published e-text, often another edition (Greek 109 of 121 modern; Chinese Kanripo / CBETA). It measures **flash-lite under the benchmark prompt, not served text**, and Greek has been routed to Flash since 2026-10-02. Digits are dropped (see above). (b) 1 page/book, sealed strata; 1,125 of 1,272 cells exploratory. (d) Refusals count as 1.0 inside a median. (e) Benchmark pages, not served pages. Chinese 25% here vs about 3% in #5935, never reconciled. | Label the column "engine under test" rather than "transcription". Add a numbers channel. Reconcile the Chinese gap in one experiment entry ($0). |

### Gates and reviews that act

| measure | verdict | evidence | cheapest fix |
|---|---|---|---|
| **#5826 quality gate** (`quality_gates`, NO-GO 2026-10-10) | **valid-with-caveat** | (a) Reader-facing: a session read 30 pages against the image. (b) 10 books × 3 consecutive pages, so **10 observations**. Three of the "4 of 30 invented" are one manuscript (invented-qual-6420). The draw prefers ≥ 150 characters of OCR. (c) One reader, no ±ctl; the NO-GO drill tests the brake, not the reader. (d) O1 "invented" covered a heavy misread (this audit, g01). (e) Stored lane output, not served. **This audit: 10/10 pages agree, 13/16 claims confirmed, 0 refuted.** It under-calls dropped list entries. Its wrong-language screen (171 flags) was read on 10-04 as catalogue headwords kept by house convention; its precision was never counted. | Report "k of 10 books". Name O1 sub-kinds. Exempt catalogue pages from the wrong-language screen, or measure its precision on 20 before it can block. |
| **#6420 convergent OCR review** ("43% seriously wrong on the most-read books") | **valid-with-caveat** | (a) Reader-facing per page (Opus reads the image, blind to which text is served). (b) The **most-read** books, the 10 most-opened pages each, pooled by page and unweighted. So the 43% describes those pages, not the corpus. (c) One Opus read; the CLI second read and one auditor are Gemini, the same family as the stored text. No +ctl, no A-vs-A. (e) Frame has no `hidden` check and no withheld filter. (f) This audit: 8/10 adjudications agree (Opus on Opus). One missed set of invented plate labels. CER < 0.01 is not acceptance (12/30 needed a fix). | Report by book. Plant 3 known-bad pages per adjudication batch. Add `hidden ≠ true` to the frame. Keep the "most-read pages" scope in every quotation of the 43%. |
| **Pre-translation gate** (#5915, live) | **valid-with-caveat** | (a) Proxies: image size, fragment share, structural rules. (b) A seeded page from each of 14,000 books. (c) Precision: 26/30 refusals unreadable (model read); recall not measured. +ctl: 3/4 known cases. (e) Hidden books included. A fluent misreading is invisible to every rule (by design). | Measure recall on 20 known-unreadable pages ($0). |
| **Invented / fabrication rates** (5 of 30 books #5914; 15.7% "invention" on `/admin/quality`; O1 counts) | **misleading** | One word for at least six kinds: repeat-count off by one, the previous page repeated, a failed read of cursive, show-through, a misread, a gloss. Only 2 of 16 cited pages are text with no basis on the leaf. Rates come from flagged pages (#6388: 37% on tables = among the 0.3% the screen flagged), consecutive pages counted as independent, and unserved pages counted. Uniform by-eye draw of 40 served pages: **0 invented** (Wilson 0–8.8%). `/admin/quality` maps the text-only judge's flag to O1 / I1, classes it cannot observe, so "wrong page 0%" reads as measured. | A typed vocabulary in every verdict writer (`recordBookCheck`, the gate, the audit): `confabulation`, `recitation`, `wrong-leaf`, `carryover`, `show-through`, `misread`, `invented-gloss`. Every verdict records served / withheld / no-English. Drop the flag→O1/I1 mapping for text-only judges. |
| **fabrication-detector.mjs** (#4523) | **proxy-only** | Agreement between two specialist engines and the vision model. It judged 56 of 349 pages. +ctl 51/51 recitation pages; −ctl 0/5 print. The classes differ in script and engine, so the controls do not isolate the construct. | Use only as a worklist. Test on 20 Tibetan manuscript pages known to be clean. |

### Detectors and guards

| measure | verdict | evidence | cheapest fix |
|---|---|---|---|
| **Paddle table-overrun "strict screen"** (#6388) | **proxy-only** | Measures repetition, not invention. Precision 80/495 (16%) on an Opus pass: 37% on tables, 4% on prose. Only 10 confirmed on a second call. Code lives outside the repo. Recall not measured. | Move the screen into the repo with fixtures. Count the confirmed 10, not the 80. |
| **Blank-leaf guard** (#4149) | **valid-with-caveat** | Refuses ≥ 300 characters on < 0.4% ink. It is wired only into `batch-collector.mjs`; realtime, CLI, Paddle and Kraken lanes skip it. Calibrated on 6 fabrications; refusal precision not measured. It quarantined the OCR but left 43 English pages derived from it (invented-qual-6420). | Add it to `ocr-write-paths-guarded.test.ts`. Withhold derived English in the same step. |
| **Markup-leak census** (#5700) | **valid** | Precision 37/37–40/40 per class. Caveats: census and fix share one function, so the count cannot check the fix. Snippets, embeddings and exports still serve raw text. The headline 72,191 includes classes invisible in the reader. | Quote the reader-visible classes only (≤ 31,234 pages). |
| **Negation-flip candidates** (#6184) | **proxy-only** | A worklist. +ctl 2/2, no −ctl. Majority repair is right 9/10 when adding a mark, 6/12 when removing one. | Gate removals on the image read, never on the vote. |
| **first-ocr-guard** | **unvalidated** in production | Not imported by any production writer. Tibetan calibration (model read): 17/19 flagged were invented; 0/26 clean pages flagged. | Wire it, or say it is eval-only. |
| **Chatter guard** (#6293 / #6412) | **unvalidated** | The reference set is the guard's own regex (circular). False positives on genuine first-person translations not measured. | Run it on 50 random stored translations, read the flags ($0). |
| **Page-integrity walk** (#5059; "about 45% real" on `/quality/methods`) | **misleading** | Of the 20 page-number breaks hand-read, 9 were real, and most of those were duplicates the duplicate check missed. Only 4/20 were missing pages, the construct the headline names. Other classes: duplicates 20/20, partial echo 3/20, catchword 1/20. | Quote per class. Change the headline to "4 of 20 breaks are missing pages" (public copy: Derek). **Done 2026-10-12.** |
| **Rights screen** (#4809) | **valid-with-caveat** | Precision 49/146 (34%), and every positive was then read before hiding, so the action is valid while the screen is a worklist. Reads OCR front matter, not the image. 18,260 non-IA books not screened. | Say "screen + by-eye confirmation" where the count is quoted. |
| **Wrong-language screens** (5 scripts; gate screen) | **proxy-only** | No canonical one, and none in the register. They read the OCR's self-reported tags, which are wrong in about 22/78 books (O16). The gate's screen (171 flags in the window) was read as catalogue headwords; precision never counted. | Pick one (`english-translation-check.mjs` has the best controls), and retire or label the rest. |
| **Loop / repetition detectors** | **valid-with-caveat** (OCR) / **missing** (translation) | The OCR guard has 15 tests with must-pass negatives. About 17% of refusals sit where real refrains live. The translation-side shape (#4334: one token repeated 5,758×) has no detector. | Add a token-run detector for translations (#4334). |

### Counts, images and money

| measure | verdict | evidence | cheapest fix |
|---|---|---|---|
| **`readable_in_english`** (homepage 20,220; reach series) | **valid-with-caveat** as coverage | Measures that ≥ 90% of translatable pages carry *any* English. It is coverage, not quality: loops and wrong-leaf English count. 20,220 on 2026-10-11 vs 14,852 on 2026-09-30, with no recorded explanation for +5.4K. The homepage figure links to `has_translation=true` (`pages_translated > 0`), a larger set. | Record the cause of the jump in `translation-state.md`. Point the link at the readable filter. Never call it quality. |
| **Other "translated" counts** (7 live definitions) | **misleading** | Seven definitions, 11,022–19,880 apart (`translation-state.md`). `homepage_stats.verification_coverage.readable` (23,258) is actually `pages_translated > 0`. | Rename the field. Route every surface through `READABLE_IN_ENGLISH_FILTER`. |
| **First-translation count** (homepage / about / census 4,961) | **misleading** | Gated on `pages_translated > 0`, not readable: 384 of 4,961 are below the readable rung. 670 carry strong or moderate evidence. Single-pass verifier "found" contradicted on 19.8%. | Gate on readable and show "verified" (181 / 670) separately. A public-copy change (Derek). **Gated on readable 2026-10-12** (4,961 → 4,578 that day); "verified" is not yet shown. |
| **Canon-gap figures** (#5513, `/research/canon-gap`, `/quality` canon table) | **valid-with-caveat** (coverage) / **misleading** (quality) | Counts hidden books: Derge Tengyur shows 196 "readable" with 0 live; Mongolian Kanjur 108 books, all hidden. "Typed by people" includes manual edits. Quoted Tengyur error rates differ tenfold (2–5 vs 38 per 100). | Add a live / hidden split column. Quote one Tengyur rate, with its unit. |
| **`scan_quality` / `gallery_quality`** | **misleading** | `gallery_quality` scores content type, not image quality: a pelican bookplate scores 0.85–0.95 (656 public rows; 230 books' only gallery image). Volunteers see the AI score before rating. `illustrationCount` (234,957) is unfiltered. | Hide the AI score from raters. Score the bookplate class down. Apply the live filter to `illustrationCount`. |
| **Paid-vs-got / bill coverage** (`/admin/quality`, `/admin/spend`) | **valid-with-caveat** | "Paid" is our price table; "got" is pages written, not served. Bill coverage 87.7% (week of Sep 27); grounding charges have no meter field. `billCheck` has no unit test. A batch-check +ctl and −ctl exist. | A unit test for `billCheck` with a known receipt week (#4599 reconciled August to $0.01). |
| **`/experiments/ocr-quality` judgments** | **unvalidated** | The AI judge is prompted with up to 10 human judgments as "calibration", then pooled with them. One book; ties dropped; sequential ELO. | Keep human and AI tallies separate, and stop priming the judge. |
| **Error ladder** (`quality-error-ladder.json`) | **valid-with-caveat** | An illustration, n = 9 rungs, read by eye. Script is confounded with level. The cited source file name does not exist. | Fix the citation. Label it an illustration. |
| **Reader feedback themes** | **valid-with-caveat** | Self-selected, keyword-themed; the page says "not a rate". | — |
| **Readers of the original** (#5406) | **not run** | 0 verdicts. The MCP review-shift pool is served by `$sample` with no known-answer pages. | Seed 1 known-answer page in 5 into the shift pool. |

## What repeats across the table

1. **No human reference anywhere.** Every judged rate, gate and "by eye" read is Claude (mostly Opus). Within-family agreement is high (κ about 0.9); cross-family agreement is at chance (#6338). A validated measure here means a model agrees with a model.
2. **One label for harm-different things.** "Invented", "serious", "major" and "reversal" each pool kinds a reader experiences very differently. The fix is one shared vocabulary in the writers (`recordBookCheck`, the gate, the audit), taken from `page-error-taxonomy.md`. *Landed 2026-10-12 (#6203): `scripts/lib/review-vocabulary.mjs`, `.claude/docs/review-vocabulary.md`: kinds, exposure on every verdict, rates as k of n books with served text as the headline.*
3. **Pages as observations.** The gate (3 per book), the spot check (3), convergence (10) and shelf-overview (4) quote page rates. Quote books.
4. **Frames that are not what the number implies.** Most-read pages (#6420), flagged pages (#6388 tables), famous texts (#5695), easier references (#5935), any-visibility books (#5914, #5935, canon-gap). The number is right about its frame; the quotation drops the frame.
5. **Positive controls are rare outside the judged-translation studies.** The cheapest one, for every reader-facing review, is 3 planted pages per batch: a neighbouring leaf, a dropped line, a flipped negation. The reviewer must catch all 3 before its verdicts count.
6. **The CER normaliser drops digits.** Any CER-based claim about numbers, dates or tables is currently unmeasured. *Repaired 2026-10-12 (#6203): `normalizeForScript` v4 keeps digits in Latin-script text, `digitChannel()` reports them apart, and the dashboard shows failures, the median over pages with text, and digits wrong per stratum. On re-scoring, only the `ref-pinned` / `ref-ws` tiers shared the normaliser (the whole-page benchmark already kept digits) and no figure moved by 1 pt: `scripts/eval/experiments/2026-10-12-cer-digits-kept-6203.md`.*

## The three measures most in need of repair

1. **The served-text CER on `/admin/quality`** (Derek's daily read). It is wrong about which pages are bad below 10%, blind to numbers, and its mean is a failure count. Fix: failure rate + text-page median + numbers channel, then the adjudicated key (#6440) and the 10 hand-keyed controls. Cost $0 (code + 10 pages by eye).
2. **"Invented" / "serious" as single labels, quoted from flagged or clustered samples.** These drove the impression that invention dominates, against 0/40 on a uniform draw. Fix: the typed vocabulary + served/withheld field in `recordBookCheck` and the gate, and "k of n books" reporting. Cost $0.
3. **The Tengyur reader note and canon-quality figures** (reader-facing). The 75% "light" verdict does not separate our draft from 84000's human translation (32/40 light), and readers are not told. Fix: drop or contextualise the light/work split; lead with reversal/agent per 100 pages with its unit. A public-copy change for Derek. Cost $0.

## Proposed validation runs (cost)

| run | what it validates | cost |
|---|---|---|
| Hand-key the 10 #6388 control pages (`control-set.json`) by eye, compare with the AI-consensus key | dashboard key accuracy | $0 (CLI / subscription) |
| Re-score the 90 panel pages with digits kept (`normalizeForScript` variant), list pages whose rank moves | number blindness | $0 (local) |
| 3 planted pages per batch in the spot check, shelf-overview, gate and #6420 adjudication | reviewer recall | $0 (subscription) |
| Opus vs Gemini 3.8 (CLI) on the same 30 #5826 / #5914 pages, κ per class | cross-family reliability | $0 (CLI) |
| 20 known-unreadable pages through the pre-translation gate | gate recall | $0 (local) |
| Chatter guard on 50 random stored translations | false-positive rate | $0 (local) |
| Kanripo leaf by neighbours vs own Dice on 30 pages | circularity of the typed-edition CER | $0 (local) |
| #5406 volunteer reads, 1 in 5 known-answer | the first human anchor | $0 money; needs the ethics answer |
