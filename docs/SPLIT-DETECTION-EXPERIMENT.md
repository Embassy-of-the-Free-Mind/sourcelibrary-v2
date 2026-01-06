# Split Detection Experiment - Findings

**Date:** January 2026
**Status:** Paused - needs alternative approach

## Summary

Attempted to use Gemini 3 Flash/Pro to automatically detect optimal split positions for two-page book spreads. While spread *detection* works well, precise *positioning* has significant limitations.

## What Works

### Spread Detection (High Accuracy)
- Gemini reliably identifies two-page spreads vs single pages
- Correctly handles edge cases: blank pages, book spines, multi-panel layouts
- Good at identifying concerns (text at gutter, marginalia, tilted scans)

### Content Analysis
- Identifies scan type (camera, flatbed, microfilm)
- Detects gutter appearance (dark shadow, light gap, curved)
- Recognizes text language and content type

## What Doesn't Work

### Precise Spatial Measurement
- **Strong center bias**: Models default to ~50% regardless of actual gutter position
- **Text boundary detection fails**: When asked where text ends, model reports approximate text block area, not actual ink boundaries
- Prompts tested:
  - "Find text boundaries" → Returns block margins, not character edges
  - "Find gutter shadow" → Returns ~50% consistently
  - "Scan horizontally for ink" → Same center bias
  - Multiple prompt variations with examples → No improvement

### Root Cause
LLMs/VLMs are not designed for precise pixel-level spatial measurement. They understand content semantically but cannot accurately measure geometric positions.

## Database State

```
Books needing splits: 64 (needs_splitting: true)
Ambiguous: 196 (needs_splitting: null)
Unchecked: 59 (no field)
Already processed: 985 (needs_splitting: false)
```

## Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/split-experiment.ts` | Full analysis with rich JSON schema |
| `scripts/split-review.ts` | Visual HTML review with overlays |
| `scripts/split-eval.ts` | Quality evaluation with random sampling |

### Usage
```bash
# List books needing splits
npx tsx scripts/split-experiment.ts --list

# Analyze a book
npx tsx scripts/split-experiment.ts --book-id=XXX --sample=5

# Generate visual review
npx tsx scripts/split-review.ts --book-id=XXX --sample=10
open split-review.html
```

## Future Directions

### 1. Bounding Box Detection
Use Gemini's object detection to return bounding boxes for left/right text blocks rather than percentage estimates. The gap between boxes would be the gutter.

```json
{
  "left_page_text": {"x1": 50, "y1": 100, "x2": 450, "y2": 800},
  "right_page_text": {"x1": 550, "y1": 100, "x2": 950, "y2": 800}
}
```

### 2. Hybrid Approach
1. **Gemini**: Detect if spread (binary) + identify gutter type
2. **Image processing**: Use column darkness analysis to find precise gutter
   - Already exists: `src/lib/splitDetection.ts`
   - Analyzes vertical columns for dark runs, transitions

### 3. ML Model Training
- Collect human-verified split positions as training data
- Train lightweight model specifically for gutter detection
- Existing infrastructure: `src/lib/splitDetectionML.ts`

### 4. Accept Imprecision + Safety Margins
- Use Gemini's ~50% as starting point
- Apply 3-4% safety margin on each side
- Accept some pages will need manual adjustment

## Sample Analysis Output

From "Das Buch Meteororum" page 78:
```
Gemini reported:
  Left text ends: 45.6%
  Right text starts: 53.5%
  Cut at: 49.5%

Visual inspection:
  Actual left text extends to ~47-48%
  Cut line crosses through left page text
  Would need ~47% cut position to be safe
```

## Key Insight

The 2% margin specified by the user would work IF the split position were accurate. The problem is the base position is wrong by 2-3%, so the margin doesn't help.

**Accurate detection + 2% margin = Good splits**
**Inaccurate detection + 2% margin = Still cuts text**

## Conclusion

Gemini is excellent for spread detection and content understanding, but should not be trusted for precise split positioning. A hybrid approach combining Gemini's detection capabilities with traditional image processing for positioning is recommended.
