/**
 * Rule-based heuristic for detecting page splits in two-page book scans
 *
 * Detects:
 * 1. Whether an image is a two-page spread (vs single page)
 * 2. The optimal split position (gutter location)
 * 3. Whether there's text along the proposed split line
 */

export interface ColumnStats {
  x: number;
  mean: number;
  min: number;
  p10: number;
  p25: number;
  median: number;
  maxDarkRun: number; // % of column height
  transitions: number; // # of dark/light transitions
  darkStdDev: number; // consistency of dark pixels
}

export interface SplitDetectionResult {
  isTwoPageSpread: boolean;
  confidence: 'high' | 'medium' | 'low';
  splitPosition: number; // 0-1000 scale
  splitPositionPercent: number;
  hasTextAtSplit: boolean;
  textWarning?: string;
  metrics: {
    aspectRatio: number;
    gutterScore: number;
    maxDarkRunAtSplit: number;
    transitionsAtSplit: number;
    windowAvgDarkRun: number;
    windowAvgTransitions: number;
  };
}

interface AnalyzeOptions {
  darkThreshold?: number; // Default 180
  searchRegionStart?: number; // Default 0.35 (35%)
  searchRegionEnd?: number; // Default 0.65 (65%)
}

/**
 * Analyze pixel data and compute column statistics
 */
export function analyzeColumns(
  pixelData: Uint8Array,
  width: number,
  height: number,
  options: AnalyzeOptions = {}
): ColumnStats[] {
  const darkThreshold = options.darkThreshold ?? 180;
  const columns: ColumnStats[] = [];

  for (let x = 0; x < width; x++) {
    const pixels: number[] = [];
    for (let y = 0; y < height; y++) {
      pixels.push(pixelData[y * width + x]);
    }

    // Sort for percentiles
    const sorted = [...pixels].sort((a, b) => a - b);
    const sum = pixels.reduce((a, b) => a + b, 0);
    const mean = sum / height;

    // Longest consecutive dark run
    let maxDarkRun = 0;
    let currentRun = 0;
    for (const p of pixels) {
      if (p < darkThreshold) {
        currentRun++;
        maxDarkRun = Math.max(maxDarkRun, currentRun);
      } else {
        currentRun = 0;
      }
    }

    // Count transitions
    let transitions = 0;
    for (let i = 1; i < pixels.length; i++) {
      const wasDark = pixels[i - 1] < darkThreshold;
      const isDark = pixels[i] < darkThreshold;
      if (wasDark !== isDark) transitions++;
    }

    // Variance in darkest 25% of pixels
    const darkPixels = sorted.slice(0, Math.floor(height * 0.25));
    const darkMean = darkPixels.reduce((a, b) => a + b, 0) / darkPixels.length;
    const darkVariance =
      darkPixels.reduce((sum, v) => sum + Math.pow(v - darkMean, 2), 0) / darkPixels.length;

    columns.push({
      x,
      mean,
      min: sorted[0],
      p10: sorted[Math.floor(height * 0.1)],
      p25: sorted[Math.floor(height * 0.25)],
      median: sorted[Math.floor(height * 0.5)],
      maxDarkRun: (maxDarkRun / height) * 100,
      transitions,
      darkStdDev: Math.sqrt(darkVariance),
    });
  }

  return columns;
}

/**
 * Find the best gutter position using multiple metrics
 */
export function findGutterPosition(
  columns: ColumnStats[],
  options: AnalyzeOptions = {}
): { position: number; score: number; stats: ColumnStats } {
  const searchStart = Math.floor(columns.length * (options.searchRegionStart ?? 0.35));
  const searchEnd = Math.floor(columns.length * (options.searchRegionEnd ?? 0.65));

  let bestScore = -Infinity;
  let bestIdx = Math.floor(columns.length / 2);

  for (let i = searchStart; i < searchEnd; i++) {
    const col = columns[i];

    // Gutter score: low P10 + high dark run + low transitions + low dark variance
    // Normalize each component to roughly 0-100 scale
    const p10Score = (255 - col.p10) / 2.55; // Lower P10 = higher score (0-100)
    const darkRunScore = col.maxDarkRun; // Higher = better (0-100)
    const transitionScore = Math.max(0, 100 - col.transitions / 5); // Fewer = better
    const consistencyScore = Math.max(0, 50 - col.darkStdDev); // Lower variance = better

    // Weighted combination
    const score =
      p10Score * 0.3 + darkRunScore * 0.35 + transitionScore * 0.2 + consistencyScore * 0.15;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return {
    position: bestIdx,
    score: bestScore,
    stats: columns[bestIdx],
  };
}

/**
 * Detect if there's text at the proposed split position
 * Text indicators: high transitions, low dark run, high variance
 *
 * Uses a narrow window (±3 columns) to check the actual split line,
 * not the surrounding text areas.
 */
export function detectTextAtPosition(
  columns: ColumnStats[],
  position: number,
  windowSize: number = 3 // Narrow window - just the gutter area
): { hasText: boolean; confidence: number; reason: string; metrics: { transitions: number; darkRun: number; darkStdDev: number } } {
  // Check the narrow window right at the split position
  const start = Math.max(0, position - windowSize);
  const end = Math.min(columns.length, position + windowSize + 1);
  const window = columns.slice(start, end);

  const avgTransitions = window.reduce((sum, c) => sum + c.transitions, 0) / window.length;
  const avgMaxDarkRun = window.reduce((sum, c) => sum + c.maxDarkRun, 0) / window.length;
  const avgDarkStdDev = window.reduce((sum, c) => sum + c.darkStdDev, 0) / window.length;

  // Also check the single column at split position
  const splitCol = columns[position];

  // Text detection thresholds (tuned from analysis)
  // A proper gutter should have: high dark run (>60%), low transitions (<30), low variance
  const hasHighTransitions = splitCol.transitions > 30 && avgTransitions > 40;
  const hasLowDarkRun = splitCol.maxDarkRun < 40 && avgMaxDarkRun < 50;
  const hasHighVariance = avgDarkStdDev > 30;

  // Text is present if the split column itself shows text characteristics
  const textSignals = [hasHighTransitions, hasLowDarkRun, hasHighVariance].filter(Boolean).length;

  const metrics = {
    transitions: Math.round(avgTransitions),
    darkRun: Math.round(avgMaxDarkRun),
    darkStdDev: Math.round(avgDarkStdDev),
  };

  if (textSignals >= 2) {
    const reasons = [];
    if (hasHighTransitions) reasons.push(`high transitions (${splitCol.transitions})`);
    if (hasLowDarkRun) reasons.push(`short dark runs (${splitCol.maxDarkRun.toFixed(0)}%)`);
    if (hasHighVariance) reasons.push(`high variance (${avgDarkStdDev.toFixed(0)})`);

    return {
      hasText: true,
      confidence: textSignals / 3,
      reason: `Text at split: ${reasons.join(', ')}`,
      metrics,
    };
  }

  return {
    hasText: false,
    confidence: 1 - textSignals / 3,
    reason: 'Clean gutter detected',
    metrics,
  };
}

/**
 * Main detection function - analyzes an image and returns split recommendation
 */
export function detectSplit(
  pixelData: Uint8Array,
  width: number,
  height: number,
  options: AnalyzeOptions = {}
): SplitDetectionResult {
  const aspectRatio = width / height;

  // Step 1: Check if it's a two-page spread
  if (aspectRatio < 0.9) {
    return {
      isTwoPageSpread: false,
      confidence: 'high',
      splitPosition: 500,
      splitPositionPercent: 50,
      hasTextAtSplit: false,
      metrics: {
        aspectRatio,
        gutterScore: 0,
        maxDarkRunAtSplit: 0,
        transitionsAtSplit: 0,
        windowAvgDarkRun: 0,
        windowAvgTransitions: 0,
      },
    };
  }

  // Step 2: Analyze columns
  const columns = analyzeColumns(pixelData, width, height, options);

  // Step 3: Find gutter
  const gutter = findGutterPosition(columns, options);

  // Step 4: Check for text at split
  const textCheck = detectTextAtPosition(columns, gutter.position);

  // Step 5: Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (aspectRatio > 1.1 && gutter.score > 50 && !textCheck.hasText) {
    confidence = 'high';
  } else if (aspectRatio < 1.0 || gutter.score < 30 || textCheck.hasText) {
    confidence = 'low';
  }

  // Convert position to 0-1000 scale
  const splitPosition = Math.round((gutter.position / columns.length) * 1000);

  return {
    isTwoPageSpread: aspectRatio > 1.0,
    confidence,
    splitPosition,
    splitPositionPercent: (gutter.position / columns.length) * 100,
    hasTextAtSplit: textCheck.hasText,
    textWarning: textCheck.hasText ? textCheck.reason : undefined,
    metrics: {
      aspectRatio,
      gutterScore: gutter.score,
      maxDarkRunAtSplit: gutter.stats.maxDarkRun,
      transitionsAtSplit: gutter.stats.transitions,
      windowAvgDarkRun: textCheck.metrics.darkRun,
      windowAvgTransitions: textCheck.metrics.transitions,
    },
  };
}

/**
 * Helper to convert Sharp raw buffer to detection result
 * Usage with Sharp:
 *
 * const { data, info } = await sharp(imageBuffer)
 *   .resize(1000, null, { fit: 'inside' })
 *   .grayscale()
 *   .raw()
 *   .toBuffer({ resolveWithObject: true });
 *
 * const result = detectSplit(data, info.width, info.height);
 */
export async function detectSplitFromBuffer(
  imageBuffer: Buffer,
  analysisWidth: number = 1000
): Promise<SplitDetectionResult> {
  // Dynamic import to avoid issues in non-Node environments
  const sharp = (await import('sharp')).default;

  const { data, info } = await sharp(imageBuffer)
    .resize(analysisWidth, null, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return detectSplit(new Uint8Array(data), info.width, info.height);
}
