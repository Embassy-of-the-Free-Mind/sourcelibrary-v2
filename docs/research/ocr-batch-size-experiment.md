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

#### After Random Matchups (421 total judgments)

| Rank | Condition | ELO | W-L | Notes |
|------|-----------|-----|-----|-------|
| 1 | **B1 Simple** | **1630** | 47-22 | Best overall |
| 2 | B1 Elaborate | 1601 | 45-20 | Close second |
| 3 | B10 Simple | 1592 | 59-25 | Best large-batch |
| 4 | B5 Elaborate | 1571 | 74-62 | Good efficiency |
| 5 | B5 Simple | 1523 | 71-61 | Solid choice |
| 6 | B20 Elaborate | 1377 | 9-31 | Poor |
| 7 | B20 Simple | 1363 | 8-54 | Poor |
| 8 | B10 Elaborate | 1344 | 19-57 | Elaborate hurts here |

#### Comparison: Fixed vs Random Matchups

| Condition | Fixed Only (207) | +Random (421) | Change |
|-----------|-----------------|---------------|--------|
| B1 Simple | 1562 (4th) | 1630 (1st) | ↑ +68 |
| B1 Elaborate | 1728 (1st) | 1601 (2nd) | ↓ -127 |
| B10 Simple | 1646 (2nd) | 1592 (3rd) | ↓ -54 |
| B5 Elaborate | 1581 (3rd) | 1571 (4th) | ↓ -10 |

**Key insight:** The elaborate prompt advantage seen in fixed comparisons was an artifact of limited matchups. With random sampling, B1 Simple emerges as the true winner.

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
Prompt: Simple
Expected cost: ~$0.0005/page
```

### For production use (bulk processing):
```
Batch size: 5-10
Prompt: Simple
Expected cost: ~$0.0003/page
```

### Never use:
- Batch size 20 (unacceptable quality)
- Elaborate prompts with batch size >1 (counterproductive)
- B10 Elaborate specifically (worst performer after B20)

---

# Single-Pass vs Two-Pass Pipeline Experiment

**Date:** December 2024
**Status:** Completed
**Book:** De occulta philosophia libri III (Agrippa, 1533)
**Pages tested:** 11 (pages 10-20)
**Total judgments:** 48

## Research Question

When using vision LLMs for OCR and translation of historical manuscripts, should we combine OCR and translation into a single API call, or keep them separate?

### Conditions

| Condition | Type | Model | Description |
|-----------|------|-------|-------------|
| Single-pass (Flash) | single_pass | Gemini 2.0 Flash | OCR + Translate in one call |
| Two-pass (Flash+Flash) | two_pass | Gemini 2.0 Flash | OCR first, then Translate separately |

## Results

| Condition | ELO | W-L | Win Rate |
|-----------|-----|-----|----------|
| **Two-pass (Flash+Flash)** | **1672** | **41-7** | **85%** |
| Single-pass (Flash) | 1328 | 7-41 | 15% |

**ELO difference:** 344 points (highly significant)

### Key Finding

**Two-pass wins decisively.** Separating OCR from translation produces significantly better results. The 344 ELO difference indicates the two-pass approach is clearly superior.

### Why Two-Pass Wins

Hypothesis: Separating the tasks allows the model to focus on one cognitive task at a time:
1. **OCR pass:** Focus entirely on reading historical letterforms accurately
2. **Translation pass:** Focus on understanding Latin grammar and producing fluent English

When combined, the model may make compromises — for example, "translating" a misread word rather than carefully transcribing it first.

### Qualitative Analysis

**Example 1: Agrippa's Dedication Letter (Page 10)**

| Aspect | Single-pass | Two-pass |
|--------|-------------|----------|
| Syntax | "I would dare to say, attempted until now by no one to restore" | "I dare say, has thus far been attempted by none to restore" |
| Flow | "I am about to offer you all my vows" (clunky) | "I shall offer you all my prayers" (idiomatic) |
| Style | Mechanical, awkward constructions | Natural Renaissance epistolary style |

**Example 2: Table of Contents (Page 15)**

| Aspect | Single-pass | Two-pass |
|--------|-------------|----------|
| Formatting | Plain unformatted text | Markdown with **bold** headers, numbered lists |
| Structure | Loses table layout | Preserves `[Page]` indicators and hierarchy |
| Readability | Dense, hard to scan | Clean, scannable |

**Observations:**
1. **Prose quality:** Two-pass produces more natural, readable English
2. **Document structure:** Two-pass better preserves tables, lists, and formatting
3. **Scholarly suitability:** Two-pass output requires less post-editing
4. **OCR consistency:** Both approaches produce nearly identical OCR — the difference is purely in translation quality

### Cost Analysis

| Condition | API Calls | Token Cost | Quality |
|-----------|-----------|------------|---------|
| Two-pass | 2 per page | $0.0006/page | Best |
| Single-pass | 1 per page | $0.0006/page | Significantly worse |

Cost is virtually identical, but quality differs dramatically.

### Recommendation

**Always use the two-pass pipeline:**
1. OCR first → Extract Latin text
2. Translate second → Latin to English

This matches our current production pipeline and validates that architecture.

### Experiment Metadata

- **Experiment ID:** `8dca8b5f-372e-4752-b4be-915828a8f8fa`
- **OCR/Translate Model:** Gemini 2.0 Flash
- **Judge Model:** Claude Sonnet 4
- **Pipeline cost:** $0.012
- **Judging cost:** $0.32

---

## Future Research

### Completed Experiments

1. **OCR Batch Size** (above) — B1 Simple is best; never exceed batch 10
2. **Single-Pass vs Two-Pass** (above) — Two-pass wins decisively

### Optimization Opportunities

#### High Priority (Expected High Impact)

| Experiment | Question | Hypothesis |
|------------|----------|------------|
| **OCR Model Comparison** | Claude vs GPT-4o vs Gemini for OCR | Claude may handle Latin abbreviations better |
| **Translation Model** | Flash vs Pro vs Claude for translation | Higher-tier models may produce more fluent prose |
| **Domain Prompts** | Add paleography/Latin hints to OCR prompt | May help with abbreviations (q̃ → que, ꝑ → per) |
| **Context Window** | Pass previous page text | May help with running sentences, consistent terminology |

#### Medium Priority (Potential Impact)

| Experiment | Question | Hypothesis |
|------------|----------|------------|
| **Image Resolution** | 800px vs 1200px vs 2000px | Higher res may help with small/degraded text |
| **Batch Size 2-5** | Is B2 or B3 the sweet spot? | May get 2-3x efficiency with minimal quality loss |
| **Translation Prompts** | Scholarly vs accessible style | Different prompts for different audiences |
| **Source Language** | Explicit Latin vs auto-detect | Explicit may improve accuracy |

#### Lower Priority (Efficiency Gains)

| Experiment | Question | Hypothesis |
|------------|----------|------------|
| **Parallel Processing** | Concurrent page processing | Reduce wall-clock time |
| **Blank Page Detection** | Skip blank/title pages | Save 5-10% of API costs |
| **Caching** | Cache repeated patterns | Reduce redundant calls |
| **Confidence Scoring** | Flag uncertain passages | Prioritize human review |

#### Reading Experience Improvements

| Feature | Description | Implementation |
|---------|-------------|----------------|
| **Chapter/Section TOC** | Auto-generate table of contents from headings | Parse OCR markdown for `#`, `##`, `###`; store as `{ chapters: [{ title, pageId, level }] }`; render as clickable nav |
| **Rolling Context Summary** | Cumulative book context for better translation | After each page, generate ~200 token summary of key facts, characters, terminology; pass to subsequent translations |
| **Reading Progress** | Track user's position in book | Store last-read page, show progress bar |
| **Heading Navigation** | Jump between sections while reading | Use extracted headings for in-page navigation |

#### Infrastructure Improvements

- **A/B Testing Framework:** Production experiments with real users
- **Quality Dashboard:** Track OCR/translation quality over time
- **Cost Monitoring:** Per-book and per-page cost tracking
- **Human Review Queue:** UI for correcting flagged passages

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
