/**
 * Manifest Store — fetch, parse, and persist IIIF manifests.
 *
 * Today a manifest is fetched once at import time, parsed for page image
 * URLs, then discarded — we keep only the manifest URL on the book and the
 * extracted page URLs on the pages. This module persists the raw manifest
 * (plus the pre-extracted page URLs) into the `iiif_manifests` collection so
 * we have provenance, can re-archive offline, and can detect IIIF/JP2 drift.
 *
 * Collection `iiif_manifests` is keyed unique on `manifest_url`. See issue #2416.
 */

/**
 * Ensure indexes on the iiif_manifests collection. Call once at startup.
 */
export async function ensureManifestIndexes(db) {
  const col = db.collection('iiif_manifests');
  await col.createIndex({ manifest_url: 1 }, { unique: true });
  await col.createIndex({ book_id: 1 });
  await col.createIndex({ source: 1 });
  await col.createIndex({ fetched_at: 1 });
  await col.createIndex({ error: 1 });
}

/** Detect IIIF Presentation API version from a manifest object. */
export function detectVersion(manifest) {
  const ctx = manifest?.['@context'];
  const ctxStr = Array.isArray(ctx) ? ctx.join(' ') : (ctx || '');
  if (ctxStr.includes('/presentation/3')) return 3;
  if (ctxStr.includes('/presentation/2')) return 2;
  // Fallback on shape: v3 uses `items`, v2 uses `sequences`.
  if (Array.isArray(manifest?.items)) return 3;
  if (Array.isArray(manifest?.sequences)) return 2;
  return manifest?.['@id'] ? 2 : 3;
}

/** Get the canvas array from a v2 or v3 manifest. */
export function getCanvases(manifest) {
  if (manifest?.sequences?.[0]?.canvases?.length) return manifest.sequences[0].canvases;
  if (manifest?.items?.length) return manifest.items;
  return [];
}

/**
 * Extract { photo, thumbnail } image URLs from a single canvas (v2 or v3).
 * Mirrors src/lib/import-utils.ts extractCanvasImage so backfilled URLs match
 * what the importer would have stored.
 */
export function extractCanvasImage(canvas) {
  // v2: canvas.images[0].resource
  const imageResource = canvas?.images?.[0]?.resource;
  if (imageResource) {
    const service = imageResource.service;
    const serviceId = Array.isArray(service)
      ? (service[0]?.['@id'] || service[0]?.id)
      : (service?.['@id'] || service?.id);
    if (serviceId) {
      return {
        photo: `${serviceId}/full/full/0/default.jpg`,
        thumbnail: `${serviceId}/full/200,/0/default.jpg`,
      };
    }
    const direct = imageResource['@id'] || imageResource.id || '';
    return { photo: direct, thumbnail: direct };
  }

  // v3: canvas.items[0].items[0].body
  const body = canvas?.items?.[0]?.items?.[0]?.body;
  if (body) {
    const service = Array.isArray(body.service) ? body.service[0] : body.service;
    const serviceId = service?.id || service?.['@id'];
    if (serviceId) {
      return {
        photo: `${serviceId}/full/full/0/default.jpg`,
        thumbnail: `${serviceId}/full/200,/0/default.jpg`,
      };
    }
    const direct = body.id || '';
    return { photo: direct, thumbnail: direct };
  }

  return { photo: '', thumbnail: '' };
}

/** Extract the display label from a v2/v3 manifest. */
function extractLabel(label) {
  if (!label) return null;
  if (typeof label === 'string') return label.trim();
  if (Array.isArray(label)) {
    const en = label.find(l => l?.['@language'] === 'en');
    return (en?.['@value'] || label[0]?.['@value'] || label[0] || '').toString().trim() || null;
  }
  if (typeof label === 'object') {
    const vals = label.en || label.none || Object.values(label)[0];
    if (Array.isArray(vals)) return (vals[0] || '').toString().trim() || null;
  }
  return null;
}

/**
 * Parse a manifest object into the stored shape (page URLs + metadata).
 * Does not touch the DB — pure.
 */
export function parseManifest(manifest_url, manifest) {
  const iiif_version = detectVersion(manifest);
  const canvases = getCanvases(manifest);
  const image_urls = canvases
    .map(extractCanvasImage)
    .filter(u => u.photo);
  return {
    manifest_url,
    iiif_version,
    label: extractLabel(manifest?.label),
    page_count: canvases.length,
    image_urls,
  };
}

const USER_AGENT =
  'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)';

/**
 * Fetch a IIIF manifest and upsert it into `iiif_manifests`.
 *
 * Idempotent: re-running updates the same doc (keyed on manifest_url).
 * On fetch/parse failure, records an error doc (raw omitted) and returns
 * { ok: false } rather than throwing — callers decide whether to continue.
 *
 * Transient failures (HTTP 5xx, timeouts, network errors) are retried in-process
 * up to `retries` times with backoff; a re-run of the script also retries any
 * doc left with `error != null`, so two passes mop up almost everything.
 *
 * @param {import('mongodb').Db} db
 * @param {{ manifest_url: string, book_id?: string|null, source?: string|null,
 *           timeoutMs?: number, storeRaw?: boolean, retries?: number }} opts
 */
export async function fetchAndStoreManifest(db, opts) {
  const {
    manifest_url,
    book_id = null,
    source = null,
    timeoutMs = 45000,
    storeRaw = true,
    retries = 1,
  } = opts;

  const col = db.collection('iiif_manifests');
  const now = new Date();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let res, manifest, lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        res = await fetch(manifest_url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/ld+json' },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }

      if (res.ok) { manifest = await res.json(); lastErr = null; break; }

      lastErr = `HTTP ${res.status}`;
      if (res.status < 500 || attempt === retries) {
        // 4xx is permanent; 5xx on last attempt records the error.
        await col.updateOne(
          { manifest_url },
          { $set: { manifest_url, book_id, source, http_status: res.status, error: lastErr, fetched_at: new Date() }, $unset: { raw: '' } },
          { upsert: true }
        );
        return { ok: false, status: res.status, error: lastErr };
      }
      // else: 5xx with retries left → loop
    } catch (err) {
      lastErr = err.name === 'AbortError' ? 'timeout' : (err.message || 'fetch failed');
      if (attempt === retries) {
        await col.updateOne(
          { manifest_url },
          { $set: { manifest_url, book_id, source, error: lastErr, fetched_at: new Date() } },
          { upsert: true }
        );
        return { ok: false, error: lastErr };
      }
      // else retry
    }
  }

  let parsed;
  try {
    parsed = parseManifest(manifest_url, manifest);
  } catch (err) {
    await col.updateOne(
      { manifest_url },
      { $set: { manifest_url, book_id, source, error: `parse: ${err.message}`, fetched_at: now } },
      { upsert: true }
    );
    return { ok: false, error: `parse: ${err.message}` };
  }

  const etag = res.headers.get('etag');
  const lastModified = res.headers.get('last-modified');

  const setDoc = {
    manifest_url,
    book_id,
    source,
    iiif_version: parsed.iiif_version,
    label: parsed.label,
    page_count: parsed.page_count,
    image_urls: parsed.image_urls,
    http_status: res.status,
    etag: etag || null,
    last_modified: lastModified || null,
    fetched_at: now,
    error: null,
  };
  if (storeRaw) setDoc.raw = manifest;

  await col.updateOne(
    { manifest_url },
    { $set: setDoc, ...(storeRaw ? {} : { $unset: { raw: '' } }) },
    { upsert: true }
  );

  return { ok: true, page_count: parsed.page_count, iiif_version: parsed.iiif_version };
}
