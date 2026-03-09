/**
 * OpenCV.js-based page edge detection.
 *
 * Lazy-loads OpenCV.js WASM (~8MB) from CDN, then uses Canny + findContours
 * for robust quadrilateral detection. Same interface as canvas-edge-detection.ts.
 *
 * IMPORTANT: Every cv.Mat must be .delete()'d to prevent WASM memory leaks.
 */

import type { EdgeDetector, DetectionResult } from './edge-detection-types';

declare const cv: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const OPENCV_CDN_URL = 'https://docs.opencv.org/4.x/opencv.js';
const MIN_AREA_RATIO = 0.20;
const CANNY_LOW = 50;
const CANNY_HIGH = 150;
const APPROX_EPSILON_RATIO = 0.02;

type Point = [number, number];

export function createOpenCVEdgeDetector(): EdgeDetector {
  let ready = false;

  return {
    async init() {
      if (ready) return;
      if (typeof window === 'undefined') {
        throw new Error('OpenCV edge detection requires a browser environment');
      }

      // If cv is already globally available, just use it
      if (typeof cv !== 'undefined' && cv.Mat) {
        ready = true;
        return;
      }

      // Check if script tag already exists (another instance loading)
      const existing = document.querySelector(`script[src="${OPENCV_CDN_URL}"]`);
      if (existing) {
        await waitForCV();
        ready = true;
        return;
      }

      // Load OpenCV.js from CDN
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = OPENCV_CDN_URL;
        script.async = true;

        script.onload = () => {
          // OpenCV.js uses either onRuntimeInitialized callback or resolves cv as a Promise
          waitForCV().then(() => resolve()).catch(reject);
        };

        script.onerror = () => reject(new Error('Failed to load OpenCV.js from CDN'));
        document.head.appendChild(script);
      });

      ready = true;
    },

    detect(frame: ImageData): DetectionResult | null {
      if (!ready) return null;

      // All cv.Mat objects that need cleanup
      const mats: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

      try {
        // Create Mat from ImageData
        const src = cv.matFromImageData(frame);
        mats.push(src);

        // Convert to grayscale
        const gray = new cv.Mat();
        mats.push(gray);
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // Gaussian blur
        const blurred = new cv.Mat();
        mats.push(blurred);
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

        // Canny edge detection
        const edges = new cv.Mat();
        mats.push(edges);
        cv.Canny(blurred, edges, CANNY_LOW, CANNY_HIGH);

        // Find contours
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        mats.push(hierarchy);
        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const frameArea = frame.width * frame.height;
        let bestCorners: Point[] | null = null;
        let bestArea = 0;

        for (let i = 0; i < contours.size(); i++) {
          const contour = contours.get(i);

          // Approximate polygon
          const perim = cv.arcLength(contour, true);
          const approx = new cv.Mat();
          mats.push(approx);
          cv.approxPolyDP(contour, approx, APPROX_EPSILON_RATIO * perim, true);

          // Must be a quadrilateral
          if (approx.rows !== 4) continue;

          // Must be convex
          if (!cv.isContourConvex(approx)) continue;

          // Area check
          const area = cv.contourArea(approx);
          if (area < MIN_AREA_RATIO * frameArea) continue;

          // Extract corner points
          const corners: Point[] = [];
          for (let j = 0; j < 4; j++) {
            corners.push([approx.intAt(j, 0), approx.intAt(j, 1)]);
          }

          // Angle check: all interior angles 60-120 degrees
          if (!anglesInRange(corners, 60, 120)) continue;

          // Aspect ratio check
          const ar = quadAspectRatio(corners);
          if (ar < 0.5 || ar > 2.0) continue;

          if (area > bestArea) {
            bestArea = area;
            bestCorners = corners;
          }
        }

        // Clean up contour vector (special handling — not a plain Mat)
        contours.delete();

        if (!bestCorners) return null;

        // Order corners clockwise from top-left
        const ordered = orderCornersCW(bestCorners);

        // Normalize to 0-1
        const normalized: [number, number][] = ordered.map(
          ([x, y]) => [x / frame.width, y / frame.height] as [number, number]
        );

        // Confidence from area ratio and contour quality
        const areaRatio = Math.min(bestArea / frameArea, 1);
        const angleScore = angleRegularity(ordered);
        const confidence = Math.min(1, areaRatio * 0.5 + angleScore * 0.5);

        return { corners: normalized, confidence };
      } catch {
        return null;
      } finally {
        // Delete all Mats to prevent WASM memory leaks
        for (const mat of mats) {
          try { mat.delete(); } catch { /* already deleted */ }
        }
      }
    },

    destroy() {
      ready = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForCV(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (typeof cv !== 'undefined' && cv.Mat) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('OpenCV.js initialization timed out'));
        return;
      }

      // Check if cv has onRuntimeInitialized
      if (typeof cv !== 'undefined' && !cv.Mat) {
        cv.onRuntimeInitialized = () => resolve();
        return;
      }

      setTimeout(check, 100);
    };
    check();
  });
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
