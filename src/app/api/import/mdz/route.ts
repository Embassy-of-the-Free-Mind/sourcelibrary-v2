import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { withAuth } from '@/lib/auth-helpers';
import { generateUniqueBookSlug } from '@/lib/slugify';

interface IIIFCanvas {
  '@id'?: string;
  label?: string;
  images?: Array<{
    resource?: {
      '@id'?: string;
      service?: {
        '@id'?: string;
      };
    };
  }>;
}

interface IIIFManifest {
  label?: string;
  description?: string | Array<{ '@value'?: string }>;
  license?: string | string[];
  attribution?: string | Array<{ '@value'?: string; '@language'?: string }>;
  metadata?: Array<{
    label?: string | { '@value'?: string };
    value?: string | Array<{ '@value'?: string }>;
  }>;
  sequences?: Array<{
    canvases?: IIIFCanvas[];
  }>;
}

/**
 * Import a book from MDZ (Münchener DigitalisierungsZentrum / Bavarian State Library) via IIIF
 *
 * POST /api/import/mdz
 * Body: {
 *   bsb_id: string,           // e.g., "bsb00029099" (BSB identifier)
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   year?: number,
 *   original_language?: string,
 *   categories?: string[]
 * }
 */
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const {
      bsb_id,
      title,
      display_title,
      author,
      year,
      original_language,
      categories,
      work_id,
    } = body;

    if (!bsb_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: bsb_id, title, author' },
        { status: 400 }
      );
    }

    // Normalize bsb_id (ensure it has the bsb prefix)
    const normalizedId = bsb_id.startsWith('bsb') ? bsb_id : `bsb${bsb_id}`;

    // Fetch IIIF manifest from MDZ
    const manifestUrl = `https://api.digitale-sammlungen.de/iiif/presentation/v2/${normalizedId}/manifest`;
    const manifestRes = await fetch(manifestUrl, {
      headers: {
        'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)',
        'Accept': 'application/json, application/ld+json',
      }
    });

    if (!manifestRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch MDZ manifest: ${manifestRes.status}` },
        { status: 400 }
      );
    }

    const manifest: IIIFManifest = await manifestRes.json();

    // Get page count from IIIF canvases
    const canvases = manifest.sequences?.[0]?.canvases || [];
    const pageCount = canvases.length;

    if (pageCount === 0) {
      return NextResponse.json(
        { error: 'No pages found in IIIF manifest' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Check if book already exists
    const existing = await db.collection('books').findOne({
      $or: [
        { mdz_id: normalizedId },
        { bsb_id: normalizedId },
        { 'dublin_core.dc_identifier': `MDZ:${normalizedId}` }
      ]
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Book already exists', existingId: existing.id || existing._id.toString() },
        { status: 409 }
      );
    }

    // Create book
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();

    // MDZ IIIF image URL pattern
    // Format: bsb_id_pagenum (padded to 5 digits)
    const getPageImageUrl = (pageNum: number) => {
      const paddedPage = String(pageNum + 1).padStart(5, '0');
      return `https://api.digitale-sammlungen.de/iiif/image/v2/${normalizedId}_${paddedPage}/full/1000,/0/default.jpg`;
    };

    const getThumbnailUrl = (pageNum: number) => {
      const paddedPage = String(pageNum + 1).padStart(5, '0');
      return `https://api.digitale-sammlungen.de/iiif/image/v2/${normalizedId}_${paddedPage}/full/200,/0/default.jpg`;
    };

    const getFullResUrl = (pageNum: number) => {
      const paddedPage = String(pageNum + 1).padStart(5, '0');
      return `https://api.digitale-sammlungen.de/iiif/image/v2/${normalizedId}_${paddedPage}/full/full/0/default.jpg`;
    };

    // Extract manifest title if available
    const manifestTitle = typeof manifest.label === 'string'
      ? manifest.label
      : (manifest.label as unknown as { '@value'?: string })?.['@value'] || title;

    // Extract license URL from manifest
    const licenseUrl = Array.isArray(manifest.license)
      ? manifest.license[0]
      : manifest.license || null;

    // Extract attribution from manifest (prefer English)
    let attribution: string | null = null;
    if (typeof manifest.attribution === 'string') {
      attribution = manifest.attribution;
    } else if (Array.isArray(manifest.attribution)) {
      const englishAttr = manifest.attribution.find(a => a['@language'] === 'en');
      attribution = englishAttr?.['@value'] || manifest.attribution[0]?.['@value'] || null;
    }

    const slug = await generateUniqueBookSlug(db, title, author, display_title);

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      tenant_id: 'default',
      title,
      display_title: display_title || null,
      author,
      language: original_language || 'Unknown',
      original_language: original_language || 'Unknown',
      published: year ? String(year) : 'Unknown',
      year: year || null,
      categories: categories || [],
      ...(work_id ? { work_id } : {}),
      mdz_id: normalizedId,
      bsb_id: normalizedId,
      thumbnail: getThumbnailUrl(0),
      pageCount,
      pages_count: pageCount,
      dublin_core: {
        dc_identifier: [`MDZ:${normalizedId}`, `URN:${normalizedId}`],
        dc_source: `https://www.digitale-sammlungen.de/de/view/${normalizedId}`,
        dc_title: manifestTitle,
      },
      image_source: {
        provider: 'mdz',
        provider_name: 'Münchener DigitalisierungsZentrum (Bavarian State Library)',
        source_url: `https://www.digitale-sammlungen.de/de/view/${normalizedId}`,
        iiif_manifest: manifestUrl,
        identifier: normalizedId,
        license: licenseUrl || 'publicdomain',
        license_url: licenseUrl,
        attribution: attribution,
        access_date: new Date(),
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
        photo: getPageImageUrl(i),
        thumbnail: getThumbnailUrl(i),
        photo_original: getFullResUrl(i),
        // Don't initialize ocr/translation with empty strings -- they cause
        // false completion in job-completion.ts (see: translation loop bug fix)
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    await db.collection('pages').insertMany(pageDocs);

    // Audit log (non-blocking)
    logAuditEvent({
      action: 'book_imported',
      book_id: bookIdStr,
      book_title: title,
      pages_affected: pageDocs.length,
      metadata: { provider: 'mdz', identifier: normalizedId },
    });

    // Fire off split detection check (non-blocking)
    const baseUrl = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : request.headers.get('origin') || 'http://localhost:3000';

    fetch(`${baseUrl}/api/books/${bookIdStr}/check-needs-split`, {
      method: 'GET',
    }).catch(() => {
      console.log(`[MDZ Import] Split check queued for ${bookIdStr}`);
    });

    // Notify search engines of new book via IndexNow (non-blocking)
    notifyBookImport(bookIdStr, slug).catch(console.error);

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      title,
      mdz_id: normalizedId,
      pagesCreated: pageDocs.length,
      bookUrl: `/book/${bookIdStr}`,
      mdzUrl: `https://www.digitale-sammlungen.de/de/view/${normalizedId}`,
      splitCheckQueued: true,
      message: `Created book with ${pageDocs.length} pages from MDZ (Bavarian State Library). Split detection queued.`
    });

  } catch (error) {
    console.error('MDZ Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
