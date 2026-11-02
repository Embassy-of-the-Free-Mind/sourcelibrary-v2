---
stage: ocr
measure: [judged, agreement]
languages: [la, de, fr, it, ar, he, zh, lzh, bo]
scripts: [Latn, Arab, Hebr, Hani, Tibt]
canons: []
n_books: 0
n_pages: 0
verdict: "Preregistered; no result yet."
status: undecided
decision: "Pending. Changes how the all-books transcription QA pass (#7896) is run: which detector and which accept rule."
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
