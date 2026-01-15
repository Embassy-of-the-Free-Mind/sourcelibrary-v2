import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

// Cache resized images for 1 week
const CACHE_DURATION = 60 * 60 * 24 * 7;

// Timeout for fetching images from external sources (150 seconds)
// Internet Archive and other IIIF servers can be slow
const FETCH_TIMEOUT_IN_MS = 150000;

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

    let buffer: Buffer | undefined;

    // Handle relative local paths (starting with /) - must be in public directory
    if (url.startsWith('/')) {
      // Prevent path traversal attacks
      const normalizedUrl = path.normalize(url).replace(/^(\.\.(\/|\\|$))+/, '');
      if (normalizedUrl.includes('..')) {
        return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
      }

      const localPath = path.join(process.cwd(), 'public', normalizedUrl);

      // Ensure the resolved path is still within public directory
      const publicDir = path.join(process.cwd(), 'public');
      if (!localPath.startsWith(publicDir)) {
        return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
      }

      if (!fs.existsSync(localPath)) {
        return NextResponse.json({ error: 'Local file not found' }, { status: 404 });
      }
      buffer = fs.readFileSync(localPath);
    } else {
      // Only allow trusted image hosts for security
      const allowedHosts = [
        'amazonaws.com',
        'archive.org',
        'vercel-storage.com',
        'blob.vercel-storage.com',
        // IIIF sources
        'gallica.bnf.fr',
        'api.digitale-sammlungen.de',  // MDZ/BSB
        'digi.vatlib.it',              // Vatican
        'digital.bodleian.ox.ac.uk',   // Bodleian
        'iiif.bodleian.ox.ac.uk',
      ];
      const urlObj = new URL(url);
      if (!allowedHosts.some(host => urlObj.hostname.endsWith(host))) {
        return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
      }

      // Fetch the original image with axios for better timeout control
      // Retry logic for transient network errors
      const maxRetries = 2;
      let fetchSucceeded = false;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: FETCH_TIMEOUT_IN_MS,
            // Axios timeout includes both connection and response timeouts
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          });

          buffer = Buffer.from(response.data);
          fetchSucceeded = true;
          break; // Success, exit retry loop
        } catch (fetchError: any) {
          // Only retry on network errors (ETIMEDOUT, ECONNREFUSED, etc), not on 4xx/5xx responses
          const isRetryable =
            fetchError.code === 'ETIMEDOUT' ||
            fetchError.code === 'ECONNREFUSED' ||
            fetchError.code === 'ENOTFOUND' ||
            fetchError.code === 'ECONNRESET';

          if (!isRetryable || attempt === maxRetries) {
            // No more retries or non-retryable error
            if (fetchError.code === 'ECONNABORTED' || fetchError.message?.includes('timeout')) {
              return NextResponse.json({ error: 'Image fetch timeout' }, { status: 504 });
            }
            if (fetchError.code === 'ETIMEDOUT') {
              return NextResponse.json({
                error: 'Connection timeout - source server not responding',
                details: `Failed to connect to ${urlObj.hostname}`
              }, { status: 504 });
            }
            if (fetchError.response?.status) {
              return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 });
            }
            throw fetchError;
          }

          // Wait before retry (exponential backoff)
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          }
        }
      }

      // This should never happen due to throw/return in catch, but TypeScript needs it
      if (!fetchSucceeded) {
        return NextResponse.json({ error: 'Failed to fetch image after retries' }, { status: 502 });
      }
    }

    // Ensure buffer was assigned (should always be true at this point)
    if (!buffer) {
      return NextResponse.json({ error: 'Failed to load image buffer' }, { status: 500 });
    }

    let sharpInstance = sharp(buffer);

    // Auto-rotate based on EXIF orientation for sources that have correct EXIF data
    // Skip for S3 images which have incorrect/missing EXIF orientation
    const shouldAutoRotate = !url.includes('amazonaws.com');
    if (shouldAutoRotate) {
      sharpInstance = sharpInstance.rotate();
    }

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
