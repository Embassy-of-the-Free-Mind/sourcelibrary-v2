import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// Batch reset multiple split pages back to original state
// Much faster than calling individual reset for each page
export async function POST(request: NextRequest) {
  try {
    const { pageIds }: { pageIds: string[] } = await request.json();

    if (!pageIds || pageIds.length === 0) {
      return NextResponse.json({ error: 'No page IDs provided' }, { status: 400 });
    }

    const db = await getDb();

    // Find all pages to reset
    const pages = await db.collection('pages')
      .find({ id: { $in: pageIds }, crop: { $exists: true } })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No split pages found' }, { status: 404 });
    }

    const bookId = pages[0].book_id;
    const pageIdsToReset = pages.map(p => p.id);

    // Find all siblings (right halves) in one query
    const siblings = await db.collection('pages')
      .find({ split_from: { $in: pageIdsToReset } })
      .toArray();
    const siblingIds = siblings.map(s => s.id);

    // Delete all siblings and reset all originals in parallel
    await Promise.all([
      siblingIds.length > 0
        ? db.collection('pages').deleteMany({ id: { $in: siblingIds } })
        : Promise.resolve(),
      db.collection('pages').updateMany(
        { id: { $in: pageIdsToReset } },
        {
          $unset: { crop: '', split_from: '' },
          $set: { updated_at: new Date() }
        }
      )
    ]);

    // Renumber all pages ONCE at the end
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
      resetCount: pages.length,
      deletedCount: siblingIds.length,
      totalPages: allPages.length
    });
  } catch (error) {
    console.error('Error batch resetting pages:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch reset failed' },
      { status: 500 }
    );
  }
}
