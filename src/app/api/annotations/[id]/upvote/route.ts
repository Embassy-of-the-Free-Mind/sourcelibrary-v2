import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import crypto from 'crypto';

// Generate a consistent identifier for anonymous users based on IP
function getAnonymousId(request: NextRequest): string {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
    request.headers.get('x-real-ip') ||
    'unknown';
  // Hash the IP for privacy
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

// POST /api/annotations/[id]/upvote - Toggle upvote on an annotation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    // User ID from auth, or anonymous ID based on IP
    const userId = body.user_id || getAnonymousId(request);

    const db = await getDb();

    const annotation = await db.collection('annotations').findOne({ id });

    if (!annotation) {
      return NextResponse.json(
        { error: 'Annotation not found' },
        { status: 404 }
      );
    }

    const upvotedBy: string[] = annotation.upvoted_by || [];
    const hasUpvoted = upvotedBy.includes(userId);

    if (hasUpvoted) {
      // Remove upvote
      await db.collection('annotations').updateOne(
        { id },
        {
          $inc: { upvotes: -1 },
          $pull: { upvoted_by: userId },
        }
      );
      return NextResponse.json({
        upvoted: false,
        upvotes: annotation.upvotes - 1,
      });
    } else {
      // Add upvote
      await db.collection('annotations').updateOne(
        { id },
        {
          $inc: { upvotes: 1 },
          $push: { upvoted_by: userId },
        }
      );
      return NextResponse.json({
        upvoted: true,
        upvotes: annotation.upvotes + 1,
      });
    }
  } catch (error) {
    console.error('Error toggling upvote:', error);
    return NextResponse.json(
      { error: 'Failed to toggle upvote' },
      { status: 500 }
    );
  }
}
