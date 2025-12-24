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
}

/**
 * Use Gemini to analyze an image and find the optimal split position
 * This serves as ground truth for training
 */
export async function detectSplitWithGemini(
  imageUrl: string,
  modelId: string = 'gemini-2.0-flash'
): Promise<GeminiSplitResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const model = genAI.getGenerativeModel({ model: modelId });

  const prompt = `You are analyzing a scanned book image that contains two facing pages (a two-page spread).

Your task is to find the EXACT vertical line where the book's gutter (center binding) is located - this is where we should split the image into left and right pages.

Look for these visual cues:
1. A dark shadow or bright gap running vertically down the center
2. Where the text margins from both pages meet
3. The natural fold line of the book
4. Any visible binding or spine

Return your answer in this EXACT JSON format:
{
  "splitPosition": <number from 0-1000 where 0=left edge, 1000=right edge, 500=exact center>,
  "confidence": "<high|medium|low>",
  "reasoning": "<brief explanation of what visual cues you used>"
}

Be precise - even a few percentage points matter for clean page separation.`;

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
  analysisWidth: number = 1000
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
  };
  trainedAt: Date;
  trainingSize: number;
  validationMSE: number;
}

/**
 * Train a simple model from labeled examples
 */
export function trainModel(examples: TrainingExample[]): SplitModel {
  if (examples.length < 10) {
    throw new Error('Need at least 10 training examples');
  }

  // Split into train/validation
  const shuffled = [...examples].sort(() => Math.random() - 0.5);
  const trainSize = Math.floor(shuffled.length * 0.8);
  const train = shuffled.slice(0, trainSize);
  const validation = shuffled.slice(trainSize);

  // Normalize target to center region offset (0 = start of center region)
  // Center region is 40-60%, so we map 400-600 → 0-200
  const normalizeTarget = (pos: number) => pos - 400;
  const denormalizeTarget = (offset: number) => offset + 400;

  // Simple gradient descent to learn weights
  const weights = {
    bias: 100, // Start at center of search region
    centerDarkestIdx: 0.5,
    centerBrightestIdx: 0.5,
    edgeCenterDiff: 0.1,
    invertedGutterOffset: 0,
    aspectRatioOffset: 0,
  };

  const learningRate = 0.001;
  const epochs = 1000;

  for (let epoch = 0; epoch < epochs; epoch++) {
    let totalLoss = 0;
    const gradients = {
      bias: 0,
      centerDarkestIdx: 0,
      centerBrightestIdx: 0,
      edgeCenterDiff: 0,
      invertedGutterOffset: 0,
      aspectRatioOffset: 0,
    };

    for (const example of train) {
      const f = example.features;
      const target = normalizeTarget(example.geminiPosition);

      // Prediction
      const pred =
        weights.bias +
        weights.centerDarkestIdx * f.centerDarkestIdx +
        weights.centerBrightestIdx * f.centerBrightestIdx +
        weights.edgeCenterDiff * (f.edgeCenterDiff / 100) +
        weights.invertedGutterOffset * (f.hasInvertedGutter ? 1 : 0) +
        weights.aspectRatioOffset * (f.aspectRatio - 1.5);

      const error = pred - target;
      totalLoss += error * error;

      // Gradients
      gradients.bias += error;
      gradients.centerDarkestIdx += error * f.centerDarkestIdx;
      gradients.centerBrightestIdx += error * f.centerBrightestIdx;
      gradients.edgeCenterDiff += error * (f.edgeCenterDiff / 100);
      gradients.invertedGutterOffset += error * (f.hasInvertedGutter ? 1 : 0);
      gradients.aspectRatioOffset += error * (f.aspectRatio - 1.5);
    }

    // Update weights
    const n = train.length;
    weights.bias -= learningRate * (gradients.bias / n);
    weights.centerDarkestIdx -= learningRate * (gradients.centerDarkestIdx / n);
    weights.centerBrightestIdx -= learningRate * (gradients.centerBrightestIdx / n);
    weights.edgeCenterDiff -= learningRate * (gradients.edgeCenterDiff / n);
    weights.invertedGutterOffset -= learningRate * (gradients.invertedGutterOffset / n);
    weights.aspectRatioOffset -= learningRate * (gradients.aspectRatioOffset / n);
  }

  // Compute validation MSE
  let validationMSE = 0;
  for (const example of validation) {
    const f = example.features;
    const target = example.geminiPosition;

    const predOffset =
      weights.bias +
      weights.centerDarkestIdx * f.centerDarkestIdx +
      weights.centerBrightestIdx * f.centerBrightestIdx +
      weights.edgeCenterDiff * (f.edgeCenterDiff / 100) +
      weights.invertedGutterOffset * (f.hasInvertedGutter ? 1 : 0) +
      weights.aspectRatioOffset * (f.aspectRatio - 1.5);

    const pred = denormalizeTarget(predOffset);
    validationMSE += Math.pow(pred - target, 2);
  }
  validationMSE /= validation.length;

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

  const predOffset =
    w.bias +
    w.centerDarkestIdx * f.centerDarkestIdx +
    w.centerBrightestIdx * f.centerBrightestIdx +
    w.edgeCenterDiff * (f.edgeCenterDiff / 100) +
    w.invertedGutterOffset * (f.hasInvertedGutter ? 1 : 0) +
    w.aspectRatioOffset * (f.aspectRatio - 1.5);

  // Convert back to 0-1000 scale
  const position = Math.round(predOffset + 400);

  // Clamp to valid range
  return Math.max(400, Math.min(600, position));
}
