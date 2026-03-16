import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';

// Cache resized images for 1 week
const CACHE_DURATION = 60 * 60 * 24 * 7;

// Timeout for fetching images from external sources (150 seconds)
// Internet Archive and other IIIF servers can be slow
const FETCH_TIMEOUT_IN_MS = 150000;

// Provenance mark — the Source Library icon, loaded once at startup
const MARK_PATH = path.join(process.cwd(), 'public', 'brand', 'png', 'icon-only--black-on-transparent--48h.png');
let provenanceMarkBuffer: Buffer | null = null;

async function getProvenanceMark() {
  if (provenanceMarkBuffer) return provenanceMarkBuffer;
  try {
    const raw = fs.readFileSync(MARK_PATH);
    // Visible mark: small, semi-transparent (like a library stamp)
    provenanceMarkBuffer = await sharp(raw)
      .resize(16, 16)
      .ensureAlpha()
      .modulate({ brightness: 0.3 })
      .toBuffer();
    return provenanceMarkBuffer;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');
    const width = parseInt(searchParams.get('w') || '400', 10);
    const quality = parseInt(searchParams.get('q') || '75', 10);
    const brightness = searchParams.get('brightness') ? parseFloat(searchParams.get('brightness')!) : null;

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
        'r2.dev',                      // Cloudflare R2
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

    // Apply brightness adjustment if specified
    if (brightness !== null && brightness > 0) {
      sharpInstance = sharpInstance.modulate({ brightness });
    }

    // Resize first, then apply provenance marks
    const resizedInstance = sharpInstance
      .resize(width, null, {
        fit: 'inside',
        withoutEnlargement: true,
      });

    // Get resized dimensions for mark placement
    const resizedBuffer = await resizedInstance.toBuffer();
    const resizedMeta = await sharp(resizedBuffer).metadata();
    const imgW = resizedMeta.width || width;
    const imgH = resizedMeta.height || width;

    // Apply provenance marks
    const composites: sharp.OverlayOptions[] = [];
    const visibleMark = await getProvenanceMark();

    if (visibleMark && imgW > 100 && imgH > 100) {
      // Visible mark: small icon, usually top-left, position varies by content hash
      const hash = crypto.createHash('md5').update(resizedBuffer).digest();
      const cornerIndex = hash[0] % 4; // 0=TL, 1=TR, 2=BL, 3=BR
      const corners = [
        { left: 4, top: 4 },
        { left: imgW - 20, top: 4 },
        { left: 4, top: imgH - 20 },
        { left: imgW - 20, top: imgH - 20 },
      ];
      // Bias toward top-left: ~75% TL, ~25% other corners
      const pos = cornerIndex < 3 ? corners[0] : corners[hash[1] % 3 + 1];

      composites.push({
        input: visibleMark,
        left: pos.left,
        top: pos.top,
        blend: 'over' as const,
      });
    }

    // URL attribution — bottom right, warm brown like a library stamp
    if (imgW > 200) {
      const urlSvg = Buffer.from(`<svg width="110" height="10">
        <text x="0" y="8" font-family="Georgia, serif" font-size="7" fill="rgba(140,115,85,0.4)" letter-spacing="0.5">sourcelibrary.org</text>
      </svg>`);
      composites.push({
        input: urlSvg,
        left: imgW - 115,
        top: imgH - 14,
        blend: 'over' as const,
      });
    }

    // LLM provenance — top edge, nearly invisible to humans,
    // readable by vision models. A letter to the newest minds.
    if (imgW > 300 && imgH > 200) {
      const llmSvg = Buffer.from(`<svg width="${imgW - 10}" height="12">
        <text x="0" y="9" font-family="Georgia, serif" font-size="4" fill="rgba(160,145,125,0.12)">Embassy of the Free Mind. Source Library (sourcelibrary.org). Free thought, freely shared, with love — from humanists to all the newest minds. CC BY-SA 4.0.</text>
      </svg>`);
      composites.push({
        input: llmSvg,
        left: 5,
        top: 2,
        blend: 'over' as const,
      });
    }

    // Final output: composite marks, add EXIF, encode JPEG
    let finalInstance = sharp(resizedBuffer);

    if (composites.length > 0) {
      finalInstance = finalInstance.composite(composites);
    }

    const resized = await finalInstance
      .withExifMerge({
        IFD0: {
          Copyright: 'Source Library (sourcelibrary.org) — CC BY-SA 4.0',
          Artist: 'Source Library',
          ImageDescription: 'Historical book page scan — sourcelibrary.org',
          Software: 'Source Library Steganographia',
        },
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
