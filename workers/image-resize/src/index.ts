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
  IMAGES: any; // Cloudflare Images binding
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

  // Use the Images binding to transform directly from R2 stream.
  // No subrequest, no origin fetch, no 9401 loop.
  try {
    const object = await env.BUCKET.get(r2Key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    // Determine output format
    const formatMap: Record<string, string> = {
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      avif: 'image/avif',
    };
    let outputFormat = formatMap[params.format] || 'image/jpeg';
    if (params.format === 'auto') {
      // Auto-negotiate: prefer avif > webp > jpeg based on Accept header
      const accept = request.headers.get('Accept') || '';
      if (accept.includes('image/avif')) outputFormat = 'image/avif';
      else if (accept.includes('image/webp')) outputFormat = 'image/webp';
      else outputFormat = 'image/jpeg';
    }

    // Build transform options
    const transformOpts: Record<string, unknown> = {};
    if (params.width) transformOpts.width = params.width;
    if (params.height) transformOpts.height = params.height;
    transformOpts.fit = params.fit;

    // Transform via Images binding: input(stream) → transform → output
    const transformed = await env.IMAGES
      .input(object.body)
      .transform(transformOpts)
      .output({ format: outputFormat, quality: params.quality });

    const resizedResponse = transformed.response();

    // Build response with cache headers
    const responseHeaders = new Headers(resizedResponse.headers);
    responseHeaders.set('Cache-Control', `public, max-age=${cacheTtl}, immutable`);
    responseHeaders.set('CDN-Cache-Control', `public, max-age=${cacheTtl}`);
    responseHeaders.set('X-Resize', buildResizeHeader(params));
    responseHeaders.set('Content-Type', outputFormat);
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
    // Images binding not available — serve the original
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Images transform failed, serving original:', errMsg);

    const object = await env.BUCKET.get(r2Key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    const headers = buildHeaders(object, cacheTtl);
    headers.set('X-Resize', 'unavailable');
    headers.set('X-Resize-Error', errMsg.slice(0, 200));
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
