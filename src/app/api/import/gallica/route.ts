import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

interface IIIFManifest {
  label?: string;
  description?: string;
  sequences?: Array<{
    canvases?: Array<{
      images?: Array<{
        resource?: {
          '@id'?: string;
        };
      }>;
    }>;
  }>;
}

/**
 * Import a book from Gallica (BnF) via IIIF
 *
 * POST /api/import/gallica
 * Body: {
 *   ark: string,           // e.g., "bpt6k61073880" (Gallica ARK identifier)
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      ark,
      title,
      display_title,
      author,
      language,
      published,
      categories,
    } = body;

    if (!ark || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: ark, title, author' },
        { status: 400 }
      );
    }

    // Fetch IIIF manifest from Gallica
    const manifestUrl = `https://gallica.bnf.fr/iiif/ark:/12148/${ark}/manifest.json`;
    const manifestRes = await fetch(manifestUrl);

    if (!manifestRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch Gallica manifest: ${manifestRes.status}` },
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
        { gallica_ark: ark },
        { 'dublin_core.dc_identifier': `GALLICA:${ark}` }
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

    // Gallica IIIF image URL pattern
    // Full quality: /full/full/0/native.jpg
    // Reduced for display: /full/1000,/0/default.jpg
    const getPageImageUrl = (pageNum: number) =>
      `https://gallica.bnf.fr/iiif/ark:/12148/${ark}/f${pageNum + 1}/full/1000,/0/default.jpg`;

    const getThumbnailUrl = (pageNum: number) =>
      `https://gallica.bnf.fr/iiif/ark:/12148/${ark}/f${pageNum + 1}/full/200,/0/default.jpg`;

    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      tenant_id: 'default',
      title,
      display_title: display_title || null,
      author,
      language: language || 'Unknown',
      published: published || 'Unknown',
      categories: categories || [],
      gallica_ark: ark,
      thumbnail: getThumbnailUrl(0),
      pageCount,
      pages_count: pageCount,
      dublin_core: {
        dc_identifier: [`GALLICA:${ark}`],
        dc_source: `https://gallica.bnf.fr/ark:/12148/${ark}`
      },
      image_source: {
        provider: 'gallica',
        provider_name: 'Gallica (Bibliothèque nationale de France)',
        source_url: `https://gallica.bnf.fr/ark:/12148/${ark}`,
        identifier: ark,
        license: 'publicdomain',
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
        photo_original: getPageImageUrl(i),
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

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      title,
      gallica_ark: ark,
      pagesCreated: pageDocs.length,
      bookUrl: `/book/${bookIdStr}`,
      gallicaUrl: `https://gallica.bnf.fr/ark:/12148/${ark}`,
      message: `Created book with ${pageDocs.length} pages from Gallica`
    });

  } catch (error) {
    console.error('Gallica Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
}
