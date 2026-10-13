# Quality rubric and sampling plan: what every quality number means, and which pages it is measured on

PRIOR ART: `.claude/docs/eval-design.md` (the measure vocabulary, registry, reference rules, decision cards; it says how a number is *stored and compared*, not what a page's grade *is* or how a corpus-wide sample is drawn and weighted), `.claude/docs/page-error-taxonomy.md` (the 44 classes, by eye, presence only, no severity scale), #5438 (quality round 1: a one-off 12-cell backlog sample with a ship rule), #4925 (decision-grade reference plan, OCR only), #3499 (the held-out reserve policy for unpublished books), #5274 / #5301 (the monthly served-translation audit this plan extends), #5914 (the monthly image-and-book arm). None of them adopts a published rubric or sizes and weights a standing sample over the whole served corpus. This doc does both and links them rather than restating them.

**Read this when:** you are about to quote a quality number, design a judge or a rubric, draw a sample for an eval, or add a figure to `/quality`. Living doc (undated). Issue: #5984. Status: **design**. Nothing here has been run. The inventory in §8 is measured; every paid step is a follow-up with a price (§9).

**Readers:**
- Derek, deciding what to fund;
- anyone running an eval, who inherits the rubric and the draw instead of inventing one;
- scholars and funders reading `/quality`, who need every number there to mean the same thing.

---

## 1. The problem in one paragraph

We publish many quality numbers: median CER per language, "rated 4 or 5 of 5 by a model judge", "pages at 4 or 5 against a published translation", "serious errors per 100 pages" (#5914), "major-defect rate ≤ 10%" (#5438). Each study chose its own scale, its own pages and its own idea of "major". So the numbers cannot be added up, compared, or tracked month to month. The samples were also chosen for convenience. References exist where reading is easiest (eval-design §11). The reader-level audit draws only text pages with at least 200 characters of OCR, so blank, title and table pages, where engines invent text (#5660 gate 0), have never been in the corpus-wide sample (§8.3). This doc fixes both. It sets **one rubric**, built from published standards, and **one sampling plan** that says which pages any corpus-wide number is measured on.

## 2. The standards, from their own published sources

Every claim below was read from the source on 2026-10-06. Where a page could not be opened, the table says so.

| Standard | What it is | Source opened | What we take | Run it, or report against it? |
|---|---|---|---|---|
| **MQM** (Multidimensional Quality Metrics) | An error typology for translation (Accuracy, Fluency, Terminology, Style, Locale, …), with a severity per error and a weighted penalty score | Lommel et al., *The Multi-Range Theory of Translation Quality Measurement: MQM scoring models and Statistical Quality Control*, AMTA 2024, [arXiv:2405.16969](https://arxiv.org/abs/2405.16969); W3C MQM Community Group, [MQM Top Level (2019-04-11)](https://www.w3.org/community/mqmcg/mqm-top-level-2019-04-11/); Freitag et al., *Experts, Errors, and Context*, TACL 2021, [arXiv:2104.14478](https://arxiv.org/abs/2104.14478). **themqm.org returned HTTP 403 to every request on 2026-10-06**, so its typology page is not cited | The severity levels and the default multipliers, the Accuracy subtypes, and the "Source error" and "Non-translation" categories (§3) | Adopt as our translation rubric. No external MQM-scored set covers our languages and periods, so there is nothing to report against |
| **ESA** (Error Span Annotation) | Annotators mark error spans as minor or major, with no category, then give the segment a 0–100 score. WMT24 used it for its human evaluation | Kocmi et al., *Error Span Annotation: A Balanced Approach for Human Evaluation of Machine Translation*, WMT 2024, [arXiv:2406.11580](https://arxiv.org/abs/2406.11580) / [ACL Anthology](https://aclanthology.org/2024.wmt-1.131/); WMT24 findings, [ACL Anthology 2024.wmt-1.1](https://aclanthology.org/2024.wmt-1.1/) | The cheap protocol for volunteer readers (§3.3) | Adopt for human readers. It is the reader-panel protocol (#5406) |
| **OCR-D ground-truth transcription guidelines** | Three transcription levels: Level 1 normalises, Level 2 keeps the printing conditions, Level 3 keeps every glyph | [Level overview](https://ocr-d.de/en/gt-guidelines/trans/trLevels.html); long s, [Level 1](https://ocr-d.de/en/gt-guidelines/trans/level_1_5.html) and [Levels 2–3](https://ocr-d.de/en/gt-guidelines/trans/level_2_und_3_1.html); [u/v, Level 1](https://ocr-d.de/en/gt-guidelines/trans/level_1_3.html); [abbreviation marks](https://ocr-d.de/en/gt-guidelines/trans/trNasalstrich.html) | The level we serve and the level we score at (§4.2) | Adopt. Our references are tagged with their level |
| **CER** (character error rate) | Edit distance between output and reference over reference length | dinglehopper, the OCR-D evaluation tool: [github.com/qurator-spk/dinglehopper](https://github.com/qurator-spk/dinglehopper) ([`character_error_rate.py`](https://github.com/qurator-spk/dinglehopper/blob/master/src/dinglehopper/character_error_rate.py): distance over NFC grapheme clusters, divided by reference length) | CER stays the transcription metric (`lib/metrics.mjs`), computed over grapheme clusters | Already run. Add the bounded companion below |
| **cMER** (bounded character error) | (S+D+I)/(H+S+D+I): insertions are in the denominator, so the rate stays in [0, 1] | Ehrmann et al., *ICDAR 2026 HIPE-OCRepair Competition on LLM-Assisted OCR Post-Correction for Historical Documents*, [arXiv:2607.08143](https://arxiv.org/abs/2607.08143) | Report cMER beside CER. Raw CER exceeds 1 on invented pages (Paddle scored 3.09 on one page in #5660), and a mean over such pages is meaningless | Adopt as a companion metric |
| **olmOCR-bench** | Per-page pass/fail unit tests: text present, text absent (headers/footers), reading order, tables, formulas, and a baseline test (no long repeated n-grams). 1,402 PDFs, 7,010 tests | Poznanski et al., *olmOCR*, [arXiv:2502.18443](https://arxiv.org/abs/2502.18443); *olmOCR 2*, [arXiv:2510.19817](https://arxiv.org/abs/2510.19817); [bench code](https://github.com/allenai/olmocr/tree/main/olmocr/bench) | The **unit-test idea** for our risky page types (§6.3): a blank page must produce no text, a title page only its lines, a two-column page its columns in order | We could run it (open code), but it measures a different population: olmOCR 2 calls it an "English-language OCR benchmark", its baseline test fails any CJK character, and its 98 `old_scans` are Library of Congress letters and typewritten pages, not early print. Report against it only when we publish an engine claim (e.g. the olmOCR-2 route for English 1600–1699, #5660) |
| **OmniDocBench** | 981 PDF pages (1,651 in the current v1.6) of 9–10 modern document types in English and Chinese. Scored by normalised edit distance (text), TEDS (tables), CDM (formulas) and reading-order edit distance. Each page is labelled with attributes such as "fuzzy scan", "watermark" and "colorful background" | Ouyang et al., CVPR 2025, [arXiv:2412.07626](https://arxiv.org/abs/2412.07626); [github.com/opendatalab/OmniDocBench](https://github.com/opendatalab/OmniDocBench) | The **page-attribute labels**. Our "damaged" stratum (§6.3) is labelled the same way: fuzzy, stained, faded, show-through, cropped | No historical category, so we do not report against it |
| **ICDAR historical tasks** | (a) Post-OCR text correction, 2019: 22M OCR'd characters with gold text in 10 European languages, detection scored by F-measure; (b) HIPE-OCRepair 2026: English, French and German print, 17th–20th century; (c) RDCL 2019: layout and text on mostly contemporary magazines, with "Flex Character Accuracy" that discounts reading-order differences | (a) Rigaud et al., [Zenodo 3459116](https://zenodo.org/records/3459116), data [Zenodo 3515403](https://zenodo.org/records/3515403); (b) as cMER above; (c) Clausner et al., [ICDAR 2019 RDCL](https://www.primaresearch.org/www/assets/papers/ICDAR2019_Clausner_RDCL2019.pdf) | cMER (b). The 2019 detection task's framing (find the wrong token before fixing it) for any post-correction lane | Their data can test a **post-correction** step, not our OCR engines: these are correction tasks over existing OCR. Report against (b) only if we propose a correction lane. The ICDAR 2017 READ handwriting data could not be verified from its own page (only a [Train-A record](https://zenodo.org/records/439807) opened) and is not cited further |

**Sampling statistics.** Sample size for a proportion, n = z²·p(1−p)/d²: [NIST/SEMATECH e-Handbook §3.3.3.3](https://www.itl.nist.gov/div898/handbook/ppc/section3/ppc333.htm) and [Penn State STAT 506, Lesson 2](https://online.stat.psu.edu/stat506/Lesson02). Optimal (Neyman) allocation, n_h = n·N_h·σ_h / Σ N_k·σ_k: [STAT 506, Lesson 6](https://online.stat.psu.edu/stat506/Lesson06); the name is from Neyman 1934 (JRSS 97(4)), as cited in [Wikipedia: Neyman allocation](https://en.wikipedia.org/wiki/Neyman_allocation). Wilson score interval: Wilson 1927 (JASA 22(158)), via [Wikipedia: Binomial proportion confidence interval](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval).

## 3. Translation: MQM severities on our error classes

### 3.1 Severities and weights

MQM's severity levels, as defined by the MQM Council authors (Lommel et al. 2024, App. A.3.2):

- **Neutral** (weight 0): "preferential changes or errors that are not the translator's fault". We log these and do not count them.
- **Minor** (weight 1): "limited impact on the usability, understandability or reliability of the content".
- **Major** (weight 5): "seriously affect the understandability, reliability, or usability … due to a significant loss or change in meaning".
- **Critical** (weight 25): "render the entire content unfit for intended purpose". The paper adds that "a single critical error automatically triggers a FAIL rating".

The weights are MQM's stated default: "The default setting for MQM is to use four severity levels, with the severity multipliers 0-1-5-25". Freitag et al. 2021 dropped Critical for WMT because its definition is "context-specific". They kept a single **Non-translation** category weighted 25, "equivalent to five Major errors", for a segment "too badly garbled" to annotate. We keep Critical, because our context is fixed: a scholar quoting a page.

**Page penalty** = Σ errors × weight, over the page, in each lane. MQM normalises per word (Lommel's "Per-Word Penalty Total"). We grade per page (§5), because the reader's unit is the page and the page grade is what we publish. The per-word figure is kept in the store for comparison with outside MQM numbers.

### 3.2 Categories: the MQM tree, and where the transcription goes

Freitag et al. (Table 10) list the hierarchy used at WMT:
- **Accuracy**: Addition, Omission, Mistranslation, Untranslated text;
- **Fluency**: Punctuation, Spelling, Grammar, Register, Inconsistency, Character encoding;
- **Terminology**: inappropriate for context, inconsistent use;
- **Style**: awkward;
- **Locale convention**: formats for dates, names and so on;
- **Other**;
- **Source error**: "an error in the source";
- **Non-translation**.

The W3C top level (2019) adds Over-translation and Under-translation under Accuracy, and a **Verity** branch for content that is wrong for its audience.

Freitag et al. say that "Source errors are ignored in our current study". That one line is why MQM alone cannot grade our pages. In our pipeline the *source* of the translation is our own OCR. A misread, an omission, or a recited canonical passage in the transcription is a "source error" to MQM, and MQM ignores it. Our worst errors (taxonomy family 1: O1, O3, O6, then T7) live there. So the rubric has **two lanes scored separately**:
- MQM on the translation **against the transcription**;
- a transcription rubric (§4) on the transcription **against the leaf**.

A third lane, **leaf identity**, is our addition (§4.4).

### 3.3 Two protocols, one scale

- **Full (judge, expert reviewer):** MQM categories and severities per error, as the source-grounded judge does today. `JUDGE-PROMPT.md` already emits `defects[]` with `type` and `severity: minor|major`. This plan adds `critical` and the MQM category to each defect.
- **Light (volunteer readers, #5406):** ESA. Mark the spans that are wrong, give each one minor or major, then give the page an overall score. The MQM-like score is −5 per major and −1 per minor (Kocmi et al. 2024, §3). It needs no category training. That is the point of ESA: it is "faster and cheaper … than MQM at the same quality level, without the requirement of expensive MQM experts". The reader's major/minor uses the same definitions as §3.1, so a reader's page and a judge's page land on the same grade (§5).

### 3.4 Our 44 classes on MQM

Each taxonomy class gets a **lane**, an **MQM home** (translation-lane classes only), and a **default severity**. The default is what a judge or reader assigns unless the instance is clearly lighter or heavier. For example, an O7 misread of a dose is major, and of a page number minor. Defaults are a judgement call made here. The calibration in §5.3 tests them.

| Class | Lane | MQM home | Default severity |
|---|---|---|---|
| I1 image one leaf away from its text | leaf | — (no MQM analogue) | critical |
| I2 duplicate scan | leaf / book | — | major (book-level) |
| I3 spread not split | leaf | — | major |
| I4 neighbour strip read as content | transcription | Source error → Addition | major |
| I5 several leaves in one photo | leaf | — | major |
| I6 pages in reverse order | book | — | major (book-level) |
| I7 catalogue identity wrong | book (metadata) | — | major (book-level) |
| O1 confabulation on an illegible leaf | transcription | Source error → Addition | **critical** |
| O2 wrong-script fabrication | transcription | Source error → Non-translation | **critical** |
| O3 canonical-text substitution (recitation) | transcription | Source error → Addition | **critical** |
| O4 block-level repetition | transcription | Source error → Addition | major |
| O5 silent omission inside the page | transcription | Source error → Omission | major (≥ 1 line), minor (a word) |
| O6 meaning-changing misread | transcription | Source error → Mistranslation | major |
| O7 numerals, dates, doses, units | transcription | Source error → Mistranslation | major (doses, dates, quantities), minor (folio numbers) |
| O8 silent normalisation | transcription | Source error → Spelling | minor at Level 2; neutral at Level 1 (§4.2) |
| O9 convention flips between pages | transcription | Fluency → Inconsistency | minor |
| O10 secondary script dropped or garbled | transcription | Source error → Omission | major |
| O11 page furniture mis-tagged | transcription | Design and markup | minor |
| O12 marginalia/apparatus dropped or merged | transcription | Source error → Omission | major if it is the apparatus a scholar cites, else minor |
| O13 later hands read as text | transcription | Source error → Addition | minor (major if merged into the body) |
| O14 described, not transcribed | transcription | Source error → Untranslated | major |
| O15 reasoning/notes inside the OCR | transcription | Source error → Addition | major |
| O16 self-reported tags wrong | transcription (metadata) | — | minor on the page; major where routing read it |
| O17 table structure invented or lost | transcription | Source error → Mistranslation | major |
| T1 translation truncated | translation | Accuracy → Omission | major; **critical** if most of the page is gone |
| T2 echoed source | translation | Accuracy → Untranslated | **critical** (Non-translation) |
| T3 translation hidden in `<meta>`/`<note>` | translation / display | Design and markup | major |
| T4 in-block drift / tail block shift | translation | Accuracy → Omission + Addition | major |
| T5 continuity leak, lookahead duplication | translation | Accuracy → Addition | major |
| T6 catchword and split-word seams | translation | Accuracy → Mistranslation | minor (major if a sentence's sense is lost) |
| T7 fluent over garble | translation | Accuracy → Addition | **critical** (prose with no source behind it) |
| T8 sense inverted, qualifier dropped | translation | Accuracy → Mistranslation | major |
| T9 quiet omission | translation | Accuracy → Omission | major |
| T10 invented scholarship in notes | translation | Verity / Accuracy → Addition | major |
| T11 parallel edition mishandled | translation | Accuracy → Addition / Omission | major |
| T12 same-language source rewritten | translation | Accuracy → Over-translation | major |
| T13 apparatus stripped | translation | Accuracy → Omission | minor (major for critical editions) |
| T14 panes from different reads | translation / display | Fluency → Inconsistency | major |
| T15 continuity meta wrong | translation | Accuracy → Mistranslation | minor |
| T16 form imposed or lost | translation | Style | minor |
| D1 unknown or broken markup | display | Design and markup | minor (major if text is hidden) |
| E1 poisoned derived metadata | derived | — | book-level, outside the page grade |
| E2 the instruments lie | measurement | — | outside the page grade; a check on the rubric itself |

Mapped classes plus "refused" (§4.4) cover every defect `JUDGE-PROMPT.md` can emit: its flags `omission`, `invention`, `inversion`, `untranslated`, `wrong_language`, `wrong_page`, `garble_passthrough`, `truncated` and `repetition` map to T9/O5, O1/T7/T10, T8, T2, O2, I1, T7, T1 and O4.

## 4. Transcription: CER at a published level, plus our checks

### 4.1 Metrics

- **CER** over NFC grapheme clusters, as dinglehopper computes it. It is the existing `lib/metrics.mjs` kernel; this plan does not add a scorer.
- **cMER** beside it, so that pages with invented text do not dominate a mean.
- **Severity-weighted errors** (§3.4) where a page is read by eye or by a judge rather than against a reference. A reference gives an accuracy number; it does not say which errors change the meaning. The by-eye lane says that.

### 4.2 The level: serve OCR-D Level 2, score at Level 2 and Level 1

OCR-D says it "recommends Level 2 for ground truth creation/transcription". At Level 2 "technical printing conditions are reproduced". Long s and round s "are differentiated" at Levels 2 and 3. At Level 1 they "are not distinguished … recorded as round-s", and u/v is written by sound ("vnd → und"). The levels page also warns that "the levels are not a seal of quality".

What follows for us:

1. **Served transcription target: Level 2.** Keep ſ, u/v and i/j as printed, and abbreviation marks as combining characters (OCR-D Level 2 writes "Uñ" with U+0303). That is what a scholar quoting the page needs. Silently expanding or modernising is O8, a minor error at this level.
2. **Each reference records its own level**, as a new `reference.level: 1 | 2 | 3 | mixed` field in the eval-design §4.1 reference record. EEBO-TCP keeps ſ (634 times on 73 pages, #5660). Wikisource editions vary. A CER computed against a Level 1 reference cannot see a Level 2 error, and the table must say so.
3. **Two CERs per cell.**
   - **Level 2 CER**: raw, against a Level 2 reference only.
   - **Level 1 CER**: after folding both texts by the Level 1 rules (ſ→s, u/v and i/j by sound, abbreviation marks resolved, ligatures split).

   This is the published standard behind #5939's "folded" column. #5939's fold also removes case and punctuation. Neither is a Level 1 rule, so that extra step is named separately ("Level 1 + case/punctuation") and is not called Level 1.
4. **Never folded at any level:**
   - **ſ read as f.** That is a misread of the glyph, not a convention (lite: 1,030 such words on 73 EEBO pages, #5660).
   - Missing diacritics, Greek accents, Hebrew points, Arabic dots.
   - Refusals and invented text.

   This is #5939's list, and it is consistent with OCR-D: Level 1 maps ſ to s; it never maps f to s.

### 4.3 Hyphenation and layout

OCR-D keeps line-end hyphenation "according to the original" at every level. Our `<page>` text joins lines, so the line-end fold (#5939) is a layout convention for us, not a reading error. It is folded at both of our levels and named in the convention table (`scripts/eval/lib/conventions.json`, eval-design §6).

### 4.4 Our additions: three checks no external standard has

| Check | What it asks | How it is decided | Where it is measured today |
|---|---|---|---|
| **Leaf identity** | Is the text the text of the leaf the reader sees? | The image and the OCR are compared on page number, running head, and first and last lines (`leaf-identity` worker instructions, #5274 follow-up) | 2.0% wrong leaf on 298 decidable audit pages (Wilson 0.9–4.3%), all of them Internet Archive (`experiments/2026-09-30-leaf-identity-…-5274.md`) |
| **Invented or recited text** | Does the transcription contain text that is not on the leaf: confabulated (O1), wrong script (O2), a remembered canonical text (O3), or text on a blank or title leaf? | By eye against the image. Screens: the self-declared-blank rule (#4149), the illegible gate (#5305), and the gate-0 by-eye checks (#5660) | 0/20 invented on flagged blanks (#4149); 3 invented in 10 Tibetan books, 1 in 10 Chinese books at #5660 gate 0 |
| **Refusal** | Did the engine decline (RECITATION, PROHIBITED_CONTENT) or return nothing for a page that has text? | `outcome` enum (eval-design §5.1); `lib/refusals.mjs` | 26 meter-recorded refusals across 10 benchmark strata (#5581) |

None of these appears in MQM, OCR-D, olmOCR-bench or OmniDocBench. olmOCR-bench's "text absence" test is the nearest relative, and it covers headers and footers only.

## 5. One reader-facing page grade

### 5.1 The four grades

A page gets the **lowest** grade any lane earns. The lanes are leaf, transcription and translation (if the page has English).

| Grade | Plain meaning | Rule (severities from §3.4) |
|---|---|---|
| **Fit to quote** | You can cite these words, in the original and in English, without opening the scan. | Leaf right. No critical and no major error in any lane. Transcription minors ≤ 2 on the page, none of them in a sentence the reader would quote. Where a reference exists, Level 2 CER ≤ 1%. |
| **Fit to read** | The page says what the leaf says. Check the scan before you quote it. | Leaf right. No critical and no major error. Any number of minors. |
| **Fit for search only** | It will help you find the page, but do not trust the reading. | Leaf right. No critical error. One or more majors. The transcription is in the right script and mostly the right words (Level 1 CER ≤ 10% where a reference exists; by eye: a reader searching a word on the page would find it). |
| **Not usable** | Do not rely on this page. | Any critical: wrong leaf, invented or recited text, wrong script, echoed source, fluent prose over unreadable text, most of the page missing. Also a refusal or empty output on a leaf that has text. |

A page with no ink that is served as blank is **fit to quote**: there is nothing to quote, and nothing false. A blank page served with text is **not usable** (O1).

The 1% and 10% lines and the "≤ 2 minors" line are **judgement calls**, chosen here:
- 1% is about one wrong letter in a printed line of 80–100 characters;
- 10% is about where the #5660 by-eye pages stop being searchable;
- the minors cap keeps "fit to quote" meaning what it says.

They are tested in §5.3 and changed only by a later commit to this doc, never after looking at a month's data.

### 5.2 What gets published

- **Headline (monthly):** the share of served pages in each grade, corpus-wide, weighted (§6.5), with a 95% interval.
- **Per reporting domain:** the same, for each language group that has ≥ 30 graded books in the window (a quarter, pooled; §6.2).
- **Diagnostic:** the MQM penalty per page and the class counts. These rank what to fix (eval-design §9.1 board). They are not headlines.
- Every published grade says which **measure** made it (eval-design §2): `judged` (a model reading the image), `judged_vs_reference`, `accuracy`, or a human reader. A grade made by a model is labelled as one.

### 5.3 Calibrating the grade before it is a headline

The grade inherits the judge's unmeasured error (eval-design §2.1, §10.2 "Human calibration"). Before the first published headline:
1. Two readers of the language grade ≥ 34 judge-sound and ≥ 35 judge-defective pages (`HUMAN-CALIBRATION.md` §7a counts) with the ESA protocol (§3.3).
2. Agreement is reported per grade boundary: quote/read, read/search, search/unusable.
3. If readers and the judge disagree on more than 1 page in 5 at a boundary, the boundary's rule is revised and the calibration rerun.

Until then the grade is published as "model-judged, not yet checked by readers", as `/quality` does today for the judge column.

## 6. Sampling plan

### 6.1 Unit, frame and draw

- **Unit = book.** One page per book in each stratum. Two pages of one book are one observation (eval-design §3.1; `lib/sampling.mjs sampleOnePagePerBook`).
- **Frame:** served books, `visible: true`, `hidden ≠ true`, `pages_count > 0`, at least one OCR'd page. On 2026-10-06 that is 42,078 books and 6,776,649 OCR'd pages (§8).
- **Main draw:** a seeded random book in each stratum, then an **interior** page: skip the first 15% and the last 5%, because front matter lies (eval-design §3.2). Only text page types; the risky types are drawn separately (§6.3), so the two draws together cover the corpus without double counting.
- **Seed:** the draw date as `YYYYMMDD` (as `MONTHLY.md` does), committed before any judging.

### 6.2 Strata

| Axis | Levels | Draw stratum or post-stratum? |
|---|---|---|
| Language | Twelve reporting domains: Latin, Chinese, English, German, Greek, French, Tibetan, Italian, Dutch, Russian, Sanskrit, and other languages pooled (each kept language has ≥ 1% of OCR'd pages) | **Draw stratum** (catalogue `language`) |
| Period | before 1500, 1500s, 1600s, 1700s, 1800s, 1900 on, unknown | **Draw stratum** (catalogue `year`/`published`) |
| Script class | Observed from the page: Fraktur vs Antiqua, Rashi vs square Hebrew, woodblock vs manuscript CJK, print vs manuscript, Tibetan print vs cursive, … (eval-design §3.2) | **Post-stratum**, assigned by eye or a classifier after the draw. Known minority classes are oversampled through catalogue proxies (title words, provider) and weighted back |
| Page type | Text (main draw) vs the five risky types (§6.3) | **Separate draw strata** |
| Engine and prompt version | The OCR model and translation model/prompt that made the served text (`ocr.model`, `translation.model`, `prompt_version`) | **Recorded covariate.** A cohort's own estimate is reported only when it holds ≥ 10% of served pages and ≥ 30 sampled books. A change is judged by the paired designs in eval-design §7 and §10.2, not by comparing cohorts in this sample: cohorts differ by when and what was processed, so comparing them measures the processing order (eval-design §7) |

The catalogue language × period gives **79 cells** with OCR'd pages today (§8). The plan does **not** report 79 cells a month. It reports twelve language domains a quarter, and a cell is reported only when it reaches 30 books by pooling.

### 6.3 Risky page types: oversampled as separate strata, then weighted back

Gate 0 of #5660 found invented text on a blank leaf and on a title leaf (Tibetan), and five lone 金 lines where the Manchu column was dropped (Chinese). The olmOCR arm dropped every Greek line on a mixed Greek/Latin page. The reader-level audit has never drawn these pages: it excludes non-text page types and pages with < 200 OCR characters. So each risky type is its own stratum, drawn at a fixed **20 books a month** (60 a quarter, directional; 100 in five months, ±10 points), one page of that type per book:

| Stratum | How a page is chosen | Size of the stratum (2026-10-06) | Unit tests (olmOCR-bench style) |
|---|---|---|---|
| **Blank** | `page_type: blank` OR pixel-blank (`blank-page-study.mjs`) OR self-declared blank (#4149) | 252,626 pages tagged `blank` (self-reported) | No body text, or only what is on the leaf (stamp, shelfmark) |
| **Title** | `page_type: title-page`, or the first page with text in the first 15% | 111,893 tagged `title-page` | Every line on the leaf is present; nothing beyond them |
| **Tables and lists** | `page_type: index` or `toc`, or a markdown table in the OCR | 165,382 `index` + 53,653 `toc`; tables inside text pages not counted | Cells and rows in order; no invented rows (O17) |
| **Mixed script** | A second script's Unicode block on the page, ≥ 10 characters (the #5660 rule), or a catalogue `languages[]` with two scripts | **Not counted yet**: no tag; first step of follow-up F1 | Each script present in its share; none dropped (O10) |
| **Damaged** | OmniDocBench-style attributes by eye (fuzzy, stained, faded, show-through, cropped), or `ocr.unreadable`, or a legibility warning | **Not counted yet**: the `ocr.unreadable` count timed out at 200 s on 2026-10-06; F1 counts it | No fluent text over illegible spans (O1, T7) |

The page-type counts are the OCR model's own tags (taxonomy O16), so they size the strata and do not define them. The weight of each risky stratum is its measured share of served pages, and its share is re-measured each quarter.

### 6.4 Sample size from target precision

n = z²·p(1−p)/d², z = 1.96 (NIST; STAT 506):

| Share being estimated (p) | ±10 points | ±5 points |
|---|---:|---:|
| 0.5 (worst case, or unknown) | 97 | 385 |
| 0.2 | 62 | 246 |
| 0.1 (the judged major-defect share in most languages, `quality-by-language.json`) | 35 | 139 |

So:
- **A reporting domain needs about 100 books for ±10 points** at worst case. Under the one-page-per-book rule that is 100 books, not 100 pages.
- **A corpus-wide headline needs about 400 books for ±5 points.** Stratification with good weights does no worse than simple random sampling, so 400 is an upper bound for the headline.
- **The floor for printing any domain is 30 books** (directional, eval-design §3.1). Below it the domain is listed as "fewer than 30 books", with the count.

### 6.5 Allocation and weighting

- **Allocation: Neyman by pages served.** n_h = n · N_h·S_h / Σ N_k·S_k. N_h is the stratum's OCR'd pages and S_h = √(p_h(1−p_h)), with p_h the language's last judged major-defect share (0.5 where none). On 2026-10-06, 400 books split as: Latin 112, Chinese 84, other languages 45, English 41, Greek 33, German 25, Tibetan 15, French 10, Dutch 9, Russian 9, Italian 8, Sanskrit 8 (§8; per cell in `inventory.json`).
- **Floor:** each domain gets at least 10 books a month (30 a quarter), and a domain with fewer eligible books takes all of them as a census (eval-design §10.2). The floor adds about 6 books a month to pure Neyman (Italian, Dutch, Russian, Sanskrit).
- **Weighting back:** the corpus estimate is Σ W_h·p̂_h. W_h is the stratum's share of served pages. The risky strata carry their own page share, and the main draw's weight is reduced by the same amount. The 95% interval is a bootstrap over books within strata. Each stratum's own interval is Wilson.
- **Weights are frozen per draw.** They are written into the draw log at draw time, as `book-weights.json` already is, so a later corpus change cannot move a past month's number.

### 6.6 Never tune and score on the same pages (#3499)

Two separate guards, because they solve two problems:

1. **Score pages vs development pages (this plan).** Every page the monthly draw selects is tagged `role: score` in the registry (eval-design §3.5). It never enters:
   - the regression set (#5913);
   - an A/B pool, a prompt example, or a gate's tuning round.

   A finding from a scored page is fixed using **other pages of the same class**. The scored page joins the regression set only after the next month's score is published. The check that enforces this is a store-schema rule (eval-design §9): a `run_id` whose pages intersect `role: score` pages fails.
2. **The sealed reserve (#3499) proper.** Books never published, held back so a model cannot have read our text. They test engines and contamination, not served quality. Monthly samples are of served pages, so they cannot come from the reserve. The reserve stays #3499's job: 1% of each batch, never exported.

### 6.7 The standing monthly sample

It **extends the existing monthly audit** (`translation-corpus-audit/MONTHLY.md`, #5301: about 103 books, $0 API, about 10 Opus subagents a month) rather than starting a new one. It also absorbs:
- the image-and-book arm (#5914);
- quality round 1's strata and ship rule (#5438), whose 237 backlog books become the first "newly served" cohort when they go live.

| | Today (#5301) | Standing sample (this plan) |
|---|---|---|
| Books a month | ~103, 15 languages, quota by hand | ~400 main (Neyman + floor) + 100 risky (5 × 20) |
| Lanes graded | Translation against the OCR text | Leaf + transcription against the image + translation; one page grade (§5) |
| Page types | Text pages with ≥ 200 OCR characters | All: text pages in the main draw, five risky strata drawn separately |
| Weighting | Post-stratified by language | Neyman by served pages, frozen weights, risky strata weighted back |
| Held-out | None | `role: score` pages barred from development (§6.6) |
| Output | ≥ 4 share, major share | Grade shares with intervals, corpus-wide and per domain (quarterly), class counts |
| Cost | $0 API, ~10 subagent sessions | $0 API, ~50 subagent sessions (10 pages each); see §9 for the human hours |

## 7. How existing numbers map onto the rubric

| Number published today | Where | Becomes |
|---|---|---|
| Median CER per language, flash-lite | `/quality` table, `quality-by-language.json` | Level 2 CER (where the reference is Level 2) and Level 1 CER, plus cMER; reference level shown |
| "Rated 4 or 5 of 5 by a model judge" | `/quality`, #5274 | Kept for comparison. The judge's defects are re-read as MQM severities: fidelity ≤ 3 with a major defect ≈ "fit for search only" or worse in the translation lane. The page grade replaces it as the headline once §5.3 is done |
| "Pages at 4 or 5 against a published translation" | `/quality`, #5695 | Unchanged as `judged_vs_reference`; a diagnostic per language, not the page grade |
| "Serious errors per 100 pages" | #5914 | "Serious" = major + critical in §3.4 terms; reported as the MQM penalty diagnostic |
| "Major-defect rate ≤ 10% on n ≥ 20" ship rule | #5438 | Restated as "share of pages graded *fit for search only* or *not usable* ≤ 10%", with the interval printed (at 2 of 20 it is about 3–30%, eval-design §2.1) |

## 8. Inventory: what is measured today, per stratum, and what it costs to fill

Measured 2026-10-06 by `scripts/eval/quality-strata-inventory.mjs` (read-only, $0). Full table, all 79 catalogue cells: `scripts/eval/results/quality-strata-inventory-2026-10-06/inventory.{json,md}`.

**Columns:**
- **Measured books** count each book once, assigned to the catalogue cell where Atlas puts it today.
- **OCR ref**: books with a reference-scored OCR page (dashboard sufficiency rows, `language_period`; books with no year go to `unknown`). "Other languages" pools Armenian 9 and Hebrew 4; Japanese, Syriac, Arabic and Persian have none.
- **Judged**: books with a judged served translation page, across the three #5274 audits (402 books).
- **vs published**: books scored against a published translation (#5695; 321 books).
- No book has a **page grade** yet, because the grade is new. "Judged" is the nearest existing proxy, so the gaps are counted against it.

### 8.1 By reporting domain

| Domain | Books with text | OCR'd pages | Share | Prior p (major) | Neyman n of 400 | OCR ref | Judged | vs published | Cells: all / < 30 judged / 0 judged | Gap to 30 | Gap to 100 | OCR-ref gap to 30 | Cost to fill the OCR-ref gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---|
| Latin | 15,767 | 2,118,996 | 31.3% | 0.10 | 112 | 159 | 116 | 71 | 7 / 5 / 0 | 0 | 0 | 0 | — |
| Chinese | 12,877 | 1,271,766 | 18.8% | 0.17 | 84 | 536 | 18 | 22 | 7 / 7 / 1 | 12 | 82 | 0 | — |
| English | 3,020 | 846,557 | 12.5% | 0.08 | 41 | 57 | 38 | 0 | 7 / 7 / 1 | 0 | 62 | 0 | — |
| German | 2,682 | 604,803 | 8.9% | 0.06 | 25 | 35 | 40 | 22 | 7 / 7 / 1 | 0 | 60 | 0 | — |
| Other languages | 2,381 | 505,976 | 7.5% | 0.50 | 45 | 13 | 61 | 80 | 7 / 7 / 1 | 0 | 39 | 17 | $0.34 + 4.4 h |
| Greek | 1,098 | 454,875 | 6.7% | 0.22 | 33 | 174 | 37 | 68 | 7 / 7 / 2 | 0 | 63 | 0 | — |
| French | 868 | 288,618 | 4.3% | 0.04 | 10 | 0 | 28 | 14 | 7 / 7 / 1 | 2 | 72 | 30 | $0.60 + 4.0 h |
| Tibetan | 1,393 | 206,135 | 3.0% | 0.23 | 15 | 0 | 13 | 0 | 6 / 6 / 0 | 17 | 87 | 30 | $0.60 + 7.8 h |
| Italian | 574 | 152,709 | 2.3% | 0.11 | 8 | 0 | 19 | 10 | 7 / 7 / 2 | 11 | 81 | 30 | $0.60 + 4.0 h |
| Dutch | 566 | 134,536 | 2.0% | 0.17 | 9 | 0 | 18 | 7 | 6 / 6 / 3 | 12 | 82 | 30 | $0.60 + 4.0 h |
| Russian | 240 | 99,055 | 1.5% | 0.50 | 9 | 0 | 0 | 0 | 4 / 4 / 4 | 30 | 100 | 30 | $0.60 + 4.0 h |
| Sanskrit | 351 | 92,623 | 1.4% | 0.50 | 8 | 0 | 14 | 27 | 7 / 7 / 3 | 16 | 86 | 30 | $0.60 + 7.8 h |

**How the costs are worked out:**
- **Gaps** count books still to grade for 30 (directional) and 100 (±10 points), capped by the books the domain has.
- **Page grades:** filling every gap to 30 is 100 books. At about 10 pages per Opus subagent session (`MONTHLY.md`), that is ~10 sessions, $0 API.
- **OCR references:** priced with the eval-design §11 cost model: $0.02 of model spend per page, plus 3 minutes of alignment where an e-text exists (assumed for 70% of pages) and 20 minutes of transcription otherwise (45 for manuscript-heavy domains: Tibetan, Sanskrit, other languages). That is 8.1 minutes a page for print and 15.6 for manuscript-heavy domains.

### 8.2 By cell: where the zeros are

- Of 79 language × period cells, **77 have fewer than 30 judged books**, and **19 have none**.
- The largest unmeasured cells, by OCR'd pages:
  - **Chinese, period unknown**: 1,139,724 pages (16.8% of the corpus). 518 OCR-referenced books (Kanripo/CBETA), but only 2 judged translation pages: the catalogue date is missing for 11,543 books, and the translation audits drew Chinese at 6–18 books a run.
  - **English 1800s**: 351,669 pages; 0 OCR-ref, 10 judged.
  - **Latin before 1500**: 347,384 pages; 1 OCR-ref, 17 judged.
  - **German 1700s**: 293,643 pages; 9 OCR-ref, 15 judged.
  - **English 1900 on**: 285,679 pages; 0 OCR-ref, 17 judged.
  - **Tibetan 1700s**: 194,337 pages; 0 OCR-ref, 4 judged. The catalogue date is mostly an estimate.
  - **Russian**: 99,055 pages in all; nothing measured.
- The cells are **catalogue** cells. eval-design §3.2 says the leaf decides the stratum, and #4884 found 17 of 20 "Greek pre-1700" pages were Latin. The first quarter therefore also measures the catalogue → observed transition rate per cell, for free.

### 8.3 By page type and by engine

- **Page types the reader-level audit has drawn:**
  - Over 489 random interior pages: text 417, untagged 62, preface 4, diagram 3, appendix 2, dedication 1.
  - **Blank, title, index/toc and table pages: 0**, by construction (§6.3).
  - The only measurements of them are targeted studies: #4149 (20 flagged blanks by eye), #4195 (37 blank and 40 fabricated leaves), #5660 gate 0 (20 books by eye), the taxonomy's `tables` stratum (6 books) and the illegible gate (#5305, 60 hand-read fires).
  - None of these is a random sample of the type, so **every risky stratum is at 0 of 30 for a weighted estimate**.
- **Engine and prompt on the audited pages:**
  - Translation by `gemini-3-flash-preview` 203, `gemini-3.1-flash-lite-preview` 157, `gemini-3.1-flash-lite` 129.
  - Prompt versions: v10 137, v11 109, v2 97, v13 85, v1 31, and eight others ≤ 13.
  - No prompt cohort except v10 and v11 reaches 100 books, and v13, the current one, has 85. That is why engine and prompt stay covariates (§6.2) and changes are judged by paired tests.

### 8.4 Cost to fill the first round

| Part | Books | Model spend | Subscription sessions | Human hours |
|---|---:|---:|---:|---:|
| Domains to 30 judged books (§8.1) | 100 | $0 | ~10 | — |
| Risky strata, first quarter (5 × 60) | 300 | $0 | ~30 | — |
| Calibration (§5.3): 69 pages × 2 readers × ~5 min | 69 | $0 | — | ~12 h (volunteers, #5406; paid if no reader exists for the language) |
| OCR references, domains to 30 (§8.1) | 197 | ~$4 | — | ~36 h (e-text alignment and transcription) |
| Counting mixed-script and damaged pages (F1) | — | $0 | — | — |

The five-minutes-a-page reader figure is a judgement call: a page read against its scan, ESA-style, by someone who reads the language. The volunteer pool has no readers for Syriac, Japanese or Armenian (eval-design §4.2).

## 9. Follow-up issues for the first sampling round (drafted; filed when this design merges)

Not filed yet: this design is `tier:hold`, and its rules may change in review. Each draft is priced; none spends money without Derek's yes.

- **F1 · Count the risky strata (mixed script, damaged) and freeze the frame.** A $0 Mongo walk over served pages:
  - for each risky type (§6.3), a page count and a book count;
  - a Unicode-block count per page for mixed script;
  - `ocr.unreadable` and legibility warnings for damaged pages.

  It writes `scripts/eval/registry/frame-<date>.json` with the weights. Checkpoints every 100K (eval-design §9). **Cost: $0, about 1 hour of Atlas walk.**
- **F2 · Extend the monthly draw to this plan's design.** `translation-corpus-audit/draw.mjs` gains:
  - the Neyman allocation with floors;
  - the five risky strata (one page of the type per book);
  - frozen weights;
  - the `role: score` tag.

  The registry gains the check that bars score pages from development runs (§6.6). Dry run first; tier:auto. **Cost: $0.**
- **F3 · The page-grade judge brief.** Extend `JUDGE-PROMPT.md` with:
  - the image (leaf and transcription lanes);
  - the severity `critical`;
  - an MQM category per defect;
  - the four-grade rule (§5.1).

  Controls stay: swap, drop, repeat. Add a blank-with-text plant and a wrong-leaf plant. Validate on last month's 103 books before any new draw. **Cost: $0 API; ~10 subscription sessions.**
- **F4 · First graded round.** One month at the full size (~400 + 100 books). It publishes the grade shares with intervals as "model-judged, not yet checked by readers". It does **not** replace the `/quality` headline. **Cost: $0 API; ~50 subscription sessions.**
- **F5 · Calibrate the grade against readers (§5.3).** 69 pages per language with readers (Latin, German, French, Dutch, Italian, Spanish first: the volunteer pool's strengths). ESA protocol on `/check` (#5406). **Cost: ~12 reader-hours per language; $0 if volunteers, else Derek's call per language.**
- **F6 · Reference level on every reference, two CERs per cell.** Add `reference.level` to the reference records and tag the existing ones. Wikisource editions are tagged by a by-eye check of 3 pages per source. Then compute Level 2 and Level 1 CER plus cMER in the scorer, which also settles the definition of #5939's folded column. **Cost: $0; about 4 hours of tagging.**
- **F7 · OCR references to directional where a domain has none** (French, Italian, Dutch, Russian, Sanskrit, Tibetan, other languages; §8.1): 197 books. **Cost: ~$4 model + ~36 human hours.** Sequenced after #4925's open cells, whose decisions are pending; it is not needed for the page grade, which reads the image.

## 10. What this plan deliberately leaves out

- **No new scorer.** CER, the judge and the detectors exist. This plan adds a level tag, cMER and a grade rule on top of them.
- **No per-cell monthly reporting.** Seventy-nine cells × 30 books a month is 2,370 books; the plan reports twelve domains a quarter.
- **No engine-vs-engine numbers from the monthly sample.** Cohorts are confounded with processing order. Engine choices go through eval-design §7 and §10.2.
- **Metadata** (title, author and date against the title page) is a book-level lane. It stays with #5914's book checks and #5438's 5-per-cell check, outside the page grade.
- **Running olmOCR-bench, OmniDocBench or the ICDAR sets.** Not until a claim needs one (§2).

## 11. Links

- **Issues:** #5984 (this), #5106 (eval design), #5274, #5301, #5914, #5438, #4925, #3499, #5406, #5660, #5939, #5913, #4149, #4195, #5305, #5581, #4884, #5695.
- **Docs:** `eval-design.md`, `page-error-taxonomy.md`, `translation-corpus-audit/MONTHLY.md`, `translation-corpus-audit/JUDGE-PROMPT.md`, `translation-corpus-audit/HUMAN-CALIBRATION.md`.
- **Inventory:** `scripts/eval/quality-strata-inventory.mjs` and `scripts/eval/results/quality-strata-inventory-2026-10-06/`.
