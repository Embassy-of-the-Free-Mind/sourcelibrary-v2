# How Much Can You Trust This Page? Consistency-Based Trust Scoring for AI-Transcribed Historical Manuscripts

**Authors:** Derek Lomas, [collaborators TBD]
**Affiliation:** Source Library / Embassy of the Free Mind
**Status:** Draft — experiments in progress

---

## Abstract

Multimodal large language models can now OCR and translate thousands of historical manuscripts at scale, making Renaissance knowledge accessible for the first time. But how much should a reader trust the result? We introduce a reference-free trust metric based on run-to-run self-consistency: transcribe the same page multiple times and measure agreement. On a corpus spanning printed books, handwritten manuscripts, and Leonardo da Vinci's mirror-script notebooks, we find that consistency varies dramatically by text type — from 97% on printed Latin to 27% on medieval manuscripts to 13% on Leonardo's mirror writing — and that all five frontier models tested (Gemini Flash, Gemini Pro, Gemini Lite, Claude Sonnet, Claude Opus) converge to the same range on handwritten text.

We show that consistency scores can drive a practical trust taxonomy for digital libraries: green (>80%, machine-verified), yellow (30-80%, approximate), red (<30%, expert review recommended). Applied to Source Library's 17,000+ books, this system enables honest communication of AI reliability to scholars. The Leonardo da Vinci case study reveals a distinctive failure mode we call "informed confabulation" — the model produces topically correct but textually unfaithful output, identifying the right subject matter while generating different text on each run. We argue that for historical manuscripts, knowing *what you don't know* is as valuable as the transcription itself.

---

## 1. Introduction

In February 2022, one of the authors encountered a 1471 manuscript of Marsilio Ficino's *Liber de Voluptate* at the Embassy of the Free Mind in Amsterdam. The text — a Latin philosophical dialogue on pleasure — had never been translated into English. This encounter led to Source Library, a digital humanities project that has since OCR'd and translated over 17,000 historical books spanning the 15th through 18th centuries, using multimodal LLMs (primarily Google Gemini) for transcription and translation.

The pipeline works remarkably well on printed text. A 1521 Latin printed book yields clean, consistent OCR with character-level accuracy comparable to Transkribus fine-tuned models — without any training data. But when we turned the pipeline to Leonardo da Vinci's mirror-script notebooks, we discovered something unsettling: the AI produced fluent, plausible Italian text about the right topics (optics on optics pages, water dynamics on water pages), but the *specific text changed completely between runs*. The same model, the same image, the same prompt — different words every time.

This paper reports our investigation into that discovery and the quality framework it led us to build. Our contributions are:

1. **A systematic evaluation of multimodal LLM OCR consistency** across text types (printed, manuscript, mirror-script), models (5 frontier models), resolutions, and image orientations.
2. **Evidence that run-to-run consistency is a valid reference-free quality signal** for historical document OCR, correlated with text difficulty and predictive of transcription reliability.
3. **A trust taxonomy** for AI-transcribed historical documents, deployed in production at Source Library, that communicates reliability honestly to users.
4. **The first systematic assessment of automated transcription on Leonardo da Vinci's mirror script**, revealing a failure mode we call "informed confabulation" — topically accurate, textually unfaithful output.

---

## 2. Related Work

Our work sits at the intersection of several active research areas: historical document OCR, multimodal LLMs for text recognition, reference-free quality estimation, and hallucination detection in vision-language models. We survey each in turn.

### 2.1 Historical Document OCR and Handwritten Text Recognition

Optical Character Recognition for historical manuscripts has evolved from rule-based systems through neural sequence-to-sequence models to transformer-based architectures. **Transkribus**, the most widely adopted platform for Handwritten Text Recognition (HTR), offers both CTC-based models (PyLaia) and its proprietary transformer-based "supermodel" (Titan). On well-matched training data, these systems achieve impressive results: the UCL–University of Toronto Medieval Latin model reports a Character Error Rate (CER) of 1.7% on its validation set, and mixed-model fine-tuning on 32 pages of a target manuscript can bring CER down to 1.65% [Constum et al., 2022]. However, performance degrades sharply on out-of-domain material. A model achieving 8.73% CER on its training manuscript can degrade to 73.23% CER on a manuscript of a different text from the same period [Constum et al., 2022], highlighting the brittleness of supervised HTR.

Medieval Latin manuscripts pose particular challenges due to heavy abbreviation — abbreviated words can represent up to half the vocabulary of legal texts — and extreme variability in scribal hands [UCL Transcribe Bentham, 2021]. The CREMMALab project developed generic HTR models for medieval manuscripts across script families [Pinche, 2023], while Clérice [2022] proposed ground-truth-free evaluation of HTR on Old French and Latin manuscripts using deep learning classifiers that bin line-level error rates into ranges without requiring reference transcriptions — an approach conceptually related to our self-consistency metric.

A comprehensive survey by Neudecker et al. [2021] catalogued OCR evaluation tools and metrics, noting that established evaluation methods require ground truth that is "neither feasible nor affordable" at the scale of mass digitization, and that even "standardized" metrics like CER cannot be compared directly between different evaluation tool implementations.

### 2.2 LLM and VLM-Based OCR

The application of multimodal large language models (MLLMs) to document transcription has emerged rapidly since the release of GPT-4V in late 2023. Several concurrent studies in 2024–2025 have demonstrated that frontier MLLMs can match or exceed specialized HTR systems on historical handwriting.

Humphries et al. [2024] ("Unlocking the Archives") systematically compared GPT-4o, Claude Sonnet 3.5, and Gemini 1.5 Pro against Transkribus PyLaia and Titan on a corpus of 50 pages of 18th–19th century English handwriting from 33 writers. LLMs achieved CER of 5.7–7% and WER of 8.9–15.9%, representing a 14% relative CER improvement over Transkribus. With LLM-based post-correction, CER dropped to 1.8% — near human-level accuracy.

Liu et al. [2024] introduced **OCRBench**, a comprehensive evaluation suite of 29 datasets probing multimodal models on text recognition, scene text VQA, document VQA, key information extraction, and mathematical expression recognition. This benchmark revealed systematic weaknesses in multilingual text, handwritten text, and non-semantic text recognition across models including GPT-4V and Gemini.

Kim et al. [2025] provided early evidence that LLMs outperform traditional OCR/HTR systems (EasyOCR, Keras, Pytesseract, TrOCR) on historical tabular records. Crosilla et al. [2025] benchmarked proprietary and open-source LLMs against Transkribus models across English, French, German, and Italian historical documents. Greif et al. [2025] evaluated multimodal LLMs for OCR, post-correction, and named entity recognition on German city directories (1754–1870).

### 2.3 Self-Consistency as Quality Estimation

The use of sampling agreement to estimate output quality without ground truth has a rich recent history in LLM research.

Wang et al. [2023] introduced self-consistency decoding for chain-of-thought reasoning at ICLR 2023, showing that sampling diverse reasoning paths and selecting the most frequent final answer yields substantial gains. The core insight — that if a model "knows" something, independent samples will converge, while uncertain or hallucinated outputs will diverge — is foundational to our approach.

Manakul et al. [2023] formalized this intuition for hallucination detection with **SelfCheckGPT** (EMNLP 2023), a zero-resource, black-box method that samples multiple responses and measures their mutual consistency via BERTScore, NLI, n-gram overlap, or LLM-based evaluation. Our self-consistency metric for OCR applies an analogous principle: if a model can reliably read a passage, independent transcription runs will agree; divergence signals either genuine difficulty or hallucination.

Farquhar et al. [2024] introduced **semantic entropy** (Nature, 2024), computing uncertainty at the level of meaning rather than token sequences by clustering sampled responses that bidirectionally entail each other. Xiong et al. [2025] showed that confidence-weighted voting achieves the same accuracy as standard self-consistency with 46% fewer samples.

Our contribution adapts these self-consistency principles to the specific domain of OCR, where the output is a deterministic function of a fixed visual input. Unlike reasoning tasks where multiple valid reasoning paths exist, OCR has a single ground truth, making run-to-run agreement a particularly clean signal: disagreement can only arise from model uncertainty, not from legitimate solution diversity.

### 2.4 OCR Quality Metrics and Their Limitations

Character Error Rate (CER) and Word Error Rate (WER), both based on Levenshtein edit distance, remain the standard metrics for OCR evaluation. However, their limitations are well-documented. Neudecker et al. [2021] demonstrated that CER values from different evaluation tools are not directly comparable due to implementation differences in normalization, Unicode handling, and alignment.

More fundamentally, CER and WER reduce document fidelity to string-edit distance, which blurs the boundary between a misread character and a misread column, or a transcription error and a layout erasure. For historical documents with non-standard orthography, abbreviations, and variant spellings, determining what constitutes an "error" requires editorial judgment that simple edit distance cannot capture.

Reference-free quality estimation remains underdeveloped. Dictionary-based heuristics fail for historical languages with no comprehensive lexicon. Clérice [2022] trained deep learning classifiers to predict error-rate bins from HTR output alone, achieving moderate accuracy on Old French and Latin. Our self-consistency approach offers a complementary reference-free signal that requires no language-specific resources — only multiple model runs.

### 2.5 Leonardo da Vinci Manuscript Digitization

Leonardo da Vinci's manuscripts present extreme challenges for any OCR or HTR system. His characteristic mirror script — written right-to-left with reversed letterforms, a practice likely related to his left-handedness — has resisted automated transcription. The Codex Atlanticus (1,119 folios, Biblioteca Ambrosiana) was fully digitized in a 2019 collaboration that produced high-resolution interactive browsing but no automated transcription. The Windsor Collection (~600 anatomy drawings, Royal Collection Trust) and the Codex Arundel (British Library, digitized 2007) are similarly available as images without machine-readable text.

To our knowledge, no published work has attempted automated HTR or OCR on Leonardo's mirror script. Computational analysis of the manuscripts has focused on watermark enhancement and art-historical questions rather than text recognition. This gap is notable: Leonardo's notebooks are among the most important scientific manuscripts in existence, yet their unusual writing system places them outside the scope of all existing HTR training corpora. Our evaluation of multimodal LLM performance on these materials appears to be the first systematic assessment of automated transcription quality for Leonardo's mirror script.

### 2.6 Hallucination in Vision-Language Models

Hallucination in VLMs — generating content not grounded in the input image — is a well-studied failure mode, but its manifestation in document understanding tasks has only recently received dedicated attention.

Zhou et al. [2025] identified "semantic hallucination" in scene text recognition, where models produce "semantically plausible yet visually incorrect answers" by relying on linguistic priors rather than visual grounding — a phenomenon directly relevant to historical document OCR, where a model might generate plausible Latin or Italian text that "sounds right" for the period but does not match the manuscript.

Wang et al. [2025] ("Seeing is Believing?", NeurIPS 2025) introduced KIE-HVQA, the first benchmark specifically targeting OCR hallucination under visual degradation (blur, occlusion, low contrast). They found that models exhibit "overreliance on linguistic priors or misaligned visual-textual reasoning" when image quality degrades. Inoue [2025] studied resolution sensitivity for context-independent OCR, finding that multimodal LLM performance "deteriorates significantly below 150 ppi."

A critical but under-explored distinction in VLM-based OCR is between *reading* (grounding output in the current image) and *reconstructing* (generating text from training-data priors about what a document "should" say). For well-known historical texts that may appear in training data, a model might produce fluent transcriptions that reflect memorized text rather than visual analysis of the specific manuscript page. Our self-consistency metric provides indirect evidence on this question: a model that is genuinely reading should produce consistent output, while a model "reconstructing" from a distribution of plausible text should produce different samples each time.

### 2.7 Reference-Free Evaluation via Inter-Annotator Agreement

Our approach draws an analogy between multiple LLM transcription runs and multiple human annotators. Inter-annotator agreement (IAA), measured via Cohen's kappa or Krippendorff's alpha, is the standard framework for assessing annotation quality without a gold standard [Artstein, 2017]. By treating each LLM run as an independent "annotator," we can apply the same statistical framework, with the key advantage that LLM annotators are cheaper, faster, and arbitrarily scalable.

---

## 3. The Source Library Corpus

Source Library (sourcelibrary.org) is a digital library of ~17,000 historical books from the 15th–18th centuries, sourced from institutional digital collections via IIIF (International Image Interoperability Framework). The collection spans printed books, handwritten manuscripts, and facsimiles of manuscript notebooks, in over 20 languages with Latin, German, Italian, French, and English predominating.

All books are processed through an automated pipeline:
1. **Image acquisition** from IIIF sources (Internet Archive, Bodleian Library, Vatican Library, Bibliotheca Philosophica Hermetica, et al.)
2. **OCR** via multimodal LLM (primarily Gemini 3 Flash or 3.1 Flash Lite)
3. **Translation** to English via LLM with cross-page context
4. **Enrichment** including quality scoring, subject classification, and image extraction

As of April 2026, the pipeline has processed ~3.35 million pages. The evaluation corpus for this paper comprises:

| Category | Source | Pages | Script | Language |
|----------|--------|-------|--------|----------|
| Printed text | Vitruvius, *De architectura* (IA) | 2 | Roman type | Latin |
| Printed text | Drebbel, *Tractatus duo* (BPH) | 2 | Roman type | Latin |
| Handwritten manuscript | Bodleian MS. Digby 23 (*Timaeus*) | 2 | 12th c. hand | Latin |
| Mirror-script manuscript | Leonardo, *Etudes sur la chevelure* (IA) | 3 | Mirror script | Italian |
| Mirror-script (flipped) | Same, horizontally mirrored | 2 | Reversed mirror | Italian |

[TODO: Expand corpus with additional Leonardo books, more manuscript samples, resolution variants]

---

## 4. Method

### 4.1 Self-Consistency Score

For a given page image $I$, we generate $N$ independent transcriptions $T_1, T_2, \ldots, T_N$ using the same model and prompt at temperature > 0. The self-consistency score is:

$$SC(I) = \frac{1}{\binom{N}{2}} \sum_{i < j} \text{sim}(T_i, T_j)$$

where $\text{sim}$ is a text similarity function. We evaluate multiple similarity functions:

- **Jaccard similarity** on word sets (baseline, crude — penalizes formatting variation)
- **Embedding cosine similarity** using Gemini's `gemini-embedding-001` model (768-dim vectors, analogous to BERTScore but using the same model family as the OCR engine)
- **Character Error Rate** (CER) between pairs (standard OCR metric applied pairwise)

Jaccard operates on word-set overlap and is sensitive to formatting noise (tag variation, whitespace, punctuation). Embedding similarity captures semantic equivalence — two transcriptions that say the same thing in slightly different formatting score ~1.0, while transcriptions that discuss the same topic with different specific text score lower. CER provides a character-level edit distance measure.

In practice, $N = 2$ provides a useful signal and $N = 5$ provides robust estimates. We strip all metadata tags, diagram descriptions (`[...]`), and model commentary before comparison, retaining only the transcribed text content. Texts are truncated to 8,000 characters before embedding to stay within model limits.

### 4.2 Trust Taxonomy

Based on empirical consistency thresholds calibrated against text types with known difficulty:

| Trust Level | Consistency | Label | Meaning |
|-------------|------------|-------|---------|
| Green | > 80% | Machine-verified | Model reads the same text consistently. Comparable to printed OCR. |
| Yellow | 30–80% | Approximate | Model partially reads the text. Useful as a guide, not a citation source. |
| Red | < 30% | Expert review needed | Model output is unreliable. May be topically correct but textually unfaithful. |

### 4.3 Models Tested

| Model | Provider | Notes |
|-------|----------|-------|
| Gemini 3 Flash | Google | Primary production model |
| Gemini 3.1 Flash Lite | Google | Cost-efficient variant |
| Gemini 3 Pro | Google | Larger model |
| Claude Sonnet 4 | Anthropic | Independent baseline |
| Claude Opus 4.6 | Anthropic | Largest Claude model |

All models are tested via API with default temperature settings. No few-shot examples or fine-tuning.

---

## 5. Results

### 5.1 Consistency by Text Type and Metric (N=5, Gemini 3 Flash)

The choice of similarity metric dramatically affects apparent consistency scores. Jaccard word similarity is depressed by formatting noise, while embedding cosine similarity captures semantic equivalence:

| Text Type | Jaccard | Embedding | CER | Run Length Variation |
|-----------|---------|-----------|-----|---------------------|
| Printed Latin (Vitruvius p25) | 55.3% | **99.0%** | 15.1% | 404–489 chars (±10%) |
| Printed Latin (Vitruvius p33) | 61.6% | **99.1%** | 5.2% | 1,578–1,633 chars (±2%) |
| Leonardo mirror-script (p49) | 7.5% | **82.2%** | 80.0% | 314–2,939 chars (±**130%**) |
| Leonardo mirror-script (p53) | 5.7% | **84.5%** | 73.2% | 1,736–3,485 chars (±33%) |

The embedding metric reveals a nuanced picture that Jaccard obscures:
- **Printed text at 99%:** The model produces semantically identical transcriptions — minor formatting differences (tag placement, whitespace) drive Jaccard down to 55–62% but have no semantic impact.
- **Leonardo at 82–84%:** The model produces *topically coherent but textually different* output. An embedding score of 82% means the runs discuss the same subject matter (optics, water dynamics) but use different specific words, sentences, and even paragraph structures. This is the quantitative signature of informed confabulation.

The run length variation provides additional diagnostic value: printed text varies by ±2–10% in character count, while Leonardo varies by up to ±130% — the model doesn't even decide how much text to produce consistently.

### 5.2 Prior Results: Consistency by Text Type (N=2, Jaccard only)

Earlier experiments with N=2 and Jaccard-only scoring across a broader set of text types:

| Text Type | Mean SC (Jaccard) | Range |
|-----------|-------------------|-------|
| Printed Latin | 95.5% | 93–98% |
| Handwritten manuscript (Bodleian Timaeus) | 22.4% | 18–27% |
| Leonardo mirror-script (flipped) | 13.4% | 11–15% |
| Leonardo mirror-script (unflipped) | 2.1% | 0–4% |

Note: N=2 Jaccard scores are higher than N=5 scores because with only 2 runs, there is one pair; with 5 runs, there are 10 pairs, and the mean includes more divergent comparisons.

### 5.3 Consistency by Model (Bodleian Manuscript, N=2, Jaccard)

| Model | Consistency |
|-------|-------------|
| Gemini 3.1 Lite | 36.7%* |
| Claude Opus 4.6 | 27.3% |
| Gemini 3 Pro | 27.0% |
| Gemini 3 Flash | 26.8% |
| Claude Sonnet 4 | 21.5% |

*Gemini Lite achieves highest consistency but produces the lowest quality text (pseudo-Latin nonsense), demonstrating that consistency without accuracy is meaningless. This motivates pairing self-consistency with cross-model agreement as a secondary quality check.

### 5.4 The Embedding–Jaccard Gap as a Diagnostic

The gap between embedding and Jaccard scores is itself informative:

| Text Type | Embedding | Jaccard | Gap |
|-----------|-----------|---------|-----|
| Printed Latin | 99.0% | 58.5% | 40.5 pp (formatting noise) |
| Leonardo mirror-script | 83.4% | 6.6% | 76.8 pp (semantic coherence + textual divergence) |

For printed text, the gap is entirely attributable to formatting noise — the transcriptions are the same text with minor presentation differences. For Leonardo, the gap reveals the informed confabulation phenomenon: high semantic similarity (same topics) combined with low lexical similarity (different words).

A large embedding–Jaccard gap on material that *should* have consistent formatting (no tables, no complex layout) is a strong signal of confabulation.

### 5.5 Sentence-Level Consistency

Per-sentence analysis reveals that consistency is not uniform within a page — even on difficult material, some fragments may be consistently decoded while others diverge completely.

| Text Type | Total Sentences | Consistent (>90%) | Mean Sentence SC |
|-----------|----------------|-------------------|------------------|
| Printed Latin (Vitruvius p25) | 5 | 5 (100%) | 98.1% |
| Leonardo mirror-script (p49) | 6 | 1 (17%) | 74.1% |

On printed text, every sentence achieves >97% embedding consistency — the model reads each one identically across runs. On Leonardo's mirror-script, only one "sentence" exceeds 90%, and it is a two-word fragment ("bon cole"). The remaining sentences cluster at 63–75%, producing recognizable Italian word fragments ("rāgi", "uedere", "d'esso lūinoso") that appear to be partial visual decodings of letter-like shapes rather than genuine transcription.

This per-sentence view enables a potential future feature: within-page trust coloring, where individual sentences are highlighted green, yellow, or red based on their consistency score. A scholar could then see at a glance which specific passages are reliable and which require expert verification.

### 5.6 Image Preprocessing

We tested 10 image preprocessing methods on Leonardo mirror-script (p49) to determine whether visual transformations could improve OCR consistency. Each method was tested with N=3 runs using Gemini Flash.

| Method | Jaccard | Embedding | Notes |
|--------|---------|-----------|-------|
| Original | 5.2% | 84.0% | Baseline |
| **Flip (horizontal)** | **15.9%** | **94.1%** | Mirror → normal orientation |
| Contrast (grayscale + normalize + sharpen) | 6.3% | 90.4% | Helps without flipping |
| **Flip + contrast** | **17.8%** | **94.4%** | **Best overall** |
| Flip + binarize | 11.2% | 93.8% | Binarization loses info |
| Binarize (adaptive) | 9.1% | 85.6% | Slight improvement |
| Binarize (Otsu) | 6.0% | 80.7% | Loses too much detail |
| Denoise (median) | 5.0% | 76.1% | Much worse — blurs text |
| Invert (negate) | 4.9% | 81.4% | No help |
| Crop (center 70%) | 7.0% | 78.9% | Loses marginal notes |

Key findings:
1. **Flipping is the single most effective intervention**, boosting embedding consistency from 84% to 94% — a 10-point gain. This confirms the model can partially read Leonardo's letterforms but struggles with their reversed orientation.
2. **Contrast enhancement helps independently** (84% → 90%), suggesting the model benefits from clearer visual separation between ink and parchment.
3. **Binarization and denoising hurt** — these destroy subtle visual information the model uses. The model performs better with rich grayscale data than with binary black/white.
4. **Combined flip + contrast achieves 94.4%** — approaching the printed text baseline of 99%. However, this does not mean the transcription is *accurate*; the Jaccard score of 17.8% (vs. 58% for printed) shows the text is still substantially different between runs.

The preprocessing results suggest that mirror-script OCR failure is partially an orientation problem and partially a handwriting recognition problem. Flipping solves the orientation issue, closing about half the gap to printed text on the embedding metric.

### 5.7 Reasoning Models

We tested whether reasoning — via Gemini 3 Pro with extended thinking — could improve OCR consistency on Leonardo's mirror-script. Five conditions were tested on pages 49 and 53:

| Condition | p49 Embedding | p53 Embedding | p49 Output Range |
|-----------|--------------|--------------|------------------|
| Flash (standard prompt) | 86.0% | 86.6% | 1,639–2,736 chars |
| Pro (standard prompt) | 74.1% | 85.3% | 18–559 chars |
| Pro (reasoning prompt) | 65.0% | 81.3% | 0–4,665 chars |
| Pro (thinking=4096) | 64.2% | N/A* | 0–1,280 chars |
| Pro (thinking=8192) | 81.1% | 69.7% | 0–1,320 chars |

*Pro with thinking=4096 produced 0 chars on all 3 runs of p53.

**Reasoning makes Leonardo OCR worse, not better.** The larger Pro model is slower (up to 150s vs. 35–60s for Flash), frequently times out, and produces dramatically less text — often zero characters. When it does produce text, consistency is lower than Flash across all conditions.

The reasoning prompt, which instructs the model to decompose mirror-script letter-by-letter, appears to cause the model to over-constrain itself: rather than producing fluent (if unreliable) Italian, it produces almost nothing, apparently recognizing that it cannot confidently decode individual letterforms. This is arguably more honest behavior — the model "knows what it doesn't know" — but it does not produce useful transcriptions.

This finding suggests that the bottleneck in mirror-script OCR is in low-level visual perception (recognizing reversed letterforms from pixel patterns), not in high-level reasoning about what the text should say. Reasoning cannot compensate for perception failure.

### 5.8 Expanded Corpus: Leonardo Across Topics

[TODO: Results from testing across 8 Leonardo codices — anatomy, water, flight, geometry, botany, physiognomy, architecture, optics — to determine whether consistency varies by subject matter or visual complexity]

---

## 6. Discussion

### 6.1 Consistency ≠ Accuracy

The Gemini Lite result demonstrates a critical caveat: high consistency does not guarantee accuracy. A model can consistently produce the wrong text — "confidently hallucinating" — if it settles on a stable but incorrect mode. Consistency is a necessary but not sufficient condition for quality. We recommend pairing consistency scores with at least one cross-model comparison to detect this failure mode.

### 6.2 Model Scale Does Not Help

Our five-model comparison on the Bodleian manuscript reveals a striking convergence: Gemini Flash (26.8%), Gemini Pro (27.0%), and Claude Opus (27.3%) all cluster within a half-point of each other. Claude Sonnet scores slightly lower (21.5%), and Gemini Lite scores higher (36.7%) but produces nonsense. The near-identical performance of models spanning different architectures, training corpora, and parameter counts (from Flash's ~30B to Opus's estimated 200B+) suggests that the difficulty lies in the visual perception task, not in language modeling capacity.

This has a practical implication: for manuscript OCR, using a larger or more expensive model provides no improvement in self-consistency. The bottleneck is the model's ability to decode unfamiliar handwriting from pixel patterns, not its ability to generate plausible text — which all models do equally well.

### 6.3 The Informed Confabulation Phenomenon

Leonardo's manuscripts reveal a distinctive failure pattern we call "informed confabulation." The model:
1. Correctly identifies the visual subject matter (optics, water dynamics, anatomy)
2. Generates fluent Italian text appropriate to that subject
3. Produces *different* specific text on each run

This is not random hallucination — the model demonstrates genuine understanding of what Leonardo *writes about*. But it cannot read what he *actually wrote*. The text is sampled from a learned distribution of "plausible Leonardo Italian about [topic]" rather than decoded from the image pixels.

The embedding–Jaccard gap quantifies this precisely: 82–84% embedding similarity (same semantic territory) combined with 6–8% Jaccard similarity (completely different words). The run length variation is equally diagnostic: on printed text, output length varies by ±2–10%, while on Leonardo it varies by up to ±130%. A model that is genuinely reading would produce a deterministic amount of text; a model that is generating produces an amount that depends on its sampling trajectory.

### 6.4 Reasoning Does Not Help

We tested whether reasoning — Gemini 3 Pro with extended thinking budgets (4,096 and 8,192 tokens) and a detailed paleographic reasoning prompt — could improve OCR consistency on Leonardo's mirror-script. The hypothesis was that step-by-step letter decomposition might ground the model better than direct visual-to-text mapping.

The results are unambiguous: **reasoning makes performance worse** (Section 5.7). Pro with thinking produces less text, lower consistency, and frequent empty outputs. The reasoning prompt causes the model to over-constrain itself — recognizing that it cannot confidently decode individual reversed letterforms, it produces almost nothing.

This reveals something important about the failure mode. A reasoning model that "tries harder" to read mirror-script discovers that it *genuinely cannot* decode the letterforms. Flash, which does not reason about the task, defaults to generating plausible Italian from visual context cues (subject matter, diagram type). The reasoning model's failure is arguably more honest: it knows what it doesn't know. But it does not produce useful transcriptions.

The implication is that the bottleneck in mirror-script OCR is **perceptual, not cognitive**. No amount of reasoning about what the text "should say" can compensate for the inability to decode reversed letterforms from pixel patterns. Improvement will require either:
1. **Better visual features** — fine-tuning on mirror-script exemplars to build letter-level recognition
2. **External preprocessing** — our flip+contrast results (Section 5.6) show that transforming the image before the model sees it is more effective than asking the model to transform its interpretation after seeing it
3. **Specialized HTR models** — trained specifically on Leonardo's hand, as no general-purpose model has this in its training distribution

### 6.5 Multi-Run Consensus as Enhancement

Self-consistency scoring is diagnostic — it tells you *how reliable* a transcription is. But the same multi-run data can be used constructively: rather than discarding all but the "best" run, we can build a consensus transcription that extracts maximal signal from N independent readings.

**Word-level majority voting.** Given N transcription runs, align them at the word or token level and keep words that appear in a majority of runs. Words that appear in only one or two runs out of five are likely hallucinated; words that appear in all five are likely genuinely read. This is the OCR analogue of Wang et al.'s [2023] self-consistency decoding for chain-of-thought reasoning.

**Confidence-annotated output.** Rather than producing a single clean transcription, output each word or phrase with its agreement count:

```
<high-confidence>per uedere</high-confidence> <low-confidence>rāgi luminoso</low-confidence>
<high-confidence>d'esso</high-confidence> <uncertain>corpo celeste</uncertain>
```

This preserves the fragments the model can genuinely read while honestly marking what it cannot. For digital libraries, this is arguably more useful than either a clean-but-unreliable transcription or no transcription at all.

**Error bounds from variance.** With N=5 runs, we can compute not just mean consistency but variance and confidence intervals. A page with mean embedding consistency of 85% ± 2% is a different proposition from one at 85% ± 15%. The former suggests a stable partial reading; the latter suggests high model uncertainty. Standard error of the mean across the $\binom{N}{2}$ pairwise scores provides a natural confidence interval for the consistency estimate itself.

**Practical protocol for difficult manuscripts.** We propose a three-stage pipeline for manuscripts in the "yellow zone" (30–80% consistency):
1. **Run N=5 independent transcriptions** at temperature > 0
2. **Compute per-sentence consistency** using embedding similarity
3. **Build a consensus transcription**: keep sentences with >90% agreement verbatim, mark 70–90% agreement sentences as approximate, and replace <70% agreement sections with `[uncertain — N variant readings available]`
4. **Store all N runs** so that future improvements (better models, reasoning, fine-tuning) can be retroactively evaluated against the same visual evidence

This approach converts the consistency measurement from a passive quality label into an active transcription enhancement tool.

### 6.6 Training Data Contamination

A confound we have not yet controlled for: if a text appears in the model's training data, consistency might be inflated by memorization rather than visual reading. The model may produce a consistent transcription because it recognizes which book this is and recites the known text, not because it decodes the pixels.

This motivates a 2×2 experimental design:

|  | Famous text | Obscure text |
|--|-------------|--------------|
| **Printed** | Vitruvius *De architectura* (many editions, widely cited) | Drebbel *Tractatus duo* (obscure, few editions) |
| **Manuscript** | Bodleian Timaeus (Plato — famous text, unfamiliar hand) | [TBD — manuscript of an obscure text] |

If consistency is driven by genuine reading, printed texts should score high regardless of fame. If driven by memorization, famous printed texts should score higher than obscure ones. For manuscripts, the prediction is cleaner: if the model is reciting memorized text, a famous text in an unfamiliar manuscript hand should still score high (it "knows" the text); if it is genuinely reading, the unfamiliar hand should degrade performance regardless of the text's fame.

[TODO: Run this 2×2 experiment. Find an obscure manuscript in our corpus.]

### 6.7 Implications for Digital Libraries

For a digital library like Source Library, processing 17,000+ books at scale, these findings have immediate practical consequences:

1. **Honest communication**: Printed books (the majority of the collection) can be presented with high confidence. Manuscripts should carry visible trust indicators warning users that the transcription is approximate.

2. **Triage**: Self-consistency scoring can automatically identify the ~5% of books that need human review, rather than requiring expert evaluation of the entire collection.

3. **Cost-effective quality**: Running 5 OCR passes costs 5× a single pass, but for manuscripts that would otherwise require expensive human transcription, the cost of consensus-building is negligible compared to expert paleographic labor.

4. **Progressive improvement**: By storing all N runs, the library accumulates a dataset that can be used to evaluate future models. When a new model is released, it can be tested against the same images without re-running the full pipeline.

### 6.8 Limitations

1. **Small corpus**: Our results are based on a limited number of pages from a small number of sources. The findings on Leonardo are based on one book; generalization to other Leonardo manuscripts, or to other mirror-script traditions, remains to be demonstrated.

2. **Jaccard as baseline**: Our initial N=2 results used Jaccard similarity, which we have shown to be a poor metric for OCR consistency. The N=5 embedding results are more reliable but cover fewer sources. We need to re-run the full corpus comparison (all models, manuscript baseline) with embedding metrics.

3. **No ground truth**: We measure consistency but not accuracy. The Gemini Lite result (high consistency, low quality) demonstrates that consistency alone is insufficient. A ground truth evaluation using known transcriptions (e.g., Richter's published translations of Leonardo) would strengthen our claims.

4. **Embedding model confound**: We use Gemini embeddings to evaluate Gemini OCR output. If the embedding model shares biases with the OCR model (e.g., both represent "plausible Italian about optics" similarly), the embedding scores could overestimate semantic consistency. Cross-family evaluation (e.g., using OpenAI embeddings to evaluate Gemini OCR) would address this.

5. **Temperature dependence**: We test at default temperature settings. Systematic variation of temperature would help characterize the relationship between sampling diversity and consistency scores.

---

## 7. Conclusion

Multimodal LLMs have made historical document transcription accessible at scale, but their reliability varies enormously by text type. We have shown that run-to-run self-consistency, measured via embedding cosine similarity, provides a practical reference-free quality signal that can be deployed without ground truth or language-specific resources.

Our key findings:
1. **Embedding similarity is the right metric** for OCR consistency — Jaccard word overlap conflates formatting noise with genuine divergence, depressing printed text scores to 55–62% while embedding similarity correctly registers them at 99%.
2. **All frontier models converge** on manuscripts at ~27% Jaccard consistency, regardless of model size or architecture. The bottleneck is visual perception, not language modeling.
3. **The embedding–Jaccard gap** is itself a diagnostic: a large gap (76+ percentage points on Leonardo vs. 40 on printed text) signals informed confabulation — semantic coherence without textual fidelity.
4. **Sentence-level analysis** reveals which specific passages a model can and cannot read, enabling within-page trust annotation.
5. **Multi-run consensus** can transform consistency measurement from a passive quality label into an active transcription enhancement tool.

For digital libraries processing historical documents at scale, these methods enable honest communication of AI reliability to scholars — telling readers not just what the AI transcribed, but how much they should trust it.

---

## References

[TODO: Full bibliography from Related Work citations]
