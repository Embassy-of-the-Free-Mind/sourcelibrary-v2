import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { notifyBookImport } from '@/lib/indexnow';

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
export async function POST(request: NextRequest) {
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
    const manifestRes = await fetch(manifestUrl);

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

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      tenant_id: 'default',
      title,
      display_title: null,
      author,
      language,
      published,
      categories: categories || work.subjects?.map(s => s.label) || [],
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
        ocr: {
          language: language,
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
    notifyBookImport(bookIdStr).catch(console.error);

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
}
