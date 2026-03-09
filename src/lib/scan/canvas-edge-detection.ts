/**
 * Page edge detection using Hough Line Transform + multi-channel color edges.
 *
 * Pipeline: downscale → multi-channel Sobel (RGB) → non-maximum suppression
 * → Hough Line Transform → line classification → quad enumeration
 * → perimeter edge scoring → temporal smoothing.
 *
 * Key insights from Dropbox scanner research:
 * - "RGB to grayscale is a mistake" — run Sobel on each channel, take max
 * - Hough lines handle broken/partial edges that contour tracing misses
 * - Score quads by perimeter edge response, not just area
 * - Temporal smoothing (EMA) eliminates jitter across frames
 *
 * Performance target: 15-30fps on mobile (320x240 downscaled frames).
 */

import type { EdgeDetector, DetectionResult } from './edge-detection-types';

// Processing constants
const TARGET_WIDTH = 320;
const MIN_AREA_RATIO = 0.08;
const MIN_ANGLE_DEG = 50;
const MAX_ANGLE_DEG = 130;

// Hough transform parameters
const HOUGH_THETA_BINS = 180;           // 1-degree resolution
const HOUGH_RHO_RESOLUTION = 2;         // pixels per rho bin
const HOUGH_THRESHOLD_RATIO = 0.25;     // fraction of max accumulator value
const HOUGH_MIN_LINE_VOTES = 30;        // minimum votes for a line
const MAX_LINES = 30;                   // max lines to extract
const HOUGH_NMS_RHO_WINDOW = 10;        // rho suppression window
const HOUGH_NMS_THETA_WINDOW = 5;       // theta suppression window (degrees)

// Canny-style thresholds (ratio of max gradient)
const CANNY_LOW_RATIO = 0.05;
const CANNY_HIGH_RATIO = 0.15;

// Temporal smoothing
const EMA_ALPHA = 0.35;                 // smoothing factor (0=full history, 1=no smoothing)
const MAX_CORNER_JUMP = 0.15;           // normalized; larger jump resets EMA

// Quad scoring weights
const WEIGHT_EDGE_RESPONSE = 0.35;
const WEIGHT_AREA = 0.25;
const WEIGHT_ANGLE = 0.25;
const WEIGHT_ASPECT = 0.15;

type Point = [number, number];

// Hough line in polar form: rho (distance from origin) and theta (angle in radians)
interface HoughLine {
  rho: number;
  theta: number;
  votes: number;
}

interface ScoredQuad {
  corners: Point[];
  score: number;
  edgeResponse: number;
  area: number;
}

export function createCanvasEdgeDetector(): EdgeDetector {
  // Temporal smoothing state (persists across frames)
  let prevCorners: Point[] | null = null;
  let prevConfidence = 0;
  let missCount = 0;

  // Pre-computed sin/cos tables for Hough transform
  const sinTable = new Float32Array(HOUGH_THETA_BINS);
  const cosTable = new Float32Array(HOUGH_THETA_BINS);
  for (let t = 0; t < HOUGH_THETA_BINS; t++) {
    const theta = (t * Math.PI) / HOUGH_THETA_BINS;
    sinTable[t] = Math.sin(theta);
    cosTable[t] = Math.cos(theta);
  }

  return {
    async init() {
      // No-op — no external dependencies.
    },

    detect(frame: ImageData): DetectionResult | null {
      const { width: srcW, height: srcH } = frame;
      if (srcW === 0 || srcH === 0) return null;

      // 1. Downscale (keep RGB)
      const scale = Math.min(TARGET_WIDTH / srcW, TARGET_WIDTH / srcH, 1);
      const w = Math.round(srcW * scale);
      const h = Math.round(srcH * scale);
      const rgb = downscaleRGB(frame, w, h);

      // 2. Multi-channel Sobel: run on R, G, B separately, take max magnitude
      const { magnitude, direction } = multiChannelSobel(rgb, w, h);

      // 3. Non-maximum suppression (thin edges to single pixel width)
      const thinned = nonMaxSuppression(magnitude, direction, w, h);

      // 4. Hysteresis thresholding (Canny-style dual threshold)
      let maxMag = 0;
      for (let i = 0; i < thinned.length; i++) {
        if (thinned[i] > maxMag) maxMag = thinned[i];
      }
      const highThresh = Math.max(20, maxMag * CANNY_HIGH_RATIO);
      const lowThresh = Math.max(8, maxMag * CANNY_LOW_RATIO);
      const edges = hysteresisThreshold(thinned, w, h, lowThresh, highThresh);

      // 5. Hough Line Transform
      const maxRho = Math.ceil(Math.sqrt(w * w + h * h));
      const lines = houghLines(edges, direction, w, h, maxRho, sinTable, cosTable);

      if (lines.length < 4) {
        // Not enough lines — can't form a quad
        return handleMiss(prevCorners, prevConfidence);
      }

      // 6. Classify lines as roughly horizontal or vertical
      const { horizontal, vertical } = classifyLines(lines);

      if (horizontal.length < 2 || vertical.length < 2) {
        return handleMiss(prevCorners, prevConfidence);
      }

      // 7. Enumerate candidate quads from line intersections
      const candidates = enumerateQuads(horizontal, vertical, w, h);

      if (candidates.length === 0) {
        return handleMiss(prevCorners, prevConfidence);
      }

      // 8. Score each candidate quad
      const frameArea = w * h;
      const scored = scoreQuads(candidates, magnitude, w, h, frameArea);

      if (scored.length === 0) {
        return handleMiss(prevCorners, prevConfidence);
      }

      // Best quad
      const best = scored[0];

      // 9. Normalize corners to 0-1
      const ordered = orderCornersCW(best.corners);
      let corners: Point[] = ordered.map(
        ([x, y]) => [x / w, y / h] as Point
      );

      // 10. Temporal smoothing (EMA)
      if (prevCorners && !hasLargeJump(prevCorners, corners)) {
        corners = corners.map((c, i) => [
          prevCorners![i][0] * (1 - EMA_ALPHA) + c[0] * EMA_ALPHA,
          prevCorners![i][1] * (1 - EMA_ALPHA) + c[1] * EMA_ALPHA,
        ] as Point);
      }

      prevCorners = corners;
      missCount = 0;

      // Confidence from quad score
      const confidence = Math.min(1, best.score);
      prevConfidence = confidence;

      return { corners, confidence };
    },

    destroy() {
      prevCorners = null;
      prevConfidence = 0;
      missCount = 0;
    },
  };

  function handleMiss(
    prev: Point[] | null,
    conf: number
  ): DetectionResult | null {
    missCount++;
    // Hold previous detection for a few frames to avoid flicker
    if (prev && missCount <= 3) {
      return { corners: prev, confidence: conf * 0.7 };
    }
    prevCorners = null;
    prevConfidence = 0;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Image processing
// ---------------------------------------------------------------------------

function downscaleRGB(
  frame: ImageData,
  w: number,
  h: number
): { r: Float32Array; g: Float32Array; b: Float32Array } {
  const srcW = frame.width;
  const srcH = frame.height;
  const src = frame.data;
  const n = w * h;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);

  for (let y = 0; y < h; y++) {
    const srcY = Math.min(Math.round((y / h) * srcH), srcH - 1);
    for (let x = 0; x < w; x++) {
      const srcX = Math.min(Math.round((x / w) * srcW), srcW - 1);
      const i = (srcY * srcW + srcX) * 4;
      const idx = y * w + x;
      r[idx] = src[i];
      g[idx] = src[i + 1];
      b[idx] = src[i + 2];
    }
  }
  return { r, g, b };
}

/** Gaussian blur 3x3 on a single channel. */
function blur3x3(ch: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y < 1 || y >= h - 1 || x < 1 || x >= w - 1) {
        out[y * w + x] = ch[y * w + x];
        continue;
      }
      const idx = y * w + x;
      out[idx] =
        (ch[idx - w - 1] + 2 * ch[idx - w] + ch[idx - w + 1] +
         2 * ch[idx - 1] + 4 * ch[idx] + 2 * ch[idx + 1] +
         ch[idx + w - 1] + 2 * ch[idx + w] + ch[idx + w + 1]) / 16;
    }
  }
  return out;
}

/** Sobel on a single channel, returns gx, gy, magnitude. */
function sobelChannel(
  ch: Float32Array,
  w: number,
  h: number
): { gx: Float32Array; gy: Float32Array; mag: Float32Array } {
  const n = w * h;
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const mag = new Float32Array(n);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const sx =
        -ch[idx - w - 1] + ch[idx - w + 1] +
        -2 * ch[idx - 1] + 2 * ch[idx + 1] +
        -ch[idx + w - 1] + ch[idx + w + 1];
      const sy =
        -ch[idx - w - 1] - 2 * ch[idx - w] - ch[idx - w + 1] +
        ch[idx + w - 1] + 2 * ch[idx + w] + ch[idx + w + 1];
      gx[idx] = sx;
      gy[idx] = sy;
      mag[idx] = Math.sqrt(sx * sx + sy * sy);
    }
  }
  return { gx, gy, mag };
}

/**
 * Multi-channel Sobel: run Sobel on each RGB channel (after blur),
 * take max magnitude at each pixel. This catches chrominance edges
 * that grayscale Sobel misses (e.g. white page on beige desk).
 */
function multiChannelSobel(
  rgb: { r: Float32Array; g: Float32Array; b: Float32Array },
  w: number,
  h: number
): { magnitude: Float32Array; direction: Float32Array } {
  const n = w * h;
  const magnitude = new Float32Array(n);
  const direction = new Float32Array(n);

  // Blur each channel
  const rBlur = blur3x3(rgb.r, w, h);
  const gBlur = blur3x3(rgb.g, w, h);
  const bBlur = blur3x3(rgb.b, w, h);

  // Sobel each channel
  const rSobel = sobelChannel(rBlur, w, h);
  const gSobel = sobelChannel(gBlur, w, h);
  const bSobel = sobelChannel(bBlur, w, h);

  // Take max magnitude across channels; use gradient direction from the
  // channel that produced the strongest response
  for (let i = 0; i < n; i++) {
    const rm = rSobel.mag[i];
    const gm = gSobel.mag[i];
    const bm = bSobel.mag[i];

    if (rm >= gm && rm >= bm) {
      magnitude[i] = rm;
      direction[i] = Math.atan2(rSobel.gy[i], rSobel.gx[i]);
    } else if (gm >= bm) {
      magnitude[i] = gm;
      direction[i] = Math.atan2(gSobel.gy[i], gSobel.gx[i]);
    } else {
      magnitude[i] = bm;
      direction[i] = Math.atan2(bSobel.gy[i], bSobel.gx[i]);
    }
  }

  return { magnitude, direction };
}

// ---------------------------------------------------------------------------
// Canny-style edge refinement
// ---------------------------------------------------------------------------

/**
 * Non-maximum suppression: thin multi-pixel edge ridges to single-pixel width
 * by suppressing pixels that aren't local maxima along the gradient direction.
 */
function nonMaxSuppression(
  magnitude: Float32Array,
  direction: Float32Array,
  w: number,
  h: number
): Float32Array {
  const out = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const mag = magnitude[idx];
      if (mag === 0) continue;

      // Quantize gradient direction to 4 sectors (0°, 45°, 90°, 135°)
      let angle = direction[idx] * (180 / Math.PI);
      if (angle < 0) angle += 180;

      let n1: number, n2: number;
      if ((angle >= 0 && angle < 22.5) || (angle >= 157.5 && angle <= 180)) {
        // Horizontal edge → compare with left/right
        n1 = magnitude[idx - 1];
        n2 = magnitude[idx + 1];
      } else if (angle >= 22.5 && angle < 67.5) {
        // 45° edge → compare with diagonal
        n1 = magnitude[idx - w + 1];
        n2 = magnitude[idx + w - 1];
      } else if (angle >= 67.5 && angle < 112.5) {
        // Vertical edge → compare with above/below
        n1 = magnitude[idx - w];
        n2 = magnitude[idx + w];
      } else {
        // 135° edge → compare with other diagonal
        n1 = magnitude[idx - w - 1];
        n2 = magnitude[idx + w + 1];
      }

      // Keep only if this pixel is the local maximum
      if (mag >= n1 && mag >= n2) {
        out[idx] = mag;
      }
    }
  }
  return out;
}

/**
 * Hysteresis thresholding: strong edges (>high) are kept; weak edges (>low)
 * are kept only if connected to a strong edge. This preserves faint page
 * boundaries while rejecting isolated noise.
 */
function hysteresisThreshold(
  thinned: Float32Array,
  w: number,
  h: number,
  low: number,
  high: number
): Uint8Array {
  const n = w * h;
  const edges = new Uint8Array(n);

  // Mark strong edges
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (thinned[i] >= high) {
      edges[i] = 1;
      stack.push(i);
    }
  }

  // Flood-fill from strong edges through weak edges
  const dx = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dy = [-1, -1, -1, 0, 0, 1, 1, 1];

  while (stack.length > 0) {
    const idx = stack.pop()!;
    const x = idx % w;
    const y = (idx - x) / w;

    for (let d = 0; d < 8; d++) {
      const nx = x + dx[d];
      const ny = y + dy[d];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (edges[nIdx] === 0 && thinned[nIdx] >= low) {
        edges[nIdx] = 1;
        stack.push(nIdx);
      }
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Hough Line Transform
// ---------------------------------------------------------------------------

/**
 * Hough Line Transform with gradient-direction voting optimization.
 * Each edge pixel only votes for angles within ±20° of its gradient direction,
 * giving ~5x speedup over full-angle voting.
 */
function houghLines(
  edges: Uint8Array,
  direction: Float32Array,
  w: number,
  h: number,
  maxRho: number,
  sinTable: Float32Array,
  cosTable: Float32Array
): HoughLine[] {
  const numRhoBins = Math.ceil((2 * maxRho) / HOUGH_RHO_RESOLUTION);
  const accumulator = new Int32Array(numRhoBins * HOUGH_THETA_BINS);

  // Voting with gradient-direction constraint
  const thetaWindow = 20; // degrees
  const thetaBinWindow = Math.ceil(thetaWindow * HOUGH_THETA_BINS / 180);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!edges[y * w + x]) continue;

      // Edge direction → expected line angle (perpendicular to gradient)
      const gradAngle = direction[y * w + x];
      // Line angle is perpendicular to gradient
      let lineAngle = gradAngle + Math.PI / 2;
      if (lineAngle < 0) lineAngle += Math.PI;
      if (lineAngle >= Math.PI) lineAngle -= Math.PI;

      const centerBin = Math.round((lineAngle / Math.PI) * HOUGH_THETA_BINS) % HOUGH_THETA_BINS;

      // Vote within ±thetaBinWindow of expected angle
      for (let dt = -thetaBinWindow; dt <= thetaBinWindow; dt++) {
        let tBin = centerBin + dt;
        if (tBin < 0) tBin += HOUGH_THETA_BINS;
        if (tBin >= HOUGH_THETA_BINS) tBin -= HOUGH_THETA_BINS;

        const rho = x * cosTable[tBin] + y * sinTable[tBin];
        const rhoBin = Math.round((rho + maxRho) / HOUGH_RHO_RESOLUTION);
        if (rhoBin >= 0 && rhoBin < numRhoBins) {
          accumulator[rhoBin * HOUGH_THETA_BINS + tBin]++;
        }
      }
    }
  }

  // Find peaks with NMS in accumulator space
  let maxVotes = 0;
  for (let i = 0; i < accumulator.length; i++) {
    if (accumulator[i] > maxVotes) maxVotes = accumulator[i];
  }

  const threshold = Math.max(
    HOUGH_MIN_LINE_VOTES,
    Math.round(maxVotes * HOUGH_THRESHOLD_RATIO)
  );

  // Extract peaks above threshold
  const peaks: HoughLine[] = [];
  for (let rBin = 0; rBin < numRhoBins; rBin++) {
    for (let tBin = 0; tBin < HOUGH_THETA_BINS; tBin++) {
      const votes = accumulator[rBin * HOUGH_THETA_BINS + tBin];
      if (votes < threshold) continue;

      // Check if this is a local maximum in a window
      let isMax = true;
      const rStart = Math.max(0, rBin - HOUGH_NMS_RHO_WINDOW);
      const rEnd = Math.min(numRhoBins - 1, rBin + HOUGH_NMS_RHO_WINDOW);
      const tStart = tBin - HOUGH_NMS_THETA_WINDOW;
      const tEnd = tBin + HOUGH_NMS_THETA_WINDOW;

      outer: for (let r = rStart; r <= rEnd; r++) {
        for (let dt = tStart; dt <= tEnd; dt++) {
          if (r === rBin && dt === tBin) continue;
          let t = dt;
          if (t < 0) t += HOUGH_THETA_BINS;
          if (t >= HOUGH_THETA_BINS) t -= HOUGH_THETA_BINS;
          if (accumulator[r * HOUGH_THETA_BINS + t] > votes) {
            isMax = false;
            break outer;
          }
        }
      }

      if (isMax) {
        peaks.push({
          rho: rBin * HOUGH_RHO_RESOLUTION - maxRho,
          theta: (tBin * Math.PI) / HOUGH_THETA_BINS,
          votes,
        });
      }
    }
  }

  // Sort by votes descending, take top N
  peaks.sort((a, b) => b.votes - a.votes);
  return peaks.slice(0, MAX_LINES);
}

// ---------------------------------------------------------------------------
// Line classification & quad enumeration
// ---------------------------------------------------------------------------

/**
 * Classify lines as roughly horizontal (theta near 0° or 180°)
 * or vertical (theta near 90°).
 */
function classifyLines(lines: HoughLine[]): {
  horizontal: HoughLine[];
  vertical: HoughLine[];
} {
  const horizontal: HoughLine[] = [];
  const vertical: HoughLine[] = [];

  for (const line of lines) {
    const angleDeg = (line.theta * 180) / Math.PI;
    // Horizontal: theta near 90° (line is horizontal in image)
    // Vertical: theta near 0° or 180° (line is vertical in image)
    if (angleDeg > 45 && angleDeg < 135) {
      horizontal.push(line);
    } else {
      vertical.push(line);
    }
  }

  return { horizontal, vertical };
}

/**
 * Find intersection of two Hough lines. Returns null if parallel.
 */
function lineIntersection(l1: HoughLine, l2: HoughLine): Point | null {
  const s1 = Math.sin(l1.theta);
  const c1 = Math.cos(l1.theta);
  const s2 = Math.sin(l2.theta);
  const c2 = Math.cos(l2.theta);

  const det = c1 * s2 - c2 * s1;
  if (Math.abs(det) < 1e-6) return null; // parallel

  const x = (l1.rho * s2 - l2.rho * s1) / det;
  const y = (l2.rho * c1 - l1.rho * c2) / det;

  return [x, y];
}

/**
 * Enumerate all candidate quadrilaterals from pairs of horizontal and
 * vertical lines. Each quad = 2 horizontal lines × 2 vertical lines → 4 corners.
 */
function enumerateQuads(
  horizontal: HoughLine[],
  vertical: HoughLine[],
  w: number,
  h: number
): Point[][] {
  const quads: Point[][] = [];
  const margin = w * 0.1; // allow corners slightly outside frame

  // Try all pairs of horizontal lines × pairs of vertical lines
  const hLen = Math.min(horizontal.length, 8); // cap to avoid combinatorial explosion
  const vLen = Math.min(vertical.length, 8);

  for (let hi = 0; hi < hLen; hi++) {
    for (let hj = hi + 1; hj < hLen; hj++) {
      for (let vi = 0; vi < vLen; vi++) {
        for (let vj = vi + 1; vj < vLen; vj++) {
          const h1 = horizontal[hi];
          const h2 = horizontal[hj];
          const v1 = vertical[vi];
          const v2 = vertical[vj];

          // 4 intersections
          const tl = lineIntersection(h1, v1);
          const tr = lineIntersection(h1, v2);
          const br = lineIntersection(h2, v2);
          const bl = lineIntersection(h2, v1);

          if (!tl || !tr || !br || !bl) continue;

          // All corners must be near the image bounds
          const corners = [tl, tr, br, bl];
          const inBounds = corners.every(
            ([x, y]) =>
              x >= -margin && x <= w + margin &&
              y >= -margin && y <= h + margin
          );
          if (!inBounds) continue;

          // Clamp to image bounds
          const clamped = corners.map(
            ([x, y]) =>
              [Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y))] as Point
          );

          quads.push(clamped);
        }
      }
    }
  }

  return quads;
}

// ---------------------------------------------------------------------------
// Quad scoring
// ---------------------------------------------------------------------------

/**
 * Score candidate quads by:
 * 1. Perimeter edge response (Dropbox method: sum gradient magnitudes along edges)
 * 2. Area (larger = better, but capped)
 * 3. Angle regularity (closer to 90° = better)
 * 4. Aspect ratio (closer to typical page ratio = better)
 */
function scoreQuads(
  candidates: Point[][],
  magnitude: Float32Array,
  w: number,
  h: number,
  frameArea: number
): ScoredQuad[] {
  const scored: ScoredQuad[] = [];

  for (const corners of candidates) {
    // Convexity check
    if (!isConvex(corners)) continue;

    // Area check
    const area = polygonArea(corners);
    if (area < MIN_AREA_RATIO * frameArea) continue;

    // Aspect ratio check
    const ar = quadAspectRatio(corners);
    if (ar < 0.3 || ar > 3.0) continue;

    // Angle check
    if (!anglesInRange(corners, MIN_ANGLE_DEG, MAX_ANGLE_DEG)) continue;

    // Perimeter edge response: sample gradient magnitude along each edge
    const edgeResponse = perimeterEdgeResponse(corners, magnitude, w, h);

    // Normalize scores
    const areaScore = Math.min(1, area / (frameArea * 0.7));
    const angleScore = angleRegularity(corners);

    // Aspect ratio score: peak at ~0.7 (typical page w/h), gentle falloff
    const idealAR = 0.75;
    const arDiff = Math.abs(1 / ar - idealAR);
    const aspectScore = Math.max(0, 1 - arDiff);

    const edgeNorm = Math.min(1, edgeResponse / 80); // empirical scaling

    const totalScore =
      WEIGHT_EDGE_RESPONSE * edgeNorm +
      WEIGHT_AREA * areaScore +
      WEIGHT_ANGLE * angleScore +
      WEIGHT_ASPECT * aspectScore;

    scored.push({ corners, score: totalScore, edgeResponse, area });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Sample gradient magnitude along the perimeter of a quad.
 * Returns average magnitude — higher values mean the quad edges align
 * with actual image edges.
 */
function perimeterEdgeResponse(
  corners: Point[],
  magnitude: Float32Array,
  w: number,
  h: number
): number {
  let sum = 0;
  let count = 0;
  const samplesPerEdge = 30;

  for (let i = 0; i < 4; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % 4];

    for (let s = 0; s <= samplesPerEdge; s++) {
      const t = s / samplesPerEdge;
      const px = Math.round(x1 + t * (x2 - x1));
      const py = Math.round(y1 + t * (y2 - y1));
      if (px >= 0 && px < w && py >= 0 && py < h) {
        sum += magnitude[py * w + px];
        count++;
      }
    }
  }

  return count > 0 ? sum / count : 0;
}

// ---------------------------------------------------------------------------
// Temporal smoothing helpers
// ---------------------------------------------------------------------------

function hasLargeJump(prev: Point[], curr: Point[]): boolean {
  for (let i = 0; i < 4; i++) {
    const dx = prev[i][0] - curr[i][0];
    const dy = prev[i][1] - curr[i][1];
    if (Math.sqrt(dx * dx + dy * dy) > MAX_CORNER_JUMP) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Polygon helpers
// ---------------------------------------------------------------------------

function polygonArea(pts: Point[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i][0] * pts[j][1];
    area -= pts[j][0] * pts[i][1];
  }
  return Math.abs(area) / 2;
}

function isConvex(pts: Point[]): boolean {
  const n = pts.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const c = pts[(i + 2) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) {
      if (sign === 0) {
        sign = cross > 0 ? 1 : -1;
      } else if ((cross > 0 ? 1 : -1) !== sign) {
        return false;
      }
    }
  }
  return true;
}

function quadAspectRatio(pts: Point[]): number {
  const sides: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const dx = pts[j][0] - pts[i][0];
    const dy = pts[j][1] - pts[i][1];
    sides.push(Math.sqrt(dx * dx + dy * dy));
  }
  const minSide = Math.min(...sides);
  const maxSide = Math.max(...sides);
  if (minSide === 0) return Infinity;
  return maxSide / minSide;
}

function angleDeg(a: Point, b: Point, c: Point): number {
  const ba = [a[0] - b[0], a[1] - b[1]];
  const bc = [c[0] - b[0], c[1] - b[1]];
  const dot = ba[0] * bc[0] + ba[1] * bc[1];
  const magBA = Math.sqrt(ba[0] * ba[0] + ba[1] * ba[1]);
  const magBC = Math.sqrt(bc[0] * bc[0] + bc[1] * bc[1]);
  if (magBA === 0 || magBC === 0) return 0;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

function anglesInRange(pts: Point[], minDeg: number, maxDeg: number): boolean {
  for (let i = 0; i < 4; i++) {
    const a = pts[(i + 3) % 4];
    const b = pts[i];
    const c = pts[(i + 1) % 4];
    const deg = angleDeg(a, b, c);
    if (deg < minDeg || deg > maxDeg) return false;
  }
  return true;
}

function angleRegularity(pts: Point[]): number {
  let totalDeviation = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[(i + 3) % 4];
    const b = pts[i];
    const c = pts[(i + 1) % 4];
    const deg = angleDeg(a, b, c);
    totalDeviation += Math.abs(deg - 90);
  }
  return Math.max(0, 1 - totalDeviation / 120);
}

/** Order 4 points clockwise starting from top-left. */
function orderCornersCW(pts: Point[]): Point[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
  const cy = pts.reduce((s, p) => s + p[1], 0) / 4;

  const sorted = [...pts].sort((a, b) => {
    const angA = Math.atan2(a[1] - cy, a[0] - cx);
    const angB = Math.atan2(b[1] - cy, b[0] - cx);
    return angA - angB;
  });

  // Find top-left (smallest x+y sum) and rotate to start there
  let tlIdx = 0;
  let minSum = Infinity;
  for (let i = 0; i < 4; i++) {
    const s = sorted[i][0] + sorted[i][1];
    if (s < minSum) {
      minSum = s;
      tlIdx = i;
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < 4; i++) {
    result.push(sorted[(tlIdx + i) % 4]);
  }
  return result;
}
