import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Cache resized images for 1 week
const CACHE_DURATION = 60 * 60 * 24 * 7;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');
    const width = parseInt(searchParams.get('w') || '400', 10);
    const quality = parseInt(searchParams.get('q') || '75', 10);

    // Crop parameters (0-1000 scale, matching the split detection)
    const cropXStart = searchParams.get('cx') ? parseInt(searchParams.get('cx')!, 10) : null;
    const cropXEnd = searchParams.get('cw') ? parseInt(searchParams.get('cw')!, 10) : null;

    if (!url) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    let buffer: Buffer;

    // Handle absolute local paths (e.g., /Users/... from imports)
    if (url.startsWith('/Users/') || url.startsWith('/home/')) {
      if (!fs.existsSync(url)) {
        return NextResponse.json({ error: 'Local file not found' }, { status: 404 });
      }
      buffer = fs.readFileSync(url);
    }
    // Handle relative local paths (starting with /)
    else if (url.startsWith('/')) {
      const localPath = path.join(process.cwd(), 'public', url);
      if (!fs.existsSync(localPath)) {
        return NextResponse.json({ error: 'Local file not found' }, { status: 404 });
      }
      buffer = fs.readFileSync(localPath);
    } else {
      // Only allow S3 URLs for security
      const allowedHosts = ['amazonaws.com'];
      const urlObj = new URL(url);
      if (!allowedHosts.some(host => urlObj.hostname.endsWith(host))) {
        return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
      }

      // Fetch the original image
      const response = await fetch(url);
      if (!response.ok) {
        return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 });
      }

      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    let sharpInstance = sharp(buffer);

    // Apply crop if specified (coordinates are 0-1000 scale)
    if (cropXStart !== null && cropXEnd !== null) {
      const metadata = await sharpInstance.metadata();
      const imgWidth = metadata.width || 1000;
      const imgHeight = metadata.height || 1000;

      const left = Math.round((cropXStart / 1000) * imgWidth);
      const cropWidth = Math.round(((cropXEnd - cropXStart) / 1000) * imgWidth);

      sharpInstance = sharpInstance.extract({
        left,
        top: 0,
        width: Math.min(cropWidth, imgWidth - left),
        height: imgHeight,
      });
    }

    // Resize with sharp
    const resized = await sharpInstance
      .resize(width, null, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality, progressive: true })
      .toBuffer();

    // Return with cache headers
    return new Response(new Uint8Array(resized), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': `public, max-age=${CACHE_DURATION}, immutable`,
        'CDN-Cache-Control': `public, max-age=${CACHE_DURATION}`,
      },
    });
  } catch (error) {
    console.error('Image resize error:', error);
    return NextResponse.json(
      { error: 'Image processing failed' },
      { status: 500 }
    );
  }
}
