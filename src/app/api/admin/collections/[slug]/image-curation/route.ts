import { NextRequest, NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { curationId, surfaceCuration, type Surface } from '@/lib/collection-image-curation';

/**
 * Image curation for a collection's hero collage and gallery preview.
 *
 * GET  → the candidate images (scored order, as the surfaces see them) plus the
 *        stored curation, so the editor can show what would render today.
 * PUT  → { surface, order, hidden }
 *
 * Editor and above: this changes what every visitor sees, but it is reversible
 * and touches no book data, so it does not need to be admin-only.
 */
const SURFACES: Surface[] = ['hero', 'gallery'];

export const GET = withAuth(async (_req: NextRequest, _session: Session, context?: { params: Promise<{ slug: string }> }) => {
  const { slug } = await context!.params;
  const db = await getDb();
  const collection = await db.collection('collections').findOne({ slug });
  if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 });

  const bookIds = await db.collection('books').distinct('id', { collections: slug, visible: true });
  const images = bookIds.length
    ? await db.collection('gallery_images').find(
      { book_id: { $in: bookIds.slice(0, 200) }, gallery_quality: { $gte: 0.5 } },
      { projection: { _id: 0, page_id: 1, detection_index: 1, extracted_url: 1, thumbnail_url: 1, image_url: 1, description: 1, museum_description: 1, book_title: 1, gallery_quality: 1 } },
    ).sort({ gallery_quality: -1 }).limit(240).toArray()
    : [];

  return NextResponse.json({
    collection: { slug: collection.slug, name: collection.name },
    curation: Object.fromEntries(SURFACES.map((s) => [s, surfaceCuration(collection, s)])),
    candidates: images.map((img) => ({
      id: curationId(img as { page_id?: string; detection_index?: number }),
      url: img.thumbnail_url || img.extracted_url || img.image_url,
      description: img.museum_description || img.description || '',
      book_title: img.book_title || '',
      quality: img.gallery_quality,
    })).filter((c) => c.url),
  });
}, { minRole: 'editor' });

export const PUT = withAuth(async (req: NextRequest, session: Session, context?: { params: Promise<{ slug: string }> }) => {
  const { slug } = await context!.params;
  const body = await req.json().catch(() => ({}));
  const surface = body.surface as Surface;
  if (!SURFACES.includes(surface)) {
    return NextResponse.json({ error: `surface must be one of ${SURFACES.join(', ')}` }, { status: 400 });
  }
  const clean = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 500) : []);
  const order = clean(body.order);
  const hidden = clean(body.hidden);

  const db = await getDb();
  const res = await db.collection('collections').updateOne(
    { slug },
    {
      $set: {
        [`image_curation.${surface}`]: { order, hidden },
        [`image_curation.${surface}_updated_by`]: session.user?.email || null,
      },
      $currentDate: { updated_at: true },
    },
  );
  if (!res.matchedCount) return NextResponse.json({ error: 'Collection not found' }, { status: 404 });

  // The collage is cached hard and the page is ISR — a curation nobody can see
  // until tomorrow is not a curation.
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath(`/collections/${slug}`);
    revalidatePath(`/api/collections/${slug}/hero-collage`);
  } catch { /* revalidate is best-effort */ }

  return NextResponse.json({ ok: true, surface, order: order.length, hidden: hidden.length });
}, { minRole: 'editor' });
