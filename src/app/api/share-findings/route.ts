import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { guardPublicSubmission } from '@/lib/public-submission-guard';

/**
 * "Share back" — a lightweight submission inbox, modeled on /api/feedback.
 *
 * Once a reader or an AI research agent has assembled a thesis backed by an
 * ordered set of passages across several books, they can share it back to the
 * library. We store REFERENCES ({book_id, page, note}), never copied text —
 * the canonical quote stays authoritative and links stay live. This is an
 * inbox the team reviews (and may later curate into a published collection),
 * NOT a public publishing surface — so there's no auth, ownership, visibility
 * tier, or moderation to build. See issue #2821.
 */

interface CitationInput {
  book_id?: unknown;
  page?: unknown;
  note?: unknown;
}

const MAX_CITATIONS = 50;

// POST /api/share-findings — submit a dossier (anonymous, like feedback)
export async function POST(request: NextRequest) {
  try {
    const limited = await guardPublicSubmission(request, 'share-findings');
    if (limited) return limited;

    const body = await request.json();
    const { title, summary, citations, name, email } = body as {
      title?: unknown; summary?: unknown; citations?: unknown; name?: unknown; email?: unknown;
    };

    if (!title || typeof title !== 'string' || title.trim().length < 2) {
      return NextResponse.json({ error: 'A title (min 2 chars) is required' }, { status: 400 });
    }
    if (title.length > 300) {
      return NextResponse.json({ error: 'Title too long (max 300)' }, { status: 400 });
    }
    if (summary !== undefined && (typeof summary !== 'string' || summary.length > 5000)) {
      return NextResponse.json({ error: 'Summary must be a string under 5000 chars' }, { status: 400 });
    }
    if (!Array.isArray(citations) || citations.length === 0) {
      return NextResponse.json({ error: 'At least one citation { book_id, page } is required' }, { status: 400 });
    }
    if (citations.length > MAX_CITATIONS) {
      return NextResponse.json({ error: `Too many citations (max ${MAX_CITATIONS})` }, { status: 400 });
    }

    // Validate + normalize each citation. We store only the reference, so the
    // rendered quote is always re-derived from the canonical (wrapper-stripped)
    // page text at view time — copied text is never persisted here.
    const cleanCitations: { book_id: string; page: number; note: string | null }[] = [];
    for (const c of citations as CitationInput[]) {
      const bookId = typeof c.book_id === 'string' ? c.book_id.trim() : '';
      const page = Number(c.page);
      if (!bookId || !Number.isInteger(page) || page < 1) {
        return NextResponse.json(
          { error: 'Each citation needs a non-empty book_id and a positive integer page' },
          { status: 400 },
        );
      }
      const note = typeof c.note === 'string' ? c.note.trim().slice(0, 1000) : null;
      cleanCitations.push({ book_id: bookId, page, note: note || null });
    }

    const db = await getDb();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

    const doc = {
      title: title.trim(),
      summary: typeof summary === 'string' ? summary.trim() || null : null,
      citations: cleanCitations,
      name: typeof name === 'string' ? name.trim() || null : null,
      email: typeof email === 'string' ? email.trim().toLowerCase() || null : null,
      ip,
      user_agent: request.headers.get('user-agent') || null,
      created_at: new Date(),
      read: false,
    };

    const result = await db.collection('shared_findings').insertOne(doc);

    return NextResponse.json({
      ok: true,
      id: result.insertedId.toString(),
      message: 'Thank you — your findings were shared with the Source Library team.',
    });
  } catch (error) {
    console.error('Share-findings error:', error);
    return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 });
  }
}

// GET /api/share-findings — list submissions (admin only; contains IPs/emails)
//   ?status=unread|read   filter by lifecycle state (default: all)
export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500);

    const filter: Record<string, unknown> =
      status === 'unread' ? { read: { $ne: true } } :
      status === 'read' ? { read: true } : {};

    const db = await getDb();
    const [items, unread, read] = await Promise.all([
      db.collection('shared_findings').find(filter).sort({ created_at: -1 }).limit(limit).toArray(),
      db.collection('shared_findings').countDocuments({ read: { $ne: true } }),
      db.collection('shared_findings').countDocuments({ read: true }),
    ]);

    return NextResponse.json({
      findings: items.map((d) => ({ ...d, _id: (d._id as { toString(): string }).toString() })),
      counts: { unread, read },
    });
  } catch (error) {
    console.error('Share-findings list error:', error);
    return NextResponse.json({ error: 'Failed to list submissions' }, { status: 500 });
  }
});
