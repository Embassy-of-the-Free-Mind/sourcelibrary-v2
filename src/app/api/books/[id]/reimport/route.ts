import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

/**
 * Re-import a book from its original source
 * 
 * POST /api/books/[id]/reimport
 * Body: {
 *   mode: 'full' | 'soft'
 *   - full: Delete all pages and re-import from IA (requires ia_identifier)
 *   - soft: Clear all OCR/translation/summary data, keep page images
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const body = await request.json();
    const { mode = 'soft' } = body as { mode?: 'full' | 'soft' };

    const db = await getDb();

    // Get the book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    if (mode === 'soft') {
      // Soft reset: Clear OCR, translation, and summary from all pages
      const result = await db.collection('pages').updateMany(
        { book_id: bookId },
        {
          $set: {
            'ocr.data': '',
            'ocr.model': null,
            'translation.data': '',
            'translation.model': null,
            'summary': null,
            'modernized': null,
            updated_at: new Date()
          }
        }
      );

      return NextResponse.json({
        success: true,
        mode: 'soft',
        pagesReset: result.modifiedCount,
        message: `Cleared OCR/translation data from ${result.modifiedCount} pages`
      });
    }

    if (mode === 'full') {
      const iaIdentifier = book.ia_identifier;
      const imageSource = book.image_source;

      // Check if we have a source to reimport from
      if (!iaIdentifier && imageSource?.provider !== 'internet_archive') {
        return NextResponse.json({
          error: 'Full reimport requires Internet Archive source (ia_identifier)',
          suggestion: 'Use mode=soft to clear OCR/translation data instead'
        }, { status: 400 });
      }

      const identifier = iaIdentifier || imageSource?.identifier;
      if (!identifier) {
        return NextResponse.json({
          error: 'No source identifier found',
        }, { status: 400 });
      }

      // Fetch fresh metadata from IA
      const metadataUrl = `https://archive.org/metadata/${identifier}`;
      const metadataRes = await fetch(metadataUrl);

      if (!metadataRes.ok) {
        return NextResponse.json({
          error: `Failed to fetch IA metadata: ${metadataRes.status}`
        }, { status: 400 });
      }

      const metadata = await metadataRes.json();
      const files = metadata.files || [];

      // Get page count
      let pageCount = 0;
      const jp2Files = files.filter((f: { name: string }) =>
        f.name.endsWith('.jp2') && !f.name.includes('thumb')
      );

      if (jp2Files.length > 0) {
        pageCount = jp2Files.length;
      } else {
        const scandata = files.find((f: { name: string }) => f.name === 'scandata.xml');
        if (scandata) {
          const scandataRes = await fetch(`https://archive.org/download/${identifier}/scandata.xml`);
          if (scandataRes.ok) {
            const scandataText = await scandataRes.text();
            const leafMatches = scandataText.match(/<page /g);
            pageCount = leafMatches ? leafMatches.length : 0;
          }
        }

        if (pageCount === 0) {
          const jp2Zip = files.find((f: { name: string }) => f.name.endsWith('_jp2.zip'));
          if (jp2Zip) {
            pageCount = Math.max(10, Math.floor((jp2Zip.size || 50000000) / 500000));
          }
        }
      }

      if (pageCount === 0) {
        pageCount = 100;
      }

      // Delete existing pages
      const deleteResult = await db.collection('pages').deleteMany({ book_id: bookId });

      // Create fresh pages
      const getPageImageUrl = (pageNum: number) =>
        `https://archive.org/download/${identifier}/page/n${pageNum}/full/pct:50/0/default.jpg`;

      const getThumbnailUrl = (pageNum: number) =>
        `https://archive.org/download/${identifier}/page/n${pageNum}/full/pct:15/0/default.jpg`;

      const pageDocs = [];
      for (let i = 0; i < pageCount; i++) {
        const pageId = new ObjectId();
        pageDocs.push({
          _id: pageId,
          id: pageId.toHexString(),
          tenant_id: 'default',
          book_id: bookId,
          page_number: i + 1,
          photo: getPageImageUrl(i),
          thumbnail: getThumbnailUrl(i),
          photo_original: getPageImageUrl(i),
          ocr: {
            language: book.language || 'Unknown',
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

      // Update book with fresh import timestamp
      await db.collection('books').updateOne(
        { id: bookId },
        {
          $set: {
            updated_at: new Date(),
            thumbnail: getThumbnailUrl(0),
            'image_source.access_date': new Date()
          }
        }
      );

      return NextResponse.json({
        success: true,
        mode: 'full',
        pagesDeleted: deleteResult.deletedCount,
        pagesCreated: pageDocs.length,
        source: `https://archive.org/details/${identifier}`,
        message: `Re-imported ${pageDocs.length} pages from Internet Archive`
      });
    }

    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });

  } catch (error) {
    console.error('Reimport error:', error);
    return NextResponse.json({ error: 'Reimport failed', details: String(error) }, { status: 500 });
  }
}
