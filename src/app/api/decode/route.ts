/**
 * POST /api/decode — read the hidden provenance mark in pasted text (#8150).
 *
 * Body: { text: string }. Returns the mark's status, and when the signature
 * verifies, the edition code, the readable colophon and the book it names.
 *
 * The signature check is an oracle: given a guessed mark, it says yes or no.
 * The tag is 48 bits, so guessing is hopeless at any human rate, and the
 * shared (Mongo-backed) limiter keeps it so across every serverless instance.
 * The in-memory limiter would not: each lambda counts alone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitShared, getClientIp } from '@/lib/rate-limit';
import { decodePastedText, MAX_DECODE_CHARS } from '@/lib/mark-decoder';
import { getReadDb } from '@/lib/mongodb';
import { bookUrl } from '@/lib/slugify';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = { name: 'mark-decode', limit: 30, windowSeconds: 60 };
const NO_STORE = { 'Cache-Control': 'private, no-store' };

interface NamedBook { title: string; url: string }

/**
 * Name the book a verified mark belongs to. The colophon's address is exact;
 * the 8-character edition code alone is shared by several books when they
 * were imported in the same second, so we name it only when it is unique.
 */
async function nameBook(bookRef: string | null, editionId: string): Promise<{ books: NamedBook[]; shared: number }> {
  const db = await getReadDb();
  const projection = { id: 1, slug: 1, title: 1, display_title: 1 };
  const live = { visible: true, pages_count: { $gt: 0 } };
  type Row = { id: string; slug?: string; title?: string; display_title?: string };
  const toNamed = (b: Row): NamedBook => ({ title: b.display_title || b.title || 'Untitled', url: bookUrl(b) });
  if (bookRef) {
    const b = await db.collection<Row>('books').findOne({ ...live, $or: [{ id: bookRef }, { slug: bookRef }] }, { projection });
    if (b) return { books: [toNamed(b)], shared: 1 };
  }
  if (!/^[0-9a-f]{8}$/.test(editionId)) return { books: [], shared: 0 };
  const rows = await db
    .collection<Row>('books')
    .find({ ...live, id: { $regex: `^${editionId}` } }, { projection })
    .limit(6)
    .toArray();
  return { books: rows.length === 1 ? [toNamed(rows[0])] : [], shared: rows.length };
}

export async function POST(request: NextRequest) {
  const rl = await checkRateLimitShared(RATE_LIMIT, getClientIp(request));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again in a minute.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfter) } },
    );
  }

  let text: unknown;
  try {
    text = (await request.json())?.text;
  } catch {
    return NextResponse.json({ error: 'Send JSON: {"text": "..."}' }, { status: 400, headers: NO_STORE });
  }
  if (typeof text !== 'string' || text.length === 0) {
    return NextResponse.json({ error: 'Paste some text to decode.' }, { status: 400, headers: NO_STORE });
  }
  if (text.length > MAX_DECODE_CHARS) {
    return NextResponse.json(
      { error: `That is more than ${MAX_DECODE_CHARS.toLocaleString('en-US')} characters. Paste a shorter passage.` },
      { status: 413, headers: NO_STORE },
    );
  }

  const result = decodePastedText(text);
  if (result.status === 'unconfigured') {
    return NextResponse.json({ error: 'The decoder is not available right now.' }, { status: 503, headers: NO_STORE });
  }

  let books: NamedBook[] = [];
  let shared = 0;
  if (result.status === 'authentic' && result.editionId) {
    try {
      ({ books, shared } = await nameBook(result.bookId, result.editionId));
    } catch {
      // Naming the book is a courtesy; the verdict stands without it.
    }
  }

  return NextResponse.json(
    {
      status: result.status,
      zero_width: result.zeroWidth,
      edition: result.editionId,
      message: result.message,
      books,
      books_sharing_code: shared,
    },
    { headers: NO_STORE },
  );
}
