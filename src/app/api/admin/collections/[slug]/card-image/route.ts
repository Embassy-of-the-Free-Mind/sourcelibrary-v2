import { NextRequest, NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { toGalleryCardUrl } from '@/lib/utils';
import { readCardFraming, DEFAULT_CARD_FRAMING } from '@/lib/collection-card-image';

/**
 * The cover a collection shows on its cards (search, the collections index,
 * /collections/all), chosen and framed by an editor.
 *
 * GET → the current cover, its framing, and candidate plates from the
 *       collection's own books (best-scored first), each with a thumbnail to
 *       pick from and the URL the card would actually use.
 * PUT → { url, x, y, scale }  sets hero_image + card_framing.
 *
 * Editor and above, like image curation: it changes what every visitor sees,
 * but it is reversible and touches no book data.
 */
type Ctx = { params: Promise<{ slug: string }> };

export const GET = withAuth(async (_req: NextRequest, _session: Session, context?: Ctx) => {
  const { slug } = await context!.params;
  const db = await getDb();
  const collection = await db.collection('collections').findOne(
    { slug },
    { projection: { _id: 0, slug: 1, name: 1, hero_image: 1, card_framing: 1 } },
  );
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
    current: {
      url: typeof collection.hero_image === 'string' ? collection.hero_image : null,
      framing: readCardFraming(collection.card_framing) ?? DEFAULT_CARD_FRAMING,
    },
    candidates: images.map((img) => ({
      id: `${img.page_id}-${img.detection_index ?? 0}`,
      thumb: img.thumbnail_url || img.extracted_url || img.image_url,
      // Cards render at up to ~750px, so the 600px `-card` variant is the right
      // size; the full extracted plate is the fallback when no card variant exists.
      url: toGalleryCardUrl(img.thumbnail_url) || img.extracted_url || img.image_url,
      fallback: img.extracted_url || img.image_url || null,
      description: img.museum_description || img.description || '',
      book_title: img.book_title || '',
    })).filter((c) => c.thumb && c.url),
  });
}, { minRole: 'editor' });

async function exists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

export const PUT = withAuth(async (req: NextRequest, session: Session, context?: Ctx) => {
  const { slug } = await context!.params;
  const body = await req.json().catch(() => ({}));

  let url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!/^https:\/\/[^\s"']+$/.test(url) || url.length > 2000) {
    return NextResponse.json({ error: 'url must be an https URL' }, { status: 400 });
  }
  // A `-card` variant is derived by convention and may not have been
  // backfilled for this crop; fall back to the full plate rather than ship a
  // card that 404s.
  if (/-card\.jpg(\?|$)/.test(url) && !(await exists(url))) {
    const fallback = typeof body.fallback === 'string' && /^https:\/\//.test(body.fallback) ? body.fallback : null;
    if (!fallback) return NextResponse.json({ error: 'That image variant does not exist yet' }, { status: 422 });
    url = fallback;
  }
  const framing = readCardFraming(body) ?? DEFAULT_CARD_FRAMING;

  const db = await getDb();
  const res = await db.collection('collections').updateOne(
    { slug },
    {
      $set: {
        hero_image: url,
        card_framing: framing,
        card_image_updated_by: session.user?.email || null,
      },
      $currentDate: { updated_at: true },
    },
  );
  if (!res.matchedCount) return NextResponse.json({ error: 'Collection not found' }, { status: 404 });

  // The card surfaces are ISR (24h); a cover nobody sees until tomorrow is not
  // a cover. Search reads Mongo per request and needs nothing.
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/collections');
    revalidatePath('/collections/all');
    revalidatePath(`/collections/${slug}`);
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, url, framing });
}, { minRole: 'editor' });
