import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';


// GET - List all jobs (with optional filters)
export const GET = withAdminAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const bookId = searchParams.get('book_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const db = await getDb();

    const query: Record<string, unknown> = {};
    if (status) query.status = status;
    if (type) query.type = type;
    if (bookId) query.book_id = bookId;

    const jobs = await db.collection('jobs')
      .find(query)
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({
      jobs: jobs.map(j => ({
        ...j,
        id: j.id || j._id?.toString(),
      })),
    });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
});