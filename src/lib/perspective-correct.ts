/**
 * Client-side perspective correction using Canvas API.
 *
 * Takes a photo of a book page (possibly at an angle with desk visible)
 * and warps it to a clean rectangle using the 4 detected corner coordinates.
 *
 * Algorithm: divides source quadrilateral into a grid of small triangles,
 * maps each to the destination rectangle using affine transforms per triangle.
 */

type Point = [number, number];

/**
 * Apply perspective correction to an image given 4 corner points.
 *
 * @param image - Source image element or bitmap
 * @param corners - 4 corners of the page in normalized 0-1 coords,
 *                  ordered: [topLeft, topRight, bottomRight, bottomLeft]
 * @param outputWidth - Desired output width in pixels
 * @param outputHeight - Desired output height in pixels
 * @returns JPEG Blob of the corrected image
 */
export async function perspectiveCorrect(
  image: HTMLImageElement | ImageBitmap,
  corners: Point[],
  outputWidth: number,
  outputHeight: number
): Promise<Blob> {
  if (corners.length !== 4) {
    throw new Error('Expected exactly 4 corner points');
  }

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d')!;

  const imgW = image.width;
  const imgH = image.height;

  // Convert normalized corners to pixel coordinates
  const src: Point[] = corners.map(([x, y]) => [x * imgW, y * imgH]);

  // Grid resolution for triangle mesh
  const gridSize = 20;

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      // Normalized grid coordinates
      const u0 = gx / gridSize;
      const v0 = gy / gridSize;
      const u1 = (gx + 1) / gridSize;
      const v1 = (gy + 1) / gridSize;

      // Source quad points via bilinear interpolation
      const s00 = bilinear(src, u0, v0);
      const s10 = bilinear(src, u1, v0);
      const s01 = bilinear(src, u0, v1);
      const s11 = bilinear(src, u1, v1);

      // Destination rectangle points
      const d00: Point = [u0 * outputWidth, v0 * outputHeight];
      const d10: Point = [u1 * outputWidth, v0 * outputHeight];
      const d01: Point = [u0 * outputWidth, v1 * outputHeight];
      const d11: Point = [u1 * outputWidth, v1 * outputHeight];

      // Draw two triangles per grid cell
      drawTriangle(ctx, image, s00, s10, s01, d00, d10, d01);
      drawTriangle(ctx, image, s10, s11, s01, d10, d11, d01);
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
      'image/jpeg',
      0.92
    );
  });
}

/**
 * Bilinear interpolation within a quadrilateral.
 * src corners ordered: [topLeft, topRight, bottomRight, bottomLeft]
 */
function bilinear(src: Point[], u: number, v: number): Point {
  const [tl, tr, br, bl] = src;
  const x =
    tl[0] * (1 - u) * (1 - v) +
    tr[0] * u * (1 - v) +
    bl[0] * (1 - u) * v +
    br[0] * u * v;
  const y =
    tl[1] * (1 - u) * (1 - v) +
    tr[1] * u * (1 - v) +
    bl[1] * (1 - u) * v +
    br[1] * u * v;
  return [x, y];
}

/**
 * Draw a textured triangle from source to destination using affine transform.
 */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | ImageBitmap,
  s0: Point, s1: Point, s2: Point,
  d0: Point, d1: Point, d2: Point
) {
  ctx.save();

  // Clip to destination triangle
  ctx.beginPath();
  ctx.moveTo(d0[0], d0[1]);
  ctx.lineTo(d1[0], d1[1]);
  ctx.lineTo(d2[0], d2[1]);
  ctx.closePath();
  ctx.clip();

  // Compute affine transform: source → destination
  // We need M such that M * [sx, sy, 1]^T = [dx, dy]^T
  // Solve for 6 unknowns (a, b, c, d, e, f) from 3 point pairs
  const denom =
    (s0[0] * (s1[1] - s2[1]) - s1[0] * (s0[1] - s2[1]) + s2[0] * (s0[1] - s1[1]));

  if (Math.abs(denom) < 1e-10) {
    ctx.restore();
    return;
  }

  // Affine matrix coefficients mapping source to destination
  const a =
    (d0[0] * (s1[1] - s2[1]) - d1[0] * (s0[1] - s2[1]) + d2[0] * (s0[1] - s1[1])) / denom;
  const b =
    -(d0[0] * (s1[0] - s2[0]) - d1[0] * (s0[0] - s2[0]) + d2[0] * (s0[0] - s1[0])) / denom;
  const c =
    (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) -
      d1[0] * (s0[0] * s2[1] - s2[0] * s0[1]) +
      d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) / denom;
  const d_ =
    (d0[1] * (s1[1] - s2[1]) - d1[1] * (s0[1] - s2[1]) + d2[1] * (s0[1] - s1[1])) / denom;
  const e =
    -(d0[1] * (s1[0] - s2[0]) - d1[1] * (s0[0] - s2[0]) + d2[1] * (s0[0] - s1[0])) / denom;
  const f =
    (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) -
      d1[1] * (s0[0] * s2[1] - s2[0] * s0[1]) +
      d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) / denom;

  ctx.setTransform(a, d_, b, e, c, f);
  ctx.drawImage(image, 0, 0);

  ctx.restore();
}

/**
 * Check if corners represent a significant perspective distortion
 * that warrants correction (vs. a nearly-rectangular capture).
 */
export function needsCorrection(corners: Point[]): boolean {
  if (corners.length !== 4) return false;

  // Check if any corner deviates significantly from the unit rectangle
  const ideal: Point[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  let maxDist = 0;
  for (let i = 0; i < 4; i++) {
    const dx = corners[i][0] - ideal[i][0];
    const dy = corners[i][1] - ideal[i][1];
    maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
  }

  // If max deviation > 3%, apply correction
  return maxDist > 0.03;
}
