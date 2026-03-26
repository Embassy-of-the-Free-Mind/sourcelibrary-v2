import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { withAuth } from '@/lib/auth-helpers';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { queuePreviewOcr } from '@/lib/preview-ocr';
import { normalizeTitle, normalizeAuthor, sourceFingerprint, checkDuplicate } from '@/lib/dedup';

export const maxDuration = 300;

interface WellcomeWork {
  id: string;
  title: string;
  alternativeTitles?: Array<{ title: string }>;
  contributors?: Array<{ agent: { label: string }; roles?: Array<{ label: string }> }>;
  production?: Array<{ dates?: Array<{ label: string }> }>;
  languages?: Array<{ label: string }>;
  subjects?: Array<{ label: string }>;
  items?: Array<{
    locations?: Array<{
      url?: string;
      locationType?: { id: string };
      license?: { id: string; url: string };
    }>;
  }>;
}

interface IIIFManifest {
  label?: string | { '@value'?: string }[];
  description?: string | { '@value'?: string }[];
  license?: string;
  attribution?: string;
  sequences?: Array<{
    canvases?: Array<{
      '@id'?: string;
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

/**
 * Import a book from Wellcome Collection via IIIF
 *
 * POST /api/import/wellcome
 * Body: {
 *   work_id: string,        // Wellcome work ID (e.g., "pqusmy2a")
 *   title?: string,         // Override title
 *   author?: string,        // Override author
 *   language?: string,
 *   published?: string,
 *   categories?: string[]
 * }
 */
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const {
      work_id,
      title: titleOverride,
      author: authorOverride,
      language: languageOverride,
      published: publishedOverride,
      categories,
    } = body;

    if (!work_id) {
      return NextResponse.json(
        { error: 'Missing required field: work_id' },
        { status: 400 }
      );
    }

    // Fetch work details from Wellcome Catalogue API
    const workRes = await fetch(
      `https://api.wellcomecollection.org/catalogue/v2/works/${work_id}?include=items`
    );

    if (!workRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch Wellcome work: ${workRes.status}` },
        { status: 400 }
      );
    }

    const work: WellcomeWork = await workRes.json();

    // Find IIIF presentation URL
    const iiifLocation = work.items
      ?.flatMap(item => item.locations || [])
      .find(loc => loc.locationType?.id === 'iiif-presentation');

    if (!iiifLocation?.url) {
      return NextResponse.json(
        { error: 'No IIIF presentation available for this work' },
        { status: 400 }
      );
    }

    const manifestUrl = iiifLocation.url;

    // Fetch IIIF manifest
    const manifestRes = await fetch(manifestUrl, {
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
        { wellcome_id: work_id },
        { 'dublin_core.dc_identifier': `WELLCOME:${work_id}` }
      ]
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Book already exists', existingId: existing.id || existing._id.toString() },
        { status: 409 }
      );
    }

    // Extract metadata from work
    const title = titleOverride || work.title || 'Untitled';
    const author = authorOverride ||
      work.contributors?.find(c => c.roles?.some(r => r.label === 'author'))?.agent.label ||
      work.contributors?.[0]?.agent.label ||
      'Unknown';
    const published = publishedOverride ||
      work.production?.[0]?.dates?.[0]?.label ||
      'Unknown';
    const language = languageOverride ||
      work.languages?.[0]?.label ||
      'Unknown';

    // Cross-source dedup check
    const dedupResult = await checkDuplicate(db, {
      title, author,
      image_source: { provider: 'wellcome', identifier: work_id, iiif_manifest: manifestUrl, source_url: `https://wellcomecollection.org/works/${work_id}` },
    });
    if (dedupResult.isDuplicate) {
      const best = dedupResult.matches[0];
      return NextResponse.json(
        { error: `Duplicate detected (${best.matchType}): matches "${best.matchedTitle}"`, existingId: best.matchedBookId, matches: dedupResult.matches },
        { status: 409 }
      );
    }

    // Extract license
    const licenseId = iiifLocation.license?.id || 'unknown';
    const licenseUrl = iiifLocation.license?.url || null;

    // Create book
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();

    // Extract b-number from manifest URL for image construction
    // URL pattern: https://iiif.wellcomecollection.org/presentation/v2/b18709436
    const bNumberMatch = manifestUrl.match(/\/v2\/(b\d+)/);
    const bNumber = bNumberMatch?.[1];

    // Get image URLs from canvases
    const getPageImageUrl = (index: number) => {
      const canvas = canvases[index];
      const imageUrl = canvas?.images?.[0]?.resource?.service?.['@id'] ||
                       canvas?.images?.[0]?.resource?.['@id'];
      if (imageUrl) {
        // Use IIIF Image API for consistent sizing
        return `${imageUrl}/full/1000,/0/default.jpg`;
      }
      return null;
    };

    const getThumbnailUrl = (index: number) => {
      const canvas = canvases[index];
      const imageUrl = canvas?.images?.[0]?.resource?.service?.['@id'] ||
                       canvas?.images?.[0]?.resource?.['@id'];
      if (imageUrl) {
        return `${imageUrl}/full/200,/0/default.jpg`;
      }
      return null;
    };

    const slug = await generateUniqueBookSlug(db, title, author);

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      tenant_id: 'default',
      title,
      display_title: null,
      author,
      language,
      published,
      categories: categories || work.subjects?.map(s => s.label) || [],
      ...(work_id ? { work_id } : {}),
      wellcome_id: work_id,
      wellcome_b_number: bNumber,
      thumbnail: getThumbnailUrl(0),
      pageCount,
      pages_count: pageCount,
      dublin_core: {
        dc_identifier: [`WELLCOME:${work_id}`],
        dc_source: `https://wellcomecollection.org/works/${work_id}`
      },
      image_source: {
        provider: 'wellcome',
        provider_name: 'Wellcome Collection',
        source_url: `https://wellcomecollection.org/works/${work_id}`,
        iiif_manifest: manifestUrl,
        identifier: work_id,
        license: licenseId,
        license_url: licenseUrl,
        attribution: 'Wellcome Collection',
        access_date: new Date(),
      },
      status: 'draft',
      hidden: true,
      source_fingerprint: sourceFingerprint({ image_source: { provider: 'wellcome', identifier: work_id, iiif_manifest: manifestUrl } }),
      normalized_title: normalizeTitle(title),
      normalized_author: normalizeAuthor(author),
      created_at: new Date(),
      updated_at: new Date()
    };

    await db.collection('books').insertOne(bookDoc);

    // Create pages
    const pageDocs = [];
    for (let i = 0; i < pageCount; i++) {
      const pageId = new ObjectId();
      const photoUrl = getPageImageUrl(i);
      const thumbUrl = getThumbnailUrl(i);

      pageDocs.push({
        _id: pageId,
        id: pageId.toHexString(),
        tenant_id: 'default',
        book_id: bookIdStr,
        page_number: i + 1,
        photo: photoUrl,
        thumbnail: thumbUrl,
        photo_original: photoUrl,
        // Don't initialize ocr/translation with empty strings -- they cause
        // false completion in job-completion.ts (see: translation loop bug fix)
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    await db.collection('pages').insertMany(pageDocs);

    // Queue preview OCR for early metadata enrichment (non-blocking)
    queuePreviewOcr(bookIdStr, title).catch(() => {});

    // Audit log (non-blocking)
    logAuditEvent({
      action: 'book_imported',
      book_id: bookIdStr,
      book_title: title,
      pages_affected: pageDocs.length,
      metadata: { provider: 'wellcome', identifier: work_id },
    });

    // Fire off split detection check (non-blocking)
    const baseUrl = process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : request.headers.get('origin') || 'http://localhost:3000';

    fetch(`${baseUrl}/api/books/${bookIdStr}/check-needs-split`, {
      method: 'GET',
    }).catch(() => {
      console.log(`[Import] Split check queued for ${bookIdStr}`);
    });

    // Notify search engines of new book via IndexNow (non-blocking)
    notifyBookImport(bookIdStr, slug).catch(console.error);

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      title,
      author,
      wellcome_id: work_id,
      pagesCreated: pageDocs.length,
      bookUrl: `/book/${bookIdStr}`,
      wellcomeUrl: `https://wellcomecollection.org/works/${work_id}`,
      splitCheckQueued: true,
      message: `Created book with ${pageDocs.length} pages from Wellcome Collection. Split detection queued.`
    });

  } catch (error) {
    console.error('Wellcome Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
