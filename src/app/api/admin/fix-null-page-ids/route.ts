import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Fix pages with null IDs by setting id = _id.toHexString()
 *
 * GET - Preview pages with null IDs
 * POST - Fix them
 */
export async function GET() {
  try {
    const db = await getDb();

    const nullIdPages = await db.collection('pages').find(
      { $or: [{ id: null }, { id: { $exists: false } }] },
      { projection: { _id: 1, book_id: 1, page_number: 1 } }
    ).limit(100).toArray();

    return NextResponse.json({
      count: nullIdPages.length,
      sample: nullIdPages.slice(0, 10)
    });
  } catch (error) {
    console.error('Error finding null ID pages:', error);
    return NextResponse.json({ error: 'Failed to find pages' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const deleteOrphans = searchParams.get('delete') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50');

    const db = await getDb();

    // Process in chunks to avoid timeout
    const nullIdPages = await db.collection('pages').find(
      { $or: [{ id: null }, { id: { $exists: false } }] }
    ).limit(limit).toArray();

    if (nullIdPages.length === 0) {
      return NextResponse.json({ message: 'No pages with null IDs found' });
    }

    // Get unique book_ids and check which exist in one query
    const bookIds = [...new Set(nullIdPages.map(p => p.book_id).filter(Boolean))];
    const existingBooks = await db.collection('books').find(
      { id: { $in: bookIds } },
      { projection: { id: 1 } }
    ).toArray();
    const existingBookIds = new Set(existingBooks.map(b => b.id));

    // Categorize pages
    const toFix = nullIdPages.filter(p => p.book_id && existingBookIds.has(p.book_id));
    const orphaned = nullIdPages.filter(p => !p.book_id || !existingBookIds.has(p.book_id));

    // Bulk fix pages with valid books
    if (toFix.length > 0) {
      const bulkOps = toFix.map(page => ({
        updateOne: {
          filter: { _id: page._id },
          update: { $set: { id: page._id.toHexString() } }
        }
      }));
      await db.collection('pages').bulkWrite(bulkOps);
    }

    // Optionally delete orphans
    let deleted = 0;
    if (deleteOrphans && orphaned.length > 0) {
      const orphanIds = orphaned.map(p => p._id);
      const result = await db.collection('pages').deleteMany({ _id: { $in: orphanIds } });
      deleted = result.deletedCount;
    }

    // Retry creating the unique index
    let indexResult = 'not attempted';
    if (toFix.length > 0 || deleted > 0) {
      try {
        await db.collection('pages').createIndex(
          { id: 1 },
          { name: 'pages_id_idx', background: true, unique: true }
        );
        indexResult = 'created';
      } catch (e) {
        const err = e as Error;
        indexResult = err.message;
      }
    }

    // Check if there are more to process
    const remaining = await db.collection('pages').countDocuments(
      { $or: [{ id: null }, { id: { $exists: false } }] }
    );

    return NextResponse.json({
      processed: nullIdPages.length,
      fixed: toFix.length,
      deleted,
      orphaned: deleteOrphans ? 0 : orphaned.length,
      remaining,
      indexResult,
      hint: remaining > 0 ? 'Run again to process more' : undefined
    });
  } catch (error) {
    console.error('Error fixing null ID pages:', error);
    return NextResponse.json({ error: 'Failed to fix pages' }, { status: 500 });
  }
}
