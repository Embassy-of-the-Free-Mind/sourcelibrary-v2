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

    // Find the original page
    const page = await db.collection('pages').findOne({ id: pageId });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Check if this page has a crop (was the left side of a split)
    if (!page.crop) {
      return NextResponse.json({ error: 'Page is not split' }, { status: 400 });
    }

    const bookId = page.book_id;

    // Find the sibling page (the right side that was created from this split)
    const sibling = await db.collection('pages').findOne({ split_from: pageId });

    // Delete sibling and restore original in parallel
    await Promise.all([
      sibling ? db.collection('pages').deleteOne({ id: sibling.id }) : Promise.resolve(),
      db.collection('pages').updateOne(
        { id: pageId },
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
