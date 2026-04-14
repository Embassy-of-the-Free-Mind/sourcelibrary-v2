import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { promoteFromWarehouse } from '@/lib/warehouse';
import { randomUUID } from 'crypto';

export const maxDuration = 300;

/**
 * POST /api/admin/promote-warehouse
 *
 * Safely promote books from warehouse to live with session tagging.
 * Each promotion is tagged with a session_id so rollback is surgical.
 *
 * Body:
 *   { bookIds: string[] }           — promote specific books
 *   { filter: { ... }, limit: 100 } — promote by query (max 500)
 *
 * Response includes session_id for rollback via DELETE.
 *
 * DELETE /api/admin/promote-warehouse?session_id=xxx
 *   Demote all books from that session back to draft status.
 *   Does NOT delete — just sets status back to draft.
 */

async function handlePost(req: NextRequest) {
  const db = await getDb();
  const body = await req.json();
  const sessionId = randomUUID();

  let bookIds: string[] = [];

  if (body.bookIds && Array.isArray(body.bookIds)) {
    bookIds = body.bookIds;
  } else if (body.filter) {
    const limit = Math.min(body.limit || 100, 500);
    const candidates = await db.collection('books_warehouse')
      .find(body.filter, { projection: { id: 1 } })
      .limit(limit)
      .toArray();
    bookIds = candidates.map((b) => (b as Record<string, string>).id);
  } else {
    return NextResponse.json(
      { error: 'Provide bookIds array or filter object' },
      { status: 400 }
    );
  }

  if (bookIds.length === 0) {
    return NextResponse.json({ error: 'No books matched' }, { status: 404 });
  }

  if (bookIds.length > 500) {
    return NextResponse.json(
      { error: `Too many books (${bookIds.length}). Max 500 per session.` },
      { status: 400 }
    );
  }

  let promoted = 0;
  const failed: string[] = [];

  for (const id of bookIds) {
    try {
      const ok = await promoteFromWarehouse(db, id);
      if (ok) {
        // Tag the promoted book with this session
        await db.collection('books').updateOne(
          { id },
          { $set: { promoted_session: sessionId, promoted_at: new Date() } }
        );
        promoted++;
      } else {
        failed.push(id);
      }
    } catch {
      failed.push(id);
    }
  }

  // Audit log
  await db.collection('audit_log').insertOne({
    action: 'warehouse_promote',
    session_id: sessionId,
    promoted_count: promoted,
    failed_count: failed.length,
    timestamp: new Date(),
  });

  return NextResponse.json({
    session_id: sessionId,
    promoted,
    failed: failed.length,
    failedIds: failed.length > 0 ? failed : undefined,
    rollback: `DELETE /api/admin/promote-warehouse?session_id=${sessionId}`,
  });
}

async function handleDelete(req: NextRequest) {
  const db = await getDb();
  const sessionId = req.nextUrl.searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.json(
      { error: 'session_id query param required' },
      { status: 400 }
    );
  }

  // Find all books promoted in this session
  const books = await db.collection('books')
    .find({ promoted_session: sessionId }, { projection: { id: 1 } })
    .toArray();

  if (books.length === 0) {
    return NextResponse.json(
      { error: `No books found for session ${sessionId}` },
      { status: 404 }
    );
  }

  const bookIds = books.map((b) => (b as Record<string, string>).id);

  // Demote: set status back to draft (do NOT delete)
  const result = await db.collection('books').updateMany(
    { promoted_session: sessionId },
    {
      $set: { status: 'draft', demoted_at: new Date() },
      $unset: { promoted_session: '' },
    }
  );

  // Audit log
  await db.collection('audit_log').insertOne({
    action: 'warehouse_demote',
    session_id: sessionId,
    demoted_count: result.modifiedCount,
    timestamp: new Date(),
  });

  return NextResponse.json({
    session_id: sessionId,
    demoted: result.modifiedCount,
    message: `Demoted ${result.modifiedCount} books back to draft. No documents were deleted.`,
  });
}

export const POST = withAdminAuth(handlePost);
export const DELETE = withAdminAuth(handleDelete);
