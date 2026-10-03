import { NextRequest, NextResponse } from 'next/server';

// mongodb requires the Node.js runtime (never edge).
export const runtime = 'nodejs';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

/**
 * Concept covers made in the cover maker (/admin/covers). Admin only.
 *
 * A concept is a layered design kept for discussion. It is NEVER applied to the
 * book: nothing here touches `books` or any cover field, and no surface outside
 * /admin/covers reads this collection.
 *
 * GET  /api/admin/cover-concepts?book=<id>   concepts for one book (or all, newest first)
 * POST /api/admin/cover-concepts             save (create or overwrite) one concept
 */

const MAX_LAYERS = 120;
const MAX_THUMB = 250_000;
const MAX_BODY = 1_500_000;

export const GET = withAdminAuth(async (request: NextRequest) => {
  const db = await getDb();
  const book = new URL(request.url).searchParams.get('book');
  const concepts = await db.collection('cover_concepts')
    .find({ deleted_at: null, ...(book ? { book_id: book } : {}) }, { projection: { _id: 0 } })
    .sort({ updated_at: -1 })
    .limit(book ? 200 : 500)
    .toArray();
  return NextResponse.json({ concepts });
});

export const POST = withAdminAuth(async (request: NextRequest, session) => {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: 'Cover is too large to save' }, { status: 413 });
  let body: { id?: unknown; book_id?: unknown; name?: unknown; layers?: unknown; thumb?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { id, book_id, name, layers, thumb } = body;
  if (typeof id !== 'string' || !/^[\w-]{4,64}$/.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (typeof book_id !== 'string' || !book_id) return NextResponse.json({ error: 'Invalid book' }, { status: 400 });
  if (!Array.isArray(layers) || layers.length > MAX_LAYERS || !layers.every(l => l && typeof l === 'object' && typeof (l as { kind?: unknown }).kind === 'string')) {
    return NextResponse.json({ error: 'Invalid layers' }, { status: 400 });
  }
  if (thumb != null && (typeof thumb !== 'string' || !thumb.startsWith('data:image/jpeg;base64,') || thumb.length > MAX_THUMB)) {
    return NextResponse.json({ error: 'Invalid thumbnail' }, { status: 400 });
  }

  const db = await getDb();
  const book = await db.collection('books').findOne({ id: book_id }, { projection: { _id: 0, id: 1, title: 1 } });
  if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

  const now = new Date();
  const email = session.user?.email || null;
  await db.collection('cover_concepts').updateOne(
    { id },
    {
      $set: {
        book_id, book_title: book.title, name: String(name || 'Untitled').slice(0, 120),
        layers, thumb: thumb ?? null, format_version: 1, status: 'concept',
        updated_at: now, updated_by: email, deleted_at: null,
      },
      $setOnInsert: { id, created_at: now, created_by: email },
    },
    { upsert: true },
  );
  return NextResponse.json({ ok: true, id, updated_at: now });
});
