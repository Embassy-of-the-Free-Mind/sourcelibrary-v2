import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

/**
 * Import a book from Internet Archive
 *
 * POST /api/import/ia
 * Body: {
 *   ia_identifier: string,      // e.g., "BIUSante_pharma_res005272"
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
      ia_identifier,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      dublin_core
    } = body;

    if (!ia_identifier || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: ia_identifier, title, author' },
        { status: 400 }
      );
    }

    // Fetch metadata from Internet Archive to get page count
    const metadataUrl = `https://archive.org/metadata/${ia_identifier}`;
    const metadataRes = await fetch(metadataUrl);

    if (!metadataRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch IA metadata: ${metadataRes.status}` },
        { status: 400 }
      );
    }

    const metadata = await metadataRes.json();

    // Find the main document file (usually a PDF or DJVU) to get page count
    // Or look for JP2 files which are individual page images
    const files = metadata.files || [];

    // Look for leaf images or calculate from PDF
    let pageCount = 0;
    const jp2Files = files.filter((f: { name: string }) =>
      f.name.endsWith('.jp2') && !f.name.includes('thumb')
    );

    if (jp2Files.length > 0) {
      pageCount = jp2Files.length;
    } else {
      // Try to get from scandata.xml or estimate from file list
      const scandata = files.find((f: { name: string }) => f.name === 'scandata.xml');
      if (scandata) {
        // Fetch scandata to get page count
        const scandataRes = await fetch(`https://archive.org/download/${ia_identifier}/scandata.xml`);
        if (scandataRes.ok) {
          const scandataText = await scandataRes.text();
          const leafMatches = scandataText.match(/<page /g);
          pageCount = leafMatches ? leafMatches.length : 0;
        }
      }

      // Fallback: look for _jp2.zip which contains all pages
      if (pageCount === 0) {
        const jp2Zip = files.find((f: { name: string }) => f.name.endsWith('_jp2.zip'));
        if (jp2Zip) {
          // Estimate based on file size (rough: ~500KB per page)
          pageCount = Math.max(10, Math.floor((jp2Zip.size || 50000000) / 500000));
        }
      }
    }

    if (pageCount === 0) {
      // Default fallback
      pageCount = 100; // Will be trimmed if pages don't exist
    }

    const db = await getDb();

    // Check if book already exists
    const existing = await db.collection('books').findOne({
      $or: [
        { ia_identifier },
        { title },
        { 'dublin_core.dc_identifier': `IA:${ia_identifier}` }
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

    // IA image URL pattern
    const getPageImageUrl = (pageNum: number) =>
      `https://archive.org/download/${ia_identifier}/page/n${pageNum}/full/pct:50/0/default.jpg`;

    const getThumbnailUrl = (pageNum: number) =>
      `https://archive.org/download/${ia_identifier}/page/n${pageNum}/full/pct:15/0/default.jpg`;

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
      ia_identifier,
      thumbnail: getThumbnailUrl(0),
      dublin_core: dublin_core || {
        dc_identifier: [`IA:${ia_identifier}`],
        dc_source: `https://archive.org/details/${ia_identifier}`
      },
      image_source: {
        provider: 'internet_archive',
        provider_name: 'Internet Archive',
        source_url: `https://archive.org/details/${ia_identifier}`,
        identifier: ia_identifier,
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
      ia_identifier,
      pagesCreated: pageDocs.length,
      bookUrl: `/book/${bookIdStr}`,
      iaUrl: `https://archive.org/details/${ia_identifier}`,
      message: `Created book with ${pageDocs.length} pages from Internet Archive`
    });

  } catch (error) {
    console.error('IA Import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
}
