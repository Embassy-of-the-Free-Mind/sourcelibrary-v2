/**
 * Persist an IIIF manifest the importer already fetched into the
 * `iiif_manifests` collection (provenance + pre-extracted page URLs).
 *
 * The bulk backfill counterpart lives in
 * scripts/iiif-discovery/lib/manifest-store.mjs (issue #2416). This module is
 * the import-path side: it stores the manifest we ALREADY have in hand, so it
 * never makes a second network request. Self-contained extraction (mirrors the
 * .mjs lib) avoids a circular import with import-utils.
 *
 * Callers should treat this as best-effort/non-blocking — a storage failure
 * must never fail an import.
 */
import type { Db } from 'mongodb';

interface MinimalCanvas {
  images?: Array<{ resource?: { '@id'?: string; id?: string; service?: unknown } }>;
  items?: Array<{ items?: Array<{ body?: { id?: string; service?: unknown } }> }>;
}
interface MinimalManifest {
  '@context'?: string | string[];
  '@id'?: string;
  label?: unknown;
  sequences?: Array<{ canvases?: MinimalCanvas[] }>;
  items?: MinimalCanvas[];
}

function detectVersion(manifest: MinimalManifest): 2 | 3 {
  const ctx = manifest?.['@context'];
  const ctxStr = Array.isArray(ctx) ? ctx.join(' ') : (ctx || '');
  if (ctxStr.includes('/presentation/3')) return 3;
  if (ctxStr.includes('/presentation/2')) return 2;
  if (Array.isArray(manifest?.items)) return 3;
  if (Array.isArray(manifest?.sequences)) return 2;
  return manifest?.['@id'] ? 2 : 3;
}

function getCanvases(manifest: MinimalManifest): MinimalCanvas[] {
  if (manifest?.sequences?.[0]?.canvases?.length) return manifest.sequences[0].canvases!;
  if (manifest?.items?.length) return manifest.items;
  return [];
}

function serviceId(service: unknown): string | undefined {
  const s = Array.isArray(service) ? service[0] : service;
  if (!s || typeof s !== 'object') return undefined;
  const o = s as Record<string, unknown>;
  return (o.id as string) || (o['@id'] as string) || undefined;
}

function extractCanvasImage(canvas: MinimalCanvas): { photo: string; thumbnail: string } {
  const imageResource = canvas?.images?.[0]?.resource;
  if (imageResource) {
    const sid = serviceId(imageResource.service);
    if (sid) return { photo: `${sid}/full/full/0/default.jpg`, thumbnail: `${sid}/full/200,/0/default.jpg` };
    const direct = imageResource['@id'] || imageResource.id || '';
    return { photo: direct, thumbnail: direct };
  }
  const body = canvas?.items?.[0]?.items?.[0]?.body;
  if (body) {
    const sid = serviceId(body.service);
    if (sid) return { photo: `${sid}/full/full/0/default.jpg`, thumbnail: `${sid}/full/200,/0/default.jpg` };
    const direct = body.id || '';
    return { photo: direct, thumbnail: direct };
  }
  return { photo: '', thumbnail: '' };
}

function extractLabel(label: unknown): string | null {
  if (!label) return null;
  if (typeof label === 'string') return label.trim();
  if (Array.isArray(label)) {
    const en = label.find((l) => l?.['@language'] === 'en');
    return ((en?.['@value'] || label[0]?.['@value'] || label[0] || '') as string).toString().trim() || null;
  }
  if (typeof label === 'object') {
    const obj = label as Record<string, unknown>;
    const vals = (obj.en || obj.none || Object.values(obj)[0]) as unknown;
    if (Array.isArray(vals)) return (vals[0] || '').toString().trim() || null;
  }
  return null;
}

/**
 * Upsert an already-fetched IIIF manifest into `iiif_manifests`.
 * Keyed unique on manifest_url. Best-effort: callers should `.catch()`.
 */
export async function storeImportedManifest(
  db: Db,
  opts: { manifest: unknown; manifest_url: string; book_id?: string | null; source?: string | null; storeRaw?: boolean }
): Promise<{ ok: boolean; page_count?: number; error?: string }> {
  const { manifest, manifest_url, book_id = null, source = null, storeRaw = true } = opts;
  if (!manifest_url) return { ok: false, error: 'no manifest_url' };

  const m = manifest as MinimalManifest;
  const canvases = getCanvases(m);
  const image_urls = canvases.map(extractCanvasImage).filter((u) => u.photo);

  const setDoc: Record<string, unknown> = {
    manifest_url,
    book_id,
    source,
    iiif_version: detectVersion(m),
    label: extractLabel(m?.label),
    page_count: canvases.length,
    image_urls,
    fetched_at: new Date(),
    error: null,
  };
  if (storeRaw) setDoc.raw = manifest;

  await db.collection('iiif_manifests').updateOne(
    { manifest_url },
    { $set: setDoc },
    { upsert: true }
  );
  return { ok: true, page_count: canvases.length };
}
