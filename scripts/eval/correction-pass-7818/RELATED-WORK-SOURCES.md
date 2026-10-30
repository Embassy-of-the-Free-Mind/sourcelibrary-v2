PRIOR ART: /root/jobs/correction-test-7818/inbox-files/review-external.md (Derek's external review, 2026-10-30) — this is that file with every citation checked against the source; none — no other related-work list for #7818 exists.

# Related-work sources for #7818, checked against the papers (2026-10-30)

Method. On 2026-10-30 each cited URL was opened (arXiv abstract, ACL Anthology, publisher or repository page; a PDF where the page failed). The `checked` column says what that showed. Only the abstract or the page text was read, except for three PDFs read directly (Freitag 2021 section 3.3, Koehn 2004, Graham 2014).

- `verified`: opened; title, authors and the attributed claim match.
- `verified, claim adjusted`: the work exists, but the claim, authors, year or venue in the original review was wrong or not supported by what could be read. The row carries the corrected text. A claim that could not be confirmed was removed from the row, not kept with a hedge.
- Rows whose source could not be opened, or did not match, were dropped (see `## Dropped`).

---

## 1. OCR/HTR metrics and benchmarks

| Work | What it measures / finds | URL | checked |
|---|---|---|---|
| Clausner, Pletschacher, Antonacopoulos (2020), "Flexible character accuracy measure for reading-order-independent evaluation", Pattern Recognition Letters 131 | Edit-distance accuracy depends on how the text is serialised, and the reading order is often wrong in multicolumn and complex layouts. The flexible character accuracy measure compares text without a fixed order. (The abstract does not discuss bag-of-words or the drawbacks listed in the earlier review.) | https://primaresearch.org/publications/PRL_Clausner_FlexibleCharacterAccuracy | verified, claim adjusted |
| Chiron, Doucet, Coustaty, Visani, Moreux (2017), "ICDAR2017 Competition on Post-OCR Text Correction", ICDAR 2017 | Two tasks (error detection, error correction). 12M OCR symbols with aligned ground truth (80% train, 20% evaluation), newspapers and monographs in English and French. 11 teams submitted; only about half of the methods denoised the evaluation set on average. 35 registrations. | https://sites.google.com/view/icdar2017-postcorrectionocr ; https://l3i.univ-larochelle.fr/ICDAR2017PostOCR (404 on 2026-10-30) | verified, claim adjusted (fifth organiser Visani added; the 12M, 11 teams and "half" figures confirmed from the competition's own summary via search) |
| Rigaud, Doucet, Coustaty, Moreux (2019), "ICDAR 2019 Competition on Post-OCR Text Correction", ICDAR 2019 | 22M OCR characters (754,025 tokens), unequal share of 10 European languages, 80/20 train/evaluation split. Two tasks (detection, correction). 5 teams; detection scores 41-95%; best correction improvement 44%. 34 registrations. | https://hal.archives-ouvertes.fr/hal-02304334 (blocked by a bot check) ; https://zenodo.org/records/3459116 | verified, claim adjusted (author list confirmed as Rigaud, Doucet, Coustaty, Moreux. The scoring details in the earlier review, "weighted sum of Levenshtein distances per token" and the "#" and hyphen exclusions, could not be read and are removed.) |
| OCR-D Ground Truth Guidelines, transcription levels 1-3 | Three levels of reproduction of the original. Level 1 is a normalised transcription; Level 2 keeps graphemic phenomena such as abbreviation marks with modest normalisation; Level 3 is the most detailed, with minimal normalisation. Limited compatibility between levels, mostly only downward (3 to 2 to 1). OCR-D recommends Level 2 for ground truth. The guidelines have level-specific rules for long s, macrons, ligatures and abbreviation marks. | https://ocr-d.de/en/gt-guidelines/trans/trLevels.html | verified, claim adjusted (the DTA and Kitodo statements in the earlier review could not be confirmed and are removed) |
| Beyene and Dancy (2026), "A Survey of OCR Evaluation Methods and Metrics and the Invisibility of Historical Documents", arXiv:2603.25761 (submitted 2026-03-26) | Surveys papers and datasets 2006-2025, with Black historical newspapers as the case. Evaluations emphasise character accuracy on modern layouts and miss structural problems such as column collapse and text hallucination. Does not itself propose a severity weighting. | https://arxiv.org/abs/2603.25761 | verified |
| "Assessing advanced handwritten text recognition engines for digitizing historical documents" (2025; PyLaia, HTR+, IDA, TrOCR-f, Transkribus Titan) | Handwriting, not print. All engines can be trained or fine-tuned to improve; Titan and TrOCR-f show the best out-of-the-box results on Latin-script documents. (The earlier claim that "language models affect recognition performance" was not confirmed.) | https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12202554/ (opened only through a search summary; the PMC page itself is behind a bot check) | verified, claim adjusted |

Gaps in what was found (unchanged from the earlier review): no head-to-head CER benchmark of Kraken or eScriptorium against Transkribus or PERO on printed Fraktur; PERO not covered; nothing located on long-s handling in CER beyond the OCR-D levels page.

Implication for us:
- CER vs Wikisource: already doing the standard thing. Gap: state the normalisation level explicitly (OCR-D Level 1 vs Level 2-3 style: long-s, ligatures, abbreviations, u/v, i/j) and report CER at both diplomatic and normalised levels, since Wikisource proofreaders typically modernise some of these.
- Adopt a reading-order-independent score (flexible character accuracy) alongside CER for multi-column pages so layout errors are not folded into text-error counts.

---

## 2. Reference-free OCR quality estimation

| Work | What it does | URL | checked |
|---|---|---|---|
| Booth, Shoemaker, Gaizauskas (2022), "A Language Modelling Approach to Quality Assessment of OCR'ed Historical Text", LREC 2022 | Language-model-based ranking of OCR versions of British Library Newspapers with no manually corrected reference, using the Old Bailey Proceedings as a genre-adjacent corpus. | https://aclanthology.org/2022.lrec-1.630 | verified |
| Schneider and Maurer (National Library of Luxembourg), "Rerunning OCR: A Machine Learning Approach to Quality Assessment and Enhancement Prediction", arXiv:2110.01661; Journal of Data Mining & Digital Humanities 2022 | Quality assessment at text-block level, plus a regression model that predicts whether a newer OCR engine will improve a document. (The "102k issues, German, French, Luxembourgish" figures were not on the page and are removed.) | https://arxiv.org/abs/2110.01661 | verified, claim adjusted |
| Clausner, Pletschacher, Antonacopoulos (2016), "Quality Prediction System for Large-Scale Digitisation Workflows", DAS 2016 | A classifier is trained on metadata, image, layout and text features against measured OCR success on a small ground-truth set; at prediction time only page images are needed. Validated on Europeana Newspapers pages. (The earlier "image-only features" and the "6.1% average error" were not confirmed; the figure is removed.) | https://www.primaresearch.org/www/assets/papers/DAS2016_Clausner_QualityPrediction.pdf | verified, claim adjusted |
| Springmann, Fink, Schulz (2016), "Automatic quality evaluation and (semi-)automatic improvement of OCR models for historical printings", arXiv:1606.05157 | Two measurable quantities correlate with true accuracy: mean character confidence (OCRopus) and mean token lexicality (distance from modern word forms, allowing for historical spelling). Fully automatic improvement gives only 1-2 points; 100-200 hand-corrected lines give much more. | https://arxiv.org/abs/1606.05157 | verified, claim adjusted (the "two quantities" are named; the page did not display the author list, kept from the review) |
| Ströbel, Clematide, Volk, Schwitter, Hodel, Schoch (2022), "Evaluation of HTR models without Ground Truth Material", LREC 2022, arXiv:2201.06170 | Compares lexicon-based, language-model-based and masked-language-model-based evaluation without ground truth; MLM-based evaluation "can compete with lexicon-based methods". | https://arxiv.org/abs/2201.06170 | verified, claim adjusted (authors and venue added) |

Not found: any Impresso-specific or Chronicling America-specific quality-estimation paper. Do not attribute methods to those projects.

Implication: we have no reference-free signal besides the LLM judge. Cheap complements: dictionary/lexicon hit-rate, LM perplexity (period-appropriate LM), and engine confidence, used to triage which pages get the expensive judge. Important caveat from our own domain: a fluent LLM read has low perplexity even when wrong (see area 4), so perplexity-based estimators are blind to exactly the failure we worry about with VLM readers.

---

## 3. Downstream impact of OCR errors

| Work | Finding | URL | checked |
|---|---|---|---|
| van Strien, Beelen, Coll Ardanuy, Hosseini, McGillivray, Colavizza (2020), "Assessing the Impact of OCR Quality on Downstream NLP Tasks", ICAART 2020, pp.484-496 | Six tasks: sentence segmentation, NER, dependency parsing, information retrieval, topic modelling, neural language model fine-tuning. OCR errors have a consistent impact, some tasks are much more affected than others; preliminary recommendations for practitioners. | https://www.scitepress.org/Papers/2020/91690/ | verified |
| Hamdi, Jean-Caurant, Sidere, Coustaty, Doucet (2019), "An Analysis of the Performance of Named Entity Recognition over OCRed Documents", JCDL 2019 | Studies how OCR errors affect named entity recognition and relates NER performance to OCR accuracy; NER systems recover some entities even when the OCR contaminates them. (The "NER drops even at CER 1.7%" figure could not be confirmed and is removed.) | https://zenodo.org/records/3243344 | verified, claim adjusted |
| Hamdi, Jean-Caurant, Sidere, Coustaty, Doucet (2020), "Assessing and Minimizing the Impact of OCR Quality on Named Entity Recognition", TPDL 2020 | Synthetic noise of several types and levels applied to CoNLL-02/03 to test NER; reports a multilingual study and an improvement on Finnish historical newspaper data. | https://zenodo.org/records/4734376 | verified, claim adjusted |
| Hamdi, Pontes, Sidère, Coustaty, Doucet (2023), "In-depth analysis of the impact of OCR errors on named entity recognition and linking", Natural Language Engineering 29(2):425-448 | Documents with different levels and types of OCR noise, assessing the impact on both NER and entity linking. (Only the metadata and the summary were read; the earlier "recommendations on thresholds" were not confirmed and are removed.) | https://l3i.univ-larochelle.fr/Publications/in-depth-analysis-of-the-impact-of-ocr-errors-on-named-entity-recognition-and-linking/ | verified, claim adjusted |

Chiron et al. 2017 (ICDAR2017) is the Chiron citation that was verified; their separate IR-impact work was not found and is not cited.

Implication: this is the strongest external evidence for severity being non-uniform: the same OCR quality hurts different uses differently. van Strien shows the task dependence directly; the Hamdi papers show it for named entities. Our "misleads" vs "cosmetic" split encodes this at the reader level; the literature measures it extrinsically (NER/IR), not by a rater-assigned severity. Gap: we could report, per defect class, an entity/number-error rate as an extrinsic proxy.

---

## 4. LLM-based post-correction (2023-2026)

| Work | Setup and finding | URL | checked |
|---|---|---|---|
| Boros, Ehrmann, Romanello, Najem-Meyer, Kaplan (2024), "Post-Correction of Historical Text Transcripts with Large Language Models: An Exploratory Study", LaTeCH-CLfL 2024, pp.133-159 | Fourteen foundation models, several post-correction benchmarks across languages, periods and document types, zero-shot and few-shot, varied model size and prompt complexity. Headline in the abstract: "LLMs are anything but efficient at this task". | https://aclanthology.org/2024.latechclfl-1.14 | verified, claim adjusted ("four series" removed; not on the page) |
| Thomas, Gaizauskas, Lu (2024), "Leveraging LLMs for Post-OCR Correction of Historical Newspapers", LT4HALA 2024, pp.116-121 | BLN600 (19th-century British newspapers). Instruction-tuned Llama 2 against fine-tuned BART: Llama 2 reduced CER by 54.51%, BART by 23.30%. Positive result, opposite in sign to Boros. | https://aclanthology.org/2024.lt4hala-1.14 | verified, claim adjusted (results added) |
| Kanerva, Ledins, Käpyaho, Ginter (2025), "OCR Error Post-Correction with LLMs in Historical Documents: No Free Lunches", RESOURCEFUL 2025 | Open-weight LLMs reduce CER on historical English; for Finnish "a practically useful performance was not reached". Explores quantisation and segment length. (The claim that earlier GPT-4 studies "were mostly negative" is not in the abstract and is removed.) | https://arxiv.org/abs/2502.01205 | verified, claim adjusted |
| Greif et al. (2025), "Multimodal LLMs for OCR, OCR Post-Correction, and Named Entity Recognition in Historical Documents", arXiv:2504.00414 | German city directories 1754-1870. The best multimodal LLM significantly outperforms conventional OCR models in transcription; a new multimodal post-correction approach reaches error rates below 1% without image preprocessing or fine-tuning. (The abstract does not name Gemini 2.0 Flash for the sub-1% result and does not say "image context substantially improves accuracy"; both removed. Author list not displayed on the page.) | https://arxiv.org/abs/2504.00414 | verified, claim adjusted |
| Gardella, Mariño, Belzarena, Ramírez, Randall, Morel (2026), "When Low CER is Not Enough: An Analysis of Hallucinations in Vision-Language OCR Systems on Historical Uruguayan Documents", arXiv:2607.24077 (submitted 2026-07-27, v3 2026-09-17; ADAPDA 2026 workshop at ICDAR 2026) | Strong character-level accuracy hides "orthographic normalization, spurious content generation, and semantic substitutions"; argues traditional error metrics miss these. | https://arxiv.org/abs/2607.24077 | verified, claim adjusted (it exists and resolves; the earlier "(verify)" is cleared; authors, date and venue added; it does name orthographic normalisation) |

Implication: Boros and Kanerva are text-only and score with CER; Thomas is text-only with a positive result; Greif uses the image like us. Our image-grounded pipeline is closest to Greif. The literature's own warning (low CER can hide fluent invention and orthographic normalisation; Gardella 2026) is exactly why our judge tags `wrong_text` and `misleads` separately from character edits. Gap: nearly all of these report mean CER improvement; few report the rate of corrections that make a page worse. We should report the "harmed" fraction (pages whose judged fidelity fell) next to mean CER change.

---

## 5. Severity-weighted evaluation in MT

| Work | What it does / finds | URL | checked |
|---|---|---|---|
| Freitag, Foster, Grangier, Ratnakar, Tan, Macherey (2021), "Experts, Errors, and Context: A Large-Scale Study of Human Evaluation for Machine Translation", TACL 2021 | MQM annotation by professional translators with document context on WMT 2020 English-German and Chinese-English systems. Ranked systems differently from crowd workers; some embedding-based metrics matched or beat crowd workers. Corpus released. **Weights (section 3.3, Table 1):** Minor 1; Major 5; Minor Fluency/Punctuation 0.1; Major Non-translation 25; Neutral 0. The paper drops the Critical severity ("we dropped this because its definition is often context-specific"), so **25 is the weight of the single Non-translation category (an entire segment too garbled to annotate), "equivalent to five Major errors", not a weight for "critical"**. Minor was fixed at 1; Major was chosen as 5 from a range of 1-10 by ranking stability. At most five errors are marked per segment. | https://arxiv.org/abs/2104.14478 | verified, claim adjusted |
| Kocmi, Zouhar, Avramidis, Grundkiewicz, Karpinska, Popović, Sachan, Shmatova (2024), "Error Span Annotation: A Balanced Approach for Human Evaluation of Machine Translation", WMT 2024, arXiv:2406.11580 | Combines DA's continuous rating with MQM-style severity span marking, aiming at MQM-comparable quality at lower cost and with less experienced annotators. Tested against MQM and DA on English-German WMT23, 12 systems plus a human reference. (Venue per the review; the arXiv page does not state it. "Adopted by WMT24" was not confirmed and is removed.) | https://arxiv.org/abs/2406.11580 | verified, claim adjusted |
| Zouhar, Kocmi, Sachan (2024), "AI-Assisted Human Evaluation of Machine Translation" (the ESA^AI paper), arXiv:2406.12419; NAACL 2025 | Pre-fills error spans from automatic quality estimation; annotation time per span falls from 71 s to 31 s, with low automation bias; skipping examples the AI deems correct cuts budget by a further 25%. | https://arxiv.org/abs/2406.12419 | verified, claim adjusted (title and venue corrected) |
| Kocmi and Federmann (2023), "GEMBA-MQM: Detecting Translation Quality Error Spans with GPT-4", WMT 2023, pp.768-775 | A fixed three-shot GPT-4 prompt marks error spans; strong system ranking; the authors urge caution using it in academic work to claim improvements, because GPT-4 is proprietary. | https://aclanthology.org/2023.wmt-1.64 | verified |
| Fernandes, Deutsch, Finkelstein, Riley, Martins, Neubig, Garg, Clark, Freitag, Firat (2023), "The Devil is in the Errors: Leveraging LLMs for Fine-grained Machine Translation Evaluation" (AutoMQM), WMT 2023, arXiv:2308.07286 | LLM prompts annotate individual error spans in the MQM style (PaLM, PaLM-2); improves on plain score prediction, more so with larger models; spans align with human annotations. ("Lags learned metrics" was not in the abstract and is removed.) | https://arxiv.org/abs/2308.07286 | verified, claim adjusted |
| Guerreiro, Rei, van Stigt, Coheur, Colombo, Martins (2024), "xCOMET: Transparent Machine Translation Evaluation through Fine-grained Error Detection", TACL 2024, arXiv:2310.10482 | Learned metric that outputs a sentence score plus error spans with severity; reported state of the art on sentence-level, system-level and error-span evaluation, and identifies critical localised errors and hallucinations in stress tests. | https://arxiv.org/abs/2310.10482 | verified |

Weights. Freitag 2021 uses Minor = 1, Major = 5, with Non-translation = 25 and Minor Fluency/Punctuation = 0.1. It does not use a Critical level. "Minor 1, Major 5, Critical 25" is therefore not what that paper does. Some other MQM schemes do include Critical; Freitag says "many MQM schemes include an additional Critical severity" but does not give its weight, and this review did not find Lommel's framework paper. No paper transferring MQM-style severity weights to OCR was found; Beyene and Dancy state that structural and hallucination failures go unmeasured.

Implication: our judge (spans tagged cosmetic / misleads / wrong_text, plus accept and 1-5 fidelity) is structurally an AutoMQM / GEMBA-MQM analogue with a three-level severity scheme; this is a novel transfer to OCR as far as this search can tell. Gap: we do not convert tags into a weighted score with stated weights; MQM's contribution included a documented, fixed weighting, chosen by ranking stability (Freitag: Major from 1-10, 5 best). Adopt: publish a weight table (and test sensitivity to it), say that cosmetic=1 and misleads=5 follow Freitag's Minor and Major, and treat wrong_text=25 as our own choice (Freitag's 25 is for a wholly untranslatable segment). Following ESA, have the judge return the span plus severity, then a scalar.

---

## 6. LLM-as-judge validity

| Work | Finding | URL | checked |
|---|---|---|---|
| Zheng et al. (2023), "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena", NeurIPS 2023 Datasets and Benchmarks | GPT-4 as judge reaches over 80% agreement with controlled and crowdsourced human preferences; documents position, verbosity and self-enhancement biases and limited reasoning. | https://arxiv.org/abs/2306.05685 | verified |
| Panickssery, Bowman, Feng (2024), "LLM Evaluators Recognize and Favor Their Own Generations", NeurIPS 2024 | Models rate their own outputs higher; they recognise their own text with non-trivial accuracy, and fine-tuning for self-recognition strengthens self-preference proportionally. | https://arxiv.org/abs/2404.13076 | verified |
| Doddapaneni, Khan, Verma, Khapra (2024), "Finding Blind Spots in Evaluator LLMs with Interpretable Checklists" (FBI), EMNLP 2024 main, pp.16279-16309 | 2,400 perturbed answers, 22 perturbation categories, four target abilities (factual accuracy, instruction following, long-form coherence, reasoning), five evaluator LLMs. Evaluators failed to identify quality drops in over 50% of cases on average; reference-based evaluation did better than single-answer or pairwise. Outstanding Paper Award. | https://arxiv.org/abs/2406.13439 ; https://aclanthology.org/2024.emnlp-main.911 | verified, claim adjusted (author list: Sumanth Doddapaneni, Mohammed Khan, Sshubam Verma, Mitesh Khapra, from the ACL Anthology listing; "human-vetted" and "even spelling/grammar perturbations were hard" were not confirmed and are removed) |
| Norman, Rivera, Hughes (2026), "Reliability without Validity: A Systematic, Large-Scale Evaluation of LLM-as-a-Judge Models Across Agreement, Consistency, and Bias", arXiv:2606.19544 (submitted 2026-06-17) | 21 judges from nine providers. "Kappa deflation" between exact-match agreement and Cohen's kappa is universal (33-41 points on MT-Bench). Test-retest reliability above 0.95 coexists with severe position bias (above 0.10). | https://arxiv.org/abs/2606.19544 | verified, claim adjusted (range corrected from 34-41 to 33-41; "verify" cleared) |

Implication:
- Planted-error validation: already do, and FBI is the published precedent for it. Adopt FBI's practice of reporting per-category detection, not a pooled rate. Our `cosmetic` class is the likeliest to be missed (FBI's finding that evaluators miss quality drops is pooled; per-class, ours is a hypothesis), so report miss-rate per class.
- Same-family bias: our judge is Claude Opus; the corrected text comes from Gemini, so the Panickssery effect is mitigated for the Gemini pipeline but would apply if a Claude model ever generates or corrects. Gap: say so, and add a spot-check with a different-family judge on a sample.
- Position bias: we grade single outputs against the image, not pairwise, which avoids the main position effect; where we compare two reads side by side, randomise order.
- Test-retest: report it, but pair it with the planted-error hit rate, since reliability does not imply validity (Norman 2026). Use kappa or Krippendorff's alpha, not raw agreement.
- Human agreement: the Zheng 80%-agreement result is on chat preferences, not OCR fidelity; we need our own human-vs-judge agreement on a sample.

---

## 7. Statistics for paired comparison

| Work | Use | URL | checked |
|---|---|---|---|
| Koehn (2004), "Statistical Significance Tests for Machine Translation Evaluation", EMNLP 2004 | Bootstrap resampling to compute the significance of test results, validated on BLEU; even for test sets of only 300 sentences the methods may give assurance that differences are real. (The review's "paired bootstrap became the default; WMT22 used it" is not in the paper and is removed. Graham 2014 describes paired bootstrap resampling, citing Koehn 2004, as "widely used in MT evaluation".) | https://aclanthology.org/www.mt-archive.info/EMNLP-2004-Koehn.pdf | verified, claim adjusted |
| Graham, Mathur, Baldwin (2014), "Randomized Significance Tests in Machine Translation", WMT 2014, pp.266-274 | Compares paired bootstrap resampling, bootstrap resampling and approximate randomisation against a large human evaluation (WMT 2012 systems, two language pairs). Very little difference in accuracy across the three tests. | https://2014.aclweb.org/W14-33/pdf/W14-3333.pdf (the review's mirror.aclweb.org link redirects here) | verified, claim adjusted (full title and authors added; read from the PDF itself) |
| Benavoli, Corani, Demšar, Zaffalon (2017), "Time for a Change: a Tutorial for Comparing Multiple Classifiers Through Bayesian Analysis", JMLR 18(77):1-36 | Argues against null-hypothesis significance testing for comparing classifiers; presents Bayesian correlated t-test, hierarchical model, signed-rank test and the region of practical equivalence (ROPE). | https://www.jmlr.org/papers/v18/16-305.html | verified, claim adjusted (full title and issue added) |

Not located: a primary source for McNemar, for clustered (by-document) bootstrap, or for a beta-binomial acceptance-rate paper; not searched for directly and not cited.

Implication: pages within a book are not independent (we already know this), so resample by book/document, not by page, when bootstrapping; use McNemar (or a paired bootstrap on discordant pairs) for accept/reject of two systems on the same pages; the beta-binomial per-cell approach is consistent with Benavoli's argument for posterior statements and ROPE rather than p-values. Gap: state the ROPE (what difference in accept rate counts as equivalent) in advance.

---

## Where our approach is unusual or ahead, and where it is behind

Unusual or ahead (as far as this search shows):
1. Severity tags on OCR defects (cosmetic / misleads / wrong_text) from an image-grounded judge is an MQM/AutoMQM-style transfer that was not found in prior OCR evaluation; the 2026 OCR evaluation survey says structural and hallucination failures go unmeasured.
2. The judge sees the page image. Most post-correction evaluation (Boros, Kanerva, Thomas) is text-only against re-keyed ground truth; Greif et al. use the image.
3. Planted-error validation of the judge follows the FBI meta-evaluation idea, which OCR/post-correction papers do not routinely apply to their own measuring instrument.
4. Separating "wrong but fluent" from "cosmetic" addresses the documented gap that low CER can hide hallucination and orthographic normalisation (Gardella 2026).

Behind or missing relative to standard practice:
1. No published, fixed severity weighting or sensitivity analysis (Freitag 2021 chose Major = 5 from a 1-10 range by ranking stability).
2. CER normalisation level not stated per OCR-D levels; no diplomatic vs normalised pair; no reading-order-independent metric (flexible character accuracy).
3. No inter-annotator human baseline for the judge in our own domain (human-vs-judge kappa; human-vs-human on the same pages).
4. No different-family judge check (self-preference); no reported per-class miss-rate for planted errors.
5. No reference-free triage signal (lexicon, perplexity, confidence), which libraries use to decide where to spend effort; note perplexity is unreliable against fluent LLM output.
6. Pooled statistics risk: resample by document, report harmed-page fraction, not just mean CER change; pre-register the equivalence margin.
7. Benchmarks: no standard external test sets used (ICDAR 2017/2019 post-OCR data, BLN600, OCR-D GT); running our correction pass on one would give a comparable number. ICDAR 2019 covers ten European languages, which would include several of ours.

---

## Dropped

- Bubula et al., "How scalable is quality assessment of text of ..." (ACH anthology, ~5M pages, BERT pseudo-perplexity): the PDF is over 10 MB and could not be opened by the fetch tool, and three searches did not locate the paper by title or author, so the title, authors and claim could not be confirmed. Dropped. (A related ZB Lab README, "bert-pppl-for-ocr-eval", turned up in search but was not opened and is not cited in its place.)
