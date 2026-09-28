/**
 * Allmaps lookup + matching logic for the nightly georeference sync (#5076, step 2 of #5070).
 *
 * PRIOR ART: src/lib/allmaps.ts — the target resolver the Georeference button uses. It is
 * TypeScript behind the `@/` alias, and no `scripts/workers/*.mjs` imports TS from src/ today,
 * so `allmapsTargetUrl` + the image-service regex are TWINNED here (like gallery-doc.mjs /
 * gallery-doc.ts) and `tests/unit/allmaps-sync.test.ts` pins both twins to the same output.
 * Keep the two in lock-step: the sync must query exactly the resource the editor opened, or a
 * volunteer's annotation is never found.
 *
 * How Allmaps is addressed (verified 2026-09-25 against annotations.allmaps.org 3.0.1):
 *   - every resource id is the first 16 hex chars of sha1(url): the manifest
 *     `https://iiif.archive.org/iiif/map2002023007/manifest.json` is `/manifests/ef8a028a5c8ea588`,
 *     and the image SERVICE id (no `/info.json`) hashes to `/images/{id}`.
 *   - `GET /images/{id}` returns every georeference annotation whose target is that image,
 *     whether it was made from the image or from a manifest containing it — so an image lookup
 *     is exact and needs no manifest.
 *   - `GET /manifests/{id}` returns the annotations for all images in the manifest.
 *   - an unknown id answers **404** `{"status":404,"error":"Not Found"}`. That is Allmaps'
 *     "no annotations", not a failure; the worker counts it separately from 5xx/network.
 *   - `GET /maps?imageServiceDomain=` silently caps at 200 items with no paging, so it cannot
 *     be used for discovery (measured: limit=1000 → 200).
 *   - each annotation: `id` (https://annotations.allmaps.org/maps/<hash>), `target.source.id`
 *     (image service), `target.source.partOf[]` (canvas → manifest), `body.features[]` (GCPs),
 *     `created`, `modified`.
 *
 * Internet Archive canvases embed the leaf: `https://iiif.archive.org/iiif/{ia}$N/canvas` (v2
 * and v3 alike), and the image service embeds `_NNNN.jp2`. Our `pages.page_number` is leaf+1
 * (IA leaf offset is always 0 — memory `lesson_ia_leaf_offset_is_always_zero…`).
 */

import { createHash } from 'node:crypto';

export const ALLMAPS_API = 'https://annotations.allmaps.org';
export const ALLMAPS_VIEWER = 'https://viewer.allmaps.org/';
export const ALLMAPS_EDITOR = 'https://editor.allmaps.org/images';

/** Allmaps' id for a IIIF URL: first 16 hex chars of its sha1. */
export function allmapsId(url) {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

export function allmapsViewerUrl(annotationId) {
  return `${ALLMAPS_VIEWER}?url=${encodeURIComponent(annotationId)}`;
}

// ── Twin of src/lib/iiif-image-service.ts#extractImageService (id only) ────────────────
const IIIF_IMAGE_REQUEST =
  /^(https?:\/\/.+?)\/(full|square|\d+,\d+,\d+,\d+|pct:[\d.,]+)\/(max|full|\^?!?\d*,\d*|pct:[\d.]+)\/(!?-?\d+(?:\.\d+)?)\/(default|color|gray|bitonal)\.(jpg|jpeg|png|tif|tiff|gif|jp2|webp)$/i;

/** The IIIF Image API service base of a stored page-image URL, or null. */
export function imageServiceId(url) {
  const m = typeof url === 'string' ? url.match(IIIF_IMAGE_REQUEST) : null;
  return m ? m[1] : null;
}

// ── Twin of src/lib/allmaps.ts#allmapsTargetUrl ───────────────────────────────────────
/**
 * @param {object} src
 * @param {Array<string|null|undefined>} src.pageImageUrls  best first (photo_original, photo)
 * @param {string|null} [src.iaIdentifier]
 * @param {string|null} [src.iiifManifest]
 * @returns {string|null} the resource the editor opens, or null when nothing is tileable
 */
export function allmapsTargetUrl(src) {
  for (const url of src.pageImageUrls || []) {
    if (!url) continue;
    if (/archive\.org\/download\//.test(url)) continue; // BookReader endpoint: info.json 404s
    const service = imageServiceId(url);
    if (service) return `${service}/info.json`;
  }
  if (src.iaIdentifier) {
    return `https://iiif.archive.org/iiif/3/${encodeURIComponent(src.iaIdentifier)}/manifest.json`;
  }
  if (src.iiifManifest && /^https?:\/\//.test(src.iiifManifest)) return src.iiifManifest;
  return null;
}

/**
 * The Allmaps API calls that can hold annotations for a page, deduplicated by the worker
 * across pages (a manifest lookup covers a whole book).
 *
 *   image target   → one `/images/{id}` lookup (exact; finds manifest-made annotations too)
 *   IA manifest    → `/manifests/{id}` for the v3 manifest the editor opens AND the v2 one
 *                    (`/iiif/{ia}/manifest.json`), because IA maps georeferenced elsewhere
 *                    are usually keyed to v2 — the example annotation on the issue is.
 *   other manifest → one `/manifests/{id}` lookup
 *
 * @returns {Array<{kind:'image'|'manifest', target:string, api:string, serviceId?:string}>}
 */
export function allmapsLookups(src) {
  const target = allmapsTargetUrl(src);
  if (!target) return [];
  if (target.endsWith('/info.json')) {
    const serviceId = target.slice(0, -'/info.json'.length);
    return [{ kind: 'image', target, serviceId, api: `${ALLMAPS_API}/images/${allmapsId(serviceId)}` }];
  }
  const lookups = [{ kind: 'manifest', target, api: `${ALLMAPS_API}/manifests/${allmapsId(target)}` }];
  if (src.iaIdentifier) {
    const v2 = `https://iiif.archive.org/iiif/${encodeURIComponent(src.iaIdentifier)}/manifest.json`;
    if (v2 !== target) lookups.push({ kind: 'manifest', target: v2, api: `${ALLMAPS_API}/manifests/${allmapsId(v2)}` });
  }
  return lookups;
}

// ── Matching an annotation to one of our pages ────────────────────────────────────────
const IA_CANVAS = /iiif\.archive\.org\/iiif\/(?:3\/)?([^/$]+?)(?:\$(\d+))?\/canvas$/;
const IA_LEAF_IN_SERVICE = /_(\d{4})\.jp2$/;

function canvasIds(item) {
  const partOf = item?.target?.source?.partOf;
  if (!Array.isArray(partOf)) return [];
  return partOf.filter((p) => p && (p.type === 'Canvas' || /\/canvas/.test(p.id || ''))).map((p) => p.id);
}

/**
 * Internet Archive leaf index an annotation points at, with the IA identifier it belongs
 * to; null when the annotation is not on an IA canvas/image.
 */
export function iaLeafFromAnnotation(item) {
  for (const id of canvasIds(item)) {
    const m = IA_CANVAS.exec(id);
    if (m) return { ia: decodeURIComponent(m[1]), leaf: m[2] === undefined ? 0 : Number(m[2]) };
  }
  const svc = item?.target?.source?.id;
  if (typeof svc === 'string' && /iiif\.archive\.org\/image\/iiif\//.test(svc)) {
    const decoded = decodeURIComponent(svc);
    const leaf = IA_LEAF_IN_SERVICE.exec(decoded);
    const ia = /\/image\/iiif\/(?:3\/)?([^/]+?)\//.exec(decoded);
    if (leaf && ia) return { ia: ia[1], leaf: Number(leaf[1]) };
  }
  return null;
}

/**
 * Does `item` georeference the page described by `ctx`?
 *
 * @param {object} ctx
 * @param {number} ctx.pageNumber
 * @param {string} [ctx.serviceId]            the page's own image service (image-target rows)
 * @param {string} [ctx.iaIdentifier]
 * @param {Map<string,number>} [ctx.canvasIndexById]     canvas id → 0-based index (from the manifest)
 * @param {Map<string,number>} [ctx.canvasIndexByService] image service id → 0-based index
 */
export function annotationMatchesPage(item, ctx) {
  const svc = item?.target?.source?.id;
  if (ctx.serviceId && svc === ctx.serviceId) return true;
  if (ctx.iaIdentifier) {
    const ia = iaLeafFromAnnotation(item);
    if (ia && ia.ia === ctx.iaIdentifier && ia.leaf + 1 === ctx.pageNumber) return true;
  }
  if (ctx.canvasIndexById) {
    for (const id of canvasIds(item)) {
      const idx = ctx.canvasIndexById.get(id);
      if (idx !== undefined && idx + 1 === ctx.pageNumber) return true;
    }
  }
  if (ctx.canvasIndexByService && typeof svc === 'string') {
    const idx = ctx.canvasIndexByService.get(svc);
    if (idx !== undefined && idx + 1 === ctx.pageNumber) return true;
  }
  return false;
}

function gcpCount(item) {
  const f = item?.body?.features;
  return Array.isArray(f) ? f.length : 0;
}

/** The annotation to show for a page: the best-anchored one, latest on ties; null if none. */
export function pickAnnotation(items, ctx) {
  const matches = (items || []).filter((it) => it && typeof it.id === 'string' && annotationMatchesPage(it, ctx));
  if (!matches.length) return null;
  matches.sort((a, b) => gcpCount(b) - gcpCount(a) || String(b.modified || '').localeCompare(String(a.modified || '')));
  return matches[0];
}

/** What gets stored on `gallery_images.allmaps` (a count of GCPs, not the points — they are one fetch away). */
export function summarizeAnnotation(item, target, now = new Date()) {
  return {
    annotation_id: item.id,
    viewer_url: allmapsViewerUrl(item.id),
    gcps: gcpCount(item),
    modified: item.modified || item.created || null,
    target,
    checked_at: now,
  };
}

/**
 * Canvas order of a IIIF Presentation manifest (v2 or v3), so a canvas id or its image
 * service can be turned into a page number (index + 1 — our importers walk canvases in order).
 * @returns {{ byCanvasId: Map<string,number>, byService: Map<string,number> }}
 */
export function indexManifestCanvases(manifest) {
  const byCanvasId = new Map();
  const byService = new Map();
  const v3 = Array.isArray(manifest?.items) ? manifest.items : null;
  const v2 = Array.isArray(manifest?.sequences?.[0]?.canvases) ? manifest.sequences[0].canvases : null;
  const canvases = v3 || v2 || [];
  canvases.forEach((c, idx) => {
    const cid = c?.id || c?.['@id'];
    if (cid) byCanvasId.set(cid, idx);
    let body = null;
    if (v3) body = c?.items?.[0]?.items?.[0]?.body;
    else body = c?.images?.[0]?.resource;
    const services = Array.isArray(body?.service) ? body.service : body?.service ? [body.service] : [];
    for (const s of services) {
      const sid = s?.id || s?.['@id'];
      if (sid) byService.set(sid.replace(/\/info\.json$/, ''), idx);
    }
    // A body without a service block: its id is usually a full-image request on the service.
    const bid = body?.id || body?.['@id'];
    const svcFromId = typeof bid === 'string' ? imageServiceId(bid) : null;
    if (svcFromId && !byService.has(svcFromId)) byService.set(svcFromId, idx);
  });
  return { byCanvasId, byService };
}
