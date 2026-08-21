import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { toUserId } from '@/lib/user-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST: Dedicate a book to yourself (one per membership year).
 * The dedication is permanent and appears on the book page + in downloads.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  // Must be a member
  const db = await getDb();
  const user = await db.collection('users').findOne(
    { _id: toUserId(session.user.id) as any },
    { projection: { membership: 1, name: 1 } }
  );

  if (!user?.membership?.active) {
    return NextResponse.json({ error: 'Membership required' }, { status: 403 });
  }

  // Check if member has already dedicated a book this membership year
  const activatedAt = user.membership.activatedAt ? new Date(user.membership.activatedAt) : new Date();
  const yearStart = new Date(activatedAt);
  // Find the most recent anniversary
  const now = new Date();
  while (yearStart < now) {
    yearStart.setFullYear(yearStart.getFullYear() + 1);
  }
  yearStart.setFullYear(yearStart.getFullYear() - 1); // back to current year start

  const existingDedication = await db.collection('books').findOne({
    'dedication.userId': session.user.id,
    'dedication.createdAt': { $gte: yearStart },
  });

  if (existingDedication) {
    return NextResponse.json(
      { error: 'You have already dedicated a book this year', dedicatedBook: existingDedication.id },
      { status: 409 }
    );
  }

  // Check book exists and isn't already dedicated
  const book = await db.collection('books').findOne(
    { id },
    { projection: { id: 1, dedication: 1 } }
  );

  if (!book) {
    return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  }

  if (book.dedication) {
    return NextResponse.json({ error: 'This book already has a dedication' }, { status: 409 });
  }

  // Get display name
  const body = await request.json().catch(() => ({}));
  const displayName = (body.displayName || user.membership.profile?.displayName || user.name || 'Anonymous').trim().slice(0, 100);

  // Set the dedication
  await db.collection('books').updateOne(
    { id },
    {
      $set: {
        dedication: {
          name: displayName,
          userId: session.user.id,
          createdAt: new Date(),
        },
      },
    }
  );

  return NextResponse.json({ success: true, name: displayName });
}
