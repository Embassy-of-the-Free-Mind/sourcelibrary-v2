import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { generateGalleryImages } from '@/lib/gallery-image-gen';
import { getSession } from '@/lib/auth-helpers';
import { getTenantContextFromRequest, resolveTenantId } from '@/lib/tenant-context';
import { getPageImageUrl } from '@/lib/utils';
import { remapBboxToMaster } from '@/lib/gallery-deepzoom-bbox';
import { VALID_IMAGE_TYPES } from '@/lib/gallery-image-types';

/**
 * Upgrade IIIF image URLs to higher resolution
 * Gallica/IIIF URLs use format: /full/{width},/ where {width} is max width
 * This function increases the width for higher resolution
 */
function upgradeIiifUrl(url: string, resolution: 'standard' | 'high' = 'standard'): string {
  if (!url.includes('full/')) return url;

  // Standard: 1000px, High: 2000px
  const targetWidth = resolution === 'high' ? 2000 : 1000;

  // Replace /full/1000,/ with /full/{targetWidth},/
  return url.replace(/\/full\/\d+,\//, `/full/${targetWidth},/`);
}

/**
 * GET /api/gallery/image/[id]
 *
 * Fetch a single detected image with full context.
 *
 * ID format: {pageId}:{detectionIndex}
 * Example: 69099f06cf28baa1b4caeb51:0
 *
 * INTENT:
 * This endpoint serves the atomic unit of the gallery - a single image that can be:
 * - Linked to directly
 * - Shared on social media
 * - Embedded elsewhere
 * - Cited in scholarly work
 *
 * It returns everything needed to display and contextualize the image:
 * - The image itself (via crop API URL)
 * - AI-generated metadata (description, type, confidence)
 * - Source context (book, page, reading link)
 * - Citation information
 */
/**
 * Query parameters:
 *   - resolution: 'high' for high-resolution magnifier image (2000px), default is standard (1000px)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const resolution = new URL(request.url).searchParams.get('resolution') || 'standard';
    const tenantCtx = getTenantContextFromRequest(request);
    const tenantSlug = tenantCtx.slug;
    let tenantId = tenantCtx.id;
    
    if (!tenantId && tenantSlug) {
      tenantId = await resolveTenantId(tenantSlug);
    }
    
    // Gallery is global — skip tenant filter when no context
    const tenantPageFilter = tenantId ? { tenantId } : {};
    const tenantGalleryFilter = tenantId ? { tenantId } : {};
    const tenantPath = (path: string) => (tenantSlug ? `/${tenantSlug}${path}` : path);
    const tenantResponseHeaders = {
      'Cache-Control': 'private, no-store',
      'Vary': 'X-Tenant-Slug, X-Tenant-Id',
    };

    // Parse compound ID: pageId:index or pageId-index
    const match = id.match(/^(.+)[:\-](\d+)$/);

    if (!match) {
      return NextResponse.json(
        { error: 'Invalid image ID format. Expected pageId-index' },
        { status: 400 }
      );
    }

    const [, pageId, indexStr] = match;
    const detectionIndex = parseInt(indexStr, 10);

    const db = await getDb();

    // Fetch the page with book info
    const page = await db.collection('pages').aggregate([
      { $match: { id: pageId, ...tenantPageFilter } },
      {
        $lookup: {
          from: 'books',
          localField: 'book_id',
          foreignField: 'id',
          as: 'book'
        }
      },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } }
    ]).toArray();

    if (!page.length) {
      // Fallback: try gallery_images collection (handles orphaned pages gracefully)
      const galleryImageId = `${pageId}-${detectionIndex}`;
      const galleryDoc = await db.collection('gallery_images').findOne({ id: galleryImageId, ...tenantGalleryFilter });
      if (galleryDoc) {
        return NextResponse.json({
          id,
          pageId,
          detectionIndex,
          imageUrl: galleryDoc.hires_url || galleryDoc.extracted_url || galleryDoc.thumbnail_url || galleryDoc.image_url,
          fullPageUrl: galleryDoc.image_url,
          highResUrl: galleryDoc.hires_url || galleryDoc.extracted_url || galleryDoc.image_url,
          extractedUrl: galleryDoc.extracted_url ?? null,
          thumbnailUrl: galleryDoc.thumbnail_url ?? null,
          rotation: galleryDoc.rotation ?? 0,
          description: galleryDoc.description,
          type: galleryDoc.type,
          confidence: galleryDoc.confidence,
          galleryQuality: galleryDoc.gallery_quality ?? null,
          museumDescription: galleryDoc.museum_description ?? null,
          metadata: galleryDoc.metadata ?? null,
          model: galleryDoc.model ?? null,
          detectionSource: galleryDoc.detection_source ?? null,
          detectedAt: galleryDoc.detected_at ?? null,
          bbox: galleryDoc.bbox,
          book: {
            id: galleryDoc.book_id,
            title: galleryDoc.book_title || 'Unknown',
            author: galleryDoc.book_author,
            year: galleryDoc.book_year,
          },
          pageNumber: galleryDoc.page_number,
          readUrl: tenantPath(`/book/${galleryDoc.book_id}/page/${pageId}`),
          galleryUrl: tenantPath(`/gallery?bookId=${galleryDoc.book_id}`),
          citation: `${galleryDoc.book_author || ''}, "${galleryDoc.book_title || 'Unknown'}", p. ${galleryDoc.page_number}, Source Library, ${aiCitationNote(galleryDoc.model)}`,
          orphaned: true, // Signal to UI that source page is gone
        }, {
          headers: tenantResponseHeaders,
        });
      }
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    const pageData = page[0];

    // Hide gallery images from hidden books
    if (pageData.book?.hidden === true) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    const detections = pageData.detected_images || [];

    if (detectionIndex < 0 || detectionIndex >= detections.length) {
      // Stale gallery_images entry — detected_images array shrank after re-extraction.
      // Fall back to gallery_images materialized data (same pattern as missing pages above).
      const galleryImageId = `${pageId}-${detectionIndex}`;
      const galleryDoc = await db.collection('gallery_images').findOne({ id: galleryImageId, ...tenantGalleryFilter });
      if (galleryDoc) {
        return NextResponse.json({
          id,
          pageId,
          detectionIndex,
          imageUrl: galleryDoc.hires_url || galleryDoc.extracted_url || galleryDoc.thumbnail_url || galleryDoc.image_url,
          fullPageUrl: galleryDoc.image_url,
          highResUrl: galleryDoc.hires_url || galleryDoc.extracted_url || galleryDoc.image_url,
          extractedUrl: galleryDoc.extracted_url ?? null,
          thumbnailUrl: galleryDoc.thumbnail_url ?? null,
          rotation: galleryDoc.rotation ?? 0,
          description: galleryDoc.description,
          type: galleryDoc.type,
          confidence: galleryDoc.confidence,
          galleryQuality: galleryDoc.gallery_quality ?? null,
          museumDescription: galleryDoc.museum_description ?? null,
          metadata: galleryDoc.metadata ?? null,
          model: galleryDoc.model ?? null,
          detectionSource: galleryDoc.detection_source ?? null,
          detectedAt: galleryDoc.detected_at ?? null,
          bbox: galleryDoc.bbox,
          book: {
            id: pageData.book_id,
            title: pageData.book?.display_title || pageData.book?.title || 'Unknown',
            author: pageData.book?.author,
            year: pageData.book?.published,
          },
          pageNumber: pageData.page_number,
          readUrl: tenantPath(`/book/${pageData.book?.slug || pageData.book_id}/page/${pageId}`),
          galleryUrl: tenantPath(`/gallery?bookId=${pageData.book_id}`),
          citation: `${pageData.book?.author || ''}, "${pageData.book?.display_title || pageData.book?.title || 'Unknown'}", p. ${pageData.page_number}, Source Library, ${aiCitationNote(galleryDoc.model)}`,
          stale: true, // Signal that detection index is stale
        }, {
          headers: tenantResponseHeaders,
        });
      }
      return NextResponse.json(
        { error: 'Detection index out of range' },
        { status: 404 }
      );
    }

    let detection = detections[detectionIndex];

    // Handle null/undefined detection entries (corrupt data)
    if (!detection) {
      const galleryImageId = `${pageId}-${detectionIndex}`;
      const galleryDoc = await db.collection('gallery_images').findOne({ id: galleryImageId, ...tenantGalleryFilter });
      if (galleryDoc) {
        return NextResponse.json({
          id,
          pageId,
          detectionIndex,
          imageUrl: galleryDoc.hires_url || galleryDoc.extracted_url || galleryDoc.thumbnail_url || galleryDoc.image_url,
          fullPageUrl: galleryDoc.image_url,
          highResUrl: galleryDoc.hires_url || galleryDoc.extracted_url || galleryDoc.image_url,
          extractedUrl: galleryDoc.extracted_url ?? null,
          thumbnailUrl: galleryDoc.thumbnail_url ?? null,
          rotation: galleryDoc.rotation ?? 0,
          description: galleryDoc.description,
          type: galleryDoc.type,
          confidence: galleryDoc.confidence,
          galleryQuality: galleryDoc.gallery_quality ?? null,
          museumDescription: galleryDoc.museum_description ?? null,
          metadata: galleryDoc.metadata ?? null,
          model: galleryDoc.model ?? null,
          detectionSource: galleryDoc.detection_source ?? null,
          detectedAt: galleryDoc.detected_at ?? null,
          bbox: galleryDoc.bbox,
          book: {
            id: pageData.book_id,
            title: pageData.book?.display_title || pageData.book?.title || 'Unknown',
            author: pageData.book?.author,
            year: pageData.book?.published,
          },
          pageNumber: pageData.page_number,
          readUrl: tenantPath(`/book/${pageData.book?.slug || pageData.book_id}/page/${pageId}`),
          galleryUrl: tenantPath(`/gallery?bookId=${pageData.book_id}`),
          citation: `${pageData.book?.author || ''}, "${pageData.book?.display_title || pageData.book?.title || 'Unknown'}", p. ${pageData.page_number}, Source Library, ${aiCitationNote(galleryDoc.model)}`,
          corrupt: true,
        }, {
          headers: tenantResponseHeaders,
        });
      }
      return NextResponse.json({ error: 'Detection data is null' }, { status: 404 });
    }

    // If the page detection is missing key fields, backfill from gallery_images
    // (gallery_images may have richer data from a previous extraction run)
    if (!detection.description || detection.gallery_quality == null) {
      const galleryImageId = `${pageId}-${detectionIndex}`;
      const galleryDoc = await db.collection('gallery_images').findOne({ id: galleryImageId, ...tenantGalleryFilter });
      if (galleryDoc) {
        detection = {
          ...detection,
          description: detection.description || galleryDoc.description,
          type: detection.type || galleryDoc.type,
          gallery_quality: detection.gallery_quality ?? galleryDoc.gallery_quality,
          museum_description: detection.museum_description ?? galleryDoc.museum_description,
          metadata: detection.metadata ?? galleryDoc.metadata,
          confidence: detection.confidence ?? galleryDoc.confidence,
          model: detection.model ?? galleryDoc.model,
          extracted_url: detection.extracted_url ?? galleryDoc.extracted_url,
          thumbnail_url: detection.thumbnail_url ?? galleryDoc.thumbnail_url,
          bbox: detection.bbox ?? galleryDoc.bbox,
        };
      }
    }

    let imageUrl = getPageImageUrl(pageData);

    // For the magnifier/high-res viewer: when a bbox exists, the high-res source MUST
    // be in the same coordinate space as the detection. If cropped_photo exists (split page),
    // archived_photo is the full spread — bbox coordinates won't map correctly to it.
    // Only use archived_photo for high-res when there's no bbox (full-page images).
    const magnifierBaseUrl = detection.bbox
      ? imageUrl  // Same coordinate space as the bbox
      : (pageData.archived_photo || pageData.cropped_photo || pageData.photo_original || pageData.photo);
    const isIiif = magnifierBaseUrl?.includes('/iiif/');
    const fullResUrl = isIiif ? upgradeIiifUrl(magnifierBaseUrl, 'high') : magnifierBaseUrl;

    // Build on-the-fly crop URL (always available as fallback)
    let cropUrl: string | null = null;
    let highResUrl = fullResUrl;

    if (detection.bbox && imageUrl) {
      const cropParams = new URLSearchParams({
        url: imageUrl,
        x: detection.bbox.x.toString(),
        y: detection.bbox.y.toString(),
        w: detection.bbox.width.toString(),
        h: detection.bbox.height.toString()
      });
      if (detection.rotation) cropParams.set('rotation', detection.rotation.toString());
      cropUrl = `/api/crop-image?${cropParams}`;

      // High-res version for magnifier
      const highResCropParams = new URLSearchParams({
        url: fullResUrl,
        x: detection.bbox.x.toString(),
        y: detection.bbox.y.toString(),
        w: detection.bbox.width.toString(),
        h: detection.bbox.height.toString()
      });
      if (detection.rotation) highResCropParams.set('rotation', detection.rotation.toString());
      highResUrl = `/api/crop-image?${highResCropParams}`;
    }

    // Prefer extracted_url (generated during detection, always from the correct page).
    // hires_url is higher resolution but may be stale — the hires backfill generates crops
    // from archived_photo which can be a bleed-through page if the detection landed on the
    // wrong side of a spread. extracted_url is the authoritative crop.
    const croppedUrl = detection.extracted_url || detection.hires_url || cropUrl || imageUrl;

    // Deep-zoom focus (#2714). When this page has a tile pyramid, the gallery
    // can drop the reader into it zoomed onto the illustration instead of the
    // lens magnifier — but only if we can place the bbox in the master's
    // coordinate space. On a split-from-spread scan the bbox is fractions of
    // the HALF while the master is the whole spread, so it needs remapping;
    // `remapBboxToMaster` returns null whenever that can't be established, and
    // we then omit the focus entirely and the client keeps the magnifier.
    const deepzoom = pageData.deepzoom ?? null;
    const focusBbox = deepzoom
      ? remapBboxToMaster(detection.bbox, pageData, pageData.fullres_master ?? deepzoom)
      : null;

    // Durable first-party view counter (written by POST /api/views; keyed the
    // same hyphen-form id as likes)
    const viewsDoc = await db.collection('views').findOne(
      { target_type: 'image', target_id: `${pageId}-${detectionIndex}` },
      { projection: { count: 1 } }
    );

    // Build the response
    const response = {
      // Identity
      id,
      pageId,
      detectionIndex,

      // Image URLs
      imageUrl: croppedUrl,
      fullPageUrl: imageUrl,
      highResUrl: detection.hires_url || highResUrl, // For magnifier/high-resolution viewing
      extractedUrl: detection.extracted_url ?? null,
      thumbnailUrl: detection.thumbnail_url ?? null,
      hiresUrl: detection.hires_url ?? null, // Cached high-res download (4000px crop in R2)
      cropUrl, // On-the-fly crop fallback (always works even if Blob is stale/broken)
      rotation: detection.rotation ?? 0,

      // AI-generated metadata
      description: detection.description,
      type: detection.type,
      confidence: detection.confidence,
      model: detection.model ?? null,
      detectionSource: detection.detection_source ?? null,
      detectedAt: detection.detected_at ?? null,

      // Gallery curation
      galleryQuality: detection.gallery_quality ?? null,
      galleryRationale: detection.gallery_rationale ?? null,
      featured: detection.featured ?? false,

      // Engagement
      viewCount: viewsDoc?.count ?? 0,

      // Rich metadata
      metadata: detection.metadata ?? null,
      museumDescription: detection.museum_description ?? null,

      // Bounding box (normalized 0-1, in the page-source coordinate space)
      bbox: detection.bbox,

      // Deep zoom (#2714) — `focusBbox` is the same rectangle translated into
      // the master's space, so the viewer can open framed on the illustration.
      // Present only when both the pyramid and a trustworthy remap exist.
      deepzoom: focusBbox ? deepzoom : null,
      focusBbox,

      // Source context
      book: {
        id: pageData.book_id,
        slug: pageData.book?.slug,
        title: pageData.book?.display_title || pageData.book?.title || 'Unknown',
        author: pageData.book?.author,
        year: pageData.book?.published,
        doi: pageData.book?.doi,
        thumbnail: pageData.book?.thumbnail,
      },
      pageNumber: pageData.page_number,

      // Links
      readUrl: tenantPath(`/book/${pageData.book?.slug || pageData.book_id}/page/${pageId}`),
      galleryUrl: tenantPath(`/gallery?bookId=${pageData.book_id}`),

      // For citation
      citation: buildCitation(pageData, detection)
    };

    return NextResponse.json(response, {
      headers: tenantResponseHeaders,
    });
  } catch (error) {
    console.error('Gallery image error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch image' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/gallery/image/[id]
 *
 * Update gallery curation fields for an image.
 * Body: { galleryQuality?, featured?, museumDescription?, metadata?, description? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const tenantCtx = getTenantContextFromRequest(request);
    const tenantSlug = tenantCtx.slug;
    let tenantId = tenantCtx.id;
    if (!tenantId && tenantSlug) {
      tenantId = await resolveTenantId(tenantSlug);
    }
    const tenantPageFilter = tenantId ? { tenantId } : {};
    const tenantGalleryFilter = tenantId ? { tenantId } : {};

    // All writes require authentication
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse compound ID: pageId:index or pageId-index
    const match = id.match(/^(.+)[:\-](\d+)$/);

    if (!match) {
      return NextResponse.json(
        { error: 'Invalid image ID format. Expected pageId-index' },
        { status: 400 }
      );
    }

    const [, pageId, indexStr] = match;
    const detectionIndex = parseInt(indexStr, 10);

    const db = await getDb();

    // Build update object for the specific array element
    const updateFields: Record<string, unknown> = {};

    if (typeof body.galleryQuality === 'number') {
      updateFields[`detected_images.${detectionIndex}.gallery_quality`] = Math.max(0, Math.min(1, body.galleryQuality));
    }

    // Re-tag the image type (e.g. an ex-libris bookplate auto-classified as
    // "emblem"). Validate against the known type vocabulary; ex-libris and
    // bookplates are provenance, not the book's own illustrations.
    if (typeof body.type === 'string' && VALID_IMAGE_TYPES.has(body.type)) {
      updateFields[`detected_images.${detectionIndex}.type`] = body.type;
    }

    if (typeof body.featured === 'boolean') {
      updateFields[`detected_images.${detectionIndex}.featured`] = body.featured;
    }

    if (typeof body.museumDescription === 'string') {
      updateFields[`detected_images.${detectionIndex}.museum_description`] = body.museumDescription;
    }

    if (typeof body.description === 'string') {
      updateFields[`detected_images.${detectionIndex}.description`] = body.description;
    }

    if (body.metadata && typeof body.metadata === 'object') {
      // Update individual metadata fields
      const m = body.metadata;
      if (Array.isArray(m.subjects)) {
        updateFields[`detected_images.${detectionIndex}.metadata.subjects`] = m.subjects;
      }
      if (Array.isArray(m.figures)) {
        updateFields[`detected_images.${detectionIndex}.metadata.figures`] = m.figures;
      }
      if (Array.isArray(m.symbols)) {
        updateFields[`detected_images.${detectionIndex}.metadata.symbols`] = m.symbols;
      }
      if (typeof m.style === 'string') {
        updateFields[`detected_images.${detectionIndex}.metadata.style`] = m.style;
      }
      if (typeof m.technique === 'string') {
        updateFields[`detected_images.${detectionIndex}.metadata.technique`] = m.technique;
      }
    }

    if (typeof body.rotation === 'number' && [0, 90, 180, 270].includes(body.rotation)) {
      updateFields[`detected_images.${detectionIndex}.rotation`] = body.rotation;
    }

    if (body.bbox && typeof body.bbox === 'object') {
      const b = body.bbox;
      if (typeof b.x === 'number' && typeof b.y === 'number' &&
          typeof b.width === 'number' && typeof b.height === 'number') {
        updateFields[`detected_images.${detectionIndex}.bbox`] = {
          x: Math.max(0, Math.min(1, b.x)),
          y: Math.max(0, Math.min(1, b.y)),
          width: Math.max(0.01, Math.min(1 - b.x, b.width)),
          height: Math.max(0.01, Math.min(1 - b.y, b.height))
        };
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const result = await db.collection('pages').updateOne(
      { id: pageId, ...tenantPageFilter },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Generate pre-cropped gallery images when bbox or rotation changes
    const bboxChanged = !!body.bbox;
    const rotationChanged = typeof body.rotation === 'number';
    if (bboxChanged || rotationChanged) {
      try {
        // Re-read the page to get current state after update
        const updatedPage = await db.collection('pages').findOne({ id: pageId, ...tenantPageFilter });
        if (updatedPage) {
          const det = updatedPage.detected_images?.[detectionIndex];
          const sourceUrl = getPageImageUrl(updatedPage);
          if (det?.bbox && sourceUrl) {
            const generated = await generateGalleryImages({
              sourceImageUrl: sourceUrl,
              bbox: det.bbox,
              rotation: det.rotation ?? 0,
              bookId: updatedPage.book_id,
              pageId,
              detectionIndex,
            });
            // Save generated URLs back to the detection
            await db.collection('pages').updateOne(
              { id: pageId, ...tenantPageFilter },
              {
                $set: {
                  [`detected_images.${detectionIndex}.extracted_url`]: generated.extractedUrl,
                  [`detected_images.${detectionIndex}.thumbnail_url`]: generated.thumbnailUrl,
                  [`detected_images.${detectionIndex}.extracted_width`]: generated.extractedWidth,
                  [`detected_images.${detectionIndex}.extracted_height`]: generated.extractedHeight,
                  [`detected_images.${detectionIndex}.dhash`]: generated.dhash,
                }
              }
            );
            // Sync to gallery_images (upsert so an earlier delete from low-quality
            // doesn't permanently strand the row out of sync with pages.detected_images)
            try {
              const galleryImageId = `${pageId}-${detectionIndex}`;
              const gallerySync: Record<string, unknown> = {
                extracted_url: generated.extractedUrl,
                thumbnail_url: generated.thumbnailUrl,
                extracted_width: generated.extractedWidth,
                extracted_height: generated.extractedHeight,
                dhash: generated.dhash,
                updated_at: new Date(),
              };
              if (typeof body.galleryQuality === 'number') gallerySync.gallery_quality = Math.max(0, Math.min(1, body.galleryQuality));
              if (typeof body.rotation === 'number') gallerySync.rotation = body.rotation;
              if (body.bbox) gallerySync.bbox = updateFields[`detected_images.${detectionIndex}.bbox`];
              await db.collection('gallery_images').updateOne(
                { id: galleryImageId, ...tenantGalleryFilter },
                {
                  $set: gallerySync,
                  $setOnInsert: { id: galleryImageId, page_id: pageId, detection_index: detectionIndex },
                },
                { upsert: true },
              );
            } catch (e) {
              console.error('Gallery images sync (bbox/rotation path) failed:', e);
            }

            return NextResponse.json({
              success: true,
              updated: updateFields,
              extractedUrl: generated.extractedUrl,
              thumbnailUrl: generated.thumbnailUrl,
            });
          }
        }
      } catch (genError) {
        // Non-fatal — crop-image fallback still works
        console.warn('Gallery image generation failed (non-fatal):', genError);
      }
    }

    // Sync changes to materialized gallery_images collection
    let gallerySyncStatus: 'ok' | 'hidden_low_quality' | 'no_change' | { error: string } = 'no_change';
    try {
      const galleryImageId = `${pageId}-${detectionIndex}`;

      // Always upsert — never delete. When a curator lowers quality below the
      // 0.5 materialization threshold the row is HIDDEN from the public gallery
      // by the gallery_quality >= minQuality read-filter gate (see
      // api/gallery/route.ts), not destroyed. It stays recoverable: raising
      // quality back ≥ 0.5 makes it reappear, and admin/curation views
      // (minQuality=0) can still see it. (Source of truth
      // pages.detected_images[].gallery_quality was already updated above.)
      const galleryUpdate: Record<string, unknown> = {};
      if (typeof body.galleryQuality === 'number') {
        galleryUpdate.gallery_quality = Math.max(0, Math.min(1, body.galleryQuality));
      }
      if (typeof body.type === 'string' && VALID_IMAGE_TYPES.has(body.type)) galleryUpdate.type = body.type;
      if (typeof body.featured === 'boolean') galleryUpdate.featured = body.featured;
      if (typeof body.museumDescription === 'string') galleryUpdate.museum_description = body.museumDescription;
      if (typeof body.description === 'string') galleryUpdate.description = body.description;
      if (body.metadata && typeof body.metadata === 'object') galleryUpdate.metadata = body.metadata;
      if (typeof body.rotation === 'number') galleryUpdate.rotation = body.rotation;
      if (body.bbox) galleryUpdate.bbox = updateFields[`detected_images.${detectionIndex}.bbox`];

      const lowQuality = typeof body.galleryQuality === 'number' && body.galleryQuality < 0.5;

      if (Object.keys(galleryUpdate).length > 0) {
        galleryUpdate.updated_at = new Date();
        // Upsert (never delete): keeps the gallery list view in sync with
        // pages.detected_images and preserves the row when quality drops < 0.5.
        // On insert, also write the foreign-key fields needed for queries.
        const result = await db.collection('gallery_images').updateOne(
          { id: galleryImageId, ...tenantGalleryFilter },
          {
            $set: galleryUpdate,
            $setOnInsert: {
              id: galleryImageId,
              page_id: pageId,
              detection_index: detectionIndex,
            },
          },
          { upsert: true },
        );
        const changed = result.upsertedCount > 0 || result.modifiedCount > 0;
        gallerySyncStatus = lowQuality ? 'hidden_low_quality' : changed ? 'ok' : 'no_change';
      } else if (lowQuality) {
        gallerySyncStatus = 'hidden_low_quality';
      }
    } catch (syncErr) {
      console.error('Gallery images sync failed:', syncErr);
      gallerySyncStatus = { error: syncErr instanceof Error ? syncErr.message : 'unknown' };
    }

    return NextResponse.json({ success: true, updated: updateFields, gallerySync: gallerySyncStatus });
  } catch (error) {
    console.error('Gallery image update error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update image' },
      { status: 500 }
    );
  }
}

/**
 * Build a scholarly citation for this image.
 */
function buildCitation(page: Record<string, unknown>, detection: Record<string, unknown>): string {
  const book = page.book as Record<string, unknown> | undefined;
  const parts: string[] = [];

  if (book?.author) parts.push(book.author as string);
  if (book?.title || book?.display_title) {
    parts.push(`"${book.display_title || book.title}"`);
  }
  if (book?.published) parts.push(`(${book.published})`);
  parts.push(`p. ${page.page_number}`);

  if (detection.description) {
    parts.push(`[${detection.description}]`);
  }

  parts.push('Source Library');

  if (book?.doi) {
    parts.push(`DOI: ${book.doi}`);
  }

  parts.push(aiCitationNote(detection.model));

  return parts.join(', ');
}

/**
 * Provenance note appended to citations: the image description/title quoted in
 * the citation is AI-generated, so the citation must carry that disclaimer
 * (and the generating model, when recorded) wherever it gets pasted.
 */
function aiCitationNote(model: unknown): string {
  return `[Image description AI-generated${typeof model === 'string' && model ? ` (${model})` : ''}]`;
}
