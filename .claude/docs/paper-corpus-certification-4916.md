# Paper with TU Delft — corpus certification: outline and evidence table (#4916)

PRIOR ART: `.claude/docs/ocr-memorization-paper.md` (the recitation paper's plan — a
different, narrower paper, already drafted at `paper/reading-or-reciting-chr2027.md`);
`.claude/docs/ft-first-translation-paper.md` and `translation-gap-paper.md` (other
papers). None of them is the corpus-certification paper #4916 describes, and none carries
a claim-by-claim evidence table with verification status — that table is this file's point.

**Workspace for the collaborator (outline, this table, the data bundle, a feedback form):
https://ocr-quality-paper.vercel.app** — source repo `github.com/JDerekLomas/ocr-quality-paper`
(private), checked out at `sidequests/ocr-quality-paper/`. Feedback from the site lands in
the `feedback` collection tagged `[paper #4916 · …]`.

**How to read the table.** Every row was re-checked on 2026-09-18 against the named
committed file (four read-only verification passes) or a fresh production query.
Status counts: verified 22 · corrected 7 · log only 16 · external 1 · unreproduced 1.
`verified` = recomputed from the file; `derived` = arithmetic on it; `log only` = stated
in `EXPERIMENTS.md`, a doc or an issue, no committed result file; `external` = against a
third party's published data; `corrected` = the #4916 brief had it wrong; `unreproduced` =
quoted in one of our own docs but no artifact or thread reproduces it. **Do not quote a
`corrected`/`unreproduced` row's original figure anywhere.** The cheapest gap to close is
the three corpus-scale counts (Syriac loop attribution, leaf drift, loop gate) whose
deterministic scripts exist but whose outputs were never committed.

---


**Working outline for the TU Delft collaboration — issue #4916. Drafted 2026-09-18.**
Not prose. Every number below was re-checked on 2026-09-18 against a committed result
file or a fresh query; the evidence table names the file and the n. Nothing here is
agreed with the collaborator.

## 1. The claim, in one paragraph

A production digital library runs generative OCR and translation over 21.6 million page
images in some forty scripts and languages, at a budget where a wrong routing decision
costs thousands of dollars a month, and with no ground truth for the overwhelming majority
of it. The paper's question is not "which model is best" but **how a library can know what
its corpus says when nobody can read all of it**. We show (a) that free agreement-based
instruments — repeat-transcription stability, engine-versus-engine agreement, and
word-sequence agreement against a non-generative reader — carry real information about
delivered quality, and we calibrate each against human or published references;
(b) that generative OCR fails in ways character error rate cannot see — loops, recitation
refusals, fluent fabrication, structural splices, wrong-leaf delivery — and we give a
detector, a measured rate, and a stated blind spot for each; (c) that per-language
acceptance thresholds, not a global one, are what the calibration supports; and (d) that
model-as-judge is not yet a usable instrument for translation quality at the sample sizes
a library can afford. The distinctive resource is the library itself: every result is
reproducible from committed artifacts in an open (AGPL) repository, and the measurements
were made because the decisions were real.

## 2. What is new

1. **Calibrated free instruments.** Agreement scores (same-model repeats, cross-engine,
   ABBYY-vs-VLM) are cheap to compute at corpus scale. We calibrate them: gate score
   against fresh-read CER on 742 books (no cliff at 0.85; monotone by band), with the
   accepted-band median at 3.9 % CER; repeat stability on same-leaf, same-model pairs by
   language (committed 2026-08-02 build: English n=14,951, median 0.9995, 0.75 % below 0.5;
   Arabic n=249, median 0.79, 13.7 % below 0.5); reference error rate of the Wikisource
   references themselves (0.06–1.15 %).
2. **A failure taxonomy for generative OCR with detectors and blind spots.** Loop (length
   ratio, repeat lines), recitation refusal (finish reason; clustered on the cleanest, most recitable print),
   fluent fabrication (specialist-convergence detector, 51/51 positives, 0/5 false
   positives, but abstains exactly on the hardest pages; front-matter re-read: 1 invention
   in 16 hand-read title pages), structural splice (bag-of-words minus sequence gap, 14 of
   488 pages, page-local not book-local), wrong-leaf delivery (neighbour-leaf test; an
   offset "calibration" that kept finding the same correction was absorbing an upstream
   bug — 236 of 893 books, 51,851 pages, written at the wrong leaf). Recitation refusal
   rate on a 742-book reference draw: 23 %, concentrated in the cleanest, most recitable
   print. Which of these are invisible from text alone is stated.
3. **When a specialist engine is worth it.** Ten sealed strata, 350 pages, one page per
   book, preregistered bars. Generalist wins or ties on Latin-script, Greek, Armenian and
   Chinese; specialists win on kuzushiji (NDL) and Syriac (Kraken, 40/0 against the
   generalist, 18.8 % line CER against published transcriptions where the generalist
   sits at 74–79 %). Engine output *conventions* (inline kunten, line direction) read as
   50 % error under a naive proxy; normalisation must be declared.
4. **Instrument validity results that generalise beyond this library.** Model-as-judge
   test–retest of 52–60 % on translation pairs at n=60; a "verified citation" metric that
   measured citation format, not accuracy; a positive control that shared the
   instrument's blind spot; an old routing policy that read as live drift until rows were
   dated. These are negative results the DH evaluation literature lacks.

## 3. Relation to the existing draft — one paper or two?

**Two, and they are already separate.** A complete 6,000-word draft, *Reading or
Reciting? Measuring the memorization subsidy in VLM OCR* (`paper/reading-or-reciting-
chr2027.md`, 2026-07-24), argues one narrow thing: canonical-text benchmarks inflate VLM
OCR scores because the model recites. Its CHR 2027 deadline (2026-08-14) was missed; the
ops plan of 2026-09-04 re-aims it at the ICDAR 2027 IJDAR journal track (15 Nov 2026).
That paper is the recitation row of the taxonomy above, expanded. The TU Delft paper is
the **corpus-certification** paper: instruments, calibration, taxonomy, routing economics.
It cites the recitation paper for one mechanism and does not re-argue it. A third,
smaller output — the volunteer annotation set with a Gebru-style datasheet — is a data
paper (JOHD / a dataset track), and is the natural TU Delft-led piece if the annotation
programme runs (#4920).

## 4. Method skeleton

- **Corpus** (re-measured 2026-09-18): 114,745 records; 41,919 readable books
  (visible with pages); 21.6 M pages ingested; 6.77 M transcribed; 5.07 M translated. Top
  languages by readable book: Latin 15,910; Chinese 12,792; English 2,760; German 2,697;
  Tibetan 1,468; Greek 1,109. Syriac 84; Armenian 68; Japanese 145.
- **Sampling rule everywhere: one page per book**, interior, seeded, sealed in a committed
  registry so the draw cannot drift. Pages within a book are one observation.
- **Reference tiers, licence-gated:** pinned ground truth (55 pages), Wikisource-proofread
  pages (120; own error rate measured), published GT sets (Syriac, CC BY 4.0), CBETA/Kanripo
  windows (Chinese). Everything else is agreement, and the paper says so per row.
- **Stats frame to be added:** paired exact sign tests and bootstrap CIs exist for the
  benchmark; the calibration tables are medians by band without CIs; several results are
  n = 9–60. This is the collaborator's first ask (see §7).
- **Preregistration** as house practice: five preregistration files precede their runs;
  one result reversed under replication (k=5 prompt A/B), which is why the log carries a
  "replicated?" column.

## 5. What is missing before this is a paper

- **Human ground truth of our own.** Everything is machine-vs-machine or vs published
  editions. A hand-transcribed set, one page per book, stratified by script and century.
  The volunteer corps can cover Spanish, Dutch, French, German, Italian, Latin, English
  (n in the hundreds by declared competence); it cannot cover Syriac (0), Japanese (3),
  Armenian (3), Greek (13). Prerequisite plumbing is #4920 (gold items, three votes, one
  consumer). Consent and credit must be settled before the first label is collected.
- **Inter-annotator agreement on the failure taxonomy.** Today's maximum is 2 votes on
  4 items.
- **Confidence intervals and a power argument** on the calibration tables.
- **A statement of the thinking/temperature confound**: generation parameters were not
  recorded until #4613; two production paths ran the same prompt at temperature 1.0 and
  0.1, one with thinking on. The provenance doc quotes inter-arm agreement figures for
  thinking on/off (74 % / 43 %) that no committed artifact or issue thread reproduces;
  the #4581 measurement was of token volume and cost, n=20 pages. Re-run before quoting.
  Any repeat-stability figure spanning 2026 carries this confound either way.
- **Numbers in the brief that were wrong or unlocatable, corrected here** (full list in
  the evidence table): the benchmark seals 350 pages, not 370 (424 with spares; 345 ran);
  the "Loeb 0.766 verbatim / 0.645 splice" pair is a hand read recorded in #4780, not a row
  in the result file (the splice page is *Century Illustrated*); "13.5 % refused as
  recitation, clustering on famous prefaces" appears nowhere — the committed figure is
  23 % (169/742), clustered in the cleanest print; "170 books rescued by shifting text" is
  not in any thread; the front-matter figures are 150 *books* (226 pages), 98 differ
  (65 %), 48 where the model's title carries catalogue words the Archive lacks, and 1
  invention in 16 hand reads (tally as of 2026-09-17); the "$0.85/1K" cost rests on 273
  pages and disagrees with the separately measured lite-batch rate of $1.48/1K; the loop
  gate's "15,595 saved" is prospective (untranslated loop pages the gate will stop), not
  realised; the Tibetan 0.968 "control" is a synthetic positive control, not a single-page
  read. Three corpus-scale counts (Syriac loop attribution, leaf drift, loop gate) come
  from committed deterministic scripts whose outputs were never committed — cheapest gap
  to close: rerun and commit the JSONL.
- **Related work** is thin except for the memorization dossier (~40 abstract-checked
  citations). Nearest published neighbours found 2026-09-18: Levchenko 2025
  (arXiv 2510.06743, LLM OCR evaluation framework, period-specific metrics); Beyene &
  Dancy 2026 (arXiv 2603.25761, OCR evaluation survey, invisibility of historical
  documents); "When low CER is not enough" (arXiv 2607.24077, VLM OCR hallucination on
  Uruguayan archives); Guo & Wei 2026 (arXiv 2603.00884, correction provenance in DH
  pipelines); risk-controlled generative OCR (arXiv 2603.19790). Plus the standing
  infrastructure literature: IMPACT, OCR-D, HTR-United, CATMuS, Transkribus, eScriptorium,
  Kraken.

## 6. Venues (checked 2026-09-18)

| venue | shape | date | fit |
|---|---|---|---|
| **ICDAR 2027, IJDAR journal track** | archival journal article + conference slot, Kuala Lumpur 18–22 Aug 2027 | **15 Nov 2026** (full paper); main track 28 Feb 2027 | the recitation paper is already aimed here; the certification paper could go to the main track in Feb — the OCR community is where a "CER is blind to fabrication" result changes practice |
| **DH2027 (ADHO), Galway** | long paper / panel; theme "Creativity" | 28 Jun–3 Jul 2027; CFP not yet published (usually ~Nov–Dec) | the audience that runs digitization projects; suits RQ1 + RQ4 (what a reader deserves to be told) |
| **CHR 2028** | 6,000-word long paper, archival | next CFP ~Aug 2027 (CHR 2027 closed 14 Aug 2026) | exact audience, but a year out |
| **JOCCH (ACM)** | journal, rolling | none | the certification paper as a full article if no conference window fits |
| **DSH (OUP)** | journal, rolling | none | broader DH readership; slower |
| **JOHD / JDMDH** | data paper / ATR special issues, rolling | none | the annotation set + datasheet; JDMDH has an ATR-on-historical-documents track |
| **COLING 2027 via ARR** | dataset half | 12 Oct 2026 (per ops plan) | tight; only if the HF dataset is published first |

Recommendation: certification paper → ICDAR 2027 main track (28 Feb 2027) with an arXiv
preprint at submission; recitation paper → IJDAR track (15 Nov 2026) as planned; data
paper → JOHD once #4920 has produced ≥3-vote labels.

## 7. Three questions for Jeff Love

1. **Ground truth capacity.** Can TU Delft supply or supervise hand transcription of a
   stratified one-page-per-book set (target ≈ 300 pages, ten strata) — and for the scripts
   our volunteers cannot cover (Syriac, Japanese, Armenian, Greek), do you have partner
   expertise, or should those strata stay "published GT only"?
2. **Statistical framing.** Our comparisons are sign tests, medians by band, and bootstrap
   CIs on n = 9–65. Would you own the inferential frame — power, CIs on calibration curves,
   the right model for a rate that flips between runs (loop rate as Bernoulli) — and is
   there a student who wants that as a thesis chapter?
3. **Ownership and venue.** Which half do you want to lead: the certification paper
   (instruments + taxonomy, ICDAR/DH), or the annotation data paper (datasheet, IAA,
   consent, JOHD)? Authorship and the licence on the annotation set (we default to
   CC BY-SA 4.0) decide the consent wording, which cannot be retrofitted.

## 8. Reproducibility note

Everything cited is in the public repository
`github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2` under `scripts/eval/`
(harness, `INDEX.md`, `EXPERIMENTS.md`, preregistrations, sealed registries, result
files). The bundle on this site is a checksummed copy (`data/manifest.json` carries the
source commit). Two items in the bundle need a licence call before wider distribution:
29 CBETA/Kanripo e-text windows in `benchmark/refs` (no licence field), and the missing
licence sections on dataset v0.3 and v0.4.


---

## Evidence table

| # | theme | claim | value | n | status | source | origin |
|---|---|---|---|---|---|---|---|
| C1 | corpus | Corpus scale: 114,745 records; 41,919 readable books; 21.6M pages ingested; 6.77M transcribed; 5.07M translated *Drifts by thousands a month; date every quotation.* | as stated | all books | **verified** | fresh countDocuments/aggregate on bookstore.books, 2026-09-18 | CLAUDE.md stack section (2026-08-30 vintage was 109,567 / 31,731 / 20.2M / 6.45M / 5.05M) |
| G1 | free-OCR gate | Delivered IA text in accepted bands (gate ≥ 0.85): median CER 3.9%, WER 8%; 84% of pages within 10% CER; 10% above 20% *Reproduces only on the clean subset: empty ref_flags and misaligned=false (n=488 of 573 scored of 742). One interior page per book.* | 0.039 / 0.0795 / 84.1% / 10.4% | 182 clean pages of 742 books | **verified** | scripts/eval/results/ia-ocr-delivered-quality-2026-09-13.jsonl | #4790, #4780, #4763; EXPERIMENTS.md 2026-09-13 |
| G2 | free-OCR gate | No quality cliff at the gate: median CER by band 0.40–0.60 17.3% · 0.60–0.70 13.3% · 0.70–0.75 10.1% · 0.75–0.80 9.3% · 0.80–0.85 7.0% · 0.85–0.90 5.9% · 0.90–0.95 3.4% · 0.95+ 1.4% *Monotone, so the cutoff is a policy choice. No CIs on the band medians yet.* | 0.1735 / 0.133 / 0.101 / 0.093 / 0.0695 / 0.0595 / 0.034 / 0.014 | 46 / 82 / 49 / 61 / 60 / 70 / 79 / 33 | **verified** | scripts/eval/results/ia-ocr-delivered-quality-2026-09-13.jsonl | EXPERIMENTS.md 2026-09-13; decision → per-language cutoffs (en/fr 0.80; la/de/it 0.85; el never), PR #4801 |
| G3 | free-OCR gate | One gate score hides two failure populations: bag-of-words minus sequence gap ≥ 0.15 isolates structural splices (14 of 488 pages), median CER 0.735 vs 0.075 for the rest; page-local, not a book property *The illustrative pair in the brief — a Loeb page at 0.766 verbatim, a spliced page at 0.645 — is the #4780 hand-read table (Basil, Letters, Loeb 1926 p.211; Century Illustrated v40 p.940), not rows in this file.* | 14 / 488; 0.735 vs 0.075 | 488 | **verified** | scripts/eval/results/ia-ocr-delivered-quality-2026-09-13.jsonl | #4780 hand read → EXPERIMENTS.md 2026-09-13 |
| G4 | free-OCR gate | Recitation refusals on the reference draw: 23% of reference reads unscored (RECITATION + PROHIBITED_CONTENT), concentrated in the cleanest, most recitable print (78 of 169 in bands ≥ 0.85) *The brief said '13.5% refused as recitation, clustering on famous prefaces'. Neither the number nor the phrase appears in any file or thread. Accepted-band quality figures are therefore, if anything, pessimistic.* | 169 / 742 = 22.8% (162 RECITATION + 7 PROHIBITED_CONTENT); first pass 193 (26%) | 742 | **corrected** | scripts/eval/results/ia-ocr-delivered-quality-2026-09-13.jsonl (finish_reason) | EXPERIMENTS.md 2026-09-13; #4790 |
| G5 | free-OCR gate | Text-only cleanup of rejected IA text is no lane: 48/60 pages improve a little, no rejected book crosses 0.85, cost 86% of re-reading the image, and it invents where input is unreadable (7 of 8 author names on one index page) *Single run.* | $0.00127/page vs $0.00148 image OCR | 60 pages, 10 books | **log only** | scripts/eval/results/ia-ocr-cleanup-2026-09-12.jsonl (not in bundle; committed) | EXPERIMENTS.md 2026-09-12 |
| L1 | wrong-leaf delivery | An offset calibration that kept finding the same correction was absorbing an upstream bug: IA leaf offset is always 0 (access-leaf count == XML object count on 478/478 books); 236 of 893 written books (26%), 51,851 of 152,997 pages (34%), were written at offset −1/−2/−3 *The brief's '170 books rescued by shifting text' is not in any thread (the only 170 there is a djvu filename count). CLASS C (text and image agree on screen at a compensating offset) is 188 books / 48,006 pages in EXPERIMENTS.md vs 197 / 50,911 in the issue — rerun and commit before quoting. Reader-visible breakage (CLASS A) was 39 books / 940 pages, repaired.* | 236 / 893 books; 51,851 / 152,997 pages; 478/478 | 893 books | **log only** | scripts/audit/ia-ocr-leaf-drift.mjs (deterministic, free) — its --out JSONL was never committed | #4790 comments 2026-09-13/14; EXPERIMENTS.md 2026-09-13; #3368 |
| L2 | wrong-leaf delivery | Delivery errors are classifiable and need opposite repairs: of 31/573 pages where text and image are different leaves, 24 text-side (offset locally wrong), 5 image-side (#3368 archived image is the neighbouring leaf), 2 unclear *Classification against the IIIF source leaf, never the archived copy.* | 31 / 573 (5.4%) | 573 | **log only** | scripts/eval/results/ia-ocr-delivered-quality-2026-09-13.jsonl (misaligned flag) + IIIF re-reads on #4790 | EXPERIMENTS.md 2026-09-13; #4790 |
| L3 | wrong-leaf delivery | Neighbour-leaf test: among revision pairs printing no page number, 94.7% same leaf, 1.6% shifted, 3.7% ambiguous; failures concentrate in the 0–0.3 agreement band (77/5/18) *Compares ±1 only; under-reports larger offsets.* | 180 / 3 / 7 of 190 | 190 usable of 200 | **log only** | scripts/eval/neighbour-leaf-test.mjs | .claude/docs/ocr-quality-measurement-loop.md 2026-08-05 |
| S1 | repeat stability | page_revisions is a mixed record: the largest source (shift-repair-erara-2026-07, 29.5% of 191,221 pairs) is bulk text relocation, 99.0% leaf-shifted; batch_api 57.5% / 3.8% shifted; pipeline_preview 6.8% / 0.8%; ai 4.5% / 0% *Segment by source before any number over page_revisions.* | as stated | 191,221 pairs | **log only** | scripts/audit/ocr-revision-provenance.mjs (free, ~2 min) | .claude/docs/ocr-quality-measurement-loop.md; data-provenance.md 2026-08-01 |
| S2 | repeat stability | Same-leaf same-model same-prompt repeat agreement by language (stability, not accuracy): English n=14,951 median 0.9995, 0.75% below 0.5; Arabic n=249 median 0.7875, 13.65% below 0.5; Persian n=297 median 0.8015, 9.76% below 0.5 *The doc's table (English 13,102 / 2.3% below 0.85; Arabic 243 / 59.7%; Persian 274 / 70.1%) and its 63,572-pair total match no committed file; the row-level JSONL it cites was never committed. Use the committed summary or rebuild the corpus. Carries the unrecorded thinking/temperature confound (#4613).* | strata_same_leaf block | 14,951 / 249 / 297 | **corrected** | scripts/eval/results/revision-agreement-corpus-2026-08-02.json | .claude/docs/ocr-quality-measurement-loop.md 'instability by language' table |
| S3 | repeat stability | The lexical repeat metric does not transfer to translation: median agreement 0.685, 89.4% of pairs below 0.85 (vs 9.3% for OCR); paraphrase and real meaning disagreements score alike *Needs a semantic comparison; not built.* | 0.685 / 89.4% | 331 same-leaf pairs (of 130,049 rows; only 2.0% carry a page number) | **log only** | scripts/eval/results/revision-agreement-corpus-translation-2026-08-02.md | .claude/docs/ocr-quality-measurement-loop.md 2026-08-02 |
| S4 | repeat stability | Plate/text specification gap flip rate is 0.34% of illustrated pairs, not 30% (30.4% was the share of unstable pages carrying an illustration — a co-occurrence) *A methods example: bucket size read as effect size.* | 3 / 893 | 893 illustrated same-leaf pairs | **log only** | scripts/eval/plate-flip-rate.mjs | .claude/docs/ocr-quality-measurement-loop.md |
| S5 | repeat stability | Repeat-instability preregistration ran: 6/8 decided pairs support the claim (p = 0.29), underpowered; the results file says 'do not quote 75% as a finding' *Fully blinded draw + key + verdicts committed — a model for the rest.* | 6/8, p=0.29 | 8 decided of 12 planned | **verified** | scripts/eval/results/repeat-instability-2026-07-31/ (RESULTS.md, key.json, verdicts.json; not in bundle, committed) | scripts/eval/PREREGISTRATION-repeat-instability.md; #3473 |
| S6 | repeat stability | A prompt A/B result reversed under replication: at k=5 the runaway loop landed on opposite arms in two runs (16,264±0 vs 554±65; 348±4 vs 16,232±0). Loop rate must be a Bernoulli outcome, not a body-length mean *Why the log has a 'replicated?' column.* | reversed | k=5 × 2 runs, 1 page | **verified** | scripts/eval/results/prompt-ab-v15-v17-lacuna-2026-09-02-amended.json | EXPERIMENTS.md 2026-09-02; PR #4610 |
| B1 | specialist benchmark | Ten sealed strata, one page per book, seeded; 350 sealed pages (424 with spares), 345 ran; japanese-ext ran 115 of 120 *The brief and the log say 370. Registries carry n_with_ref = 0 for every stratum except Chinese (28/40); references live in the ref-pinned (55) and ref-ws (120) tiers.* | 350 (not 370) | armenian 20, chinese 40, german-fraktur 20, greek 30, japanese 40, japanese-ext 120, latin-1700s 20, latin-pre1700 20, longs-en-fr 20, syriac 20 | **corrected** | scripts/eval/benchmark/*.json; scripts/eval/results/benchmark/summary-2026-09-16.json | #4735; PR #4885; EXPERIMENTS.md 2026-09-15 |
| B2 | specialist benchmark | Wikisource Latin n=65: flash-preview 0.7% median CER (31W/7L vs lite, p<0.001), lite 1.1%, Kraken CATMuS 1.2% (n.s.), Surya 2 1.6%, Tesseract 4.0% *Latin reference error (1.15%) is the same size as the Kraken–Gemini gap: 'Latin is a tie' is the arithmetic.* | 0.007 / 0.011 / 0.012 / 0.016 / 0.040 | 65 | **verified** | scripts/eval/results/benchmark/ref-ws-2026-09-16.json | EXPERIMENTS.md 2026-09-15 |
| B3 | specialist benchmark | Wikisource German n=30: flash-preview 0.3%, lite 0.6%, Surya 2.3%, Tesseract frk 3.9%, Kraken austriannewspapers 6.2% on 14/30 | 0.003 / 0.006 | 30 | **verified** | scripts/eval/results/benchmark/ref-ws-2026-09-16.json | EXPERIMENTS.md 2026-09-15 |
| B4 | specialist benchmark | Greek pinned n=17: flash-preview 0.1%, lite 0.4%, Kraken greek-cllg 0.5% on 14 aligned (6/7/1, p=1; 4 catastrophic); Armenian pinned n=9: flash 2.1% (8/0), lite 3.4%, Calfa Tesseract 3.9% *Bench 2's Kraken≈Gemini Greek tie replicated on 14 pinned pages.* | 0.001 / 0.004 / 0.005; 0.021 / 0.034 | 17; 9 | **verified** | scripts/eval/results/benchmark/ref-pinned-2026-09-16.json | EXPERIMENTS.md 2026-09-15 |
| B5 | specialist benchmark | Chinese canon windows n=28: PaddleOCR-VL 0.149 median CER (18/7 vs lite, p=0.043), flash-preview 0.163, lite 0.191, Surya 0.188, NDL 0.250, Tesseract 0.73 *References cut from CBETA/Kanripo windows (licence field absent on the refs files).* | 0.149 / 0.163 / 0.191 | 28 of 40 | **verified** | scripts/eval/results/benchmark/chinese-2026-09-16.json | EXPERIMENTS.md 2026-09-15; #4743 |
| B6 | specialist benchmark | Kuzushiji: on 45 cursive pages the two Gemini arms disagree with each other (median distance 0.63; 28 > 0.5; 4 loops each) while NDL classical OCR v3 has 0 loops and reads the book's own text; on 84 woodblock-regular pages NDL↔lite 0.53 is a convention gap (inline kunten/furigana), not misreads *Script class per page from a flash-preview classifier (10/10 vs eye on the cursive axis) — the catalogue year is the WORK's date.* | 0.634; 28; 0; 0.529 | 45 (44 scored); 84 (83 scored) | **verified** | scripts/eval/results/benchmark/japanese-2026-09-16.json + japanese-ext-2026-09-16.json | EXPERIMENTS.md 2026-09-15; #4745 |
| B7 | specialist benchmark | Syriac stratum n=20: flash-preview vs lite distance 0.77, 16 pages > 0.5; every specialist ≥ 0.82 from lite; one Serto page: lite one line of John 6:32 (recitation), flash-preview 448 lines (loop) *Two failure kinds named on one page: recitation and loop.* | 0.773; 16 | 20 | **verified** | scripts/eval/results/benchmark/syriac-2026-09-16.json | EXPERIMENTS.md 2026-09-15; #4746 |
| B8 | specialist benchmark | Syriac IS read by Kraken: Sophro Mhiro 0.188 order-free line CER against published GT (Jerusalem 0.173, ÖNB 0.232), 40/0 wins over lite; flash-preview 0.736, lite 0.791, lite loops on 16/40 *External reference: HTR Winter School GT sets (PAGE XML, CC BY 4.0). Kraken run with -d horizontal-rl; nothing reversed post hoc. k=1 per engine.* | 0.188; 40/0/0 (p=0.0); 0.736 / 0.791; 16/40 | 40 manuscript pages + 8 print | **external** | scripts/eval/results/benchmark/syriac-retest-2026-09-16/score.json, score-table.md | EXPERIMENTS.md 2026-09-16; #4901; #4883 |
| B9 | specialist benchmark | Bench 2 (print): Kraken CATMuS +0.18pp [−0.28,+0.68], Surya 2 −0.04pp, CHURRO −0.69pp vs Gemini on pages both align; Gemini aligns 52/56, Kraken 25/56; Latin escalation 40%, Greek 0% *Tiny n; superseded by the 2026-09-16 benchmark at 13× the n. Coverage, not accuracy, is the finding.* | per-segment deltas in file; paired totals only in the log | 5 Latin / 4 Greek / 2 German diplomatic pages | **log only** | scripts/eval/results/bench2-escalation-2026-09-03.json (per-segment meanDeltaPp and clearGuardPct); paired totals and coverage counts only in EXPERIMENTS.md 2026-09-03 | PREREGISTRATION-bench2-print.md; #4523 |
| B10 | specialist benchmark | Google Cloud Vision is no lane: aligns 37/55 pinned pages (lite 52/55); where both align loses to lite 3W/19T/15L (p=0.0075); zero invention by eye (n=5); Tibetan Derge identity 0.339 vs 0.453, loses 20/20 *52/55 for lite is derived (37 both + 15 lite-only). Vision's per-block confidence is a possible triage signal.* | 37/55; 3/19/15; 0.339 | 55; 37 pairs; 20 | **verified** | scripts/eval/results/vision-vs-gemini-2026-09-11.json, .md | EXPERIMENTS.md 2026-09-11 |
| B11 | specialist benchmark | Lite fails on early-modern manuscripts and incunables while flash reads them: flash better on 11/11 read; lite runaway loops 2.4–9.9× longer, and silently renders long s as f on 16th–17th-c. roman type *Pre-spend pilot, no metric, k=1. Not a general claim about lite (Chinese A/B found lite competitive).* | 11/11 by human read | 11 books, 1 page each | **log only** | raw arms uncommitted (scratchpad); table in #4541 comment 2026-09-15 | EXPERIMENTS.md 2026-09-15; #4541 |
| B12 | specialist benchmark | Engine output conventions read as errors on a proxy: NDL writes kunten/furigana inline and shinjitai; Kraken emits Syriac lines left-to-right by default *Normalisation choices decide the verdict; declare them.* | NDL↔lite 0.53 on regular woodblock | 84; 40 | **verified** | japanese-ext-2026-09-16.json; syriac-retest score.json | EXPERIMENTS.md 2026-09-15/16; memory lesson |
| F1 | fabrication | Reference-free fabrication detector (specialist convergence + VLM-to-ink agreement + overrun): 51/51 known positives flagged, 0/5 false positives, threshold plateau 0.10–0.40; abstains on the highest-risk pages (hard image breaks the CTC engines and pushes the VLM onto memory) *Positive and negative classes differ in script, medium and engine set — separation orders known-bad above known-good, not within early-modern print. Overrun median 0.93×, only 38/203 > 1.6×: the agreement gap carries the signal.* | tp 51, fp 0; 56 judged of 349 | 349 pages (313 Tibetan folios + 36 print) | **verified** | scripts/eval/results/fabrication-detector-2026-09-05.json | EXPERIMENTS.md 2026-09-05; #4523 |
| F2 | fabrication | Memorization subsidy (canonical vs non-canonical reference text on matched pages): within-work pairs manuscript 3–9pp, print 0–2pp; pooled across unmatched pages it vanishes into page-difficulty noise (pro +1.19pp, lite −0.08pp, flash −1.31pp at n=40) *The paper's abstract line ('~1pp Pro-class, ~5pp small models') contradicts its own pooled table, where small models are negative; the ~5pp is a within-work per-model cell. Quote the within-work pairs, not the abstract.* | see note | 44 pages, 980 reference-scored observations; corpus arm 109,953 revision pairs | **verified** | scripts/eval/observations/ocr-observations-2026-07-*.jsonl + report-canonical-gap.mjs (committed; not in bundle); dataset v0.3 | .claude/docs/ocr-memorization-paper.md; paper/reading-or-reciting-chr2027.md; #3235 |
| F3 | fabrication | Front-matter re-read: of 150 books with a model-identified title page (226 pages), 98 (65%) differ from the Archive's reading; in 48 the model's title carries catalogue-title words the Archive lacks (6 the other way); 1 invention (a subtitle supplied from memory on a degraded scan) in 16 hand-read cases *The brief said '150 title pages', 'recovers the title in 48 books' and '1 of 14'. Attach a date to the hand-read tally.* | 98/150; 48; 1/16 | 2,884 pages / 279 books re-read; 150 books titled | **corrected** | scripts/maintenance/reocr-ia-frontmatter.mjs --report; raw outputs on Hetzner /root/frontmatter-4815/ (not committed) | #4815 (results, 2026-09-15), PR #4840, hand-read tally on #4780 (12 → 14 → 16 within three days) |
| F4 | fabrication | Corpus loop scan: 6,091,450 judged pages → 69,223 loops (1.14%); 53,628 already translated (withholding call open); 15,595 untranslated loop pages across 1,840 books that the translate-side pre-flight will stop *The brief's '15,595 saved' is prospective, not realised. Rerun and commit the JSONL.* | 69,223 / 53,628 / 15,595 | 6.09M pages | **corrected** | scripts/audit/ocr-loop-corpus.mjs (committed) → scripts/output/ocr-loops.jsonl (not committed) | #4765 comment 2026-09-15; #4850 table; guards in scripts/lib/translate-core.mjs |
| F5 | fabrication | Old policy looks like live drift: of 46,705 OCR'd Syriac pages, 2,160 loop; 1,465 (68%) were written by the retired lite-preview model (11.8% of its 12,425 pages) vs 661 (2.1% of 31,012) for current flash-preview *Deterministic and free to rerun; numbers as published are unbacked by a committed file. Current Gemini does not fix printed Syriac (lite loops, flash fabricates the running head).* | 2,160; 68%; 11.8% vs 2.1% | 46,705 pages | **log only** | scratchpad/syriac-vs-published/out/2026-09-16-syriac-loop-pages.jsonl (untracked); scanner scripts/audit/ocr-loop-corpus.mjs | EXPERIMENTS.md 2026-09-16; #4883 |
| F6 | fabrication | A positive control can share the instrument's blind spot: a one-page e-text window capped two-leaf Tibetan folios (~470–600 syllables) near 0.5; re-scoring the same reads with windowing gives 0.93–0.97; every Derge identity published before 2026-09-11 is an underestimate for long pages *The brief's '0.97 single-page control' conflates two things: 0.968 is a synthetic positive control (a true e-text page + 5% noise), and 0.93–0.97 is the windowed re-score.* | ~0.5 → 0.93–0.97 | EAP two-leaf captures | **corrected** | ops repo eval-tibetan/kanjur_align.py (score_page); results-2026-09-04/mss-scores.jsonl; the windowed re-score is prose only | .claude/docs/invariants/measurement-instruments.md; #4523 |
| R1 | reference quality | How wrong is the ground truth: Wikisource level-3 reference error Greek 0.07% CI [0.02,0.13] (n=18), German 0.06% (n=15), Latin 1.15% CI [0.17,2.47] (n=36); 39 of 69 pages exact *Greek/German engine gaps are 20× the reference noise; the Latin Kraken–Gemini gap is the same size as the reference error.* | 0.000688 / 0.000588 / 0.011450 | 69 | **verified** | scripts/eval/results/reference-error-2026-09-05.json | EXPERIMENTS.md 2026-09-05; Track B #4523 |
| R2 | reference quality | Our own reference cleaner was the bigger error: a template-stripping bug deleted 6.0% of Greek reference letters, 3.8% Latin, 0.9% German; re-scoring moved Greek lite accuracy 97.8% → 99.6% and one page 59.7% → 100.0% *The Greek correction (1.8pp) exceeds the Greek engine gap it was used to judge (1.5pp).* | 0.0604 / 0.0379 / 0.0093 | 39 / 93 / 17 pages | **verified** | scripts/eval/results/reference-error-2026-09-05.json (instrument_C) | EXPERIMENTS.md 2026-09-05 |
| J1 | model as judge | A Sonnet judge cannot carry a p-value at n=60: test–retest arm-vs-lite direction agreement 52/100 (six-arm read) and 24/40 = 60% (three-arm read); the preview-vs-lite verdict flipped between passes from 27–26–7 (p=1.0) to 31–16–13 (p=0.040) on the same translations *Fabrication flags per arm (deepseek-v4.1 14, pro 16, preview 21, lite 22, 2.5-flash 28, qwen 31 of 60) are the sturdier signal.* | 52%; 60%; p 1.0 → 0.040 | 60 pages / 60 books; 20 re-judged | **verified** | scripts/eval/results/translation-model-ab-zh-report.md, .json; 3arm judge verdicts + keys | EXPERIMENTS.md 2026-09-13/14; #4762 |
| J2 | model as judge | A 'verified note' rate measures citation FORMAT, not accuracy: preview writes pinyin in original: fields that a verbatim verifier cannot match (0.79 / 0.02 / 1.00 across arms) | instrument note | 60 | **verified** | scripts/eval/results/translation-model-ab-zh-report.md | EXPERIMENTS.md 2026-09-13 |
| J3 | model as judge | Translation prompt v15: verified-note rate 66.7% → 96.3% (Δ +28.9pp, CI [+14.7,+44.7]; sign test 13–0) while writing more notes — but interpretive notes fall 1.27 → 0.81 per page (−36%) in every stratum and a blind judge scores 8:1 against v15 on 30 pairs; not shipped *Cost $1.26. Hebrew 8% → 93% verified, Arabic 29% → 100%: on those scripts v13's citations were mostly fabricated.* | 0.6667 → 0.9634; 1.27 → 0.81; 8:1 | 320 pages, 8 strata × 40, one per book; 30 judged pairs | **verified** | scripts/eval/results/translation-prompt-v15-report-2026-09-12.json, .md | PREREGISTRATION-translation-prompt-v15.md; PR #4758, #4767; #3825 |
| J4 | model as judge | Batch-API translation continuity: seeded/chained batch beats plain batch 41–11 by blind judge; seam-repair second pass ties production; decision 'do not migrate' (rung 5) *Production failed its own −5pp non-inferiority bound at n=17 — run the A-vs-A noise floor first.* | 41–11 (5 ties); $2.72 | 57 boundaries scored of 58 | **log only** | results on unmerged branch eval/batch-continuity-run (translation-batch-continuity-report-2026-09-17.json); PR #4912 | PREREGISTRATION-translation-batch-continuity.md; #4681 |
| P1 | provenance | Generation parameters (thinkingBudget, temperature, maxOutputTokens) are recorded nowhere; two production OCR paths ran the same model and prompt at temperature 1.0 and 0.1, one with thinking on until #4591 *Every repeat-stability figure spanning 2026 carries this confound.* | gap open | — | **log only** | .claude/docs/data-provenance.md GAP note; #4613 | #4613, #4581, #4591 |
| P2 | provenance | Thinking-on vs thinking-off arms of the same images agreed only 74% (Latin, words) / 43% (Classical Chinese, characters) *Quoted in a committed doc; no artifact or thread reproduces the agreement statistics. Re-run (20 pages, ~$1) before the doc or the paper quotes it.* | not found | 20 pages (12 zh, 8 Latin) | **unreproduced** | none — #4581's measurement comment (2026-09-03) reports token volume and cost only (thinking off: +2.4% output, +3.4% words) | .claude/docs/data-provenance.md GAP note |
| P3 | provenance | No current OCR writer emits prompt_id / prompt_hash / prompt_name (0/300 recent, 0/800 May-2026 sample); translation realtime path 100%, batch 19% *An OCR page ties to a prompt version string, not to the prompt text.* | 0/300; 0/800; 100% / 19% | 1,100; 600 | **log only** | data-provenance.md corrected 2026-09-03 | #4613 |
| E1 | cost | OCR cost per 1K pages: $3.42 measured on flash realtime (125,585 pages / $429.85, 30 d) → $0.85 after route-by-book to lite batch (#4730) *The 'after' figure rests on 273 pages and disagrees with the separately measured lite-batch image OCR rate of $0.00148/page = $1.48/1K (EXPERIMENTS.md 2026-09-12). Realtime lite measured at $3.02/1K (2026-09-13). Re-measure over a month before publishing a frontier.* | $3.42 → $0.85 | 125,585 pages; 273 pages | **corrected** | PR #4730 body; memory/pipeline-ops.md table; ad-hoc gemini_usage queries, no result file | #4729, PR #4730 (2026-09-11) |
| E2 | cost | Translation model cost per page (realtime, batch halves it): qwen3.8-flash $0.0005, deepseek-v4.1 $0.0010, 2.5-flash $0.0012, lite $0.0017, deepseek-pro $0.0024, flash-preview $0.0037 *OpenRouter arms are provider-reported; Gemini arms are list price × tokens.* | as stated | 60 pages per arm | **verified** | scripts/eval/results/translation-model-ab-zh-report.md | EXPERIMENTS.md 2026-09-14 |
| E3 | cost | Specialist engines are near-free on CPU: Kraken ≈ €0 (Hetzner CPU, 20–50 s/page), Surya 2 €0.00094/page on an L4, NDL 2–5 s/page on an L4; the benchmark's real cost was idle GPU (≈ $52 vs $35 approved) *Process finding: a dead-man switch must call the provider's stop API, not the guest's poweroff.* | see log | — | **log only** | EXPERIMENTS.md 2026-09-03 and 2026-09-15 cost lines | #4735 |
| V1 | volunteers | 1,090 volunteers, 1,088 with a self-description; declared competence by keyword: Spanish 514, translator 134, Dutch 128, academic 100, French 48, German 38, Italian 35, Russian 28, Latin 21, Hebrew 21, Arabic 20, Chinese 15, Greek 13, Tibetan 7, Japanese 3, Armenian 3, Syriac 0 *Volunteers anchor Latin-script and modern-language claims; specialist scripts need paid or partner expertise.* | as stated | 1,090 | **log only** | /root/sl-ia-cache/_runs/volunteer-intros.mjs on Hetzner (not committed) | #4916 comment 2026-09-18 |
| V2 | volunteers | Review queues today: 5 live, 9,137 pooled candidates, 104 ratings ever (all Aug 2026, 8 raters, two account for 81), 4 items with two votes, none with three, zero gold items, nothing consumes volunteer_ratings *No inter-annotator agreement is computable from what exists.* | as stated | 104 ratings | **log only** | Supabase volunteer_ratings via src/app/api/review/stats/route.ts; scripts/maintenance/build-review-candidates.mjs (is_gold hardcoded false) | #4920 (measured 2026-09-18); #3560, #3635, #3958 |
