import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';

interface IIIFManifest {
  '@context'?: string;
  '@id'?: string;
  label?: string | { '@value'?: string }[];
  description?: string | { '@value'?: string }[];
  license?: string | string[];
  attribution?: string | { '@value'?: string; '@language'?: string }[];
  logo?: string | { '@id'?: string };
  sequences?: Array<{
    canvases?: Array<{
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
    }>;
  }>;
}

function extractLabel(label: string | { '@value'?: string }[] | undefined): string | null {
  if (!label) return null;
  if (typeof label === 'string') return label;
  if (Array.isArray(label) && label[0]?.['@value']) return label[0]['@value'];
  return null;
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
 *   provider?: string,       // e.g., "Vatican", "IRHT", "Bodleian"
 *   start_page?: number,     // 1-indexed start page (for extracting portion of manifest)
 *   end_page?: number        // 1-indexed end page (inclusive)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      manifest_url,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      provider,
      start_page,
      end_page,
    } = body;

    if (!manifest_url || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: manifest_url, title, author' },
        { status: 400 }
      );
    }

    // Fetch IIIF manifest
    const manifestRes = await fetch(manifest_url, {
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!manifestRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch IIIF manifest: ${manifestRes.status}` },
        { status: 400 }
      );
    }

    const manifest: IIIFManifest = await manifestRes.json();

    // Get page count from IIIF canvases
    let canvases = manifest.sequences?.[0]?.canvases || [];

    if (canvases.length === 0) {
      return NextResponse.json(
        { error: 'No pages found in IIIF manifest' },
        { status: 400 }
      );
    }

    // Support extracting a page range from the manifest
    const startIdx = start_page ? Math.max(0, start_page - 1) : 0;
    const endIdx = end_page ? Math.min(canvases.length, end_page) : canvases.length;

    if (startIdx > 0 || endIdx < canvases.length) {
      canvases = canvases.slice(startIdx, endIdx);
      console.log(`[IIIF Import] Extracting pages ${startIdx + 1}-${endIdx} (${canvases.length} pages)`);
    }

    const pageCount = canvases.length;

    const db = await getDb();

    // Check if book already exists (with same page range if specified)
    const existingQuery: Record<string, unknown> = {
      'image_source.iiif_manifest': manifest_url
    };
    if (start_page || end_page) {
      // If extracting a page range, check for exact match
      existingQuery['image_source.page_range'] = `${startIdx + 1}-${endIdx}`;
    }
    const existing = await db.collection('books').findOne(existingQuery);

    if (existing) {
      return NextResponse.json(
        { error: 'Book already exists', existingId: existing.id || existing._id.toString() },
        { status: 409 }
      );
    }

    // Create book
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();

    // Build page image URLs from IIIF canvases
    const pageImages: { photo: string; thumbnail: string }[] = [];

    for (const canvas of canvases) {
      const imageResource = canvas.images?.[0]?.resource;
      let imageUrl = imageResource?.['@id'] || '';

      // If there's an IIIF Image API service, use it for better quality control
      const imageService = imageResource?.service?.['@id'];
      if (imageService) {
        // Use IIIF Image API for consistent sizing
        imageUrl = `${imageService}/full/1000,/0/default.jpg`;
      }

      // Generate thumbnail
      let thumbnailUrl = imageUrl;
      if (imageService) {
        thumbnailUrl = `${imageService}/full/200,/0/default.jpg`;
      } else if (imageUrl) {
        // Try to modify URL for smaller size if it's IIIF-like
        thumbnailUrl = imageUrl.replace(/\/full\/[^/]+\//, '/full/200,/');
      }

      pageImages.push({
        photo: imageUrl,
        thumbnail: thumbnailUrl
      });
    }

    // Extract manifest metadata
    const manifestLabel = extractLabel(manifest.label);
    const rawLicenseUrl = Array.isArray(manifest.license)
      ? manifest.license[0]
      : manifest.license || null;
    const attributionText = extractAttribution(manifest.attribution);

    // Determine provider name
    let providerName = provider || 'IIIF Source';
    const manifestId = manifest['@id'] || manifest_url;
    if (manifestId.includes('vatlib.it')) providerName = 'Vatican Library';
    else if (manifestId.includes('gallica.bnf.fr')) providerName = 'Gallica (BnF)';
    else if (manifestId.includes('bodleian.ox.ac.uk')) providerName = 'Bodleian Library';
    else if (manifestId.includes('irht.cnrs.fr')) providerName = 'IRHT (CNRS)';
    else if (manifestId.includes('loc.gov')) providerName = 'Library of Congress';

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

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      tenant_id: 'default',
      title,
      display_title: display_title || manifestLabel || null,
      author,
      language: language || 'Unknown',
      published: published || 'Unknown',
      categories: categories || [],
      thumbnail: pageImages[0]?.thumbnail || '',
      pages_count: pageCount,
      pages_ocr: 0,
      pages_translated: 0,
      dublin_core: {
        dc_identifier: [`IIIF:${manifest['@id'] || manifest_url}`],
        dc_source: manifest['@id'] || manifest_url
      },
      image_source: {
        provider: 'iiif',
        provider_name: providerName,
        source_url: manifest['@id'] || manifest_url,
        iiif_manifest: manifest_url,
        license,
        license_url,
        attribution: creditText,
        access_date: new Date(),
        ...(start_page || end_page ? { page_range: `${startIdx + 1}-${endIdx}` } : {}),
      },
      status: 'draft',
      created_at: new Date(),
      updated_at: new Date()
    };

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
          language: language || 'Unknown',
          model: null,
          data: ''
        },
        translation: {
          language: 'English',
          model: null,
          data: ''
        },
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    await db.collection('pages').insertMany(pageDocs);

    // Notify search engines of new book via IndexNow (non-blocking)
    notifyBookImport(bookIdStr).catch(console.error);

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
}
