import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { withAuth } from '@/lib/auth-helpers';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { getDb } from '@/lib/mongodb';
import { sanitizeReferrer } from '@/lib/reading-history-referrer';

const DB_TIMEOUT_MS = 3000;
const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

/**
 * POST /api/reading-history — record a page view (sendBeacon)
 *
 * The proxy attaches a tenant header on tenant subdomains and `/[tenant]/`
 * paths. For canonical `/book/{slug}` URLs there is no tenant in the path and
 * no referer slug to infer from, so we resolve the tenant from the book
 * itself — same pattern the likes route uses.
 *
 * Silent no-op for anonymous users.
 */
export async function POST(request: NextRequest) {
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

    const userId = session.user.id;
    const now = new Date();
    const cleanReferrer = sanitizeReferrer(referrer);

    const dbWork = (async () => {
      const db = await getDb();

      // Tenant from proxy header if available; otherwise look up the book.
      // Global (non-tenant) books legitimately have no tenantId — we still
      // record their history with tenantId: null. Only bail when the book
      // itself can't be resolved (unknown id/slug).
      let tenantId = getTenantContextFromRequest(request).id;
      let resolvedBookId = book_id;
      if (!tenantId) {
        const book = await db.collection('books').findOne(
          { $or: [{ id: book_id }, { slug: book_id }] },
          { projection: { id: 1, tenantId: 1 } }
        );
        if (!book) return; // unknown book — silent fail
        tenantId = (book.tenantId as string) || null;
        if (book.id) resolvedBookId = book.id as string;
      }

      const collection = db.collection('reading_history');
      const cutoff = new Date(now.getTime() - SESSION_GAP_MS);

      // Session collapse: find recent entry for same user+book
      const existing = await collection.findOne(
        {
          user_id: userId,
          book_id: resolvedBookId,
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
          book_id: resolvedBookId,
          first_page_id: page_id,
          first_page_number: page_number,
          last_page_id: page_id,
          last_page_number: page_number,
          pages_viewed: 1,
          pages_read: [{ page_id, page_number }],
          started_at: now,
          updated_at: now,
          tenantId,
          // Only ever set on the row that OPENS a session, so this records the
          // surface the reader entered the book from rather than the last page
          // they turned. Empty on every row written before 2026-07-29 — the
          // client did not send it until then.
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
 * GET /api/reading-history — list reading history (auth required).
 *
 * Scopes to the tenant if the proxy injected a tenant header (e.g. on
 * bph.sourcelibrary.org or /[tenant]/reading-history). On the canonical
 * /reading-history page there is no tenant context and we show every book
 * the user has read across the library.
 */
export const GET = withAuth(async (request, session) => {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
  const offset = parseInt(searchParams.get('offset') || '0');
  const userId = session.user!.id as string;
  const { id: tenantId } = getTenantContextFromRequest(request);

  const baseMatch: Record<string, string> = { user_id: userId };
  if (tenantId) baseMatch.tenantId = tenantId;

  const db = await getDb();

  const pipeline = [
    { $match: baseMatch },
    { $sort: { updated_at: -1 as const } },
    { $skip: offset },
    { $limit: limit },
    {
      $lookup: {
        from: 'books',
        let: { bid: '$book_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$id', '$$bid'] } } },
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
    db.collection('reading_history').countDocuments(baseMatch),
  ]);

  return NextResponse.json({ entries, total: totalResult, offset, limit });
});
