import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { authenticateEditor, checkCollectionOwnership } from '@/lib/editor-auth';
import { revalidatePath } from 'next/cache';

export const maxDuration = 15;

/**
 * POST /api/editor/collections/[slug]/publish
 * Make a draft collection visible. Validates minimum requirements.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await authenticateEditor(request, 'collections:write');
  if (auth instanceof NextResponse) return auth;

  const { slug } = await params;

  const { owned, collection } = await checkCollectionOwnership(slug, auth);
  if (!collection) {
    return NextResponse.json({ error: `Collection "${slug}" not found` }, { status: 404 });
  }
  if (!owned) {
    return NextResponse.json({ error: 'You can only publish collections you created' }, { status: 403 });
  }

  // Validate minimum requirements
  const issues: string[] = [];
  if (!collection.name) issues.push('name is required');
  if (!collection.description && !collection.expanded_description) issues.push('description is required');

  const db = await getDb();
  const bookCount = await db.collection('books').countDocuments({
    collections: slug, deleted: { $ne: true },
  });
  if (bookCount === 0) issues.push('at least one book must be assigned');

  if (issues.length > 0) {
    return NextResponse.json({
      error: 'Collection is not ready to publish',
      issues,
    }, { status: 400 });
  }

  // Auto-backfill featured_images if missing
  const fi = collection.featured_images;
  if (!fi || fi.length < 3) {
    const bookIds = await db.collection('books').distinct('id', {
      collections: slug, deleted: { $ne: true },
    });
    const gallery = await db.collection('gallery_images').find({
      book_id: { $in: bookIds },
      gallery_quality: { $gte: 0.7 },
      $or: [{ thumbnail_url: { $exists: true, $ne: null } }, { extracted_url: { $exists: true, $ne: null } }],
    }).sort({ gallery_quality: -1 }).limit(6).project({
      thumbnail_url: 1, extracted_url: 1, image_url: 1, description: 1, book_title: 1, book_id: 1,
    }).toArray();

    if (gallery.length > 0) {
      await db.collection('collections').updateOne({ slug }, {
        $set: { featured_images: gallery },
      });
    }
  }

  await db.collection('collections').updateOne({ slug }, {
    $set: {
      visible: true,
      book_count: bookCount,
      published_at: new Date(),
      updated_at: new Date(),
    },
  });

  // Bust ISR cache
  try {
    revalidatePath('/collections');
    revalidatePath(`/collections/${slug}`);
  } catch {
    // revalidatePath may fail outside request context
  }

  return NextResponse.json({
    success: true,
    slug,
    url: `https://sourcelibrary.org/collections/${slug}`,
    book_count: bookCount,
  });
}
