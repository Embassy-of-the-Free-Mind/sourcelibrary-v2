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

    const db = await getDb();

    const nullIdPages = await db.collection('pages').find(
      { $or: [{ id: null }, { id: { $exists: false } }] }
    ).toArray();

    if (nullIdPages.length === 0) {
      return NextResponse.json({ message: 'No pages with null IDs found' });
    }

    let fixed = 0;
    let deleted = 0;
    let orphaned = 0;

    for (const page of nullIdPages) {
      // Check if book exists
      const bookExists = page.book_id
        ? await db.collection('books').findOne({ id: page.book_id })
        : null;

      if (!bookExists && deleteOrphans) {
        // Delete orphaned page
        await db.collection('pages').deleteOne({ _id: page._id });
        deleted++;
      } else if (!bookExists) {
        orphaned++;
      } else {
        // Fix the ID
        await db.collection('pages').updateOne(
          { _id: page._id },
          { $set: { id: page._id.toHexString() } }
        );
        fixed++;
      }
    }

    // Retry creating the unique index
    let indexResult = 'not attempted';
    if (fixed > 0 || deleted > 0) {
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

    return NextResponse.json({
      found: nullIdPages.length,
      fixed,
      deleted,
      orphaned,
      indexResult,
      hint: orphaned > 0 ? 'Run with ?delete=true to remove orphaned pages' : undefined
    });
  } catch (error) {
    console.error('Error fixing null ID pages:', error);
    return NextResponse.json({ error: 'Failed to fix pages' }, { status: 500 });
  }
}
