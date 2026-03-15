import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { queuePreviewOcr } from '@/lib/preview-ocr';
import { computeProcessingPriority } from '@/lib/processing-priority';
import { normalizeTitle, normalizeAuthor, sourceFingerprint, checkDuplicate } from '@/lib/dedup';

// IIIF v2 manifest shape (covers most digital library providers)
export interface IIIFManifest {
  '@context'?: string | string[];
  '@id'?: string;
  id?: string; // v3
  label?: string | Record<string, string[]> | { '@value'?: string }[];
  description?: string | Record<string, string[]> | { '@value'?: string }[];
  license?: string | string[];
  rights?: string; // v3
  attribution?: string | { '@value'?: string; '@language'?: string }[];
  requiredStatement?: { label?: Record<string, string[]>; value?: Record<string, string[]> }; // v3
  logo?: string | { '@id'?: string };
  sequences?: Array<{
    canvases?: Array<IIIFCanvas>;
  }>;
  items?: Array<IIIFCanvas>; // v3
}

export interface IIIFCanvas {
  '@id'?: string;
  id?: string; // v3
  label?: string | Record<string, string[]>;
  width?: number;
  height?: number;
  images?: Array<{
    resource?: {
      '@id'?: string;
      service?: { '@id'?: string } | Array<{ '@id'?: string; id?: string }>;
    };
  }>;
  items?: Array<{ // v3
    items?: Array<{
      body?: {
        id?: string;
        service?: Array<{ id?: string; '@id'?: string }>;
      };
    }>;
  }>;
}

export function extractLabel(label: string | Record<string, string[]> | { '@value'?: string }[] | undefined): string | null {
  if (!label) return null;
  if (typeof label === 'string') return label;
  if (Array.isArray(label) && label[0]?.['@value']) return label[0]['@value'];
  // v3 language map
  if (typeof label === 'object' && !Array.isArray(label)) {
    const vals = (label as Record<string, string[]>)['en'] || Object.values(label)[0];
    if (Array.isArray(vals)) return vals[0] || null;
  }
  return null;
}

export function extractAttribution(
  attribution: string | { '@value'?: string; '@language'?: string }[] | undefined,
  requiredStatement?: { label?: Record<string, string[]>; value?: Record<string, string[]> }
): string | null {
  // v2
  if (attribution) {
    if (typeof attribution === 'string') {
      return attribution.replace(/<[^>]*>/g, '').trim();
    }
    if (Array.isArray(attribution)) {
      const englishAttr = attribution.find(a => a['@language'] === 'en');
      const text = englishAttr?.['@value'] || attribution[0]?.['@value'] || null;
      return text ? text.replace(/<[^>]*>/g, '').trim() : null;
    }
  }
  // v3
  if (requiredStatement?.value) {
    const vals = requiredStatement.value['en'] || Object.values(requiredStatement.value)[0];
    if (Array.isArray(vals) && vals[0]) return vals[0].replace(/<[^>]*>/g, '').trim();
  }
  return null;
}

export function parseLicense(
  licenseUrl: string | null,
  attribution: string | null,
  defaultLicense?: string
): { license: string; license_url: string | null } {
  if (attribution) {
    if (attribution.includes('CC BY-NC 4.0') || attribution.includes('CC-BY-NC-4.0') || attribution.includes('creativecommons.org/licenses/by-nc/4.0')) {
      return { license: 'CC-BY-NC-4.0', license_url: 'https://creativecommons.org/licenses/by-nc/4.0/' };
    }
    if (attribution.includes('CC BY-SA 4.0') || attribution.includes('CC-BY-SA-4.0') || attribution.includes('creativecommons.org/licenses/by-sa/4.0')) {
      return { license: 'CC-BY-SA-4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' };
    }
    if (attribution.includes('CC BY 4.0') || attribution.includes('CC-BY-4.0') || attribution.includes('creativecommons.org/licenses/by/4.0')) {
      return { license: 'CC-BY-4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/' };
    }
    if (attribution.includes('CC0') || attribution.includes('publicdomain/zero')) {
      return { license: 'CC0-1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/' };
    }
    if (attribution.includes('Public Domain')) {
      return { license: 'publicdomain', license_url: null };
    }
  }

  if (licenseUrl) {
    if (licenseUrl.includes('by-nc-sa')) return { license: 'CC-BY-NC-SA-4.0', license_url: licenseUrl };
    if (licenseUrl.includes('by-nc/')) return { license: 'CC-BY-NC-4.0', license_url: licenseUrl };
    if (licenseUrl.includes('by-sa/')) return { license: 'CC-BY-SA-4.0', license_url: licenseUrl };
    if (licenseUrl.includes('by/4.0')) return { license: 'CC-BY-4.0', license_url: licenseUrl };
    if (licenseUrl.includes('zero/1.0')) return { license: 'CC0-1.0', license_url: licenseUrl };
    return { license: 'unknown', license_url: licenseUrl };
  }

  if (defaultLicense) {
    return { license: defaultLicense, license_url: null };
  }

  return { license: 'unknown', license_url: null };
}

// Extract image URLs from a IIIF canvas (handles v2 and v3)
export function extractCanvasImage(canvas: IIIFCanvas): { photo: string; thumbnail: string } {
  // v2: canvas.images[0].resource
  const imageResource = canvas.images?.[0]?.resource;
  if (imageResource) {
    let imageUrl = imageResource['@id'] || '';
    const service = imageResource.service;
    const serviceId = Array.isArray(service)
      ? (service[0]?.['@id'] || service[0]?.id)
      : service?.['@id'];

    if (serviceId) {
      return {
        photo: `${serviceId}/full/1000,/0/default.jpg`,
        thumbnail: `${serviceId}/full/200,/0/default.jpg`,
      };
    }
    return { photo: imageUrl, thumbnail: imageUrl };
  }

  // v3: canvas.items[0].items[0].body
  const body = canvas.items?.[0]?.items?.[0]?.body;
  if (body) {
    const serviceId = body.service?.[0]?.id || body.service?.[0]?.['@id'];
    if (serviceId) {
      return {
        photo: `${serviceId}/full/1000,/0/default.jpg`,
        thumbnail: `${serviceId}/full/200,/0/default.jpg`,
      };
    }
    return { photo: body.id || '', thumbnail: body.id || '' };
  }

  return { photo: '', thumbnail: '' };
}

// Get canvases from manifest (handles v2 and v3)
export function getCanvases(manifest: IIIFManifest): IIIFCanvas[] {
  // v2: sequences[0].canvases
  if (manifest.sequences?.[0]?.canvases?.length) {
    return manifest.sequences[0].canvases;
  }
  // v3: items
  if (manifest.items?.length) {
    return manifest.items;
  }
  return [];
}

export interface IIIFImportConfig {
  provider: string;
  provider_name: string;
  manifest_url: string;
  identifier: string;
  source_url: string;
  title: string;
  display_title?: string;
  author: string;
  language?: string;
  published?: string;
  categories?: string[];
  license_default?: string;
  attribution_default?: string;
  duplicate_query: Record<string, unknown>;
  identifier_field?: Record<string, string>; // e.g. { bodleian_uuid: 'xxx' }
  work_id?: string; // WEMI work-level grouping (e.g. 'agrippa-de-occulta-philosophia')
  start_page?: number;
  end_page?: number;
}

export async function importBookFromIIIF(
  config: IIIFImportConfig,
  request: NextRequest
): Promise<NextResponse> {
  // Fetch IIIF manifest
  const manifestRes = await fetch(config.manifest_url, {
    headers: { 'Accept': 'application/json, application/ld+json' },
  });

  if (!manifestRes.ok) {
    return NextResponse.json(
      { error: `Failed to fetch IIIF manifest: ${manifestRes.status} ${manifestRes.statusText}` },
      { status: 400 }
    );
  }

  const manifest: IIIFManifest = await manifestRes.json();

  // Get canvases (v2 + v3)
  let canvases = getCanvases(manifest);

  if (canvases.length === 0) {
    return NextResponse.json(
      { error: 'No pages found in IIIF manifest' },
      { status: 400 }
    );
  }

  // Support page range extraction
  const startIdx = config.start_page ? Math.max(0, config.start_page - 1) : 0;
  const endIdx = config.end_page ? Math.min(canvases.length, config.end_page) : canvases.length;

  if (startIdx > 0 || endIdx < canvases.length) {
    canvases = canvases.slice(startIdx, endIdx);
  }

  const pageCount = canvases.length;

  const db = await getDb();

  // Check for duplicates (provider-specific query)
  const existing = await db.collection('books').findOne(config.duplicate_query);
  if (existing) {
    return NextResponse.json(
      { error: 'Book already exists', existingId: existing.id || existing._id.toString() },
      { status: 409 }
    );
  }

  // Cross-source dedup check (catches duplicates across providers)
  const dedupResult = await checkDuplicate(db, {
    title: config.title,
    author: config.author,
    display_title: config.display_title,
    image_source: {
      provider: config.provider,
      identifier: config.identifier,
      iiif_manifest: config.manifest_url,
      source_url: config.source_url,
    },
  });
  if (dedupResult.isDuplicate) {
    const best = dedupResult.matches[0];
    return NextResponse.json(
      {
        error: `Duplicate detected (${best.matchType}): matches "${best.matchedTitle}"`,
        existingId: best.matchedBookId,
        matches: dedupResult.matches,
      },
      { status: 409 }
    );
  }

  // Extract page images from canvases
  const pageImages = canvases.map(extractCanvasImage);

  // Extract metadata from manifest
  const manifestLabel = extractLabel(manifest.label);
  const rawLicenseUrl = manifest.rights
    || (Array.isArray(manifest.license) ? manifest.license[0] : manifest.license)
    || null;
  const attributionText = extractAttribution(manifest.attribution, manifest.requiredStatement)
    || config.attribution_default
    || null;

  const { license, license_url } = parseLicense(
    rawLicenseUrl,
    attributionText,
    config.license_default
  );

  // Create book
  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();

  const slug = await generateUniqueBookSlug(db, config.title, config.author, config.display_title);

  const bookDoc = {
    _id: bookId,
    id: bookIdStr,
    slug,
    tenant_id: 'default',
    title: config.title,
    display_title: config.display_title || manifestLabel || null,
    author: config.author,
    language: config.language || 'Unknown',
    published: config.published || 'Unknown',
    categories: config.categories || [],
    ...(config.identifier_field || {}),
    ...(config.work_id ? { work_id: config.work_id } : {}),
    thumbnail: pageImages[0]?.thumbnail || '',
    pages_count: pageCount,
    pages_ocr: 0,
    pages_translated: 0,
    dublin_core: {
      dc_identifier: [`${config.provider.toUpperCase()}:${config.identifier}`],
      dc_source: config.source_url,
    },
    image_source: {
      provider: config.provider,
      provider_name: config.provider_name,
      source_url: config.source_url,
      iiif_manifest: config.manifest_url,
      identifier: config.identifier,
      license,
      license_url,
      attribution: attributionText,
      access_date: new Date(),
      ...(config.start_page || config.end_page
        ? { page_range: `${startIdx + 1}-${endIdx}` }
        : {}),
    },
    status: 'draft',
    pipeline_auto: {
      status: 'queued',
      source: 'import',
      queued_at: new Date(),
      last_updated: new Date(),
      retry_count: 0,
    },
    created_at: new Date(),
    updated_at: new Date(),
  };

  // Compute processing priority at import time (deterministic, no AI calls)
  const priority = computeProcessingPriority(bookDoc);
  (bookDoc as Record<string, unknown>).processing_priority = priority.score;
  (bookDoc as Record<string, unknown>).processing_priority_breakdown = priority.breakdown;

  // Dedup fields for cross-source matching
  const fp = sourceFingerprint(bookDoc as Record<string, unknown>);
  if (fp) (bookDoc as Record<string, unknown>).source_fingerprint = fp;
  (bookDoc as Record<string, unknown>).normalized_title = normalizeTitle(config.title);
  (bookDoc as Record<string, unknown>).normalized_author = normalizeAuthor(config.author);

  await db.collection('books').insertOne(bookDoc);

  // Create pages
  const pageDocs = [];
  for (let i = 0; i < pageCount; i++) {
    const pageId = new ObjectId();
    pageDocs.push({
      _id: pageId,
      id: pageId.toHexString(),
      tenant_id: 'default',
      book_id: bookIdStr,
      page_number: i + 1,
      photo: pageImages[i]?.photo || '',
      thumbnail: pageImages[i]?.thumbnail || '',
      photo_original: pageImages[i]?.photo || '',
      ocr: {
        language: config.language || 'Unknown',
        model: null,
        data: '',
      },
      translation: {
        language: 'English',
        model: null,
        data: '',
      },
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  await db.collection('pages').insertMany(pageDocs);

  // Audit log (non-blocking)
  logAuditEvent({
    action: 'book_imported',
    book_id: bookIdStr,
    book_title: config.title,
    pages_affected: pageDocs.length,
    metadata: { provider: config.provider, identifier: config.identifier },
  });

  // Queue preview OCR for early metadata enrichment (non-blocking)
  queuePreviewOcr(bookIdStr, config.title).catch(() => {});

  // Queue split detection check (non-blocking)
  const baseUrl = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : request.headers.get('origin') || 'http://localhost:3000';

  fetch(`${baseUrl}/api/books/${bookIdStr}/check-needs-split`, {
    method: 'GET',
  }).catch(() => {
    console.log(`[Import] Split check queued for ${bookIdStr}`);
  });

  // Kick off image archiving (non-blocking, first batch)
  fetch(`${baseUrl}/api/books/${bookIdStr}/archive-images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 50 }),
  }).catch(() => {
    console.log(`[Import] Archive kick-off queued for ${bookIdStr}`);
  });

  // Notify search engines (non-blocking)
  notifyBookImport(bookIdStr, slug).catch(console.error);

  return NextResponse.json({
    success: true,
    bookId: bookIdStr,
    slug,
    title: config.title,
    provider: config.provider_name,
    pagesCreated: pageDocs.length,
    bookUrl: `/book/${slug}`,
    sourceUrl: config.source_url,
    splitCheckQueued: true,
    message: `Created book with ${pageDocs.length} pages from ${config.provider_name}. Split detection queued.`,
  });
}
