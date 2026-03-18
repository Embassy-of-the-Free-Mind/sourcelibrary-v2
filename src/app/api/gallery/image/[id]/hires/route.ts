import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import sharp from 'sharp';
import { storagePut } from '@/lib/storage';
import { images } from '@/lib/api-client/images';

/**
 * GET /api/gallery/image/[id]/hires
 *
 * Generate (and cache) a high-resolution crop for download.
 *
 * Fetches the source page at up to 4000px from IIIF (vs 1000px for standard display),
 * crops using the stored bbox, caches the result in R2, and redirects to the cached URL.
 *
 * On subsequent requests the cached R2 URL is returned immediately.
 *
 * ID format: {pageId}-{detectionIndex} (e.g., 69099f06cf28baa1b4caeb51-0)
 */

const HIRES_WIDTH = 4000; // Max width for high-res IIIF fetch
const HIRES_MAX_DIM = 5000; // Safety cap before cropping (memory protection)
const HIRES_JPEG_QUALITY = 92;

function upgradeIiifUrl(url: string, width: number): string {
  if (!url.includes('full/')) return url;
  return url.replace(/\/full\/(full|max|\d+,)\//, `/full/${width},/`);
}

function hiresStorageKey(bookId: string, pageId: string, detectionIndex: number): string {
  return `gallery/${bookId}/${pageId}-${detectionIndex}-hires.jpg`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Parse compound ID
    const match = id.match(/^(.+)[:\-](\d+)$/);
    if (!match) {
      return NextResponse.json({ error: 'Invalid image ID format' }, { status: 400 });
    }

    const [, pageId, indexStr] = match;
    const detectionIndex = parseInt(indexStr, 10);

    const db = await getDb();
    const page = await db.collection('pages').findOne(
      { id: pageId },
      { projection: {
        book_id: 1, page_number: 1,
        cropped_photo: 1, archived_photo: 1, photo_original: 1, photo: 1,
        detected_images: 1,
      } }
    );

    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    const detection = page.detected_images?.[detectionIndex];
    if (!detection) {
      return NextResponse.json({ error: 'Detection not found' }, { status: 404 });
    }

    // Check if already cached in R2
    const storageKey = hiresStorageKey(page.book_id, pageId, detectionIndex);
    const existingUrl = detection.hires_url;

    if (existingUrl) {
      // Verify it's still accessible (quick HEAD check)
      try {
        const head = await fetch(existingUrl, { method: 'HEAD' });
        if (head.ok) {
          return NextResponse.json({ url: existingUrl, cached: true });
        }
      } catch {
        // Cache miss or stale — regenerate
      }
    }

    // Source image URL — same priority as extraction worker
    const sourceUrl = page.cropped_photo || page.archived_photo || page.photo_original || page.photo;
    if (!sourceUrl) {
      return NextResponse.json({ error: 'No source image available' }, { status: 404 });
    }

    // Upgrade IIIF URL to high resolution
    const hiresSourceUrl = upgradeIiifUrl(sourceUrl, HIRES_WIDTH);

    // Fetch high-res source
    const rawBuffer = await images.fetchBuffer(hiresSourceUrl, { timeout: 60000 });
    const rawMeta = await sharp(rawBuffer).metadata();
    const origWidth = rawMeta.width || 1;
    const origHeight = rawMeta.height || 1;

    // Safety downscale if extremely large
    let imageBuffer = rawBuffer;
    let imgWidth = origWidth;
    let imgHeight = origHeight;

    if (origWidth > HIRES_MAX_DIM || origHeight > HIRES_MAX_DIM) {
      const resized = sharp(rawBuffer)
        .resize(HIRES_MAX_DIM, HIRES_MAX_DIM, { fit: 'inside', withoutEnlargement: true });
      imageBuffer = await resized.toBuffer();
      const resizedMeta = await sharp(imageBuffer).metadata();
      imgWidth = resizedMeta.width || 1;
      imgHeight = resizedMeta.height || 1;
    }

    // Normalize bbox (same logic as gallery-image-gen.ts)
    const bbox = detection.bbox;
    if (!bbox) {
      // No bbox means the whole page is the image — just return the high-res source
      const fullPageBuffer = await sharp(imageBuffer)
        .jpeg({ quality: HIRES_JPEG_QUALITY, progressive: true })
        .toBuffer();

      const uploaded = await storagePut(storageKey, fullPageBuffer, {
        contentType: 'image/jpeg',
        allowOverwrite: true,
      });

      const hiresUrl = uploaded.url;
      await saveHiresUrl(db, pageId, detectionIndex, hiresUrl);
      return NextResponse.json({ url: hiresUrl, cached: false });
    }

    const isPixels = bbox.x > 1 || bbox.y > 1 || bbox.width > 1 || bbox.height > 1;
    let normX: number, normY: number, normW: number, normH: number;
    if (isPixels) {
      const scale = Math.max(bbox.x + bbox.width, bbox.y + bbox.height, 1000);
      normX = Math.min(bbox.x / scale, 0.95);
      normY = Math.min(bbox.y / scale, 0.95);
      normW = Math.min(bbox.width / scale, 1);
      normH = Math.min(bbox.height / scale, 1);
    } else {
      normX = bbox.x;
      normY = bbox.y;
      normW = bbox.width;
      normH = bbox.height;
    }

    // Crop with padding
    const padding = 0.02;
    const padX = padding * imgWidth;
    const padY = padding * imgHeight;

    const left = Math.max(0, Math.floor(normX * imgWidth - padX));
    const top = Math.max(0, Math.floor(normY * imgHeight - padY));
    const width = Math.min(imgWidth - left, Math.ceil(normW * imgWidth + padX * 2));
    const height = Math.min(imgHeight - top, Math.ceil(normH * imgHeight + padY * 2));

    let pipeline = sharp(imageBuffer).extract({ left, top, width, height });

    if (detection.rotation) {
      pipeline = pipeline.rotate(detection.rotation);
    }

    const hiresBuffer = await pipeline
      .jpeg({ quality: HIRES_JPEG_QUALITY, progressive: true })
      .toBuffer();

    // Upload to R2
    const uploaded = await storagePut(storageKey, hiresBuffer, {
      contentType: 'image/jpeg',
      allowOverwrite: true,
    });

    const hiresUrl = uploaded.url;

    // Cache the URL on the detection for fast future lookups
    await saveHiresUrl(db, pageId, detectionIndex, hiresUrl);

    return NextResponse.json({ url: hiresUrl, cached: false });
  } catch (error) {
    console.error('High-res generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate high-res image' },
      { status: 500 }
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function saveHiresUrl(db: any, pageId: string, detectionIndex: number, url: string) {
  try {
    await db.collection('pages').updateOne(
      { id: pageId },
      { $set: { [`detected_images.${detectionIndex}.hires_url`]: url } }
    );
    // Also sync to gallery_images
    const galleryImageId = `${pageId}-${detectionIndex}`;
    await db.collection('gallery_images').updateOne(
      { id: galleryImageId },
      { $set: { hires_url: url, updated_at: new Date() } }
    );
  } catch {
    // Non-fatal — the URL is returned to the client regardless
  }
}
