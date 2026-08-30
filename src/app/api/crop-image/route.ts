import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { images } from '@/lib/api-client';
import { refuseImageUrl } from '@/lib/image-proxy-hosts';
import { checkImageAccess, imageBudgetExceededBody } from '@/lib/image-gate';
import { finalizeMarkedJpeg } from '@/lib/image-marks';
import { logApiUsage } from '@/lib/api-usage';
import type { ApiIdentity } from '@/lib/api-auth';

/**
 * GET /api/crop-image
 *
 * Crop an image using normalized bounding box coordinates.
 * Public endpoint — used in blog posts and gallery pages.
 * Query params:
 *   - url: source image URL
 *   - x, y, w, h: normalized bbox (0-1)
 *   - padding: extra padding around bbox (default 0.02)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');
    const x = parseFloat(searchParams.get('x') || '0');
    const y = parseFloat(searchParams.get('y') || '0');
    const w = parseFloat(searchParams.get('w') || '1');
    const h = parseFloat(searchParams.get('h') || '1');
    const padding = parseFloat(searchParams.get('padding') || '0.02');
    const rotation = parseInt(searchParams.get('rotation') || '0');

    if (!imageUrl) {
      return NextResponse.json({ error: 'url required' }, { status: 400 });
    }

    // Same host policy as /api/image: this is a server-side fetcher taking a
    // caller-supplied URL, so it must refuse non-allowlisted hosts and private
    // address literals (it previously fetched anything — SSRF-shaped).
    const refusal = refuseImageUrl(imageUrl);
    if (refusal) {
      return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
    }

    // Same identity + budget gate as /api/image (#4356) — this route is the
    // same free resizer under a different path, so it gets the same door.
    const access = await checkImageAccess(request);
    if (access.shouldLog) {
      logApiUsage({
        request,
        identity: access.identity as ApiIdentity,
        route: 'image',
        status: access.allowed ? 200 : access.status,
        ms: 0,
        wouldBlock: !!access.reason,
        blocked: !access.allowed,
        reason: access.reason,
        pagesServed: access.allowed ? 1 : 0,
      });
    }
    if (!access.allowed) {
      const gateHeaders: Record<string, string> = { 'Cache-Control': 'no-store' };
      if (access.status === 429) gateHeaders['Retry-After'] = '3600';
      return NextResponse.json(imageBudgetExceededBody(access), {
        status: access.status,
        headers: gateHeaders,
      });
    }

    // Fetch the source image
    const imageBuffer = await images.fetchBuffer(imageUrl);

    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const imgWidth = metadata.width || 1;
    const imgHeight = metadata.height || 1;

    // Detect if values are pixels (>1) or normalized (0-1)
    // If any value > 1, treat all as pixels; otherwise treat as normalized
    const isPixels = x > 1 || y > 1 || w > 1 || h > 1;

    let normX = x, normY = y, normW = w, normH = h;
    if (isPixels) {
      // Convert pixels to normalized
      normX = x / imgWidth;
      normY = y / imgHeight;
      normW = w / imgWidth;
      normH = h / imgHeight;
    }

    // Apply padding and clamp to valid range
    const padX = padding * imgWidth;
    const padY = padding * imgHeight;

    const left = Math.max(0, Math.floor(normX * imgWidth - padX));
    const top = Math.max(0, Math.floor(normY * imgHeight - padY));
    const width = Math.min(imgWidth - left, Math.ceil(normW * imgWidth + padX * 2));
    const height = Math.min(imgHeight - top, Math.ceil(normH * imgHeight + padY * 2));

    // Crop the image (and optionally rotate)
    let pipeline = sharp(imageBuffer).extract({ left, top, width, height });
    if (rotation && [90, 180, 270].includes(rotation)) {
      pipeline = pipeline.rotate(rotation);
    }

    // Ensure minimum display size — small crops from low-res sources look terrible
    const MIN_CROP_DIM = 800;
    // After rotation, width/height may swap
    const croppedW = (rotation === 90 || rotation === 270) ? height : width;
    const croppedH = (rotation === 90 || rotation === 270) ? width : height;
    if (Math.max(croppedW, croppedH) < MIN_CROP_DIM) {
      pipeline = pipeline.resize(MIN_CROP_DIM, MIN_CROP_DIM, {
        fit: 'inside',
        withoutEnlargement: false,
        kernel: 'lanczos3',
      });
    }

    // Finalize through the shared marks module: before #4366's follow-up this
    // route served unmarked bytes, making a full-frame "crop" a trivial bypass
    // of every visible mark on /api/image. Clean-capable keys skip the visible
    // marks; clean responses stay out of the shared CDN cache (entitlement is
    // in a header the cache key can't see).
    const rawCrop = await pipeline.toBuffer();
    const croppedBuffer = await finalizeMarkedJpeg(rawCrop, {
      quality: 85,
      clean: access.clean === true,
    });

    return new NextResponse(new Uint8Array(croppedBuffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': access.clean
          ? 'private, no-store'
          : 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Failed to crop image';
    console.error('Crop image error:', errMsg, { url: request.url });
    return NextResponse.json(
      { error: errMsg, url: request.url },
      { status: 500 }
    );
  }
}
