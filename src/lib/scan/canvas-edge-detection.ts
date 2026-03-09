/**
 * Lightweight page edge detection using pure Canvas API.
 *
 * Algorithm: downscale -> grayscale -> blur -> Sobel -> threshold -> contour scan
 * -> polygon simplification -> quadrilateral filter -> confidence scoring.
 *
 * Performance target: 15-30fps on mobile (operates on ~320x240 downscaled frames).
 */

import type { EdgeDetector, DetectionResult } from './edge-detection-types';

// Processing constants
const TARGET_WIDTH = 320;
const MIN_AREA_RATIO = 0.10;
const MIN_ANGLE_DEG = 50;
const MAX_ANGLE_DEG = 130;
const SOBEL_THRESHOLD = 40;
const BLUR_KERNEL_SIZE = 3;

type Point = [number, number];

export function createCanvasEdgeDetector(): EdgeDetector {
  return {
    async init() {
      // No-op for canvas — no external dependencies to load.
    },

    detect(frame: ImageData): DetectionResult | null {
      const { width: srcW, height: srcH } = frame;
      if (srcW === 0 || srcH === 0) return null;

      // 1. Downscale
      const scale = Math.min(TARGET_WIDTH / srcW, TARGET_WIDTH / srcH, 1);
      const w = Math.round(srcW * scale);
      const h = Math.round(srcH * scale);
      const gray = downscaleToGray(frame, w, h);

      // 2. Gaussian blur 3x3
      const blurred = gaussianBlur3x3(gray, w, h);

      // 3. Sobel edge detection
      const { magnitude, maxMag } = sobelEdges(blurred, w, h);

      // 4. Threshold to binary edge map
      // Use a low adaptive ratio so strong text edges don't drown out
      // subtle page-to-surface boundary edges.
      const threshold = Math.max(SOBEL_THRESHOLD, maxMag * 0.12);
      const edges = new Uint8Array(w * h);
      for (let i = 0; i < magnitude.length; i++) {
        edges[i] = magnitude[i] >= threshold ? 1 : 0;
      }

      // 4b. Dilate edges to bridge small gaps in page boundary contours
      dilateEdges(edges, w, h);

      // 5. Find contours
      const contours = findContours(edges, w, h);

      // 6-9. Find best quadrilateral
      const frameArea = w * h;
      let bestQuad: Point[] | null = null;
      let bestArea = 0;
      let bestEdgeStrength = 0;

      for (const contour of contours) {
        if (contour.length < 20) continue;

        // Approximate polygon (Douglas-Peucker)
        const perim = contourPerimeter(contour);
        const epsilon = perim * 0.03;
        const poly = douglasPeucker(contour, epsilon);

        if (poly.length !== 4) continue;

        // Convexity check
        if (!isConvex(poly)) continue;

        // Area check
        const area = polygonArea(poly);
        if (area < MIN_AREA_RATIO * frameArea) continue;

        // Aspect ratio check
        const ar = quadAspectRatio(poly);
        if (ar < 0.5 || ar > 2.0) continue;

        // Angle check
        if (!anglesInRange(poly, MIN_ANGLE_DEG, MAX_ANGLE_DEG)) continue;

        // Compute average edge strength along contour
        const edgeStr = averageEdgeStrength(contour, magnitude, w);

        if (area > bestArea) {
          bestQuad = poly;
          bestArea = area;
          bestEdgeStrength = edgeStr;
        }
      }

      if (!bestQuad) return null;

      // 10. Order corners clockwise from top-left
      const ordered = orderCornersCW(bestQuad);

      // 11. Normalize to 0-1
      const corners: [number, number][] = ordered.map(
        ([x, y]) => [x / w, y / h] as [number, number]
      );

      // Confidence: blend of area ratio, angle regularity, and edge strength
      const areaRatio = Math.min(bestArea / frameArea, 1);
      const angleScore = angleRegularity(ordered);
      const edgeScore = Math.min(bestEdgeStrength / (maxMag || 1), 1);
      const confidence = Math.min(1, areaRatio * 0.4 + angleScore * 0.35 + edgeScore * 0.25);

      return { corners, confidence };
    },

    destroy() {
      // No-op for canvas — no resources to release.
    },
  };
}

// ---------------------------------------------------------------------------
// Image processing helpers
// ---------------------------------------------------------------------------

function downscaleToGray(frame: ImageData, w: number, h: number): Float32Array {
  const srcW = frame.width;
  const srcH = frame.height;
  const src = frame.data;
  const gray = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const srcY = Math.min(Math.round((y / h) * srcH), srcH - 1);
    for (let x = 0; x < w; x++) {
      const srcX = Math.min(Math.round((x / w) * srcW), srcW - 1);
      const i = (srcY * srcW + srcX) * 4;
      gray[y * w + x] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    }
  }
  return gray;
}

function gaussianBlur3x3(gray: Float32Array, w: number, h: number): Float32Array {
  // Kernel: [1,2,1; 2,4,2; 1,2,1] / 16
  const out = new Float32Array(w * h);
  const k = BLUR_KERNEL_SIZE >> 1; // 1

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y < k || y >= h - k || x < k || x >= w - k) {
        out[y * w + x] = gray[y * w + x];
        continue;
      }
      const idx = y * w + x;
      out[idx] =
        (gray[idx - w - 1] + 2 * gray[idx - w] + gray[idx - w + 1] +
         2 * gray[idx - 1] + 4 * gray[idx] + 2 * gray[idx + 1] +
         gray[idx + w - 1] + 2 * gray[idx + w] + gray[idx + w + 1]) / 16;
    }
  }
  return out;
}

function sobelEdges(gray: Float32Array, w: number, h: number): { magnitude: Float32Array; maxMag: number } {
  const magnitude = new Float32Array(w * h);
  let maxMag = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      // Sobel X: [-1,0,1; -2,0,2; -1,0,1]
      const gx =
        -gray[idx - w - 1] + gray[idx - w + 1] +
        -2 * gray[idx - 1] + 2 * gray[idx + 1] +
        -gray[idx + w - 1] + gray[idx + w + 1];
      // Sobel Y: [-1,-2,-1; 0,0,0; 1,2,1]
      const gy =
        -gray[idx - w - 1] - 2 * gray[idx - w] - gray[idx - w + 1] +
        gray[idx + w - 1] + 2 * gray[idx + w] + gray[idx + w + 1];

      const mag = Math.sqrt(gx * gx + gy * gy);
      magnitude[idx] = mag;
      if (mag > maxMag) maxMag = mag;
    }
  }

  return { magnitude, maxMag };
}

/** 3x3 dilation — if any neighbour is an edge, the pixel becomes an edge. */
function dilateEdges(edges: Uint8Array, w: number, h: number): void {
  const copy = new Uint8Array(edges);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (copy[y * w + x]) continue; // already edge
      const idx = y * w + x;
      if (
        copy[idx - w - 1] || copy[idx - w] || copy[idx - w + 1] ||
        copy[idx - 1]     ||                   copy[idx + 1] ||
        copy[idx + w - 1] || copy[idx + w] || copy[idx + w + 1]
      ) {
        edges[idx] = 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Contour detection — simple boundary tracing on binary edge map
// ---------------------------------------------------------------------------

function findContours(edges: Uint8Array, w: number, h: number): Point[][] {
  const visited = new Uint8Array(w * h);
  const contours: Point[][] = [];

  // Direction offsets: right, down-right, down, down-left, left, up-left, up, up-right
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (!edges[idx] || visited[idx]) continue;
      // Only start from boundary pixels (edge pixel adjacent to non-edge)
      if (edges[(y - 1) * w + x] && edges[(y + 1) * w + x] &&
          edges[y * w + (x - 1)] && edges[y * w + (x + 1)]) continue;

      const contour: Point[] = [];
      let cx = x, cy = y;
      let dir = 0;
      const maxSteps = w * h;

      for (let step = 0; step < maxSteps; step++) {
        if (visited[cy * w + cx] && contour.length > 2) break;
        visited[cy * w + cx] = 1;
        // Subsample — only record every 3rd point for speed
        if (step % 3 === 0) contour.push([cx, cy]);

        // Follow edge: search clockwise from (dir + 5) % 8
        let found = false;
        const startDir = (dir + 5) % 8;
        for (let d = 0; d < 8; d++) {
          const nd = (startDir + d) % 8;
          const nx = cx + dx[nd];
          const ny = cy + dy[nd];
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          if (edges[ny * w + nx]) {
            cx = nx;
            cy = ny;
            dir = nd;
            found = true;
            break;
          }
        }
        if (!found) break;
      }

      if (contour.length >= 20) {
        contours.push(contour);
      }
    }
  }

  return contours;
}

// ---------------------------------------------------------------------------
// Polygon helpers
// ---------------------------------------------------------------------------

function contourPerimeter(pts: Point[]): number {
  let perim = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j][0] - pts[i][0];
    const dy = pts[j][1] - pts[i][1];
    perim += Math.sqrt(dx * dx + dy * dy);
  }
  return perim;
}

/** Douglas-Peucker polygon simplification. */
function douglasPeucker(pts: Point[], epsilon: number): Point[] {
  if (pts.length <= 2) return pts;

  // Find the point with max distance from line(start, end)
  let maxDist = 0;
  let maxIdx = 0;
  const start = pts[0];
  const end = pts[pts.length - 1];

  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDist(pts[i], start, end);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(pts.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

function perpendicularDist(pt: Point, lineA: Point, lineB: Point): number {
  const dx = lineB[0] - lineA[0];
  const dy = lineB[1] - lineA[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = pt[0] - lineA[0];
    const ey = pt[1] - lineA[1];
    return Math.sqrt(ex * ex + ey * ey);
  }
  return Math.abs(dy * pt[0] - dx * pt[1] + lineB[0] * lineA[1] - lineB[1] * lineA[0]) / Math.sqrt(lenSq);
}

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
  // Approximate as max side / min side
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
  // How close are all 4 angles to 90 degrees? 1.0 = perfect rectangle
  let totalDeviation = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[(i + 3) % 4];
    const b = pts[i];
    const c = pts[(i + 1) % 4];
    const deg = angleDeg(a, b, c);
    totalDeviation += Math.abs(deg - 90);
  }
  // Max reasonable deviation: 4 * 30 = 120 degrees
  return Math.max(0, 1 - totalDeviation / 120);
}

function averageEdgeStrength(contour: Point[], magnitude: Float32Array, w: number): number {
  let sum = 0;
  let count = 0;
  for (const [x, y] of contour) {
    const idx = y * w + x;
    if (idx >= 0 && idx < magnitude.length) {
      sum += magnitude[idx];
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Order 4 points clockwise starting from top-left. */
function orderCornersCW(pts: Point[]): Point[] {
  // Centroid
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
  const cy = pts.reduce((s, p) => s + p[1], 0) / 4;

  // Sort by angle from centroid
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

  // Rotate so TL is first
  const result: Point[] = [];
  for (let i = 0; i < 4; i++) {
    result.push(sorted[(tlIdx + i) % 4]);
  }
  return result;
}
