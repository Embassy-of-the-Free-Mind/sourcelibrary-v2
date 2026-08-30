import { NextRequest, NextResponse } from 'next/server';
import { applyTextRole } from '@/lib/text-role';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { withCuratorAuth } from '@/lib/auth-helpers';
import { publishedToYear } from '@/lib/resolve-language';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { normalizeTitle, normalizeAuthor, sourceFingerprint } from '@/lib/dedup';
import { acquisitionGate, confirmClaims } from '@/lib/acquisition-guard';
import { storeImportedManifest } from '@/lib/iiif-manifest-store';
import type { ImageSourceProvider } from '@/lib/types/image-source';

export const maxDuration = 300;

/** Map IIIF provider names and manifest URL patterns to canonical provider keys */
const PROVIDER_NAME_TO_KEY: Record<string, ImageSourceProvider> = {
  'British Library': 'bl',
  'Harvard Library': 'harvard',
  'SAT Daizokyo': 'sat_daizokyo',
  'National Diet Library of Japan': 'ndl_japan',
  'TU Darmstadt': 'tu_darmstadt',
  'Vatican Library': 'vatican',
  'Biblioteca Apostolica Vaticana': 'vatican',
  'Gallica (BnF)': 'gallica',
  'Leiden University Library': 'leiden',
  'John Rylands Library, University of Manchester': 'manchester',
  'Universitätsbibliothek Heidelberg': 'heidelberg',
  'Wellcome Collection': 'wellcome',
  'Allard Pierson, University of Amsterdam': 'allard_pierson',
  'Biblioteca Medicea Laurenziana': 'laurenziana',
  'Bodleian Library': 'bodleian',
  'e-codices': 'e-codices',
  'Library of Congress': 'loc',
  'Austrian National Library': 'onb',
  'Chester Beatty Library': 'chester_beatty',
  'Cambridge Digital Library': 'cambridge',
  'IRHT (CNRS)': 'irht',
  'Bayerische Staatsbibliothek': 'bsb',
  'Kyoto University Rare Materials Digital Archive': 'kyoto_rmda',
  'Buddhist Digital Resource Center (BDRC)': 'bdrc',
  'Metropolitan Museum of Art': 'met',
  'TU Delft Library': 'tu_delft',
  'Qatar Digital Library': 'qdl',
  'Victoria and Albert Museum': 'v_and_a',
};

// IIIF v2 canvas
interface IIIFv2Canvas {
  '@id'?: string;
  label?: string;
  width?: number;
  height?: number;
  images?: Array<{
    resource?: {
      '@id'?: string;
      service?: {
        '@id'?: string;
      };
    };
  }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface IIIFManifest {
  '@context'?: string | string[];
  '@id'?: string;
  id?: string;       // v3
  type?: string;     // v3
  label?: string | { '@value'?: string }[] | Record<string, string[]>;
  description?: string | { '@value'?: string }[];
  summary?: Record<string, string[]>; // v3
  license?: string | string[];
  rights?: string;   // v3
  attribution?: string | { '@value'?: string; '@language'?: string }[];
  requiredStatement?: { label?: Record<string, string[]>; value?: Record<string, string[]> }; // v3
  logo?: string | { '@id'?: string };
  metadata?: Array<{ label?: unknown; value?: unknown }>;
  seeAlso?: unknown | unknown[];
  navDate?: string;
  viewingDirection?: string;
  sequences?: Array<{
    canvases?: IIIFv2Canvas[];
  }>;
  items?: Array<{     // v3 canvases
    id?: string;
    type?: string;
    label?: Record<string, string[]>;
    width?: number;
    height?: number;
    thumbnail?: Array<{ id?: string }>;
    items?: Array<{    // AnnotationPages
      items?: Array<{  // Annotations
        body?: {
          id?: string;
          type?: string;
          format?: string;
          service?: Array<{
            id?: string;
            '@id'?: string;
            type?: string;
            profile?: string;
          }>;
        };
      }>;
    }>;
  }>;
}

function extractLabel(label: string | { '@value'?: string }[] | Record<string, string[]> | undefined): string | null {
  if (!label) return null;
  if (typeof label === 'string') return label;
  if (Array.isArray(label) && label[0]?.['@value']) return label[0]['@value'];
  // v3 format: { "en": ["Label text"] }
  if (typeof label === 'object' && !Array.isArray(label)) {
    const vals = (label as Record<string, string[]>)['en'] || Object.values(label as Record<string, string[]>)[0];
    if (vals?.[0]) return vals[0];
  }
  return null;
}

function isV3Manifest(manifest: IIIFManifest): boolean {
  const ctx = manifest['@context'];
  if (typeof ctx === 'string') return ctx.includes('presentation/3');
  if (Array.isArray(ctx)) return ctx.some(c => typeof c === 'string' && c.includes('presentation/3'));
  return manifest.type === 'Manifest' && 'items' in manifest;
}

// Extract attribution text from IIIF manifest
function extractAttribution(attribution: string | { '@value'?: string; '@language'?: string }[] | undefined): string | null {
  if (!attribution) return null;
  if (typeof attribution === 'string') {
    // Strip HTML tags for clean text
    return attribution.replace(/<[^>]*>/g, '').trim();
  }
  if (Array.isArray(attribution)) {
    // Prefer English if available
    const englishAttr = attribution.find(a => a['@language'] === 'en');
    const text = englishAttr?.['@value'] || attribution[0]?.['@value'] || null;
    return text ? text.replace(/<[^>]*>/g, '').trim() : null;
  }
  return null;
}

// Parse license from attribution text or URL
function parseLicense(licenseUrl: string | null, attribution: string | null, provider: string): { license: string; license_url: string | null } {
  // Check for CC license in attribution text
  if (attribution) {
    if (attribution.includes('CC BY-NC 4.0') || attribution.includes('CC-BY-NC-4.0') || attribution.includes('creativecommons.org/licenses/by-nc/4.0')) {
      return { license: 'CC-BY-NC-4.0', license_url: 'https://creativecommons.org/licenses/by-nc/4.0/' };
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

  // Check license URL directly
  if (licenseUrl) {
    if (licenseUrl.includes('by-nc/4.0')) return { license: 'CC-BY-NC-4.0', license_url: licenseUrl };
    if (licenseUrl.includes('by/4.0')) return { license: 'CC-BY-4.0', license_url: licenseUrl };
    if (licenseUrl.includes('zero/1.0')) return { license: 'CC0-1.0', license_url: licenseUrl };
    return { license: 'unknown', license_url: licenseUrl };
  }

  // Provider-specific defaults (based on known terms)
  if (provider.includes('Vatican')) {
    // Vatican: CC BY-NC 4.0 for manifests, images copyright Vatican
    return { license: 'CC-BY-NC-4.0', license_url: 'https://creativecommons.org/licenses/by-nc/4.0/' };
  }
  if (provider.includes('Bodleian')) {
    return { license: 'CC-BY-NC-4.0', license_url: 'https://creativecommons.org/licenses/by-nc/4.0/' };
  }
  if (provider.includes('Gallica') || provider.includes('BnF')) {
    return { license: 'publicdomain', license_url: null };
  }

  return { license: 'unknown', license_url: licenseUrl };
}

/**
 * Import a book from any IIIF manifest
 *
 * POST /api/import/iiif
 * Body: {
 *   manifest_url: string,    // Full URL to IIIF manifest.json
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   collections?: string[],  // Source Library collection slugs to tag the book with
 *   provider?: string,       // e.g., "Vatican", "IRHT", "Bodleian"
 *   start_page?: number,     // 1-indexed start page (for extracting portion of manifest)
 *   end_page?: number        // 1-indexed end page (inclusive)
 * }
 */
export const POST = withCuratorAuth(async (request, session) => {
  try {
    const body = await request.json();
    const {
      manifest_url,
      manifest_data,
      title,
      display_title,
      author,
      language,
      published,
      year,
      categories,
      collections: requestCollections,
      work_id,
      provider,
      start_page,
      end_page,
      contributing_library,
      shelfmark,
    } = body;

    if (!manifest_url || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: manifest_url, title, author' },
        { status: 400 }
      );
    }

    // Use pre-fetched manifest data if provided, otherwise fetch it
    let manifest: IIIFManifest;
    if (manifest_data) {
      manifest = manifest_data;
    } else {
      const manifestRes = await fetch(manifest_url, {
        headers: {
          'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)',
          'Accept': 'application/json, application/ld+json',
        }
      });

      if (!manifestRes.ok) {
        return NextResponse.json(
          { error: `Failed to fetch IIIF manifest: ${manifestRes.status}` },
          { status: 400 }
        );
      }

      manifest = await manifestRes.json();
    }
    const v3 = isV3Manifest(manifest);

    // Extract canvases from v2 or v3 manifest
    let totalCanvasCount: number;
    if (v3) {
      totalCanvasCount = manifest.items?.length || 0;
    } else {
      totalCanvasCount = manifest.sequences?.[0]?.canvases?.length || 0;
    }

    if (totalCanvasCount === 0) {
      return NextResponse.json(
        { error: 'No pages found in IIIF manifest' },
        { status: 400 }
      );
    }

    // Support extracting a page range from the manifest
    const startIdx = start_page ? Math.max(0, start_page - 1) : 0;
    const endIdx = end_page ? Math.min(totalCanvasCount, end_page) : totalCanvasCount;
    const pageCount = endIdx - startIdx;

    if (startIdx > 0 || endIdx < totalCanvasCount) {
      console.log(`[IIIF Import] Extracting pages ${startIdx + 1}-${endIdx} (${pageCount} pages)`);
    }

    const db = await getDb();

    // Check if book already exists (with same page range if specified)
    const existingQuery: Record<string, unknown> = {
      'image_source.iiif_manifest': manifest_url
    };
    if (start_page || end_page) {
      existingQuery['image_source.page_range'] = `${startIdx + 1}-${endIdx}`;
    }
    const existing = await db.collection('books').findOne(existingQuery);

    if (existing) {
      return NextResponse.json(
        { error: 'Book already exists', existingId: existing.id || existing._id.toString() },
        { status: 409 }
      );
    }

    // Cross-source dedup check
    const gate = await acquisitionGate(db, {
      title, author, display_title, year, published,
      image_source: { provider: 'iiif', iiif_manifest: manifest_url, source_url: manifest_url },
    }, { importer: 'api:iiif' });
    if (!gate.ok) {
      const best = gate.matches[0];
      return NextResponse.json(
        { error: gate.message, existingId: best?.matchedBookId ?? null, reason: gate.reason, evidence: gate.evidence, matches: gate.matches },
        { status: 409 }
      );
    }

    // Create book
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();

    // Build page image URLs from IIIF canvases (v2 or v3)
    const pageImages: { photo: string; thumbnail: string }[] = [];

    if (v3) {
      // IIIF Presentation API v3
      const v3Canvases = (manifest.items || []).slice(startIdx, endIdx);
      for (const canvas of v3Canvases) {
        const annotation = canvas.items?.[0]?.items?.[0];
        const body = annotation?.body;
        let imageUrl = body?.id || '';
        const service = Array.isArray(body?.service) ? body.service[0] : undefined;
        const imageService = service?.id || service?.['@id'];

        if (imageService) {
          imageUrl = `${imageService}/full/full/0/default.jpg`;
        }

        let thumbnailUrl = canvas.thumbnail?.[0]?.id || '';
        if (!thumbnailUrl && imageService) {
          thumbnailUrl = `${imageService}/full/200,/0/default.jpg`;
        } else if (!thumbnailUrl) {
          thumbnailUrl = imageUrl.replace(/\/full\/[^/]+\//, '/full/200,/');
        }

        pageImages.push({ photo: imageUrl, thumbnail: thumbnailUrl });
      }
    } else {
      // IIIF Presentation API v2
      const v2Canvases = (manifest.sequences?.[0]?.canvases || []).slice(startIdx, endIdx);
      for (const canvas of v2Canvases) {
        const imageResource = canvas.images?.[0]?.resource;
        let imageUrl = imageResource?.['@id'] || '';
        const imageService = imageResource?.service?.['@id'];

        if (imageService) {
          imageUrl = `${imageService}/full/full/0/default.jpg`;
        }

        let thumbnailUrl = imageUrl;
        if (imageService) {
          thumbnailUrl = `${imageService}/full/200,/0/default.jpg`;
        } else if (imageUrl) {
          thumbnailUrl = imageUrl.replace(/\/full\/[^/]+\//, '/full/200,/');
        }

        pageImages.push({ photo: imageUrl, thumbnail: thumbnailUrl });
      }
    }

    // Extract manifest metadata (v2 and v3)
    const manifestLabel = extractLabel(manifest.label);
    const rawLicenseUrl = v3
      ? (manifest.rights || null)
      : (Array.isArray(manifest.license) ? manifest.license[0] : manifest.license || null);
    let attributionText = extractAttribution(manifest.attribution);
    // v3 uses requiredStatement instead of attribution
    if (!attributionText && manifest.requiredStatement?.value) {
      const vals = manifest.requiredStatement.value['en'] || Object.values(manifest.requiredStatement.value)[0];
      if (vals?.[0]) attributionText = vals[0].replace(/<[^>]*>/g, '').trim();
    }

    // Extract the manifest's `metadata` array — IIIF stores publisher,
    // creator, persistent ID, call number, DOI, etc. as label/value pairs
    // here. Both v2 and v3 use the same structure but values can be a
    // string, array, or {language: [strings]} map. Normalise to {label: string,
    // value: string} for downstream display.
    const flattenIiifValue = (v: unknown): string => {
      if (typeof v === 'string') return v.replace(/<[^>]*>/g, '').trim();
      if (Array.isArray(v)) return v.map(flattenIiifValue).filter(Boolean).join(' / ');
      if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        // v3 language map: {en: ['…']}
        const en = obj['en'] || obj['none'] || Object.values(obj)[0];
        if (Array.isArray(en)) return en.map(flattenIiifValue).filter(Boolean).join(' / ');
        if (typeof en === 'string') return en;
      }
      return '';
    };
    const iiifMetadata: Array<{ label: string; value: string }> = [];
    for (const item of (manifest.metadata || [])) {
      const label = flattenIiifValue(item.label);
      const value = flattenIiifValue(item.value);
      if (label && value) iiifMetadata.push({ label, value });
    }
    // Index by common labels for quick access. Labels vary per institution
    // ("Publisher", "Publication Date", "Author", "Creator", "Call Number",
    // "DOI", "Persistent ID", "Bibliographic ID") — we collapse a few
    // synonyms so the catalog_metadata has stable keys.
    const labelGet = (...needles: string[]): string | null => {
      for (const n of needles) {
        const hit = iiifMetadata.find(m => m.label.toLowerCase().includes(n.toLowerCase()));
        if (hit) return hit.value;
      }
      return null;
    };
    const iiifPublisher = labelGet('publisher');
    const iiifPlace = labelGet('publication place', 'place of publication', 'place');
    const iiifPubDate = labelGet('publication date', 'date issued', 'date');
    const iiifCreator = labelGet('creator', 'author');
    const iiifCallNumber = labelGet('call number', 'shelfmark', 'shelf mark');
    const iiifDoi = labelGet('doi');
    const iiifBibId = labelGet('bibliographic id', 'bibliographic identifier', 'identifier');
    const iiifPersistentId = labelGet('persistent id', 'persistent identifier');
    const iiifDescription = v3
      ? flattenIiifValue(manifest.summary)
      : (manifest.description ? flattenIiifValue(manifest.description) : '');
    const iiifSeeAlso: string[] = [];
    for (const ref of (Array.isArray(manifest.seeAlso) ? manifest.seeAlso : manifest.seeAlso ? [manifest.seeAlso] : [])) {
      const id = ref?.id || ref?.['@id'] || ref;
      if (typeof id === 'string') iiifSeeAlso.push(id);
    }

    const iiifCatalog: Record<string, unknown> = {
      source: 'iiif',
      manifest_url,
      manifest_version: v3 ? 'v3' : 'v2',
      publisher: iiifPublisher,
      place: iiifPlace,
      publication_date: iiifPubDate,
      creator: iiifCreator,
      call_number: iiifCallNumber,
      doi: iiifDoi,
      bibliographic_id: iiifBibId,
      persistent_id: iiifPersistentId,
      description: iiifDescription,
      see_also: iiifSeeAlso,
      metadata_pairs: iiifMetadata,
      nav_date: manifest.navDate || null,
      viewing_direction: manifest.viewingDirection || null,
      attribution: attributionText || null,
      scraped_at: new Date().toISOString(),
    };
    for (const k of Object.keys(iiifCatalog)) {
      const v = iiifCatalog[k];
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete iiifCatalog[k];
    }

    // Determine provider name
    let providerName = provider || 'IIIF Source';
    const manifestId = manifest['@id'] || manifest.id || manifest_url;
    if (manifestId.includes('vatlib.it')) providerName = 'Vatican Library';
    else if (manifestId.includes('gallica.bnf.fr')) providerName = 'Gallica (BnF)';
    else if (manifestId.includes('bodleian.ox.ac.uk')) providerName = 'Bodleian Library';
    else if (manifestId.includes('bl.uk') || manifestId.includes('bl.digirati.io')) providerName = 'British Library';
    else if (manifestId.includes('irht.cnrs.fr')) providerName = 'IRHT (CNRS)';
    else if (manifestId.includes('loc.gov')) providerName = 'Library of Congress';
    else if (manifestId.includes('nli.org.il')) providerName = 'National Library of Israel';
    else if (manifestId.includes('polona.pl')) providerName = 'National Library of Poland';
    else if (manifestId.includes('onb.ac.at')) providerName = 'Austrian National Library';
    else if (manifestId.includes('e-codices.unifr.ch')) providerName = 'e-codices';
    else if (manifestId.includes('contentdm.oclc.org')) providerName = provider || 'ContentDM (OCLC)';

    // Parse license from manifest data
    const { license, license_url } = parseLicense(rawLicenseUrl, attributionText, providerName);

    // Build attribution/credit text
    let creditText = attributionText;
    if (!creditText) {
      // Generate default attribution based on provider
      if (providerName === 'Vatican Library') {
        creditText = 'Images © Biblioteca Apostolica Vaticana';
      } else if (providerName === 'Bodleian Library') {
        creditText = '© Bodleian Libraries, University of Oxford';
      } else if (providerName.includes('Gallica')) {
        creditText = 'Source: Bibliothèque nationale de France';
      }
    }

    // Build a human-readable source URL instead of the raw IIIF manifest JSON
    const rawManifestId = manifest['@id'] || manifest.id || manifest_url;
    let sourceUrl = rawManifestId;
    const bodleianMatch = manifest_url.match(/iiif\.bodleian\.ox\.ac\.uk\/iiif\/manifest\/([a-f0-9-]+)/);
    if (bodleianMatch) {
      sourceUrl = `https://digital.bodleian.ox.ac.uk/objects/${bodleianMatch[1]}`;
    }

    const slug = await generateUniqueBookSlug(db, title, author, display_title);

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      title,
      display_title: display_title || manifestLabel || null,
      author,
      language: language || 'Unknown',
      published: published || 'Unknown',
      ...(publishedToYear(typeof year === 'number' ? year : published) !== null
        ? { year: publishedToYear(typeof year === 'number' ? year : published)! }
        : {}),
      categories: categories || [],
      ...(requestCollections?.length ? { collections: requestCollections } : {}),
      ...(work_id ? { work_id } : {}),
      ...(contributing_library ? { contributing_library } : providerName !== 'IIIF Source' ? { contributing_library: providerName } : {}),
      thumbnail: pageImages[0]?.thumbnail || '',
      pages_count: pageCount,
      pages_ocr: 0,
      pages_translated: 0,
      dublin_core: {
        dc_identifier: [
          `IIIF:${rawManifestId}`,
          ...(iiifCatalog.persistent_id ? [String(iiifCatalog.persistent_id)] : []),
          ...(iiifCatalog.doi ? [`DOI:${iiifCatalog.doi}`] : []),
          ...(iiifCatalog.bibliographic_id ? [`BIB:${iiifCatalog.bibliographic_id}`] : []),
        ],
        dc_source: rawManifestId,
        ...(iiifCatalog.publisher ? { dc_publisher: iiifCatalog.publisher } : {}),
        ...(iiifCatalog.description ? { dc_description: iiifCatalog.description } : {}),
      },
      catalog_metadata: iiifCatalog,
      ...(iiifCatalog.place ? { place_published: String(iiifCatalog.place) } : {}),
      ...(iiifCatalog.publisher ? { publisher: String(iiifCatalog.publisher) } : {}),
      image_source: {
        provider: PROVIDER_NAME_TO_KEY[providerName] || (bodleianMatch ? 'bodleian' : 'iiif'),
        provider_name: providerName,
        source_url: sourceUrl,
        iiif_manifest: manifest_url,
        license,
        license_url,
        attribution: creditText,
        access_date: new Date(),
        ...(start_page || end_page ? { page_range: `${startIdx + 1}-${endIdx}` } : {}),
        ...(contributing_library ? { contributing_library } : {}),
        ...(shelfmark ? { shelfmark } : {}),
      },
      status: 'draft',
      hidden: true, visible: false,
      source_fingerprint: sourceFingerprint({ image_source: { provider: 'iiif', iiif_manifest: manifest_url } }),
      source_fingerprints: gate.fingerprints,
      normalized_title: normalizeTitle(title),
      normalized_author: normalizeAuthor(author),
      created_at: new Date(),
      updated_at: new Date()
    };

    // Classify original-vs-translation at import (issue #2395).
    applyTextRole(bookDoc as Record<string, unknown>);
    await db.collection('books').insertOne(bookDoc);
    // The claim now points at the row it produced, so it stops being
    // reclaimable and the acquisition ledger is joinable to `books`.
    await confirmClaims(db, gate.fingerprints, bookIdStr);

    // Create pages
    const pageDocs = [];
    for (let i = 0; i < pageCount; i++) {
      const pageId = new ObjectId();
      pageDocs.push({
        _id: pageId,
        id: pageId.toHexString(),
        book_id: bookIdStr,
        page_number: i + 1,
        photo: pageImages[i]?.photo || '',
        thumbnail: pageImages[i]?.thumbnail || '',
        photo_original: pageImages[i]?.photo || '',
        // Don't initialize ocr/translation with empty strings -- they cause
        // false completion in job-completion.ts (see: translation loop bug fix)
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    await db.collection('pages').insertMany(pageDocs);

    // Persist the IIIF manifest we already fetched (provenance, #2416; non-blocking)
    storeImportedManifest(db, {
      manifest,
      manifest_url,
      book_id: bookIdStr,
      source: (provider as string) || 'iiif',
    }).catch((e) => console.warn(`[IIIF Import] manifest store failed for ${bookIdStr}: ${e?.message}`));

    // Notify search engines of new book via IndexNow (non-blocking)
    notifyBookImport(bookIdStr, slug).catch(console.error);

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      title,
      provider: providerName,
      pagesCreated: pageDocs.length,
      bookUrl: `/book/${bookIdStr}`,
      manifestUrl: manifest_url,
      message: `Created book with ${pageDocs.length} pages from ${providerName}.`
    });

  } catch (error) {
    console.error('IIIF Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
