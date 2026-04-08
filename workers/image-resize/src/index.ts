/**
 * Cloudflare Worker — on-demand image resizing for images.sourcelibrary.org
 *
 * Serves images from R2 with optional resize/format params. Resized variants
 * are cached at the edge for 30 days.
 *
 * Usage:
 *   /pages/abc123/0001-full.jpg           → original from R2 (passthrough)
 *   /pages/abc123/0001-full.jpg?w=150     → resized to 150px wide
 *   /pages/abc123/0001-full.jpg?preset=thumb → 150px, q=60
 *   /pages/abc123/0001-full.jpg?w=400&q=75&f=webp → 400px, quality 75, webp
 *
 * Params:
 *   w|width   — target width (max 4000)
 *   h|height  — target height (max 4000)
 *   q|quality — JPEG/WebP quality (1-100, default 80)
 *   f|format  — output format: auto|webp|avif|jpeg (default: auto)
 *   fit       — scale-down (default) | contain | cover | crop
 *   preset    — thumb|card|display (overrides individual params)
 *
 * How cf.image loop prevention works:
 *   When we call fetch() with cf.image options, Cloudflare's Image Resizing
 *   service fetches the origin URL to get the original image. That request
 *   comes back to this worker, but WITHOUT resize params — so it hits the
 *   "serve directly from R2" path. The Via header includes "image-resizing"
 *   on those subrequests; we check for it as an extra safety measure.
 */

export interface Env {
  BUCKET: R2Bucket;
  MAX_WIDTH: string;
  MAX_HEIGHT: string;
  DEFAULT_QUALITY: string;
  CACHE_TTL_RESIZED: string;
  CACHE_TTL_ORIGINAL: string;
}

// --- Presets ---

interface ImageParams {
  width?: number;
  height?: number;
  quality: number;
  format: 'auto' | 'webp' | 'avif' | 'jpeg';
  fit: 'scale-down' | 'contain' | 'cover' | 'crop';
}

const PRESETS: Record<string, Partial<ImageParams>> = {
  thumb:   { width: 150,  quality: 60 },
  card:    { width: 400,  quality: 75 },
  display: { width: 1200, quality: 85 },
};

// --- Main handler ---

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Only handle GET/HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Health check
    if (url.pathname === '/_health') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
    }

    // Strip leading slash for R2 key
    const r2Key = decodeURIComponent(url.pathname.slice(1));

    if (!r2Key) {
      return new Response('Not found', { status: 404 });
    }

    // Detect cf.image subrequest — these come from Image Resizing fetching
    // the original. Always serve the raw R2 object, never try to resize again.
    const via = request.headers.get('Via') || '';
    if (via.includes('image-resizing')) {
      return serveOriginal(r2Key, request, env, ctx);
    }

    // Parse resize parameters
    const params = parseParams(url.searchParams, env);
    const needsResize = params.width !== undefined || params.height !== undefined;

    if (!needsResize) {
      return serveOriginal(r2Key, request, env, ctx);
    }

    return serveResized(r2Key, params, request, env, ctx);
  },
};

// --- Parameter parsing ---

function parseParams(search: URLSearchParams, env: Env): ImageParams {
  const maxW = parseInt(env.MAX_WIDTH) || 4000;
  const maxH = parseInt(env.MAX_HEIGHT) || 4000;
  const defaultQ = parseInt(env.DEFAULT_QUALITY) || 80;

  let params: ImageParams = {
    quality: defaultQ,
    format: 'auto',
    fit: 'scale-down',
  };

  // Apply preset first (individual params can override)
  const preset = search.get('preset');
  if (preset && PRESETS[preset]) {
    params = { ...params, ...PRESETS[preset] };
  }

  // Width
  const w = search.get('w') || search.get('width');
  if (w) {
    const parsed = parseInt(w, 10);
    if (parsed > 0) {
      params.width = Math.min(parsed, maxW);
    }
  }

  // Height
  const h = search.get('h') || search.get('height');
  if (h) {
    const parsed = parseInt(h, 10);
    if (parsed > 0) {
      params.height = Math.min(parsed, maxH);
    }
  }

  // Quality
  const q = search.get('q') || search.get('quality');
  if (q) {
    const parsed = parseInt(q, 10);
    if (parsed >= 1 && parsed <= 100) {
      params.quality = parsed;
    }
  }

  // Format
  const f = search.get('f') || search.get('format');
  if (f && ['auto', 'webp', 'avif', 'jpeg'].includes(f)) {
    params.format = f as ImageParams['format'];
  }

  // Fit
  const fit = search.get('fit');
  if (fit && ['scale-down', 'contain', 'cover', 'crop'].includes(fit)) {
    params.fit = fit as ImageParams['fit'];
  }

  return params;
}

// --- Serve original (no resize) ---

async function serveOriginal(
  r2Key: string,
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const cacheTtl = parseInt(env.CACHE_TTL_ORIGINAL) || 86400;

  // Use R2 conditional headers for efficiency
  const ifNoneMatch = request.headers.get('If-None-Match');
  const ifModifiedSince = request.headers.get('If-Modified-Since');

  const r2Options: R2GetOptions = {};
  if (ifNoneMatch) {
    r2Options.onlyIf = { etagDoesNotMatch: ifNoneMatch.replace(/^W\//, '') };
  } else if (ifModifiedSince) {
    r2Options.onlyIf = { uploadedAfter: new Date(ifModifiedSince) };
  }

  const object = await env.BUCKET.get(r2Key, r2Options);

  if (!object) {
    // Conditional request matched (object exists but hasn't changed)
    const headCheck = await env.BUCKET.head(r2Key);
    if (headCheck) {
      return new Response(null, { status: 304 });
    }
    return new Response('Not found', { status: 404 });
  }

  const headers = buildHeaders(object, cacheTtl);
  return new Response(object.body, { headers });
}

// --- Serve resized variant ---

async function serveResized(
  r2Key: string,
  params: ImageParams,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const cacheTtl = parseInt(env.CACHE_TTL_RESIZED) || 2592000;

  // Check Cache API for this exact resize variant
  const cacheKey = buildCacheKey(request.url, params);
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  // Verify the original exists in R2 before attempting resize
  const head = await env.BUCKET.head(r2Key);
  if (!head) {
    return new Response('Not found', { status: 404 });
  }

  // Use cf.image to resize. This fetches the origin URL (this worker, no params)
  // to get the original, then applies transforms at the edge.
  try {
    const originUrl = `https://images.sourcelibrary.org/${r2Key}`;

    const imageOptions: Record<string, unknown> = {
      fit: params.fit,
      quality: params.quality,
      format: params.format,
    };
    if (params.width) imageOptions.width = params.width;
    if (params.height) imageOptions.height = params.height;

    const resizedResponse = await fetch(originUrl, {
      cf: {
        image: imageOptions,
        cacheTtl: cacheTtl,
        cacheEverything: true,
      },
    });

    if (!resizedResponse.ok) {
      // If image resizing returns 9xxx errors, it means the feature isn't enabled
      if (resizedResponse.status >= 9000) {
        throw new Error(`Image Resizing not enabled: ${resizedResponse.status}`);
      }
      throw new Error(`cf.image returned ${resizedResponse.status}`);
    }

    // Build the response with cache headers
    const responseHeaders = new Headers(resizedResponse.headers);
    responseHeaders.set('Cache-Control', `public, max-age=${cacheTtl}, immutable`);
    responseHeaders.set('CDN-Cache-Control', `public, max-age=${cacheTtl}`);
    responseHeaders.set('X-Resize', buildResizeHeader(params));
    responseHeaders.set('Vary', 'Accept');
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    const response = new Response(resizedResponse.body, {
      status: 200,
      headers: responseHeaders,
    });

    // Cache the resized variant
    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
  } catch (err) {
    // cf.image not available — serve the original with a header indicating
    // resize was requested but unavailable. The client still gets an image.
    console.error('cf.image resize failed, serving original:', err);

    const object = await env.BUCKET.get(r2Key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    const headers = buildHeaders(object, cacheTtl);
    headers.set('X-Resize', 'unavailable');
    return new Response(object.body, { headers });
  }
}

// --- Helpers ---

function buildHeaders(object: R2Object | R2ObjectBody, cacheTtl: number): Headers {
  const headers = new Headers();

  const contentType = ('httpMetadata' in object && object.httpMetadata?.contentType)
    ? object.httpMetadata.contentType
    : 'image/jpeg';
  headers.set('Content-Type', contentType);

  headers.set('Cache-Control', `public, max-age=${cacheTtl}`);
  headers.set('CDN-Cache-Control', `public, max-age=${cacheTtl}`);

  if ('etag' in object) {
    headers.set('ETag', object.etag);
  }

  headers.set('Access-Control-Allow-Origin', '*');

  return headers;
}

function buildCacheKey(requestUrl: string, params: ImageParams): Request {
  // Deterministic cache key — normalize param ordering
  const key = new URL(requestUrl);
  key.search = '';
  key.searchParams.set('_w', String(params.width || 0));
  key.searchParams.set('_h', String(params.height || 0));
  key.searchParams.set('_q', String(params.quality));
  key.searchParams.set('_f', params.format);
  key.searchParams.set('_fit', params.fit);
  return new Request(key.toString());
}

function buildResizeHeader(params: ImageParams): string {
  return `w=${params.width || 'auto'},h=${params.height || 'auto'},q=${params.quality},f=${params.format}`;
}
