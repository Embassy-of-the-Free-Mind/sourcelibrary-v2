# Does a Second AI Reader Earn Its Place? Calibrating Cross-Family Reviewers for Quality Assurance of Machine-Read Historical Sources

<!--
  DRAFT MASTER (markdown). Issue #6338; preregistration scripts/eval/PREREGISTRATION-second-reader-6338.md.
  STATUS: method written; NO RESULT EXISTS YET. Every result sentence below is a placeholder naming the field of
  src/data/second-reader-6338.json it will be generated from. Do not type a number into this file: numbers are
  filled from that file, and every one is listed in paper/VERIFICATION-second-reader.md with its source.
  Target: a workshop short paper (LaTeCH-CLfL or NLP4DH) if only the Latin-script round is done; a long paper (CHR,
  or a journal such as ACM JOCCH / DSH) with all three scripts. Check each venue's current deadline and AI-use policy.
  Voice for any claim about text quality: .claude/docs/quality-statements.md (say "AI reviewers"; n, date, interval).
-->

**Abstract.** *(Written last, from the results.)* Digital libraries now publish machine transcriptions and
translations of historical sources at a scale no team can proofread, and increasingly check them with AI reviewers.
A single AI reviewer's verdict is only as good as its recall, which is rarely measured. We ask whether a second
reader from a different model family finds serious errors the first misses, and whether that gain is due to the
second family or merely to reading twice. On [n] pages from [k] scripts, with errors planted on [share] of pages,
findings matched across readers and adjudicated blind, we compare Claude Opus + Gemini against Claude Opus + Claude
Opus. *[Result: gain per 100 pages per script, with intervals; recall by error class; cost per confirmed error.]*
We release the pages, every reader's output, the adjudications and the harness.

## 1. Introduction

Readers of a digital library meet a page in about a minute and decide whether to trust it. For machine-read
historical sources the errors that matter most are small and fluent: a dropped negation that reverses a claim in
both the transcription and the English, a number off by a factor of ten, a sentence that is not on the leaf. On a
random draw of public books, AI reviewers reading pages against their images flagged a serious error on roughly one
page in five (the library's fortnightly spot check, *[cite experiment entry]*). Those rates, and the warnings readers
see, rest on one AI reviewer whose own miss rate is unknown.

Two runs of the same reviewer agree closely (κ 0.85–0.92 on whether a page has a serious error; *[cite #6174
entry]*), but agreement within one model is not evidence about what that model never sees. A second reader is the
obvious remedy, and a second reader from another model family is the obvious way to make it independent. It is not
free, and it is not obviously independent: the served transcriptions and translations were themselves made by
Gemini models, which raises both a shared-blind-spot and a self-preference concern.

**Contributions.**
1. A calibration design for AI reviewers of page images that separates *a different reader* from *a second read*,
   by giving the same-family second read its own arm (§3.4).
2. Per-script results: recall by planted-error class, confirmed serious errors per 100 pages, false alarms, and
   agreement against the same-model floor (§4).
3. A practical number for libraries: cost per confirmed serious error found (§4.5).
4. A methods note: synthetic tests of the evaluation harness found four defects that would each have biased the
   result without any visible failure (§3.7).

## 2. Related work

*Double keying and its blind spots.* Text-creation projects reach very low error rates by keying each text twice
and reconciling, with a proofread sample (the Text Creation Partnership); double keying fails exactly where both
keyers err the same way (Haaf, Wiegand & Geyken 2013). Our same-family arm tests the model analogue of that failure.

*AI reviewers and judges.* Language models used as judges prefer outputs like their own (self-preference bias;
arXiv 2410.21819 *[verify title and authors]*). A reviewer that cannot do the task can also answer "clean" rather
than "unable" (the library's own Flash-Lite judge case, *[cite measurement-instruments note]*). Planted errors with
known answers measure sensitivity directly, where agreement on easy cases cannot.

*Negation and numbers.* Negation is a known failure of machine translation (Hossain et al. 2020 *[verify]*); in our
corpus OCR drops negations and the English then asserts the opposite *[cite #6184]*.

*Measurement.* Krippendorff's α for agreement with missing data (Krippendorff 2011); the prevalence effect, by which
searchers miss rare targets and over-report common ones (Wolfe, Horowitz & Kenner 2005), which sets our planted share;
capture–recapture estimates of errors no reader finds *[cite an inspection-literature source]*, whose independence
assumption we test directly with a by-eye sample.

## 3. Method

The design was preregistered before any page was drawn (`scripts/eval/PREREGISTRATION-second-reader-6338.md`,
commit *[sha]*); deviations are listed in §3.8.

### 3.1 Corpus and frames
Source Library, a digital library of historical primary sources with AI transcription and translation into
English. One study per script, with the script read from each page's own text, not from catalogue metadata: Latin
script (Latin, German, French, Italian, Dutch, Spanish, Portuguese editions), Han (Chinese, Classical Chinese),
Arabic script (Arabic, Persian, Ottoman Turkish, Urdu). Books already reviewed in earlier checks are excluded,
because those reviews led to repairs. Eligible pages carry at least 200 characters of transcription and 100 of
translation, are not front or back matter or plates, and have an image that downloads.

### 3.2 Sample
One page from each of 100 books per script. A third of the books are drawn from those with a page flagged by
model-free integrity checks (truncation, echoed source, repeated blocks, hidden text, duplicate scans), and within
such a book the flagged page is chosen with probability 0.8. Every page's inclusion probability is recorded, and
rates are Hájek-weighted back to "a book at random, then a page at random". Reading order is random.

### 3.3 Planted errors
On 28% of pages a model-free procedure plants one error, five classes in rotation: a negation removed from the
English; a number multiplied by ten; a sentence from another book of the same script inserted; a middle sentence
dropped; the whole text replaced by another book's page (wrong leaf). Errors are spliced into the page's own text
so a planted page keeps its layout. 28% rather than 50% because reviewers who meet errors on half the pages learn to
over-report them, and false-alarm rates would not transfer to a corpus where about one page in six is serious.

### 3.4 Readers
Four readers read every page against its image with the same frozen brief: Claude Opus (primary), a second
independent Claude Opus run (**control**), Gemini 3.1 Pro and Gemini 3.8 Flash. Model names and URLs are removed from
what readers see; each reader runs in a sealed folder holding only the brief, the packet and its images (for Claude,
enforced by the command-line tool's restricted mode). Both Gemini models are candidates; on the Latin script
Gemini 3.1 Pro is re-run once to measure its own test–retest floor.

### 3.5 Matching and adjudication
Findings are matched across readers by a fixed rule: the same page and lane, with quotes that overlap or touch the
same sentence. Every matched issue some reader called serious is adjudicated by two AI adjudicators blind to its
source, shown only structured fields (lane, error class, quoted span) and the image; true and false planted claims
measure the adjudicators. Every disagreement between adjudicators, and a random 20 items, are settled by eye. A
further 20 pages no reader flagged are read by eye to measure errors all readers miss.

### 3.6 Measures and decision rule
Recall on planted errors per reader and class; confirmed serious issues per 100 pages (weighted, 95% bootstrap
by book); false alarms per 100 pages; Krippendorff's α. The decision is made on errors, not pages: among confirmed
serious errors the primary Opus missed, we count those the Gemini reader found and the second Opus did not (*b*)
against the reverse (*c*), and apply a one-sided exact sign test (α = 0.025 per Gemini model, Bonferroni over two),
pooled over the three scripts. A model is adopted if the test passes, the weighted **gain of Opus + Gemini over
Opus + Opus** is at least 3 confirmed serious errors per 100 pages, and its false alarms are at most 3 per 100 pages
above the primary's. The same test is reported per script. This rule replaced a page-level rule before any data was
drawn, after a simulation showed the first had 34% power at a true gain of 6.3 per 100 pages; the amended rule has
93%, with under 1% false adoption (§3.8).

### 3.7 Testing the harness
Before reading any real page the harness was run on a synthetic study whose every reported number was known in
advance (40 pages, four simulated readers, two simulated adjudicators). This found three defects and a code review a
fourth: a matching gap that merged errors in neighbouring sentences, a planter that could "invent" a sentence the page
already held, a dropped image per packet, and planted pages that lost their layout. A separate check found that the
command-line tool's tool allow-list did not confine a headless reader in our environment, while its restricted mode
did. *[cite experiment entry 2026-10-08-second-reader-harness-synthetic-check-6338]*

### 3.8 Deviations from the preregistration
Amendment 1 (2026-10-08, before any page was drawn): the decision rule above replaced a page-level rule (block 2
only, gain ≥ 5 per 100 pages with its interval above zero) after a power simulation (`second-reader/power.mjs`).
*[Any later deviation, with date and reason.]*

## 4. Results

*(Every number in this section is generated from `src/data/second-reader-6338.json`; field paths in brackets.)*

### 4.1 Readers and coverage
*[Table 1 from `scripts[].readers[]`: returned, missing, fabricated quotes, recall serious / detected, false alarms
per 100, confirmed per 100.]*

### 4.2 Recall by error class
*[Figure 2 from `scripts[].readers[].recall_by_class`.]*

### 4.3 Does a second family add more than a second read?
*[The pooled decision from `pooled.tests[]` (b, c, p, mean gain) and `pooled.verdict`. Figure 3 from
`scripts[].tests[].gain_per100` and `scripts[].second_opus_gain_per100`, against the +3 line; per-script verdicts from
`scripts[].verdict`. Figure 4 (UpSet) from `scripts[].upset`.]*

### 4.4 Agreement and the adjudicators
*[Table from `scripts[].agreement` against the Opus–Opus and Gemini retest floors; adjudicator accuracy on planted
claims and against the eye from `scripts[].adjudicators`; shared misses from `scripts[].shared_miss`.]*

### 4.5 Cost
*[Table 7 from `scripts[].readers[].cost`: cost per confirmed serious error found.]*

### 4.6 Shared blind spot and family leniency
*[H2 from `scripts[].hypotheses[].h2_*`; H3 from `h3_translation_recall` and `h3_en_score_minus_primary`.]*

## 5. Discussion
*(Written from the results. To cover: what the gain, or its absence, means for a library deciding where to spend
reading; whether the gain is in transcription or translation and what that says about shared blind spots; what the
planted classes cannot stand for; what changes on the reader-facing warnings.)*

**Limits.** No scholar is in the loop: adjudication is two model reads plus by-eye checks by non-specialists, which on
a script the checker cannot read reduce to layout, numbers and alignment. Recall is measured on the kinds of error
planted. Command-line requests are not API requests. "Serious" is the reviewer brief's definition, not a severity
rated by readers. Gemini runs are not audited for reads outside their folder.

## 6. Data and code availability
Dataset `second-reader-v1` (pages as shown, the planted-error key, every reader's output, matched issues,
adjudications), CC BY-SA 4.0 for the library's text, images by URL and sha256, the evaluation canary on every row:
DOI *[Zenodo]*. Harness, tests and preregistration: `scripts/eval/second-reader/`, `tests/unit/second-reader-6338.test.ts`.

## References
*(Each to be verified against the source before freeze; see the VERIFICATION file.)*
- Haaf, S., Wiegand, F., & Geyken, A. (2013). Measuring the correctness of double-keying. *Journal of the Text
  Encoding Initiative* 4.
- Hossain, M. M., et al. (2020). An analysis of negation in machine translation (or related title) *[verify]*.
- Krippendorff, K. (2011). Computing Krippendorff's alpha-reliability. Annenberg School for Communication.
- Wolfe, J. M., Horowitz, T. S., & Kenner, N. M. (2005). Rare items often missed in visual searches. *Nature* 435.
- arXiv 2410.21819, self-preference bias in LLM-as-a-judge *[verify]*.
- *[Capture–recapture for inspection]*.
