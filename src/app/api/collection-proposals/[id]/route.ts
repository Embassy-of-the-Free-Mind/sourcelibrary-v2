import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { createCollection } from '@/lib/create-collection';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/**
 * POST /api/collection-proposals/[id] — admin action on a proposal (#3185).
 *
 * body.action = 'approve' | 'reject'
 *   approve: mints a HIDDEN draft collection (visible:false) from the proposal,
 *            tagging the proposed books, then marks the proposal approved.
 *            Optional overrides: title, slug, description.
 *   reject:  marks the proposal rejected with an optional note. No collection.
 *
 * A proposal can only be acted on while `pending`. Approve is idempotency-guarded
 * by the collections slug-uniqueness check (returns 409 on a taken slug).
 */
export const POST = withAdminAuth(async (
  request: NextRequest,
  session,
  context?: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await context!.params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
    }

    const db = await getDb();
    const proposal = await db.collection('collection_proposals').findOne({ _id: new ObjectId(id) });
    if (!proposal) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (proposal.status !== 'pending') {
      return NextResponse.json(
        { error: `Proposal already ${proposal.status}` },
        { status: 409 },
      );
    }

    const reviewer = (session?.user as { email?: string } | undefined)?.email || null;
    const now = new Date();
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) || null : null;

    if (action === 'reject') {
      await db.collection('collection_proposals').updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'rejected', reviewed_by: reviewer, reviewed_at: now, review_note: note } },
      );
      return NextResponse.json({ ok: true, status: 'rejected' });
    }

    // approve — allow admin overrides, else fall back to the proposal's own values.
    const title =
      typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : (proposal.title as string);
    const description =
      typeof body?.description === 'string' && body.description.trim()
        ? body.description.trim()
        : (proposal.rationale as string);
    const slug =
      (typeof body?.slug === 'string' && body.slug.trim() && slugify(body.slug)) ||
      (proposal.suggested_slug as string | null) ||
      slugify(title);

    if (!slug) {
      return NextResponse.json({ error: 'Could not derive a slug — provide one' }, { status: 400 });
    }

    let result;
    try {
      result = await createCollection({
        slug,
        name: title,
        description,
        bookIds: (proposal.book_ids as string[]) || [],
        draft: true,
        createdBy: (proposal.proposer_email as string | null) || reviewer,
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'exists') {
        return NextResponse.json({ error: (err as Error).message, code: 'slug_taken' }, { status: 409 });
      }
      throw err;
    }

    await db.collection('collection_proposals').updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: 'approved',
          reviewed_by: reviewer,
          reviewed_at: now,
          review_note: note,
          created_collection_slug: slug,
        },
      },
    );

    return NextResponse.json({
      ok: true,
      status: 'approved',
      collection_slug: slug,
      books_tagged: result.booksTagged,
      // The collection is a hidden draft — the curator flips it visible after review.
      draft: true,
      edit_url: `/admin/book-collections`,
    });
  } catch (error) {
    console.error('Collection-proposal action error:', error);
    return NextResponse.json({ error: 'Failed to process proposal' }, { status: 500 });
  }
});
