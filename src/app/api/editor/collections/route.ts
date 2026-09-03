import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { authenticateEditor, checkCollectionOwnership } from '@/lib/editor-auth';
import { tagBooksIntoCollection, untagBooksFromCollection } from '@/lib/collection-tagging';

export const maxDuration = 30;

/**
 * GET /api/editor/collections
 * List collections created by the authenticated editor.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateEditor(request, 'collections:read');
  if (auth instanceof NextResponse) return auth;

  const db = await getDb();
  const { searchParams } = new URL(request.url);
  const all = searchParams.get('all') === 'true' && (auth.role === 'admin' || auth.role === 'superadmin');

  const filter = all ? {} : { created_by: auth.email };
  const collections = await db.collection('collections')
    .find(filter)
    .project({ _id: 0, slug: 1, name: 1, subtitle: 1, visible: 1, book_count: 1, artwork_count: 1, created_by: 1, created_at: 1, health_score: 1 })
    .sort({ created_at: -1 })
    .toArray();

  return NextResponse.json({ collections });
}

/**
 * POST /api/editor/collections
 * Create a new collection. Starts as draft (visible: false).
 *
 * Body: { name, slug?, description?, subtitle?, parent?, bookIds?: string[] }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateEditor(request, 'collections:write');
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { name, description, subtitle, parent, bookIds } = body;

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  // Generate slug from name
  const slug = body.slug || name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);

  const db = await getDb();

  // Check uniqueness
  const existing = await db.collection('collections').findOne({ slug });
  if (existing) {
    return NextResponse.json({ error: `Collection "${slug}" already exists` }, { status: 409 });
  }

  // Validate parent exists if specified
  if (parent) {
    const parentCol = await db.collection('collections').findOne({ slug: parent });
    if (!parentCol) {
      return NextResponse.json({ error: `Parent collection "${parent}" not found` }, { status: 400 });
    }
  }

  // Tag books
  let booksTagged = 0;
  const languages: { lang: string; count: number }[] = [];

  if (bookIds?.length) {
    const result = await tagBooksIntoCollection(db, slug, {
      $or: [{ id: { $in: bookIds } }, { slug: { $in: bookIds } }],
      deleted: { $ne: true },
    });
    booksTagged = result.changedCount;

    // Compute languages
    const langAgg = await db.collection('books').aggregate([
      { $match: { collections: slug, deleted: { $ne: true }, language: { $exists: true, $ne: null } } },
      { $group: { _id: '$language', count: { $sum: 1 } } },
      { $match: { _id: { $nin: ['Unknown', 'Visual', 'undefined', ''] }, count: { $gte: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();
    langAgg.forEach(l => languages.push({ lang: l._id, count: l.count }));
  }

  const bookCount = await db.collection('books').countDocuments({
    collections: slug, deleted: { $ne: true },
  });

  // Auto-pick featured images from gallery
  let featured_images: any[] = [];
  if (bookIds?.length) {
    const gallery = await db.collection('gallery_images').find({
      book_id: { $in: bookIds },
      gallery_quality: { $gte: 0.7 },
      $or: [{ thumbnail_url: { $exists: true, $ne: null } }, { extracted_url: { $exists: true, $ne: null } }],
    }).sort({ gallery_quality: -1 }).limit(6).project({
      thumbnail_url: 1, extracted_url: 1, image_url: 1, description: 1, book_title: 1, book_id: 1,
    }).toArray();
    featured_images = gallery;
  }

  const now = new Date();
  const doc = {
    slug,
    name,
    subtitle: subtitle || '',
    description: description || '',
    expanded_description: description || '',
    parent: parent || undefined,
    visible: false, // Always start as draft
    book_count: bookCount,
    languages,
    featured_images,
    created_by: auth.email,
    created_at: now,
    updated_at: now,
  };

  await db.collection('collections').insertOne(doc);

  const previewUrl = `https://sourcelibrary.org/collections/${slug}`;

  return NextResponse.json({
    success: true,
    slug,
    preview_url: previewUrl,
    books_tagged: booksTagged,
    featured_images: featured_images.length,
  }, { status: 201 });
}

/**
 * PATCH /api/editor/collections
 * Update a collection the editor owns.
 *
 * Body: { slug, name?, description?, subtitle?, expanded_description?, highlighted_books?, addBookIds?, removeBookIds? }
 */
export async function PATCH(request: NextRequest) {
  const auth = await authenticateEditor(request, 'collections:write');
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { slug, addBookIds, removeBookIds, ...fields } = body;

  if (!slug) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  }

  // Ownership check
  const { owned, collection } = await checkCollectionOwnership(slug, auth);
  if (!collection) {
    return NextResponse.json({ error: `Collection "${slug}" not found` }, { status: 404 });
  }
  if (!owned) {
    return NextResponse.json({ error: 'You can only edit collections you created' }, { status: 403 });
  }

  const db = await getDb();
  const updates: Record<string, any> = { updated_at: new Date() };

  // Safe fields that editors can update
  const allowedFields = ['name', 'subtitle', 'description', 'expanded_description', 'highlighted_books', 'parent'];
  for (const key of allowedFields) {
    if (fields[key] !== undefined) updates[key] = fields[key];
  }

  // Add books
  if (addBookIds?.length) {
    await tagBooksIntoCollection(db, slug, {
      $or: [{ id: { $in: addBookIds } }, { slug: { $in: addBookIds } }],
      deleted: { $ne: true },
    });
  }

  // Remove books
  if (removeBookIds?.length) {
    await untagBooksFromCollection(db, slug, {
      $or: [{ id: { $in: removeBookIds } }, { slug: { $in: removeBookIds } }],
    });
  }

  // Recount
  if (addBookIds?.length || removeBookIds?.length) {
    updates.book_count = await db.collection('books').countDocuments({
      collections: slug, deleted: { $ne: true },
    });

    // Refresh languages
    const langAgg = await db.collection('books').aggregate([
      { $match: { collections: slug, deleted: { $ne: true }, language: { $exists: true, $ne: null } } },
      { $group: { _id: '$language', count: { $sum: 1 } } },
      { $match: { _id: { $nin: ['Unknown', 'Visual', 'undefined', ''] }, count: { $gte: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();
    updates.languages = langAgg.map((l: any) => ({ lang: l._id, count: l.count }));
  }

  await db.collection('collections').updateOne({ slug }, { $set: updates });

  return NextResponse.json({ success: true, slug, updated: Object.keys(updates) });
}
