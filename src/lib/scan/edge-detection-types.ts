/**
 * Shared types for edge detection modules.
 * Both canvas and OpenCV detectors implement the same interface
 * so they're swappable at runtime.
 */

/** Four corners of a detected quadrilateral, normalized 0-1, clockwise from top-left. */
export interface DetectionResult {
  corners: [number, number][]; // Exactly 4 entries: TL, TR, BR, BL
  confidence: number;          // 0-1, higher = more certain
}

/** Common interface for all edge detector backends. */
export interface EdgeDetector {
  init(): Promise<void>;
  detect(frame: ImageData): DetectionResult | null;
  destroy(): void;
}
