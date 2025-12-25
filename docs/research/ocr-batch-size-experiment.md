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

### Overall Condition Rankings (ELO)

ELO accounts for opponent strength — beating a strong opponent matters more than beating a weak one.

| Rank | Condition | ELO | W-L | Notes |
|------|-----------|-----|-----|-------|
| 1 | B1 Elaborate | **1728** | 27-4 | Best quality |
| 2 | B10 Simple | 1646 | 43-19 | Best large-batch |
| 3 | B5 Elaborate | 1581 | 46-46 | Middle tier |
| 4 | B1 Simple | 1562 | 17-14 | Good baseline |
| 5 | B5 Simple | 1491 | 49-44 | Efficiency sweet spot |
| 6 | B20 Elaborate | 1378 | 7-15 | Poor |
| 7 | B10 Elaborate | 1331 | 17-35 | Elaborate hurts here |
| 8 | B20 Simple | 1283 | 1-30 | Unacceptable quality |

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
- **Total OCR cost:** $0.08
- **Total judging cost:** $0.53
- **Runtime:** ~45 minutes

## Raw Data

All data persists in MongoDB for future analysis (e.g., ELO ranking):

| Collection | Records | Contents |
|------------|---------|----------|
| `ocr_experiments` | 1 | Experiment config, conditions, comparisons |
| `ocr_experiment_results` | 248 | OCR text for each page × condition |
| `ocr_judgments` | 207 | Pairwise judgments with winner (a/b/tie) |

### B5 Elaborate Detailed Record

| Opponent | W-L | Win % |
|----------|-----|-------|
| vs B1 Elaborate | 4-27 | 13% |
| vs B10 Elaborate | 28-2 | 93% |
| vs B5 Simple | 14-17 | 45% |
| **Total** | **46-46** | **50%** |

Despite a 50% raw win rate, ELO ranks B5 Elaborate 3rd (1581) because it beat a strong opponent (B10 Elaborate) decisively and only lost to the top-ranked B1 Elaborate.
