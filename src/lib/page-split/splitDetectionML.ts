/**
 * ML-based split detection using Gemini for ground truth generation
 * and a fast trained model for inference.
 */

import { analyzeColumns } from './splitDetection';
import { images } from '@/lib/api-client';
import { getGeminiClient, reportRateLimitError } from '../gemini-client';

export interface GeminiSplitResult {
  isTwoPageSpread: boolean; // Is this actually a two-page spread?
  splitPosition: number; // 0-1000 scale
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export interface TrainingExample {
  pageId: string;
  bookId: string;
  imageUrl: string;
  features: SplitFeatures;
  geminiPosition: number;
  geminiConfidence: string;
  timestamp: Date;
}

export interface SplitFeatures {
  // Image-level features
  aspectRatio: number;
  width: number;
  height: number;

  // Page context (optional - set during import)
  pageNumber?: number;
  totalPages?: number;
  pagePosition?: number; // pageNumber / totalPages (0-1 normalized)

  // Book size category (small <100, medium 100-300, large 300+)
  bookSizeCategory?: number; // 0=small, 1=medium, 2=large

  // Center region stats (40-60%)
  centerDarkestP10: number;
  centerDarkestIdx: number;  // relative to center region
  centerBrightestP10: number;
  centerBrightestIdx: number;
  centerAvgP10: number;
  centerP10Variance: number;

  // Edge vs center comparison
  leftEdgeP10: number;
  rightEdgeP10: number;
  edgeCenterDiff: number;  // positive = center brighter (inverted gutter)

  // Column stats at predicted position
  predictedDarkRun: number;
  predictedTransitions: number;
  predictedP10: number;

  // Gutter pattern detection
  hasInvertedGutter: boolean;
  gutterWidth: number;  // approximate width of gutter region in pixels

  // Text boundary detection (where text ends on left, starts on right)
  leftTextEndIdx: number;   // last column with significant text on left side
  rightTextStartIdx: number; // first column with significant text on right side
  textGapWidth: number;     // gap between left text end and right text start
  textGapCenter: number;    // center of the text gap (ideal split point)

  // New: Text block boundary features (0-1000 scale like split position)
  leftPageTextStart?: number;   // where left page text block begins
  leftPageTextEnd?: number;     // where left page text block ends (rightmost edge)
  rightPageTextStart?: number;  // where right page text block begins (leftmost edge)
  rightPageTextEnd?: number;    // where right page text block ends
  leftMargin?: number;          // left page outer margin (0-100%)
  rightMargin?: number;         // right page outer margin (0-100%)
  idealSplitFromText?: number;  // computed ideal split from text block analysis (0-1000)
}

/**
 * Use Gemini to analyze an image and find the optimal split position
 * This serves as ground truth for training
 */
export async function detectSplitWithGemini(
  imageUrl: string,
  modelId: string =  process.env.GEMINI_MODEL || 'gemini-3-flash-preview'
): Promise<GeminiSplitResult> {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: modelId });

  const prompt = `You are an expert at analyzing scanned book images.

TASK: Determine if this is a TWO-PAGE SPREAD or a SINGLE PAGE, and if it's a spread, find the optimal split position.

STEP 1: DETERMINE IMAGE TYPE
- Is this a two-page spread (left and right pages visible) OR a single page?
- Clues for TWO-PAGE SPREAD:
  - Two distinct text columns separated by a gutter (dark or light gap)
  - Symmetrical layout with text on both sides
  - Central binding line (vertical line or shadow in middle)
  - Aspect ratio typically > 1.0 (wider than tall)
- Clues for SINGLE PAGE:
  - One continuous text column
  - Portrait orientation (taller than wide)
  - No central gutter or binding line
  - Text flows naturally without a vertical gap

STEP 2: IF TWO-PAGE SPREAD, FIND SPLIT POSITION
- Find the exact vertical position to split into left and right pages
- NEVER cut through text - split must fall in gap between text columns
- Follow natural binding angle if book is tilted
- Gutter can be dark shadow, bright gap, or just margin between text blocks

Return your answer in this EXACT JSON format:
{
  "isTwoPageSpread": <true|false>,
  "splitPosition": <integer from 0-1000, or 500 if single page>,
  "confidence": "<high|medium|low>",
  "reasoning": "<brief explanation of your determination>"
}`;

  // Fetch and encode the image
  const imageData = await images.fetchBase64(imageUrl, { includeMimeType: true });
  const { base64: base64Image, mimeType } = typeof imageData === 'string'
    ? { base64: imageData, mimeType: 'image/jpeg' }
    : { base64: imageData.base64, mimeType: imageData.mimeType };

  let result;
  try {
    result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      },
    ]);
  } catch (error: any) {
    // Report rate limit errors for key rotation tracking
    if (error?.message?.includes('429') || error?.message?.includes('rate limit')) {
      const apiKey = process.env.GEMINI_API_KEY || '';
      reportRateLimitError(apiKey);
    }
    throw error;
  }

  const responseText = result.response.text();

  // Parse JSON from response (handle markdown code blocks)
  const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse Gemini response as JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    isTwoPageSpread: parsed.isTwoPageSpread ?? true, // Default to true for backward compatibility
    splitPosition: Math.round(parsed.splitPosition),
    confidence: parsed.confidence || 'medium',
    reasoning: parsed.reasoning || '',
  };
}

/**
 * Extract features from an image for ML training/inference
 */
export async function extractFeatures(
  imageBuffer: Buffer,
  analysisWidth: number = 500
): Promise<SplitFeatures> {
  const sharp = (await import('sharp')).default;

  const { data, info } = await sharp(imageBuffer)
    .resize(analysisWidth, null, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const pixels = new Uint8Array(data);

  // Analyze all columns
  const columns = analyzeColumns(pixels, width, height);

  // Center region (40-60%)
  const searchStart = Math.floor(width * 0.40);
  const searchEnd = Math.floor(width * 0.60);
  const centerColumns = columns.slice(searchStart, searchEnd);

  // Find darkest and brightest in center
  let darkestP10 = 255, darkestIdx = 0;
  let brightestP10 = 0, brightestIdx = 0;
  let sumP10 = 0;

  for (let i = 0; i < centerColumns.length; i++) {
    const p10 = centerColumns[i].p10;
    sumP10 += p10;
    if (p10 < darkestP10) {
      darkestP10 = p10;
      darkestIdx = i;
    }
    if (p10 > brightestP10) {
      brightestP10 = p10;
      brightestIdx = i;
    }
  }

  const avgP10 = sumP10 / centerColumns.length;

  // Variance in center region
  let varianceSum = 0;
  for (const col of centerColumns) {
    varianceSum += Math.pow(col.p10 - avgP10, 2);
  }
  const p10Variance = varianceSum / centerColumns.length;

  // Edge P10 values (first and last 5%)
  const edgeWidth = Math.floor(width * 0.05);
  const leftEdgeP10 = columns.slice(0, edgeWidth).reduce((s, c) => s + c.p10, 0) / edgeWidth;
  const rightEdgeP10 = columns.slice(-edgeWidth).reduce((s, c) => s + c.p10, 0) / edgeWidth;
  const edgeAvg = (leftEdgeP10 + rightEdgeP10) / 2;

  // Center brightness relative to edges
  const centerP10 = centerColumns[Math.floor(centerColumns.length / 2)].p10;
  const edgeCenterDiff = centerP10 - edgeAvg;

  // Is this an inverted gutter (bright center)?
  const hasInvertedGutter = edgeCenterDiff > 30;

  // Predicted position based on simple heuristic
  const predictedIdx = hasInvertedGutter
    ? searchStart + brightestIdx
    : searchStart + darkestIdx + Math.floor(width * 0.005);

  const predictedCol = columns[Math.min(predictedIdx, columns.length - 1)];

  // Estimate gutter width (how wide is the dark/bright region)
  const threshold = hasInvertedGutter ? brightestP10 - 20 : darkestP10 + 20;
  let gutterWidth = 0;
  for (const col of centerColumns) {
    if (hasInvertedGutter ? col.p10 > threshold : col.p10 < threshold) {
      gutterWidth++;
    }
  }

  // Text boundary detection using transitions
  // Text columns have high transitions (many dark/light switches)
  // Margins/gutters have low transitions
  const textThreshold = 20; // columns with >20 transitions likely have text
  const center = Math.floor(width / 2);

  // Use a sliding window to detect sustained text regions (more robust than single column)
  const windowSize = Math.max(3, Math.floor(width * 0.01)); // 1% of width or min 3 columns

  const hasTextAt = (idx: number): boolean => {
    let textCols = 0;
    for (let i = Math.max(0, idx - windowSize); i <= Math.min(width - 1, idx + windowSize); i++) {
      if (columns[i].transitions > textThreshold) textCols++;
    }
    return textCols > windowSize; // majority of window has text
  };

  // Scan from LEFT EDGE inward to find where left page text starts
  let leftPageTextStart = 0;
  for (let i = 0; i < center; i++) {
    if (hasTextAt(i)) {
      leftPageTextStart = i;
      break;
    }
  }

  // Scan from CENTER leftward to find where left page text ends (rightmost text on left page)
  let leftPageTextEnd = center;
  for (let i = center; i >= leftPageTextStart; i--) {
    if (hasTextAt(i)) {
      leftPageTextEnd = i;
      break;
    }
  }

  // Scan from RIGHT EDGE inward to find where right page text ends
  let rightPageTextEnd = width - 1;
  for (let i = width - 1; i > center; i--) {
    if (hasTextAt(i)) {
      rightPageTextEnd = i;
      break;
    }
  }

  // Scan from CENTER rightward to find where right page text starts (leftmost text on right page)
  let rightPageTextStart = center;
  for (let i = center; i <= rightPageTextEnd; i++) {
    if (hasTextAt(i)) {
      rightPageTextStart = i;
      break;
    }
  }

  // Legacy variables for backward compatibility
  const leftTextEndIdx = leftPageTextEnd;
  const rightTextStartIdx = rightPageTextStart;

  // Calculate gap metrics
  const textGapWidth = rightPageTextStart - leftPageTextEnd;
  const textGapCenter = (leftPageTextEnd + rightPageTextStart) / 2;

  // New: Calculate margins (how much space between page edge and text)
  const leftMargin = leftPageTextStart; // pixels from left edge to text start
  const rightMargin = (width - 1) - rightPageTextEnd; // pixels from text end to right edge

  // New: Inner margins (space between text blocks and the gap)
  const leftInnerMargin = leftPageTextEnd - leftPageTextStart; // width of left text block
  const rightInnerMargin = rightPageTextEnd - rightPageTextStart; // width of right text block

  // New: Ideal split point considering margins
  // If left margin is larger, shift split slightly left to balance
  const marginBias = (leftMargin - rightMargin) / 2;
  const idealSplitFromText = textGapCenter + marginBias;

  return {
    aspectRatio: width / height,
    width,
    height,
    centerDarkestP10: darkestP10,
    centerDarkestIdx: darkestIdx,
    centerBrightestP10: brightestP10,
    centerBrightestIdx: brightestIdx,
    centerAvgP10: avgP10,
    centerP10Variance: p10Variance,
    leftEdgeP10,
    rightEdgeP10,
    edgeCenterDiff,
    predictedDarkRun: predictedCol.maxDarkRun,
    predictedTransitions: predictedCol.transitions,
    predictedP10: predictedCol.p10,
    hasInvertedGutter,
    gutterWidth,
    leftTextEndIdx: (leftTextEndIdx / width) * 100, // normalize to 0-100
    rightTextStartIdx: (rightTextStartIdx / width) * 100,
    textGapWidth: (textGapWidth / width) * 100,
    textGapCenter: (textGapCenter / width) * 1000, // scale to 0-1000 like split position

    // New text block boundary features
    leftPageTextStart: (leftPageTextStart / width) * 1000,   // where left page text begins
    leftPageTextEnd: (leftPageTextEnd / width) * 1000,       // where left page text ends (rightmost)
    rightPageTextStart: (rightPageTextStart / width) * 1000, // where right page text begins (leftmost)
    rightPageTextEnd: (rightPageTextEnd / width) * 1000,     // where right page text ends
    leftMargin: (leftMargin / width) * 100,                  // left page outer margin %
    rightMargin: (rightMargin / width) * 100,                // right page outer margin %
    idealSplitFromText: (idealSplitFromText / width) * 1000, // computed ideal split from text analysis
  };
}

/**
 * Simple linear regression model for split prediction
 * Weights are learned from training data
 */
export interface SplitModel {
  weights: {
    bias: number;
    centerDarkestIdx: number;
    centerBrightestIdx: number;
    edgeCenterDiff: number;
    invertedGutterOffset: number;
    aspectRatioOffset: number;
    pagePositionOffset: number;  // early/late pages may differ
    textGapCenterWeight: number; // weight for text gap center feature
    bookSizeOffset: number;      // adjustment for book size
    // New text block boundary weights
    idealSplitFromTextWeight: number;  // weight for computed ideal split from text analysis
    leftPageTextEndWeight: number;     // where left page text ends
    rightPageTextStartWeight: number;  // where right page text starts
    marginBalanceWeight: number;       // balance between left and right margins
  };
  trainedAt: Date;
  trainingSize: number;
  validationMSE: number;
}

/**
 * Check if features are valid for training
 */
function isValidExample(example: TrainingExample): boolean {
  const f = example.features;
  if (!f) return false;
  if (typeof example.geminiPosition !== 'number') return false;
  if (typeof f.centerDarkestIdx !== 'number' || isNaN(f.centerDarkestIdx)) return false;
  if (typeof f.centerBrightestIdx !== 'number' || isNaN(f.centerBrightestIdx)) return false;
  if (typeof f.edgeCenterDiff !== 'number' || isNaN(f.edgeCenterDiff)) return false;
  if (typeof f.aspectRatio !== 'number' || isNaN(f.aspectRatio)) return false;
  return true;
}

/**
 * Train a simple model from labeled examples
 */
export function trainModel(examples: TrainingExample[]): SplitModel {
  // Filter to valid examples only
  const validExamples = examples.filter(isValidExample);

  if (validExamples.length < 10) {
    throw new Error(`Need at least 10 valid examples to train. Have ${validExamples.length} valid out of ${examples.length} total.`);
  }

  // Split into train/validation
  const shuffled = [...validExamples].sort(() => Math.random() - 0.5);
  const trainSize = Math.floor(shuffled.length * 0.8);
  const train = shuffled.slice(0, trainSize);
  const validation = shuffled.slice(trainSize);

  // Simple approach: use median of geminiPosition as baseline, learn offsets from features
  const positions = validExamples.map(e => e.geminiPosition);
  const medianPosition = positions.sort((a, b) => a - b)[Math.floor(positions.length / 2)];

  // Learn weights using gradient descent
  const weights = {
    bias: medianPosition,
    centerDarkestIdx: 0,
    centerBrightestIdx: 0,
    edgeCenterDiff: 0,
    invertedGutterOffset: 0,
    aspectRatioOffset: 0,
    pagePositionOffset: 0,
    textGapCenterWeight: 0,
    bookSizeOffset: 0,
    // New text block boundary weights
    idealSplitFromTextWeight: 0,
    leftPageTextEndWeight: 0,
    rightPageTextStartWeight: 0,
    marginBalanceWeight: 0,
  };

  const learningRate = 0.0001;
  const epochs = 500;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradients = {
      bias: 0,
      centerDarkestIdx: 0,
      centerBrightestIdx: 0,
      edgeCenterDiff: 0,
      invertedGutterOffset: 0,
      aspectRatioOffset: 0,
      pagePositionOffset: 0,
      textGapCenterWeight: 0,
      bookSizeOffset: 0,
      idealSplitFromTextWeight: 0,
      leftPageTextEndWeight: 0,
      rightPageTextStartWeight: 0,
      marginBalanceWeight: 0,
    };

    for (const example of train) {
      const f = example.features;
      const target = example.geminiPosition;

      // Page position: 0=start, 0.5=middle, 1=end (default to 0.5 if missing)
      const pagePos = f.pagePosition ?? 0.5;

      // Book size category: 0=small (<100), 1=medium (100-300), 2=large (300+)
      const bookSize = f.bookSizeCategory ?? 1;

      // Text gap center (normalized to deviation from 500)
      const textGapCenterDev = (f.textGapCenter ?? 500) - 500;

      // New text block features (normalized to deviation from 500)
      const idealSplitDev = (f.idealSplitFromText ?? 500) - 500;
      const leftTextEndDev = (f.leftPageTextEnd ?? 500) - 500;
      const rightTextStartDev = (f.rightPageTextStart ?? 500) - 500;
      const marginBalance = (f.leftMargin ?? 5) - (f.rightMargin ?? 5); // positive = more left margin

      // Prediction - use simpler features that are more robust
      const pred =
        weights.bias +
        weights.centerDarkestIdx * (f.centerDarkestIdx - 50) + // Normalize around center
        weights.centerBrightestIdx * (f.centerBrightestIdx - 50) +
        weights.edgeCenterDiff * (f.edgeCenterDiff / 50) + // Scale down
        weights.invertedGutterOffset * (f.hasInvertedGutter ? 1 : 0) +
        weights.aspectRatioOffset * (f.aspectRatio - 1.5) +
        weights.pagePositionOffset * (pagePos - 0.5) + // Center around middle of book
        weights.textGapCenterWeight * (textGapCenterDev / 100) + // Text gap center contribution
        weights.bookSizeOffset * (bookSize - 1) + // Center around medium books
        // New text block features
        weights.idealSplitFromTextWeight * (idealSplitDev / 100) +
        weights.leftPageTextEndWeight * (leftTextEndDev / 100) +
        weights.rightPageTextStartWeight * (rightTextStartDev / 100) +
        weights.marginBalanceWeight * (marginBalance / 10);

      const error = pred - target;

      // Gradients (with clipping to prevent explosion)
      const clip = (x: number) => Math.max(-10, Math.min(10, x));
      gradients.bias += clip(error);
      gradients.centerDarkestIdx += clip(error * (f.centerDarkestIdx - 50));
      gradients.centerBrightestIdx += clip(error * (f.centerBrightestIdx - 50));
      gradients.edgeCenterDiff += clip(error * (f.edgeCenterDiff / 50));
      gradients.invertedGutterOffset += clip(error * (f.hasInvertedGutter ? 1 : 0));
      gradients.aspectRatioOffset += clip(error * (f.aspectRatio - 1.5));
      gradients.pagePositionOffset += clip(error * (pagePos - 0.5));
      gradients.textGapCenterWeight += clip(error * (textGapCenterDev / 100));
      gradients.bookSizeOffset += clip(error * (bookSize - 1));
      // New feature gradients
      gradients.idealSplitFromTextWeight += clip(error * (idealSplitDev / 100));
      gradients.leftPageTextEndWeight += clip(error * (leftTextEndDev / 100));
      gradients.rightPageTextStartWeight += clip(error * (rightTextStartDev / 100));
      gradients.marginBalanceWeight += clip(error * (marginBalance / 10));
    }

    // Update weights
    const n = train.length;
    weights.bias -= learningRate * (gradients.bias / n);
    weights.centerDarkestIdx -= learningRate * (gradients.centerDarkestIdx / n);
    weights.centerBrightestIdx -= learningRate * (gradients.centerBrightestIdx / n);
    weights.edgeCenterDiff -= learningRate * (gradients.edgeCenterDiff / n);
    weights.invertedGutterOffset -= learningRate * (gradients.invertedGutterOffset / n);
    weights.aspectRatioOffset -= learningRate * (gradients.aspectRatioOffset / n);
    weights.pagePositionOffset -= learningRate * (gradients.pagePositionOffset / n);
    weights.textGapCenterWeight -= learningRate * (gradients.textGapCenterWeight / n);
    weights.bookSizeOffset -= learningRate * (gradients.bookSizeOffset / n);
    // New feature weight updates
    weights.idealSplitFromTextWeight -= learningRate * (gradients.idealSplitFromTextWeight / n);
    weights.leftPageTextEndWeight -= learningRate * (gradients.leftPageTextEndWeight / n);
    weights.rightPageTextStartWeight -= learningRate * (gradients.rightPageTextStartWeight / n);
    weights.marginBalanceWeight -= learningRate * (gradients.marginBalanceWeight / n);
  }

  // Compute validation MSE
  let validationMSE = 0;
  for (const example of validation) {
    const f = example.features;
    const target = example.geminiPosition;
    const pagePos = f.pagePosition ?? 0.5;
    const bookSize = f.bookSizeCategory ?? 1;
    const textGapCenterDev = (f.textGapCenter ?? 500) - 500;
    const idealSplitDev = (f.idealSplitFromText ?? 500) - 500;
    const leftTextEndDev = (f.leftPageTextEnd ?? 500) - 500;
    const rightTextStartDev = (f.rightPageTextStart ?? 500) - 500;
    const marginBalance = (f.leftMargin ?? 5) - (f.rightMargin ?? 5);

    const pred =
      weights.bias +
      weights.centerDarkestIdx * (f.centerDarkestIdx - 50) +
      weights.centerBrightestIdx * (f.centerBrightestIdx - 50) +
      weights.edgeCenterDiff * (f.edgeCenterDiff / 50) +
      weights.invertedGutterOffset * (f.hasInvertedGutter ? 1 : 0) +
      weights.aspectRatioOffset * (f.aspectRatio - 1.5) +
      weights.pagePositionOffset * (pagePos - 0.5) +
      weights.textGapCenterWeight * (textGapCenterDev / 100) +
      weights.bookSizeOffset * (bookSize - 1) +
      weights.idealSplitFromTextWeight * (idealSplitDev / 100) +
      weights.leftPageTextEndWeight * (leftTextEndDev / 100) +
      weights.rightPageTextStartWeight * (rightTextStartDev / 100) +
      weights.marginBalanceWeight * (marginBalance / 10);

    validationMSE += Math.pow(pred - target, 2);
  }
  validationMSE = validation.length > 0 ? validationMSE / validation.length : 0;

  return {
    weights,
    trainedAt: new Date(),
    trainingSize: train.length,
    validationMSE,
  };
}

/**
 * Use trained model to predict split position
 */
export function predictWithModel(features: SplitFeatures, model: SplitModel): number {
  const f = features;
  const w = model.weights;
  const pagePos = f.pagePosition ?? 0.5;
  const bookSize = f.bookSizeCategory ?? 1;
  const textGapCenterDev = (f.textGapCenter ?? 500) - 500;
  const idealSplitDev = (f.idealSplitFromText ?? 500) - 500;
  const leftTextEndDev = (f.leftPageTextEnd ?? 500) - 500;
  const rightTextStartDev = (f.rightPageTextStart ?? 500) - 500;
  const marginBalance = (f.leftMargin ?? 5) - (f.rightMargin ?? 5);

  // Use same normalization as training
  const position =
    w.bias +
    w.centerDarkestIdx * (f.centerDarkestIdx - 50) +
    w.centerBrightestIdx * (f.centerBrightestIdx - 50) +
    w.edgeCenterDiff * (f.edgeCenterDiff / 50) +
    w.invertedGutterOffset * (f.hasInvertedGutter ? 1 : 0) +
    w.aspectRatioOffset * (f.aspectRatio - 1.5) +
    (w.pagePositionOffset ?? 0) * (pagePos - 0.5) +
    (w.textGapCenterWeight ?? 0) * (textGapCenterDev / 100) +
    (w.bookSizeOffset ?? 0) * (bookSize - 1) +
    // New text block features (with fallback for older models)
    (w.idealSplitFromTextWeight ?? 0) * (idealSplitDev / 100) +
    (w.leftPageTextEndWeight ?? 0) * (leftTextEndDev / 100) +
    (w.rightPageTextStartWeight ?? 0) * (rightTextStartDev / 100) +
    (w.marginBalanceWeight ?? 0) * (marginBalance / 10);

  // Clamp to valid range (allow wider range for off-center splits)
  return Math.max(200, Math.min(800, Math.round(position)));
}
