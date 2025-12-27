import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { cleanupEmptyTags } from '@/lib/validateTranslation';

interface CleanupResult {
  pageId: string;
  pageNumber: number;
  field: 'translation' | 'ocr';
  removedCount: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();
    const body = await request.json().catch(() => ({}));

    // Options
    const dryRun = body.dryRun === true;
    const field = body.field || 'both'; // 'translation', 'ocr', or 'both'

    // Get all pages for the book
    const pages = await db.collection('pages')
      .find({ book_id: bookId })
      .toArray();

    const results: CleanupResult[] = [];
    let totalRemoved = 0;
    let pagesModified = 0;

    for (const page of pages) {
      const fieldsToClean = field === 'both'
        ? ['translation', 'ocr'] as const
        : [field as 'translation' | 'ocr'];

      for (const f of fieldsToClean) {
        const text = page[f]?.data;
        if (!text) continue;

        const { cleaned, removedCount } = cleanupEmptyTags(text);

        if (removedCount > 0) {
          results.push({
            pageId: page.id,
            pageNumber: page.page_number,
            field: f,
            removedCount
          });
          totalRemoved += removedCount;

          if (!dryRun) {
            await db.collection('pages').updateOne(
              { id: page.id },
              {
                $set: {
                  [`${f}.data`]: cleaned,
                  [`${f}.updated_at`]: new Date(),
                  updated_at: new Date()
                },
                $inc: { edit_count: 1 }
              }
            );
            pagesModified++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      bookId,
      totalPages: pages.length,
      pagesModified: dryRun ? results.length : pagesModified,
      totalTagsRemoved: totalRemoved,
      results
    });
  } catch (error) {
    console.error('Error during cleanup:', error);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
