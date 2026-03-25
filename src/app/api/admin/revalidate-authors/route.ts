import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { revalidatePath } from 'next/cache';
import { authorSlug } from '@/lib/slugify';

export const maxDuration = 300;

/**
 * POST /api/admin/revalidate-authors
 *
 * Revalidate all author pages by finding distinct authors with visible books
 * and calling revalidatePath for each.
 */
export const POST = withAdminAuth(async () => {
  const db = await getDb();

  // Get distinct authors from visible books
  const authors: string[] = await db.collection('books').distinct('author', {
    hidden: { $ne: true },
    author: { $exists: true, $ne: null, $nin: ['Unknown', 'Anonymous', 'Various'] },
  });

  let revalidated = 0;
  for (const author of authors) {
    const slug = authorSlug(author);
    revalidatePath(`/author/${slug}`);
    revalidated++;
  }

  return NextResponse.json({
    revalidated,
    total_authors: authors.length,
  });
});
