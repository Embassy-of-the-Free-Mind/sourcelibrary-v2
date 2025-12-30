/**
 * ML-based split detection using Gemini for ground truth generation
 * and a fast trained model for inference
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { analyzeColumns, type ColumnStats } from './splitDetection';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export interface GeminiSplitResult {
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
}

/**
 * Use Gemini to analyze an image and find the optimal split position
 * This serves as ground truth for training
 */
export async function detectSplitWithGemini(
  imageUrl: string,
  modelId: string = 'gemini-3-flash-preview'
): Promise<GeminiSplitResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const model = genAI.getGenerativeModel({ model: modelId });

  const prompt = `You are an expert at analyzing scanned book spreads to find the optimal vertical split line.

TASK: Find the exact vertical position to split this two-page book scan into left and right pages.

CRITICAL RULES:
1. NEVER cut through text - the split must fall in a gap between text columns
2. The book may not be perfectly vertical - follow the natural angle of the binding
3. Gutter appearance varies widely:
   - Dark shadow (common in phone/camera scans)
   - Bright gap (common in flatbed scans)
   - Curved distortion near binding
   - No visible gutter at all (just margin between text blocks)

ANALYSIS APPROACH:
1. First, identify the text blocks on left and right pages
2. Find the gap/margin between them - this is where to split
3. If there's a visible gutter line (dark or light), use it as a guide
4. If the book is tilted, the split line should follow the tilt
5. Prefer erring slightly toward margins rather than cutting text

Return your answer in this EXACT JSON format:
{
  "splitPosition": <integer from 0-1000 where 0=left edge, 500=center, 1000=right edge>,
  "confidence": "<high|medium|low>",
  "reasoning": "<brief explanation: what visual cues you used, any challenges>"
}`;

  // Fetch and encode the image
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image: ${imageResponse.status}`);
  }

  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString('base64');
  let mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
  mimeType = mimeType.split(';')[0].trim();

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    },
  ]);

  const responseText = result.response.text();

  // Parse JSON from response (handle markdown code blocks)
  const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse Gemini response as JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
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

  // Scan left from center to find where text ends (transitions drop)
  let leftTextEndIdx = center;
  for (let i = center; i >= 0; i--) {
    if (columns[i].transitions > textThreshold) {
      leftTextEndIdx = i;
      break;
    }
  }

  // Scan right from center to find where text starts (transitions rise)
  let rightTextStartIdx = center;
  for (let i = center; i < width; i++) {
    if (columns[i].transitions > textThreshold) {
      rightTextStartIdx = i;
      break;
    }
  }

  // Calculate gap metrics (normalized to 0-100 range relative to center region)
  const textGapWidth = rightTextStartIdx - leftTextEndIdx;
  const textGapCenter = (leftTextEndIdx + rightTextStartIdx) / 2;

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
        weights.bookSizeOffset * (bookSize - 1); // Center around medium books

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
  }

  // Compute validation MSE
  let validationMSE = 0;
  for (const example of validation) {
    const f = example.features;
    const target = example.geminiPosition;
    const pagePos = f.pagePosition ?? 0.5;
    const bookSize = f.bookSizeCategory ?? 1;
    const textGapCenterDev = (f.textGapCenter ?? 500) - 500;

    const pred =
      weights.bias +
      weights.centerDarkestIdx * (f.centerDarkestIdx - 50) +
      weights.centerBrightestIdx * (f.centerBrightestIdx - 50) +
      weights.edgeCenterDiff * (f.edgeCenterDiff / 50) +
      weights.invertedGutterOffset * (f.hasInvertedGutter ? 1 : 0) +
      weights.aspectRatioOffset * (f.aspectRatio - 1.5) +
      weights.pagePositionOffset * (pagePos - 0.5) +
      weights.textGapCenterWeight * (textGapCenterDev / 100) +
      weights.bookSizeOffset * (bookSize - 1);

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
    (w.bookSizeOffset ?? 0) * (bookSize - 1);

  // Clamp to valid range (allow wider range for off-center splits)
  return Math.max(200, Math.min(800, Math.round(position)));
}
