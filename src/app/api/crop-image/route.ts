import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

/**
 * GET /api/crop-image
 *
 * Crop an image using normalized bounding box coordinates.
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

    if (!imageUrl) {
      return NextResponse.json({ error: 'url required' }, { status: 400 });
    }

    // Fetch the source image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.status}` },
        { status: 502 }
      );
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());

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

    // Crop the image
    const croppedBuffer = await sharp(imageBuffer)
      .extract({ left, top, width, height })
      .jpeg({ quality: 85 })
      .toBuffer();

    return new NextResponse(new Uint8Array(croppedBuffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
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
