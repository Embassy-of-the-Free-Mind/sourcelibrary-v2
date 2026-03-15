import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { scoreBooksKdp } from '@/lib/kdp-scoring';

/**
 * POST /api/admin/kdp/score — Batch compute KDP scores
 */
export const POST = withAdminAuth(async (request: NextRequest) => {
  try {
    const db = await getDb();
    const body = await request.json().catch(() => ({}));
    const bookIds = body.bookIds as string[] | undefined;

    const result = await scoreBooksKdp(db, { bookIds });

    return NextResponse.json({
      scored: result.scored,
      topBooks: result.topBooks,
    });
  } catch (error) {
    console.error('KDP score error:', error);
    return NextResponse.json({ error: 'Failed to compute scores' }, { status: 500 });
  }
});

export const maxDuration = 60;
