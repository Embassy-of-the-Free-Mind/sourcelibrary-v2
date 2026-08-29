import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { refuseImageUrl } from '@/lib/image-proxy-hosts';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { checkImageAccess, imageBudgetExceededBody } from '@/lib/image-gate';
import { finalizeMarkedJpeg } from '@/lib/image-marks';
import { logApiUsage } from '@/lib/api-usage';
import type { ApiIdentity } from '@/lib/api-auth';

// Cache resized images for 1 week
const CACHE_DURATION = 60 * 60 * 24 * 7;

// Timeout for fetching images from external sources (150 seconds)
// Internet Archive and other IIIF servers can be slow
const FETCH_TIMEOUT_IN_MS = 150000;

// Input caps — guard the serverless function against OOM/timeout from a
// genuinely huge source (multi-hundred-MB scan, full-res IIIF tile). The
// resolver's fallback chain can route uncovered/oversized images here.
//   - MAX_INPUT_BYTES: hard cap on bytes we'll buffer before decode. 150 MB
//     comfortably covers legitimate page scans (JPEG/JP2 masters are typically
//     <30 MB) while rejecting pathological inputs. Enforced both during the
//     fetch (axios maxContentLength) and on local files / the final buffer.
//   - MAX_INPUT_PIXELS: cap passed to sharp's `limitInputPixels`. 100 megapixels
//     (~10000×10000) covers high-res book pages; above that sharp throws rather
//     than allocating a multi-GB decode buffer, and we return 413.
const MAX_INPUT_BYTES = 150 * 1024 * 1024;
const MAX_INPUT_PIXELS = 100_000_000;

/** Thrown when a redirect hop points somewhere we refuse to follow. */
class BlockedRedirectError extends Error {
  constructor(public readonly reason: string) {
    super(`Redirect refused: ${reason}`);
    this.name = 'BlockedRedirectError';
  }
}

/**
 * Fetch an image, re-validating the host on EVERY redirect hop.
 *
 * axios follows redirects itself (up to 5) and performs no further checks, so
 * a permitted origin — or, before the dot-boundary fix, an attacker-registered
 * lookalike — could 302 us onto a private address. We follow the chain by hand
 * with `maxRedirects: 0` and run each Location through the same policy as the
 * caller-supplied URL.
 */
async function fetchAllowlistedImage(startUrl: string, maxHops = 5) {
  let current = startUrl;

  for (let hop = 0; hop <= maxHops; hop++) {
    const response = await axios.get(current, {
      responseType: 'arraybuffer',
      timeout: FETCH_TIMEOUT_IN_MS,
      // Axios timeout includes both connection and response timeouts.
      // Cap the response body so an oversized source aborts the download
      // instead of buffering hundreds of MB into the function (throws
      // ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED, handled by the caller as 413).
      maxContentLength: MAX_INPUT_BYTES,
      maxBodyLength: MAX_INPUT_BYTES,
      maxRedirects: 0,
      // 3xx must reach us as a value, not an axios throw, so we can inspect
      // Location. Anything else keeps the usual error behaviour.
      validateStatus: status => (status >= 200 && status < 300) || (status >= 300 && status < 400),
    });

    if (response.status < 300) return response;

    const location = response.headers?.location;
    if (!location) throw new BlockedRedirectError('redirect without a Location header');

    // Relative Locations are legal and common; resolve against the current URL.
    const next = new URL(location, current).toString();
    const refusal = refuseImageUrl(next);
    if (refusal) throw new BlockedRedirectError(refusal);
    current = next;
  }

  throw new BlockedRedirectError(`more than ${maxHops} redirects`);
}

// Ceiling on how much fetch-and-resize work one caller can make us do. Even
// with a tight allowlist the proxy is still a free image resizer over some very
// large public buckets, so it needs a cap.
//
// Deliberately generous: a gallery grid is dozens of images, and the limiter is
// per-lambda-instance and in-memory, so the effective ceiling across instances
// is higher than the number below. Most requests are served from the CDN and
// never reach this function at all — only cache misses count. Tune via
// IMAGE_PROXY_PER_MIN if it ever bites a real reader.
const IMAGE_PROXY_PER_MIN = Number(process.env.IMAGE_PROXY_PER_MIN || 600);

export async function GET(request: NextRequest) {
  try {
    const rl = checkRateLimit(
      { name: 'image-proxy', limit: IMAGE_PROXY_PER_MIN, windowSeconds: 60 },
      getClientIp(request),
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many image requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      );
    }

    // Identity + budget gate (#4356): browsers, signed internal fetchers, and
    // trusted bots pass untouched; keyed callers are tier-budgeted and logged;
    // anonymous non-browser bulk pulls are budgeted per IP. Blocked responses
    // are no-store — a CDN-cached 429 would outlive the budget window.
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
      const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
      if (access.status === 429) headers['Retry-After'] = '3600';
      return NextResponse.json(imageBudgetExceededBody(access), {
        status: access.status,
        headers,
      });
    }

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
      // Only allow trusted image hosts. The allowlist and the matching rule
      // live in src/lib/image-proxy-hosts.ts — matching is on a dot boundary,
      // NOT a bare suffix. See that file for why (`evilarchive.org` used to
      // pass), and tests/unit/image-proxy-hosts.test.ts for the cases.
      const refusal = refuseImageUrl(url);
      if (refusal) {
        return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
      }
      const urlObj = new URL(url);

      // Fetch the original image with axios for better timeout control
      // Retry logic for transient network errors
      const maxRetries = 2;
      let fetchSucceeded = false;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetchAllowlistedImage(url);

          buffer = Buffer.from(response.data);
          fetchSucceeded = true;
          break; // Success, exit retry loop
        } catch (fetchError: any) {
          // A refused redirect is a policy decision, not a transient fault —
          // return immediately rather than retrying it twice more.
          if (fetchError instanceof BlockedRedirectError) {
            return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
          }
          // Only retry on network errors (ETIMEDOUT, ECONNREFUSED, etc), not on 4xx/5xx responses
          const isRetryable =
            fetchError.code === 'ETIMEDOUT' ||
            fetchError.code === 'ECONNREFUSED' ||
            fetchError.code === 'ENOTFOUND' ||
            fetchError.code === 'ECONNRESET';

          if (!isRetryable || attempt === maxRetries) {
            // No more retries or non-retryable error
            if (fetchError.code === 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED') {
              return NextResponse.json(
                { error: 'Source image exceeds size limit', limitBytes: MAX_INPUT_BYTES },
                { status: 413 }
              );
            }
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

    // Byte cap — catches local files (readFileSync is uncapped) and any source
    // that slipped past the fetch-time limit (e.g. no Content-Length header).
    if (buffer.length > MAX_INPUT_BYTES) {
      return NextResponse.json(
        { error: 'Source image exceeds size limit', limitBytes: MAX_INPUT_BYTES },
        { status: 413 }
      );
    }

    // Pixel cap — sharp throws "Input image exceeds pixel limit" above this,
    // preventing a multi-GB decode allocation. Caught below and returned as 413.
    let sharpInstance = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS });

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

    // Resize, then finalize: provenance marks (skipped for clean-capable
    // keys), EXIF, JPEG — shared with /api/crop-image (src/lib/image-marks.ts).
    const resizedBuffer = await sharpInstance
      .resize(width, null, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer();

    const resized = await finalizeMarkedJpeg(resizedBuffer, {
      quality,
      progressive: true,
      clean: access.clean === true,
    });

    // Clean responses must NEVER enter the shared CDN cache: the entitlement
    // lives in the Authorization header, which is not part of the cache key,
    // so a cached clean body would be served to unentitled callers.
    const cacheHeaders: Record<string, string> = access.clean
      ? { 'Cache-Control': 'private, no-store' }
      : {
          'Cache-Control': `public, max-age=${CACHE_DURATION}, immutable`,
          'CDN-Cache-Control': `public, max-age=${CACHE_DURATION}`,
        };

    return new Response(new Uint8Array(resized), {
      headers: { 'Content-Type': 'image/jpeg', ...cacheHeaders },
    });
  } catch (error) {
    // sharp throws when the decoded image would exceed limitInputPixels —
    // respond gracefully rather than letting it surface as a generic failure.
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      return NextResponse.json(
        { error: 'Source image exceeds pixel limit', limitPixels: MAX_INPUT_PIXELS },
        { status: 413 }
      );
    }
    console.error('Image resize error:', error);
    return NextResponse.json(
      { error: 'Image processing failed' },
      { status: 500 }
    );
  }
}
