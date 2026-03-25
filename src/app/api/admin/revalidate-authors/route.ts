import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { revalidatePath } from 'next/cache';
import { authorSlug } from '@/lib/slugify';

export const maxDuration = 300;

/**
 * POST /api/admin/revalidate-authors
 *
 * Invalidate + warm all author pages. Two phases:
 * 1. revalidatePath to mark cached pages stale
 * 2. Fetch each author URL to trigger ISR regeneration
 *
 * Query params:
 *   ?warm=false  — skip the warming step (just invalidate)
 */
export const POST = withAdminAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const warm = searchParams.get('warm') !== 'false';

  const db = await getDb();

  // Get distinct authors from visible books
  const authors: string[] = await db.collection('books').distinct('author', {
    hidden: { $ne: true },
    author: { $exists: true, $ne: null, $nin: ['Unknown', 'Anonymous', 'Various'] },
  });

  // Deduplicate by slug (different author strings can produce same slug)
  const slugs = [...new Set(authors.map(a => authorSlug(a)))];

  // Phase 1: invalidate all
  for (const slug of slugs) {
    revalidatePath(`/author/${slug}`);
  }

  // Phase 2: warm by fetching each page (triggers ISR regeneration)
  let warmed = 0;
  const errors: string[] = [];
  if (warm) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://sourcelibrary.org';
    // Fetch in batches of 10 to avoid overwhelming the server
    for (let i = 0; i < slugs.length; i += 10) {
      const batch = slugs.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(slug =>
          fetch(`${baseUrl}/author/${slug}`, {
            headers: { 'User-Agent': 'SourceLibrary-Warmer' },
          })
        )
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled' && r.value.ok) {
          warmed++;
        } else {
          errors.push(batch[j]);
        }
      }
    }
  }

  return NextResponse.json({
    slugs: slugs.length,
    invalidated: slugs.length,
    warmed: warm ? warmed : 'skipped',
    errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
  });
});
