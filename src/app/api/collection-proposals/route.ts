import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { guardPublicSubmission } from '@/lib/public-submission-guard';

/**
 * "Propose a collection" — a lightweight submission inbox, modeled on
 * /api/share-findings (#2821) and /api/feedback.
 *
 * Anyone browsing the library (via the MCP `propose_collection` tool or a form)
 * can propose a themed collection: a title, a rationale, and an ordered list of
 * book id REFERENCES. This is UNTRUSTED input and an inbox the team reviews —
 * NOT a public publishing surface. A proposal never creates anything on its own;
 * an admin reviews it and, on approval, mints the real collection
 * (POST /api/collection-proposals/[id]/approve). See issue #3185.
 */

const MAX_BOOK_IDS = 200;
const MAX_TITLE = 200;
const MAX_RATIONALE = 5000;

// POST /api/collection-proposals — submit a proposal (anonymous, like feedback)
export async function POST(request: NextRequest) {
  try {
    const limited = await guardPublicSubmission(request, 'collection-proposals');
    if (limited) return limited;

    const body = await request.json();
    const { title, rationale, book_ids, suggested_slug, name, email } = body as {
      title?: unknown;
      rationale?: unknown;
      book_ids?: unknown;
      suggested_slug?: unknown;
      name?: unknown;
      email?: unknown;
    };

    if (!title || typeof title !== 'string' || title.trim().length < 2) {
      return NextResponse.json({ error: 'A title (min 2 chars) is required' }, { status: 400 });
    }
    if (title.length > MAX_TITLE) {
      return NextResponse.json({ error: `Title too long (max ${MAX_TITLE})` }, { status: 400 });
    }
    if (!rationale || typeof rationale !== 'string' || rationale.trim().length < 2) {
      return NextResponse.json(
        { error: 'A rationale (why these books belong together) is required' },
        { status: 400 },
      );
    }
    if (rationale.length > MAX_RATIONALE) {
      return NextResponse.json({ error: `Rationale too long (max ${MAX_RATIONALE})` }, { status: 400 });
    }
    if (!Array.isArray(book_ids) || book_ids.length === 0) {
      return NextResponse.json({ error: 'At least one book_id is required' }, { status: 400 });
    }
    if (book_ids.length > MAX_BOOK_IDS) {
      return NextResponse.json({ error: `Too many books (max ${MAX_BOOK_IDS})` }, { status: 400 });
    }

    // Normalize book id references — store strings only, de-duplicated, order preserved.
    const seen = new Set<string>();
    const cleanBookIds: string[] = [];
    for (const raw of book_ids) {
      const id = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      cleanBookIds.push(id);
    }
    if (cleanBookIds.length === 0) {
      return NextResponse.json({ error: 'No valid book_ids provided' }, { status: 400 });
    }

    const slugHint =
      typeof suggested_slug === 'string' && suggested_slug.trim()
        ? suggested_slug
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 100)
        : null;

    const db = await getDb();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

    const doc = {
      title: title.trim(),
      rationale: rationale.trim(),
      suggested_slug: slugHint,
      book_ids: cleanBookIds,
      proposer_name: typeof name === 'string' ? name.trim() || null : null,
      proposer_email: typeof email === 'string' ? email.trim().toLowerCase() || null : null,
      ip,
      user_agent: request.headers.get('user-agent') || null,
      created_at: new Date(),
      status: 'pending' as const,
      reviewed_by: null,
      reviewed_at: null,
      created_collection_slug: null,
      review_note: null,
    };

    const result = await db.collection('collection_proposals').insertOne(doc);

    return NextResponse.json({
      ok: true,
      id: result.insertedId.toString(),
      message:
        'Thank you — your collection proposal was sent to the Source Library team for review. ' +
        'It is not published yet; a curator will review it.',
    });
  } catch (error) {
    console.error('Collection-proposal error:', error);
    return NextResponse.json({ error: 'Failed to save proposal' }, { status: 500 });
  }
}

// GET /api/collection-proposals — list proposals (admin only; contains IPs/emails)
//   ?status=pending|approved|rejected   filter by lifecycle state (default: all)
export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500);

    const filter: Record<string, unknown> =
      status === 'pending' || status === 'approved' || status === 'rejected' ? { status } : {};

    const db = await getDb();
    const [items, pending, approved, rejected] = await Promise.all([
      db.collection('collection_proposals').find(filter).sort({ created_at: -1 }).limit(limit).toArray(),
      db.collection('collection_proposals').countDocuments({ status: 'pending' }),
      db.collection('collection_proposals').countDocuments({ status: 'approved' }),
      db.collection('collection_proposals').countDocuments({ status: 'rejected' }),
    ]);

    return NextResponse.json({
      proposals: items.map((d) => ({ ...d, _id: (d._id as { toString(): string }).toString() })),
      counts: { pending, approved, rejected },
    });
  } catch (error) {
    console.error('Collection-proposal list error:', error);
    return NextResponse.json({ error: 'Failed to list proposals' }, { status: 500 });
  }
});
