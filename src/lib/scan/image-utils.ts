/**
 * Client-side image utilities for bulk upload scanning.
 *
 * EXIF parsing uses raw DataView (no external library).
 * Blur/brightness scoring uses Canvas API with Laplacian variance.
 */

export interface QualityMetrics {
  blurScore: number;      // 0-1, higher = sharper
  brightnessScore: number; // 0-1, higher = better exposed
}

export interface ProcessedFile {
  id: string;
  file: File;
  thumbnailUrl: string;
  timestamp: Date | null;
  quality: QualityMetrics;
}

/**
 * Extract EXIF DateTimeOriginal from a JPEG file.
 * Reads raw binary — no external dependency.
 */
export async function getExifTimestamp(file: File): Promise<Date | null> {
  try {
    // Only JPEGs have EXIF in this format
    if (!file.type.startsWith('image/jpeg') && !file.name.toLowerCase().endsWith('.jpg')) {
      return null;
    }

    const buffer = await file.slice(0, 65536).arrayBuffer(); // First 64KB is enough
    const view = new DataView(buffer);

    // Check JPEG SOI marker
    if (view.getUint16(0) !== 0xFFD8) return null;

    // Find APP1 (EXIF) marker
    let offset = 2;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset);
      if (marker === 0xFFE1) {
        // APP1 found
        const exifOffset = offset + 4;
        // Check "Exif\0\0"
        if (
          view.getUint8(exifOffset) === 0x45 &&
          view.getUint8(exifOffset + 1) === 0x78 &&
          view.getUint8(exifOffset + 2) === 0x69 &&
          view.getUint8(exifOffset + 3) === 0x66
        ) {
          return parseExifDateTime(view, exifOffset + 6);
        }
        return null;
      }

      if ((marker & 0xFF00) !== 0xFF00) break; // Not a valid marker
      const segmentLength = view.getUint16(offset + 2);
      offset += 2 + segmentLength;
    }
    return null;
  } catch {
    return null;
  }
}

function parseExifDateTime(view: DataView, tiffStart: number): Date | null {
  try {
    // Byte order: II (little-endian) or MM (big-endian)
    const byteOrder = view.getUint16(tiffStart);
    const littleEndian = byteOrder === 0x4949;

    // Get IFD0 offset
    const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
    const ifd0Pos = tiffStart + ifd0Offset;
    const entryCount = view.getUint16(ifd0Pos, littleEndian);

    // Search IFD0 for ExifIFD pointer (tag 0x8769)
    for (let i = 0; i < entryCount; i++) {
      const entryPos = ifd0Pos + 2 + i * 12;
      if (entryPos + 12 > view.byteLength) break;
      const tag = view.getUint16(entryPos, littleEndian);
      if (tag === 0x8769) {
        const exifIfdOffset = view.getUint32(entryPos + 8, littleEndian);
        return readDateTimeFromIFD(view, tiffStart, tiffStart + exifIfdOffset, littleEndian);
      }
    }

    // Fallback: check IFD0 for DateTime (tag 0x0132)
    return readDateTimeFromIFD(view, tiffStart, ifd0Pos, littleEndian);
  } catch {
    return null;
  }
}

function readDateTimeFromIFD(
  view: DataView, tiffStart: number, ifdPos: number, littleEndian: boolean
): Date | null {
  try {
    const entryCount = view.getUint16(ifdPos, littleEndian);
    // DateTimeOriginal = 0x9003, DateTime = 0x0132
    const targetTags = [0x9003, 0x0132];

    for (let i = 0; i < entryCount; i++) {
      const entryPos = ifdPos + 2 + i * 12;
      if (entryPos + 12 > view.byteLength) break;
      const tag = view.getUint16(entryPos, littleEndian);
      if (!targetTags.includes(tag)) continue;

      const valueOffset = view.getUint32(entryPos + 8, littleEndian);
      const strPos = tiffStart + valueOffset;
      if (strPos + 19 > view.byteLength) continue;

      // Read "YYYY:MM:DD HH:MM:SS" (19 bytes)
      let dateStr = '';
      for (let j = 0; j < 19; j++) {
        dateStr += String.fromCharCode(view.getUint8(strPos + j));
      }

      // Parse "2024:01:15 14:30:00" → Date
      const match = dateStr.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
      if (match) {
        return new Date(
          parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]),
          parseInt(match[4]), parseInt(match[5]), parseInt(match[6])
        );
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate a thumbnail as an object URL using Canvas API.
 */
export async function generateThumbnail(file: File, maxSize = 300): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(maxSize / bitmap.width, maxSize / bitmap.height, 1);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return URL.createObjectURL(blob);
}

/**
 * Assess image quality from a thumbnail.
 * - Blur: Laplacian variance on grayscale (higher = sharper)
 * - Brightness: mean luminance (flagged if too dark or too bright)
 */
export async function assessQuality(file: File): Promise<QualityMetrics> {
  const bitmap = await createImageBitmap(file);
  // Use a small version for speed
  const size = 100;
  const scale = Math.min(size / bitmap.width, size / bitmap.height, 1);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, w, h);
  const pixels = imageData.data;

  // Convert to grayscale
  const gray = new Float32Array(w * h);
  let brightnessSum = 0;
  for (let i = 0; i < w * h; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    brightnessSum += gray[i];
  }

  const meanBrightness = brightnessSum / (w * h);

  // Laplacian variance for blur detection
  // Kernel: [0, 1, 0; 1, -4, 1; 0, 1, 0]
  let lapSum = 0;
  let lapSumSq = 0;
  let lapCount = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap =
        gray[idx - w] + gray[idx + w] + gray[idx - 1] + gray[idx + 1] -
        4 * gray[idx];
      lapSum += lap;
      lapSumSq += lap * lap;
      lapCount++;
    }
  }

  const lapMean = lapSum / lapCount;
  const lapVariance = lapSumSq / lapCount - lapMean * lapMean;

  // Normalize scores to 0-1
  // Blur: variance > 500 is sharp, < 50 is very blurry
  const blurScore = Math.min(1, Math.max(0, lapVariance / 500));

  // Brightness: optimal around 100-180, flag extremes
  let brightnessScore: number;
  if (meanBrightness < 40) {
    brightnessScore = meanBrightness / 40; // Too dark
  } else if (meanBrightness > 220) {
    brightnessScore = (255 - meanBrightness) / 35; // Too bright
  } else {
    brightnessScore = 1;
  }
  brightnessScore = Math.min(1, Math.max(0, brightnessScore));

  return { blurScore, brightnessScore };
}

/**
 * Sort files by EXIF timestamp, fallback to file.lastModified.
 */
export function sortByTimestamp(files: ProcessedFile[]): ProcessedFile[] {
  return [...files].sort((a, b) => {
    const aTime = a.timestamp?.getTime() ?? a.file.lastModified;
    const bTime = b.timestamp?.getTime() ?? b.file.lastModified;
    return aTime - bTime;
  });
}

/**
 * Process a batch of raw files into ProcessedFile objects.
 * Runs thumbnail generation, EXIF extraction, and quality assessment in parallel.
 */
export async function processFiles(files: File[]): Promise<ProcessedFile[]> {
  const results = await Promise.all(
    files.map(async (file) => {
      const [thumbnailUrl, timestamp, quality] = await Promise.all([
        generateThumbnail(file),
        getExifTimestamp(file),
        assessQuality(file),
      ]);

      return {
        id: crypto.randomUUID(),
        file,
        thumbnailUrl,
        timestamp,
        quality,
      };
    })
  );

  return sortByTimestamp(results);
}
