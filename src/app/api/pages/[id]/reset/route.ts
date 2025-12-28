import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// Reset a split page back to its original state
// This removes the crop from the original and deletes the split sibling
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pageId } = await params;
    const db = await getDb();

    // Find the page (could be left or right side of split)
    let page = await db.collection('pages').findOne({ id: pageId });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // If this is the right side (has split_from), find the original left page
    if (page.split_from) {
      const leftPage = await db.collection('pages').findOne({ id: page.split_from });
      if (leftPage) {
        page = leftPage;
      }
    }

    // Check if this page has a crop (was the left side of a split)
    if (!page.crop) {
      return NextResponse.json({
        error: 'Page is not split',
        details: 'No crop data found on this page'
      }, { status: 400 });
    }

    const bookId = page.book_id;
    const originalPageId = page.id; // This is now always the left page ID

    // Find the sibling page (the right side that was created from this split)
    const sibling = await db.collection('pages').findOne({ split_from: originalPageId });

    // Delete sibling and restore original in parallel
    await Promise.all([
      sibling ? db.collection('pages').deleteOne({ id: sibling.id }) : Promise.resolve(),
      db.collection('pages').updateOne(
        { id: originalPageId },
        {
          $unset: { crop: '', split_from: '' },
          $set: { updated_at: new Date() }
        }
      )
    ]);

    // Renumber all pages
    const allPages = await db.collection('pages')
      .find({ book_id: bookId })
      .sort({ page_number: 1 })
      .toArray();

    const renumberOps = allPages.map((p, i) => ({
      updateOne: {
        filter: { id: p.id },
        update: { $set: { page_number: i + 1 } }
      }
    }));

    if (renumberOps.length > 0) {
      await db.collection('pages').bulkWrite(renumberOps);
    }

    // Update book page count
    await db.collection('books').updateOne(
      { id: bookId },
      { $set: { pages: allPages.length } }
    );

    return NextResponse.json({
      success: true,
      deletedSibling: sibling?.id || null,
      totalPages: allPages.length
    });
  } catch (error) {
    console.error('Error resetting split page:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reset failed' },
      { status: 500 }
    );
  }
}
