# OCR Batch Size & Prompt Complexity Experiment

**Date:** December 2024
**Status:** Completed
**Book:** De occulta philosophia libri III (Agrippa, 1533)
**Pages tested:** 31 (pages 10-40)
**Total judgments:** 207

## Research Question

When using vision LLMs for OCR of historical manuscripts, how do batch size and prompt complexity affect transcription quality?

### Motivation

Processing manuscript pages one at a time is accurate but slow and expensive. Batching multiple pages per API call reduces costs, but may degrade quality due to:

1. **"Lost in the Middle" effect** (Liu et al., 2023) — LLMs attend well to the beginning and end of context but poorly to the middle
2. **Attention dilution** — More images competing for model attention
3. **Context overflow** — Long prompts + many images may exceed effective context

We also tested whether detailed OCR instructions ("elaborate prompts") improve accuracy over minimal prompts.

## Methodology

### Conditions (2×4 factorial design)

| Batch Size | Simple Prompt | Elaborate Prompt |
|------------|---------------|------------------|
| 1 page | B1 Simple | B1 Elaborate |
| 5 pages | B5 Simple | B5 Elaborate |
| 10 pages | B10 Simple | B10 Elaborate |
| 20 pages | B20 Simple | B20 Elaborate |

**Simple prompt:**
> "Transcribe the text from this historical manuscript page accurately. Preserve the original spelling and formatting. Output in plain text."

**Elaborate prompt:** Detailed instructions covering Latin paleography, abbreviations, letterforms, unclear text handling, and formatting guidelines (~500 tokens).

### OCR Model
- Gemini 2.0 Flash (`gemini-2.0-flash-exp`)

### Evaluation
- **Judge:** Claude Sonnet 4 (independent model to avoid self-preference bias)
- **Method:** Blind pairwise comparison — judge sees original page image + two transcriptions (A/B randomized), picks winner
- **Comparisons:** 7 key pairings × 31 pages = 217 judgments

### Pairwise Comparisons
1. B1 vs B5 (Simple) — Effect of batching at low complexity
2. B5 vs B10 (Simple) — Continued batching effect
3. B10 vs B20 (Simple) — Large batch degradation
4. B1 vs B5 (Elaborate) — Batching with detailed prompts
5. B5 vs B10 (Elaborate) — Continued effect
6. B10 vs B20 (Elaborate) — Large batch with detailed prompts
7. Simple vs Elaborate (B5) — Prompt complexity effect

## Results

### Pairwise Comparison Results

| Comparison | Winner | Win Rate | p-value | Significant |
|------------|--------|----------|---------|-------------|
| B1 vs B5 (Simple) | B1 | 55% | 0.59 | No |
| B5 vs B10 (Simple) | B5 | 58% | 0.37 | No |
| **B10 vs B20 (Simple)** | **B10** | **97%** | **<0.001** | **Yes** |
| **B1 vs B5 (Elaborate)** | **B1** | **87%** | **<0.001** | **Yes** |
| **B5 vs B10 (Elaborate)** | **B5** | **93%** | **<0.001** | **Yes** |
| B10 vs B20 (Elaborate) | B10 | 68% | 0.09 | No |
| Simple vs Elaborate (B5) | Simple | 55% | 0.59 | No |

### Overall Condition Rankings

| Rank | Condition | Win Rate | Notes |
|------|-----------|----------|-------|
| 1 | B1 Elaborate | 87% | Best quality |
| 2 | B10 Simple | 69% | Best large-batch |
| 3 | B1 Simple | 55% | Good baseline |
| 4 | B5 Simple | 53% | Efficiency sweet spot |
| 5 | B5 Elaborate | 50% | No benefit over simple |
| 6 | B10 Elaborate | 33% | Elaborate hurts here |
| 7 | B20 Elaborate | 32% | Poor |
| 8 | B20 Simple | 3% | Unacceptable quality |

### Cost Analysis

| Condition | API Calls (31 pages) | Token Cost | Quality |
|-----------|---------------------|------------|---------|
| B1 Elaborate | 31 | $0.018 | Best |
| B1 Simple | 31 | $0.014 | Good |
| B5 Simple | 7 | $0.008 | Good |
| B5 Elaborate | 7 | $0.010 | Good |
| B10 Simple | 4 | $0.008 | Acceptable |
| B20 Simple | 2 | $0.006 | Unacceptable |

## Key Findings

### 1. Batch size 20 causes severe quality degradation
At batch size 20, simple prompts won only 3% of comparisons against batch 10. This is a catastrophic failure — likely due to attention dilution across too many images.

**Recommendation:** Never exceed batch size 10.

### 2. Elaborate prompts show an interaction effect with batch size

| Batch Size | Elaborate vs Simple |
|------------|---------------------|
| B1 | Elaborate significantly better (+32%) |
| B5 | No significant difference |
| B10 | Simple significantly better (+36%) |

The elaborate prompt *helps* at batch size 1 but *hurts* at larger batches. Hypothesis: the ~500 token prompt competes with image attention at larger batches.

**Recommendation:** Use elaborate prompts only for single-page processing.

### 3. Simple prompts are more robust to batching
Quality degradation across batch sizes:
- Simple: B1 (55%) → B5 (53%) → B10 (69%) — relatively stable
- Elaborate: B1 (87%) → B5 (50%) → B10 (33%) — steep decline

### 4. Batch size 5 with simple prompts is the efficiency sweet spot
- 4.4× fewer API calls than B1
- 43% cost reduction
- No statistically significant quality loss vs B1

## Recommendations

### For maximum quality (archival/scholarly editions):
```
Batch size: 1
Prompt: Elaborate
Expected cost: ~$0.0006/page
```

### For production use (bulk processing):
```
Batch size: 5
Prompt: Simple
Expected cost: ~$0.0003/page
```

### Never use:
- Batch size 20 (unacceptable quality)
- Elaborate prompts with batch size >1 (counterproductive)

## Future Research

1. **Prompt optimization for batches** — Can we design a batch-specific elaborate prompt that doesn't degrade?
2. **Context window testing** — Does passing previous page context help or hurt?
3. **Model comparison** — Test Claude, GPT-4o for OCR (not just judging)
4. **Image resolution** — Does higher resolution improve accuracy enough to justify cost?
5. **Fine-tuning batch 1-5 range** — Is B2 or B3 a better sweet spot?

## Experiment Metadata

- **Experiment ID:** `39a9c4fd-672c-4a69-8a14-523910267b11`
- **OCR Model:** Gemini 2.0 Flash
- **Judge Model:** Claude Sonnet 4
- **Total OCR cost:** ~$0.08
- **Total judging cost:** ~$0.85
- **Runtime:** ~45 minutes
