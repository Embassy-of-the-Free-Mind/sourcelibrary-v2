import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 15;

/**
 * GET /api/collections
 *
 * List all book collections from MongoDB, ordered by display order.
 */
export async function GET() {
  try {
    const db = await getDb();
    const collections = await db
      .collection('collections')
      .find({})
      .sort({ order: 1 })
      .toArray();

    const cleaned = collections.map(({ _id, ...rest }) => rest);

    return NextResponse.json({ collections: cleaned });
  } catch (error) {
    console.error('Collections list error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch collections' },
      { status: 500 }
    );
  }
}
