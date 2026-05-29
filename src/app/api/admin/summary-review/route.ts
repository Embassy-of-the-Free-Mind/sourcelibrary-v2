/**
 * Admin review queue for re-synthesized "About This Book" summaries.
 *
 * Candidates are generated NON-DESTRUCTIVELY into `book.summary_candidate` by
 * scripts/maintenance/resynthesize-summaries.mjs. This route lets a reviewer
 * (via /platform/admin/summary-review) approve, reject, or edit them.
 *
 * IMPORTANT — what actually shows as "About This Book":
 * the book page (src/app/book/[id]/page.tsx) reads, in order,
 *   book_indexes.bookSummary.brief  ->  book.reading_summary.overview  ->  book.summary.data
 * so promotion writes to book_indexes.bookSummary AND the book doc, or the
 * page would not change. The pre-promotion text is stashed in
 * summary_candidate.replaced for rollback.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb, getReadDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface ReviewItem {
  id: string;
  title?: string;
  display_title?: string;
  author?: string;
  slug?: string;
  oldBrief: string;
  candidate: {
    brief?: string;
    abstract?: string;
    detailed?: string;
    status?: string;
    edited?: boolean;
    prompt_version?: string;
    generated_at?: Date;
  };
}

export const GET = withAdminAuth(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'pending';
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 200, 1), 500);

  const db = await getReadDb();

  const match = { 'summary_candidate.status': status };
  const books = await db.collection('books')
    .find(match)
    .project({
      id: 1, title: 1, display_title: 1, author: 1, slug: 1,
      'summary.data': 1, summary_candidate: 1, _id: 0,
    })
    .limit(limit)
    .toArray();

  // The live "About This Book" comes from book_indexes.bookSummary.brief first.
  const ids = books.map((b) => b.id);
  const idxDocs = await db.collection('book_indexes')
    .find({ book_id: { $in: ids } })
    .project({ book_id: 1, 'bookSummary.brief': 1, _id: 0 })
    .toArray();
  const idxBrief = new Map(idxDocs.map((d) => [d.book_id, d.bookSummary?.brief as string | undefined]));

  const items: ReviewItem[] = books.map((b) => ({
    id: b.id,
    title: b.title,
    display_title: b.display_title,
    author: b.author,
    slug: b.slug,
    oldBrief: idxBrief.get(b.id) || (typeof b.summary === 'string' ? b.summary : b.summary?.data) || '',
    candidate: b.summary_candidate || {},
  }));

  const counts = await db.collection('books').aggregate([
    { $match: { 'summary_candidate.status': { $exists: true } } },
    { $group: { _id: '$summary_candidate.status', n: { $sum: 1 } } },
  ]).toArray();
  const countMap: Record<string, number> = {};
  for (const c of counts) countMap[c._id] = c.n;

  return NextResponse.json({ items, counts: countMap });
});

export const POST = withAdminAuth(async (request: NextRequest, session) => {
  const body = await request.json().catch(() => null);
  if (!body?.id || !body?.action) {
    return NextResponse.json({ error: 'id and action required' }, { status: 400 });
  }
  const { id, action } = body as {
    id: string;
    action: 'approve' | 'reject' | 'save';
    brief?: string;
    abstract?: string;
    detailed?: string;
  };

  const db = await getDb();
  const books = db.collection('books');
  const book = await books.findOne({ id }, { projection: { id: 1, summary: 1, reading_summary: 1, summary_candidate: 1 } });
  if (!book) return NextResponse.json({ error: 'book not found' }, { status: 404 });

  const cand = (book.summary_candidate || {}) as Record<string, unknown>;
  const reviewer = (session.user as { email?: string })?.email || 'unknown';

  // Edits from the reviewer take precedence over the generated text.
  const brief = (body.brief ?? cand.brief ?? '') as string;
  const abstract = (body.abstract ?? cand.abstract ?? '') as string;
  const detailed = (body.detailed ?? cand.detailed ?? '') as string;
  const edited = body.brief != null || body.abstract != null || body.detailed != null;

  if (action === 'reject') {
    await books.updateOne({ id }, { $set: {
      'summary_candidate.status': 'rejected',
      'summary_candidate.reviewed_at': new Date(),
      'summary_candidate.reviewed_by': reviewer,
    } });
    return NextResponse.json({ ok: true, status: 'rejected' });
  }

  if (action === 'save') {
    // Persist edits, keep in the pending queue.
    await books.updateOne({ id }, { $set: {
      'summary_candidate.brief': brief,
      'summary_candidate.abstract': abstract,
      'summary_candidate.detailed': detailed,
      'summary_candidate.edited': true,
      'summary_candidate.status': 'pending',
    } });
    return NextResponse.json({ ok: true, status: 'pending', edited: true });
  }

  if (action === 'approve') {
    if (!brief.trim()) return NextResponse.json({ error: 'empty brief' }, { status: 400 });

    // Stash the current live text for rollback before overwriting.
    const idxDoc = await db.collection('book_indexes').findOne({ book_id: id }, { projection: { bookSummary: 1 } });
    const replaced = {
      summary: book.summary ?? null,
      reading_summary: book.reading_summary ?? null,
      bookSummary: idxDoc?.bookSummary ?? null,
    };

    // 1) book_indexes.bookSummary — this is what "About This Book" reads first.
    await db.collection('book_indexes').updateOne(
      { book_id: id },
      { $set: { 'bookSummary.brief': brief, 'bookSummary.abstract': abstract, 'bookSummary.detailed': detailed } },
    );

    // 2) book doc — the fallback surfaces (summary.data, reading_summary).
    await books.updateOne({ id }, { $set: {
      'summary.data': brief,
      'summary.generated_at': new Date(),
      'summary.model': cand.model ?? null,
      'summary.prompt_version': cand.prompt_version ?? null,
      'summary.source': 'ai-resynth-approved',
      'reading_summary.overview': abstract,
      'reading_summary.detailed': detailed,
      'summary_candidate.brief': brief,
      'summary_candidate.abstract': abstract,
      'summary_candidate.detailed': detailed,
      'summary_candidate.edited': edited,
      'summary_candidate.status': 'approved',
      'summary_candidate.reviewed_at': new Date(),
      'summary_candidate.reviewed_by': reviewer,
      'summary_candidate.replaced': replaced,
    } });

    // Best-effort page revalidation so the change shows without waiting for ISR.
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.REVALIDATE_SECRET) headers['x-revalidate-secret'] = process.env.REVALIDATE_SECRET;
      await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${id}`, { method: 'POST', headers });
    } catch { /* best-effort */ }

    return NextResponse.json({ ok: true, status: 'approved' });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
});
