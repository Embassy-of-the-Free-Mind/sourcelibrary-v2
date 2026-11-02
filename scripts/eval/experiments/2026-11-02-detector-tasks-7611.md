---
stage: ocr
measure: [judged, agreement]
languages: [la, de, fr, it, ar, he, zh, lzh, bo]
scripts: [Latn, Arab, Hebr, Hani, Tibt]
canons: []
n_books: 266
n_pages: 281
verdict: "Only the strict Opus rule (S) passes the preregistered bar. It catches 60/60 plants and, against the new blind labels, finds 169/182 pages with an error that matters (0.93) at precision 0.95. That costs $0.0023 a page, the price of today's Opus judge, which finds 111/182 (0.61). The correction diff (C) is cheaper ($0.0013) and catches 58/60 plants, but finds only 0.77 of real errors on the held-out half. The re-read diff (R) flags almost every page (κ 0.27) and catches 130/140 plants. As a fixer, C made 622 changes that matter for the better and 262 for the worse, but on already-corrected Latin GPU>GEM pages it did more harm than good (9 fixed, 19 made worse). The labels come from an Opus adjudicator that saw S's review, so S's numbers have a shared-judge bias."
status: adopted
decision: "For the all-books transcription pass (#7896), run S: the same Opus call with the strict accept rule (about 237K judgements, about $552, against $520 planned). Do not use C or R as the detector. C as an automatic fixer is out of scope here; this is evidence for a Tibetan-GPU and Gemini-read correction lane, not for Latin GPU>GEM. No cron, router rules.json or book_checks change in this PR."
superseded_by: null
issue: [7611, 7896]
router_evidence: "none — a detector comparison on items whose Opus verdicts are already router evidence; it adds no route k/n"
defect_rates: "none — a detector comparison: it measures the detectors, not the routes"
---
## 2026-11-02 · Is a CORRECTION diff, a RE-READ diff, or a STRICTER Opus rule a better transcription detector than the verdict prompt? (#7611)

PRIOR ART:
- `2026-11-01-flash-tier-judge-7611.md` (PR #7918, qualitative section PR #7928): the 540 items, the stored Opus verdicts, Flash-medium/high verdicts, 267 adjudications, and the finding this test answers: Opus is lenient (at least 52 of the 158 transcription pages it passed have an error that matters), Flash at medium/high finds real word changes but invents defects and counts conventions.
- `scripts/eval/judge-compare-7611/run.mjs`: items, texts, `adjudicatePrompt`, the gated agy call, the scorer's statistics. Reused; the new arms live in `detect.mjs` beside it.
- #5313 (`two-read-garble-5313.mjs`): a re-read diff as a garble screen, AUC 0.80–0.85, precision 0.3–0.45 on Flash-lite and Flash 3. This reruns that idea on 3.8 Flash against image-checked labels.
- #7701 / #7558 correct lane (`cli-ocr-lane.mjs`, `cli-ocr.mjs read --correct-prompt`): the live correction template, `fc-prompt.mjs`, hash `0601ef30e816f7a7` (built 2026-11-02 from live OCR prompt "Standard OCR" v19.1; the same hash as `GPU_TEMPLATE`), called on `CORRECT_MODEL = gemini-3.8-flash-low`.
- #7835 (`fraktur-paired-7835/`): correct-vs-re-read as two WRITERS, judged. Here they are two DETECTORS.
- Folding: `scripts/lib/latin-diffqa.mjs` (`wordTokens`, `fold`, `classifyHunk`: long s, u/v, i/j, æ/œ, case, punctuation, hyphenation joins are LOW), `scripts/lib/tibetan-yatags-guard.mjs` (`syllableTokens`, `alignSyllables`), `scripts/lib/correction-diff-guard.mjs` (abbreviation marks), the kyūjitai/shinjitai pairs of `scripts/eval/benchmark-score.mjs` (not importable: restated).

**Question (Derek, 2026-11-02).** "I wonder if the judgement prompt works better or a correction prompt or a re-read (diff)." Which detector should the all-books transcription QA pass (#7896, about 237K judgements) run, and with which accept rule?

### Items

From #7807's frame (`results/2026-10-30/items.json`, `texts.json.gz`, seed 7611), transcription only:
- **Real: the 270 real transcription items** (GEM 90, GPU 90, GPU>GEM 90). Translation (TR) is out of scope.
- **Plants (Latin, German, French; 36 pages).** R reads each of the 36 pages once and is diffed against all 5 versions (A clean + B–E planted), so R is scored on all 144 plants and 36 clean pages. C and S take input per version, so they run on a **seeded subset of 60 planted items, 15 of each kind B–E** (first 15 per kind in `h('plantsub:7611:'+id)` order); S also judges the 36 clean A pages. This keeps the calls inside the budget.
- **Strata** (reporting): Tibetan GPU (45); Chinese GPU and GPU>GEM (86); Latin and Italian GPU>GEM (49); Gemini reads (GEM Latin, German, French, Chinese: 60); Hebrew and Arabic GEM (30).

### Arms (one page a call, with the image)

- **C (correct).** `gemini-3.8-flash-low` through `agy -p` on the default pool (the live #7701/#7558 correct lane's model: its thinking level is low). Prompt = the live template above with the stored text in `{draft}`, then ` @./page.jpg`, exactly as `cli-ocr.mjs read --correct-prompt` sends it; tool gate as there; answer unwrapped with `unwrapRead`. The corrected text is kept.
  - `UNCHANGED` = no change (score 0). `CONTAIN: …` = flagged at every threshold (the corrector says the text is not this leaf's).
- **R (re-read).** The same model and pool, the live OCR prompt (`liveOcrPrompt`, v19.1) + the `sentinels-6523` image sentence (the `cli-ocr.mjs` default), on the image alone.
- **S (strict Opus).** `claude -p --model opus` (`opusCall`, image in the workspace, Read only), `judgePrompt` unchanged except its accept question, which is replaced by: *accept is false if the candidate has ANY word-level difference from the page (a wrong word, a wrong letter that makes another word, a wrong number or numeral), ANY dropped or added word or line, or ANY wrong name, title, running title, heading or folio number, however small. Spelling conventions never fail a page: variant or old/new character forms, abbreviations kept or written out, long s written as s, u/v and i/j, ligatures, accents written or not, punctuation, tsheg and shad, line breaks, hyphenation and the library's markup.* Same output schema, same `parseVerdict`.
- **Retries:** an agy call that is unparsed, cut, or did not open the image is tried again, at most 3 tries an item; an Opus call likewise.

### Detection score for C and R

Diff of the arm's text against the stored text, word level, after folding conventions:
- **Tokens** (tag lines and `<meta>`/`<vocab>`/… blocks out, other tags out): Latin-script pages, `latin-diffqa.wordTokens` (its `fold`: ſ→s, æ, œ, u/v, i/j, case, edge punctuation), plus U+0364 combining e → umlaut; Tibetan, `syllableTokens`, with མྱ→མ; Chinese, one Han character a token, kyūjitai→shinjitai pairs plus 巳/已 and 弟/第 folded; Hebrew and Arabic, whitespace words with marks (niqqud, harakat), tatweel and edge punctuation out, Arabic alef forms folded.
- **Alignment:** `alignSyllables` on the folded keys; runs of unequal keys are hunks.
- **Conventions dropped:** on Latin-script pages, a hunk `classifyHunk` calls LOW (case/punctuation, join/split, long s), or an abbreviation hunk (one side carries an abbreviation mark and its base letters are a subsequence of the other side), is a convention and does not count.
- **Score = changed tokens per 100 stored tokens**: Σ over counted hunks of max(stored side, arm side) ÷ stored tokens × 100.

### Reference labels

- **Plants:** known. A plant is **caught** when the page is flagged at the arm's threshold; **named** when a counted hunk touches the planted span (B/C/E: a stored-side token of the plant's `after`; D: the arm side holds at least half of the dropped line's words). S: `scorePlant`, as before.
- **Real pages, existing label:** the adjudicator's accept where #7807 / #7918 adjudicated the item; else stored Opus and Flash-medium agree (every disagreement of theirs was adjudicated) and that agreement is the label.
- **New adjudication, one blind Opus call a page** on every real page where (a) any arm's flag disagrees with the existing label (C and R flag = at least one counted hunk; S flag = reject), or (b) C made at least one counted change (the fix accounting below). The adjudicator is #7807's `adjudicatePrompt` generalised from two reviews to N, unlabelled and in seeded order:
  - the stored Opus verdict, Flash-medium's verdict, S's verdict, and the earlier adjudication's `real_defects` where one exists (each as a review: accept, defects with quote/what);
  - C's and R's counted hunks, shown as **numbered spots**: the stored span and the alternative reading(s) proposed for it, unattributed (up to 40 spots a page; past 40, spots both C and R propose first, then the rest in page order; the cut is counted);
  - it answers #7807's JSON (`accept`, `real_defects` with `matters`, `false_defects`, `note`) plus `spots: [{n, page_prints: "stored" | "A" | "B" | "neither" | "unclear", matters: bool}]`, where A/B are the proposed readings.
  - **Label = this adjudication's accept** where one ran (it saw every earlier review's spots, so it reuses them); else the existing label. A page **has an error that matters** when the label is reject.
- **C's fix accounting** (the "useful pages" half): over C's counted changes on real pages, from `spots`: **fixed** = the page prints C's reading and the stored text was wrong there; **introduced** = the page prints the stored reading (C made it wrong), counted where `matters`; **convention/unclear** reported apart. Net = fixed − introduced, overall and per stratum, and pages where C's text is better / worse / mixed.

### Scoring

- **Threshold for C and R:** items split in half by `h('half:7611:'+id)` (stratified by stratum). On the calibration half, pick the threshold that maximises recall subject to precision ≥ 0.70; if none reaches 0.70, the one that maximises F1. Report recall and precision on the other half, and the reverse split as a check. A second, preregistered **secondary** threshold: score > 0 (any counted change).
- **Per arm:** plant recall (C, S: of 60; R: of 144) and named share, clean-page false alarms; recall and precision of matters-errors on real pages, overall and per stratum, Wilson and book-bootstrap 95% CIs; AUC of the C and R scores (overall and per stratum); κ against the label.
- **Baselines on the same pages, same labels:** the stored Opus verdict and Flash-medium.
- **Cost per page:** agy $/call = $0.00055 × (mean list cost of the arm's calls ÷ mean list cost of #7807's Flash-low judge calls), list cost at gemini-3.8-flash rates ($0.75/M input, $3.75/M output incl. thinking, cache read at 10%), times calls per parsed result. Opus $/call = $0.0022 × (mean list cost of S's calls ÷ mean list cost of the stored Opus noise-floor judge calls, `verdicts-opus-repeat`).
- **One named combination, CS:** C flags at its threshold, S confirms (page fails only when both say so). Recall/precision computed from the two arms' outputs; cost = C + (share C flags) × S.

### Decision rule (set now)

Among the arms (C, R, S, CS) with
1. plant recall ≥ 141/144 or the same share of their plants (≥ 59/60);
2. recall of matters-errors on real pages ≥ 0.85 (C, R: on the held-out half);
3. precision ≥ 0.70,

**recommend the cheapest per page** for the all-books pass. If none passes, say so, and say which arm is closest and why.

### Budget and stops

- **agy:** at most about 600 calls (C 270 + 60 = 330, R 270 + 36 = 306, plus retries). Read `agy -p /quota` first; stop if the default pool's Gemini weekly remaining falls below **0.15** or its 5-hour bucket under 0.30 (resume after reset), checked every 25 calls.
- **Opus:** at most about 700 calls (S 270 + 96 = 366, adjudications ≤ 270, plus retries), under `claude-pace-guard`, stop at the account's weekly 85%.
- No Argon, no paid API, no production writes (no `book_checks`, pages, router `rules.json` or cron). Outputs in `results/2026-11-02/`.

### Results (run 2026-11-02 08:18Z to 09:26Z, after this preregistration was pushed at 5655ccea9)

**Calls.**
- **agy, 663 in all**, against a budget of about 600. C made 331 calls, R made 332, all `gemini-3.8-flash-low` on the default pool. The 26 R retries were replies cut before `<<<END>>>` and are counted. The overrun of about 10% is retries.
  - C: 330/330 items answered. 40 answered UNCHANGED and 3 answered CONTAIN.
  - R: 302/306 answered. 4 items were still cut after 3 tries; they are left out (3 real pages, 1 plant page).
  - The pool's weekly remaining went from 0.615 to 0.593, never near the 0.15 stop.
- **Opus, 616 calls** (budget about 700): S made 366, all parsed, and the adjudicator 250 (248 pages, 2 retries after unparsed replies). The account stayed under the 85% weekly stop.

**Deviations, all declared and all decided from the first 34 diffs, before any label or score was seen:**
1. Chinese folding: added the Siku variant pairs of `grounding-6871/skqs-real.py` and 擧舉 栢柏 呌叫 臯皐 攷考 両兩. The ditto mark 丨 is dropped.
2. In every script, a hunk whose keys join to the same string is a join or split. This covers a dropped tsheg (ཕྱིནཔ / ཕྱིན པ) and the Hebrew maqaf. A deleted run of 3 or more tokens (4 or more Han) that the other text holds elsewhere is MOVED, not changed; an inserted run likewise.
3. Past the 40-spot cap, the order is: spots both arms proposed, then C's, then R's (C's fix accounting needs C's spots). On adjudicated pages, 1,514 of C's 1,603 spots were shown. Most of the 2,992 cut spots are R's.
4. **Introduced errors.** The adjudicator read `matters` as "does the candidate differ from the page here". So `matters` is false wherever the page prints the candidate, and the preregistered "introduced, where matters" would always be 0. Introduced is therefore counted as every C spot where the page prints the STORED reading. Counted hunks already exclude the folded conventions. This is an upper bound: an unfolded variant character counts.
5. Adjudication ran in three rounds while the arms finished. A page was planned only once all three arms had answered; the last round took the 3 pages with an R answer missing.

**Labels.** All 270 real pages are labelled: 248 by this run's adjudicator, 18 by the existing Opus = Flash-medium agreement, and 4 by an earlier adjudication. **182/270 (67%) have an error that matters.**
- The new adjudications moved 22 labels: 18 from pass to fail, 4 from fail to pass.
- By stratum: Tibetan GPU 42/45, Chinese GPU and GPU>GEM 58/86, Gemini reads 39/60, Latin and Italian GPU>GEM 21/49, Hebrew and Arabic 22/30.
- The base rate is 0.67, so the precision bar of 0.70 is only just above flagging every page. κ is reported for that reason.

**1. Plants.** C and S ran on the 60-item subset; R on all 144, plus 35 clean pages with an R read.

| arm | caught | named | by kind B / C / D / E | clean pages flagged |
|---|---|---|---|---|
| C (at threshold) | **58/60** | 56 | 14 / 15 / 15 / 14 | (not run) |
| R (at threshold) | **130/140** | 137 | 30 / 30 / 35 / 35 | **29/35** |
| S | **60/60** | 60 | 15 / 15 / 15 / 15 | 12/36 |
| stored Opus (#7807) | 143/144 | 142 | | 1/36 |
| Flash-medium (#7918) | 143/144 | 141 | | 13/36 |

- C at "any change" catches 59/60. Its two misses at threshold are one number change (B) and one inserted sentence (E). A single changed word on a long page scores under 0.22 per 100.
- R's 10 misses are number and noun swaps (B, C). R names 137/140 plants, but where the re-read otherwise agrees with the page, one swapped word scores under R's threshold of 0.55.
- The "clean" pages are pages Opus had accepted. Opus passes have real errors about a third of the time (#7918), so S's 12/36 and Flash-medium's 13/36 are not all false alarms. They were not adjudicated.

**2. Real pages, errors that matter.** C and R use thresholds picked on half 0 and are scored on half 1; the reverse split is shown beside. All others are shown on all 270 pages, with half 1 for comparison.

| arm | threshold (per 100 tokens) | recall | precision | κ | AUC |
|---|---|---|---|---|---|
| **C** held-out | 0.224 (reverse 0.143) | **68/88 = 0.77** (reverse 0.84) | 68/84 = 0.81 (0.86) | 0.42 | **0.78** |
| C, any change, all 270 | > 0 | 149/182 = 0.82 | 149/178 = 0.84 | 0.48 | |
| **R** held-out | 0.552 (reverse 0.575) | 88/88 = 1.00 (0.98) | **88/124 = 0.71** (0.77) | **0.27** | 0.81 |
| **S**, all 270 | — | **169/182 = 0.93** | **169/178 = 0.95** | **0.82** | |
| S, half 1 | — | 82/88 = 0.93 | 82/88 = 0.93 | 0.80 | |
| CS (C flags, S confirms), half 1 | — | 63/88 = 0.72 | 63/67 = 0.94 | 0.57 | |
| stored Opus, all 270 | — | 111/182 = 0.61 | 111/112 = 0.99 | 0.50 | |
| Flash-medium, all 270 | — | 161/182 = 0.88 | 161/182 = 0.88 | 0.65 | |

By stratum, all 270 pages (C at its primary threshold; R at its own):

| stratum | errors | C recall / precision | C AUC | R recall / precision | R AUC | S recall / precision | stored Opus recall | Flash-medium recall / precision |
|---|---|---|---|---|---|---|---|---|
| Tibetan GPU | 42/45 | 0.93 / 0.95 | 0.93 | 1.00 / 0.93 | 0.57 | 0.93 / 0.93 | **0.43** | 0.98 / 0.93 |
| Chinese GPU, GPU>GEM | 58/86 | 0.79 / 0.81 | 0.72 | 1.00 / 0.74 | 0.83 | 0.95 / 0.96 | 0.78 | 0.97 / 0.92 |
| Latin, Italian GPU>GEM | 21/49 | **0.62 / 0.62** | 0.71 | 1.00 / **0.53** | 0.74 | 0.90 / 0.95 | **0.29** | 0.52 / 0.58 |
| Gemini reads | 39/60 | 0.77 / 0.86 | 0.84 | 0.97 / 0.71 | 0.70 | 0.90 / 0.97 | 0.62 | 0.87 / 0.92 |
| Hebrew, Arabic | 22/30 | 0.86 / 0.86 | 0.73 | 1.00 / 0.79 | 0.90 | 0.95 / 0.91 | 0.82 | 0.86 / 0.90 |

**S is today's Opus judge with the strict rule, and it accepts a strict subset of what Opus accepted.** S passes 92 pages, every one of which stored Opus also passed (158). The 66 it removes are where Opus's recall goes from 0.61 to 0.93: Opus saw those slips and forgave them, as #7918's qualitative section found.

**3. C as a fixer** (175 real pages where C changed a counted word, 1,514 of C's spots adjudicated).
- **Fixed:** 622 spots where the page prints C's reading and the difference matters. A further 350 match the page but the adjudicator says they do not matter.
- **Made worse:** 262 spots where the page prints the stored reading (an upper bound; see deviation 4). In 87 of them R proposed the same wrong reading, which is the shape of a shared Flash misreading.
- Other or unclear: 222 and 57.
- **Net: +360 spots.** By page: 66 better, 42 worse, 44 mixed, 23 no change that matters.

| stratum | fixed | made worse |
|---|---|---|
| Tibetan GPU | **310** | 47 |
| Gemini reads | 112 | 43 |
| Chinese GPU, GPU>GEM | 146 | 123 |
| Hebrew, Arabic | 45 | 30 |
| Latin, Italian GPU>GEM | **9** | **19** |

- C found 3 leaves whose stored text is another text (`CONTAIN`): the Ruth chapter 1 substitution #7918 described, a medal legend, and a Hebrew fragment from elsewhere.
- Correcting a page that agy Flash-low has already corrected (Latin GPU>GEM) does more harm than good.

**4. Cost per page** (from tokens; the method is #7918's).

| arm | tokens in / out (thinking) | ratio to the Flash-low judge | $ per call | $ per page | 237K pages |
|---|---|---|---|---|---|
| C | 27,819 / 2,314 (1,537) | 2.28 | $0.00125 | **$0.00126** | $298 |
| R | 24,867 / 3,390 (2,658) | 2.42 | $0.00133 | $0.00146 | $346 |
| S | (Opus list $0.072 vs the judge's $0.068) | 1.06 × Opus | $0.00233 | **$0.00233** | **$552** |
| CS | | | | $0.00278 (S on the 65% C flags) | $659 |
| stored Opus | | | | $0.0022 | $520 |
| Flash-medium | | | | $0.00248 | $588 |

C costs about 2.3 Flash-low judge calls, because the stored text rides in the prompt and is written back out.

**5. Decision, by the preregistered rule.**

| arm | plants ≥ 141/144 share | recall ≥ 0.85 | precision ≥ 0.70 | $ / page | passes |
|---|---|---|---|---|---|
| C | 58/60 ✗ (needs 59) | 0.77 ✗ | 0.81 ✓ | $0.00126 | no |
| R | 130/140 ✗ | 1.00 ✓ | 0.71 ✓ (base rate 0.67) | $0.00146 | no |
| **S** | **60/60 ✓** | **0.93 ✓** | **0.95 ✓** | **$0.00233** | **yes** |
| CS | C ✗ | 0.72 ✗ | 0.94 ✓ | $0.00278 | no |

**Recommended: S, the only arm that passes.**
- The closest cheaper arm is **C**. It misses the plant bar by one item and has real-page recall of 0.77, with 0.62 on Latin and Italian GPU>GEM.
- C's score is a good ranking on Tibetan GPU (AUC 0.93), but weak where Flash itself reads poorly.
- R is not a detector at this bar: it flags 91% of pages (242/267), and its κ against the label is 0.27.

### Limits

- **The referee is Opus, and it saw S's review** (and stored Opus's and Flash-medium's) beside C's and R's spots. S's numbers therefore share a judge with the label. Stored Opus was also a review, yet the adjudicator overruled it on 71 of its passes, so it does not simply side with the Opus reviews. A non-Opus or by-eye check of a sample of S's 66 extra rejections is the next step before the book-page wording changes.
- The sample is weighted toward hard cells (67% of pages fail), so none of these rates is a library rate.
- The Tibetan κ values are meaningless: 42 of 45 pages fail.
- Plants are Latin, German and French print only.

### Recommendation for judging every book (#7896)

- **Run S:** the same `claude -p --model opus` call with the strict accept line (`detect.mjs` `STRICT_ACCEPT`). About 237K judgements, about **$552**, against $520 for the lenient rule. On these pages it finds 0.93 of the errors that matter, where the lenient rule finds 0.61.
- **Expect many more pages to fail:** 92/270 pass here, against 158. The "checked, no serious errors" line on the book page then means something closer to what it says, and fewer pages will carry it. That is public copy, so it is Derek's call.
- **Do not use C or R as the detector.** A C correction lane is worth a separate test on Tibetan GPU and on Gemini reads, where it fixed 310 and 112 spots against 47 and 43. It is not worth one on pages agy has already corrected.

**Artifacts** in `scripts/eval/judge-compare-7611/results/2026-11-02/`:
- `out-{C,R,S}.jsonl.gz`: C's corrected texts, R's reads, S's verdicts, with tokens;
- `diffs.json.gz`: the counted hunks per item and arm;
- `adjudications-new.jsonl.gz`: 248 pages, with spots and answers;
- `score.json`, `setup.json` (prompt hashes), and `runs.json` (quota readings).

Runner: `detect.mjs` (`setup`, `call`, `diff`, `plan`, `adjudicate`, `score`).
