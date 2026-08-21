import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { withAuth } from '@/lib/auth-helpers';
import { resolveTenantId } from '@/lib/tenant-context';
import { getDb } from '@/lib/mongodb';
import { sanitizeReferrer } from '@/lib/reading-history-referrer';

const DB_TIMEOUT_MS = 3000;
const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

/**
 * POST /api/[tenant]/reading-history — record a page view (sendBeacon)
 * Silent no-op for anonymous users.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tenant: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: true });
    }

    const body = await request.json();
    const { book_id, page_id, page_number, referrer } = body;

    if (!book_id || !page_id || page_number == null) {
      return NextResponse.json({ success: true }); // silent fail
    }

    const { tenant } = await context.params;
    const tenantId = await resolveTenantId(tenant);
    if (!tenantId) {
      return NextResponse.json({ success: true }); // silent fail
    }

    const userId = session.user.id;
    const now = new Date();
    const cleanReferrer = sanitizeReferrer(referrer);

    const dbWork = (async () => {
      const db = await getDb();
      const collection = db.collection('reading_history');
      const cutoff = new Date(now.getTime() - SESSION_GAP_MS);

      // Session collapse: find recent entry for same user+book
      const existing = await collection.findOne(
        {
          user_id: userId,
          book_id,
          tenantId,
          updated_at: { $gte: cutoff },
        },
        { sort: { updated_at: -1 } }
      );

      if (existing) {
        await collection.updateOne(
          { _id: existing._id },
          {
            $set: {
              last_page_id: page_id,
              last_page_number: page_number,
              updated_at: now,
            },
            $inc: { pages_viewed: 1 },
            $addToSet: { pages_read: { page_id, page_number } },
          }
        );
      } else {
        await collection.insertOne({
          user_id: userId,
          book_id,
          first_page_id: page_id,
          first_page_number: page_number,
          last_page_id: page_id,
          last_page_number: page_number,
          pages_viewed: 1,
          pages_read: [{ page_id, page_number }],
          started_at: now,
          updated_at: now,
          tenantId,
          // Session-opening row only — see the global twin. Empty on every row
          // written before 2026-07-29; the client never sent it until then.
          ...(cleanReferrer ? { referrer: cleanReferrer } : {}),
        });
      }
    })();

    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS)
    );

    await Promise.race([dbWork, timeout]);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}

/**
 * GET /api/[tenant]/reading-history — list reading history (auth required)
 */
export const GET = withAuth(async (request, session, context) => {
  const { tenant } = await context.params;
  const tenantId = await resolveTenantId(tenant);

  if (!tenantId) {
    return NextResponse.json({ entries: [], total: 0 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const userId = session.user!.id;

  const db = await getDb();

  const pipeline = [
    { $match: { user_id: userId, tenantId } },
    { $sort: { updated_at: -1 as const } },
    { $skip: offset },
    { $limit: limit },
    {
      $lookup: {
        from: 'books',
        let: { bid: '$book_id', tid: '$tenantId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$id', '$$bid'] },
                  { $eq: ['$tenantId', '$$tid'] },
                ],
              },
            },
          },
          {
            $project: {
              _id: 0,
              id: 1,
              title: 1,
              display_title: 1,
              author: 1,
              year: 1,
              language: 1,
              thumbnail: 1, image_display: 1,
              thumbnail_blob: 1, image_thumb: 1,
              slug: 1,
              pages_count: 1,
              pages_translated: 1,
              pages_ocr: 1,
            },
          },
        ],
        as: 'book',
      },
    },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: false } },
    {
      $project: {
        _id: 0,
        book_id: 1,
        first_page_id: 1,
        first_page_number: 1,
        last_page_id: 1,
        last_page_number: 1,
        pages_viewed: 1,
        pages_read: 1,
        started_at: 1,
        updated_at: 1,
        referrer: 1,
        book: 1,
      },
    },
  ];

  const [entries, totalResult] = await Promise.all([
    db.collection('reading_history').aggregate(pipeline).toArray(),
    db.collection('reading_history').countDocuments({ user_id: userId, tenantId }),
  ]);

  return NextResponse.json({ entries, total: totalResult, offset, limit });
});
