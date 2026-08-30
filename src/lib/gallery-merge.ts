/**
 * Merged gallery browse — interleaves book illustrations (gallery_images) with
 * standalone artworks (books, content_type:'artwork') into one GalleryItem feed.
 *
 * Pure: takes a Mongo db handle + plain options and returns { items, total }.
 * No Next/auth/route deps, so it can run in the API route, in SSR, and in a
 * standalone test script. Used ONLY for the unscoped /gallery browse; all the
 * scoped/search paths stay illustration-only in their existing code.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MergedBrowseOpts {
  tenantId: string | null;
  source: 'all' | 'artwork';
  limit: number;
  offset: number;
  imageType?: string | null;
  minQuality?: number;
  maxPerBook?: number;
  yearStart?: number | null;
  yearEnd?: number | null;
  visitorId?: string | null;
}

const clampAspect = (r: number) => Math.min(3, Math.max(0.33, r));

// Standalone artworks store images in their own fields — map one to a GalleryItem tile.
export function artworkToGalleryItem(a: any) {
  const image = a.image_display || a.image_full || a.image_thumb || a.thumbnail_blob || a.thumbnail || '';
  const thumb = a.image_thumb || a.thumbnail_blob || a.thumbnail || a.image_display || image;
  // books.summary has two shapes: legacy plain string, or the enrich-worker
  // wrapper { data, generated_at, model, ... } (~17k books each). Passing the
  // wrapper object through as `description` crashed /search client-side
  // ("e.normalize is not a function" in the highlighter) for any query whose
  // AI expansion surfaced such an artwork.
  const summaryText = typeof a.summary === 'string' ? a.summary : a.summary?.data;
  const year = typeof a.year === 'number' ? a.year : (parseInt(a.published, 10) || undefined);
  const w = a.full_width || a.commons_width;
  const h = a.full_height || a.commons_height;
  const aspect = w && h ? clampAspect(w / h) : 0.78;
  return {
    aspect,
    pageId: `artwork-${a.id}`,
    bookId: a.id,
    pageNumber: 0,
    detectionIndex: 0,
    imageUrl: image,
    thumbnailUrl: thumb,
    extractedUrl: image,        // card's primary src; no bbox crop for artworks
    bookTitle: a.display_title || a.title || 'Untitled',
    author: a.author,
    year,
    description: summaryText || a.display_title || a.title || '',
    type: a.resource_type,
    source: 'artwork' as const,
    // /artwork is the canonical route for a standalone artwork. This field is
    // consumed by GalleryClient tiles AND handed to MCP clients verbatim as the
    // public URL, so a `/book/...` here is how AI answers ended up citing the
    // non-canonical twin. `/artwork` also resolves on tenant subdomains.
    // Falls back to the id only when a slug is missing — /artwork matches by
    // slug, so an id-only record has to keep the /book form.
    link: a.slug ? `/artwork/${a.slug}` : `/book/${a.id}`,
    likeCount: 0,
    likedByVisitor: false,
  };
}

export async function mergedGalleryBrowse(
  db: any,
  opts: MergedBrowseOpts,
): Promise<{ items: any[]; total: number; hasMore: boolean }> {
  const {
    tenantId, source, limit, offset,
    imageType = null, minQuality = 0.7, maxPerBook = 3,
    yearStart = null, yearEnd = null, visitorId = null,
  } = opts;
  const tenant = tenantId ? { tenantId } : {};
  const pageIndex = Math.floor(offset / Math.max(1, limit));
  // The natural-aspect masonry shows full pages, so raise the quality floor for
  // the merged browse — blank/low-content plates the old square crop hid now
  // read as empty tiles. (Explicit type/quality filters still honor the request.)
  const qFloor = imageType ? minQuality : Math.max(minQuality, 0.82);
  // Artworks must actually have an image, else they render as blank tiles.
  const artHasImage = { $or: [
    { image_display: { $nin: [null, ''] } },
    { image_full: { $nin: [null, ''] } },
    { image_thumb: { $nin: [null, ''] } },
  ] };

  const artPerPage = source === 'artwork' ? limit : Math.max(1, Math.round(limit * 0.25));
  const illusPerPage = source === 'artwork' ? 0 : limit - artPerPage;

  // ---- illustrations ----
  let illusDocs: any[] = [];
  let illusHasMore = false;
  if (illusPerPage > 0) {
    const f: Record<string, unknown> = {
      ...tenant, gallery_quality: { $gte: qFloor }, book_visible: true,
      extracted_url: { $ne: null }, image_url: { $ne: null },
    };
    if (maxPerBook < 100) f.book_rank = { $lte: maxPerBook };
    if (imageType) f.type = imageType;
    if (yearStart !== null || yearEnd !== null) {
      const y: Record<string, number> = {};
      if (yearStart !== null) y.$gte = yearStart;
      if (yearEnd !== null) y.$lte = yearEnd;
      f.book_year = y;
    }
    const docs = await db.collection('gallery_images')
      .find(f, { projection: { _id: 0 } })
      .sort({ gallery_quality: -1, book_year: 1, book_id: 1, page_number: 1 })
      .skip(pageIndex * illusPerPage).limit(illusPerPage + 1).toArray();
    illusHasMore = docs.length > illusPerPage;
    illusDocs = docs.slice(0, illusPerPage);
  }

  // ---- artworks (allowDiskUse guards the sort on the 26k-row artwork set) ----
  const af: Record<string, unknown> = { ...tenant, content_type: 'artwork', visible: true, ...artHasImage };
  if (imageType) af.resource_type = imageType;
  if (yearStart !== null || yearEnd !== null) {
    const y: Record<string, number> = {};
    if (yearStart !== null) y.$gte = yearStart;
    if (yearEnd !== null) y.$lte = yearEnd;
    af.year = y;
  }
  const artDocs = await db.collection('books')
    .find(af, {
      projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, summary: 1, resource_type: 1, image_display: 1, image_full: 1, image_thumb: 1, thumbnail: 1, thumbnail_blob: 1, full_width: 1, full_height: 1, commons_width: 1, commons_height: 1 },
      allowDiskUse: true,
    })
    .sort({ year: 1, title: 1 })
    .skip(pageIndex * artPerPage).limit(artPerPage + 1).toArray();
  const artHasMore = artDocs.length > artPerPage;
  const arts = artDocs.slice(0, artPerPage).map(artworkToGalleryItem);

  // ---- illustration likes + page dims (for exact aspect) ----
  const likesMap: Record<string, { count: number; liked: boolean }> = {};
  const dimMap = new Map<string, { image_width?: number; image_height?: number }>();
  if (illusDocs.length > 0) {
    const ids = illusDocs.map(d => `${d.page_id}-${d.detection_index}`);
    const pageIds = illusDocs.map(d => d.page_id).filter(Boolean);
    const [likeDocs, dimDocs] = await Promise.all([
      db.collection('likes').aggregate([
        { $match: { target_type: 'image', target_id: { $in: ids } } },
        { $group: { _id: '$target_id', count: { $sum: 1 }, visitors: { $addToSet: '$visitor_id' } } },
      ]).toArray().catch(() => []),
      db.collection('pages').find({ id: { $in: pageIds } }, { projection: { id: 1, image_width: 1, image_height: 1 } }).toArray().catch(() => []),
    ]);
    for (const ld of likeDocs) likesMap[ld._id] = { count: ld.count, liked: visitorId ? ld.visitors.includes(visitorId) : false };
    for (const p of dimDocs) dimMap.set(p.id, p);
  }
  const illus = illusDocs.map(d => {
    const key = `${d.page_id}-${d.detection_index}`;
    const b = d.bbox; const pd = dimMap.get(d.page_id);
    const aspect = b && b.width > 0 && b.height > 0 && pd?.image_width && pd?.image_height
      ? clampAspect((b.width * pd.image_width) / (b.height * pd.image_height))
      : (b && b.width > 0 && b.height > 0 ? clampAspect((b.width / b.height) * 0.72) : 0.72);
    return {
      pageId: d.page_id, bookId: d.book_id, pageNumber: d.page_number, detectionIndex: d.detection_index,
      imageUrl: d.image_url, bookTitle: d.book_title, author: d.book_author, year: d.book_year,
      description: d.description, type: d.type, bbox: d.bbox, rotation: d.rotation, aspect,
      extractedUrl: d.extracted_url, thumbnailUrl: d.thumbnail_url, galleryQuality: d.gallery_quality,
      museumDescription: d.museum_description, metadata: d.metadata, source: 'illustration' as const,
      likeCount: likesMap[key]?.count ?? 0, likedByVisitor: likesMap[key]?.liked ?? false,
    };
  });

  // ---- interleave (space artworks ~every `gap` tiles) ----
  const items: any[] = [];
  let ii = 0, ai = 0;
  const gap = arts.length > 0 ? Math.max(2, Math.round((illus.length + arts.length) / arts.length)) : Infinity;
  for (let pos = 0; items.length < limit && (ii < illus.length || ai < arts.length); pos++) {
    const wantArt = ai < arts.length && (pos % gap === gap - 1 || ii >= illus.length);
    if (wantArt) items.push(arts[ai++]);
    else if (ii < illus.length) items.push(illus[ii++]);
    else if (ai < arts.length) items.push(arts[ai++]);
  }

  const hasMore = illusHasMore || artHasMore;

  // Real total for the UI count: illustrations (estimated when unfiltered, exact
  // when type/year-filtered) + artworks. Both guarded with a time cap.
  let illusTotal = 0;
  if (illusPerPage > 0) {
    if (imageType || yearStart !== null || yearEnd !== null) {
      const cf: Record<string, unknown> = {
        ...tenant, gallery_quality: { $gte: qFloor }, book_visible: true,
        extracted_url: { $ne: null }, image_url: { $ne: null },
      };
      if (maxPerBook < 100) cf.book_rank = { $lte: maxPerBook };
      if (imageType) cf.type = imageType;
      if (yearStart !== null || yearEnd !== null) {
        const y: Record<string, number> = {};
        if (yearStart !== null) y.$gte = yearStart;
        if (yearEnd !== null) y.$lte = yearEnd;
        cf.book_year = y;
      }
      illusTotal = await db.collection('gallery_images').countDocuments(cf, { maxTimeMS: 8000 }).catch(() => 0);
    } else {
      illusTotal = await db.collection('gallery_images').estimatedDocumentCount();
    }
  }
  const artTotal = await db.collection('books').countDocuments(af, { maxTimeMS: 8000 }).catch(() => arts.length);
  const total = illusTotal + artTotal;

  return { items, total, hasMore };
}
