import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { generateGalleryImages } from '@/lib/gallery-image-gen';

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
      { $match: { id: pageId } },
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
      const galleryDoc = await db.collection('gallery_images').findOne({ id: galleryImageId });
      if (galleryDoc) {
        return NextResponse.json({
          id,
          pageId,
          detectionIndex,
          imageUrl: galleryDoc.extracted_url || galleryDoc.thumbnail_url || galleryDoc.image_url,
          fullPageUrl: galleryDoc.image_url,
          highResUrl: galleryDoc.extracted_url || galleryDoc.image_url,
          extractedUrl: galleryDoc.extracted_url ?? null,
          thumbnailUrl: galleryDoc.thumbnail_url ?? null,
          rotation: galleryDoc.rotation ?? 0,
          description: galleryDoc.description,
          type: galleryDoc.type,
          confidence: galleryDoc.confidence,
          galleryQuality: galleryDoc.gallery_quality ?? null,
          museumDescription: galleryDoc.museum_description ?? null,
          metadata: galleryDoc.metadata ?? null,
          bbox: galleryDoc.bbox,
          book: {
            id: galleryDoc.book_id,
            title: galleryDoc.book_title || 'Unknown',
            author: galleryDoc.book_author,
            year: galleryDoc.book_year,
          },
          pageNumber: galleryDoc.page_number,
          readUrl: `/book/${galleryDoc.book_id}/page/${pageId}`,
          galleryUrl: `/gallery?bookId=${galleryDoc.book_id}`,
          citation: `${galleryDoc.book_author || ''}, "${galleryDoc.book_title || 'Unknown'}", p. ${galleryDoc.page_number}, Source Library`,
          orphaned: true, // Signal to UI that source page is gone
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
      return NextResponse.json(
        { error: 'Detection index out of range' },
        { status: 404 }
      );
    }

    const detection = detections[detectionIndex];
    // Prefer archived photo (Vercel Blob - fast CDN), fall back to original source
    let imageUrl = pageData.archived_photo || pageData.cropped_photo || pageData.photo_original || pageData.photo;

    // For IIIF sources, upgrade resolution if requested
    const isIiif = imageUrl?.includes('/iiif/');
    const fullResUrl = isIiif ? upgradeIiifUrl(imageUrl, 'high') : imageUrl;

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

    // Prefer pre-generated extracted_url, fall back to on-the-fly crop, then raw page
    const croppedUrl = detection.extracted_url || cropUrl || imageUrl;

    // Build the response
    const response = {
      // Identity
      id,
      pageId,
      detectionIndex,

      // Image URLs
      imageUrl: croppedUrl,
      fullPageUrl: imageUrl,
      highResUrl: highResUrl, // For magnifier/high-resolution viewing
      extractedUrl: detection.extracted_url ?? null,
      thumbnailUrl: detection.thumbnail_url ?? null,
      cropUrl, // On-the-fly crop fallback (always works even if Blob is stale/broken)
      rotation: detection.rotation ?? 0,

      // AI-generated metadata
      description: detection.description,
      type: detection.type,
      confidence: detection.confidence,
      model: detection.model,
      detectionSource: detection.detection_source,

      // Gallery curation
      galleryQuality: detection.gallery_quality ?? null,
      galleryRationale: detection.gallery_rationale ?? null,
      featured: detection.featured ?? false,

      // Rich metadata
      metadata: detection.metadata ?? null,
      museumDescription: detection.museum_description ?? null,

      // Bounding box (normalized 0-1)
      bbox: detection.bbox,

      // Source context
      book: {
        id: pageData.book_id,
        title: pageData.book?.display_title || pageData.book?.title || 'Unknown',
        author: pageData.book?.author,
        year: pageData.book?.published,
        doi: pageData.book?.doi
      },
      pageNumber: pageData.page_number,

      // Links
      readUrl: `/book/${pageData.book_id}/page/${pageId}`,
      galleryUrl: `/gallery?bookId=${pageData.book_id}`,

      // For citation
      citation: buildCitation(pageData, detection)
    };

    return NextResponse.json(response);
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

    // Handle rotation
    if (typeof body.rotation === 'number' && [0, 90, 180, 270].includes(body.rotation)) {
      updateFields[`detected_images.${detectionIndex}.rotation`] = body.rotation;
    }

    // Handle bbox updates
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
      { id: pageId },
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
        const updatedPage = await db.collection('pages').findOne({ id: pageId });
        if (updatedPage) {
          const det = updatedPage.detected_images?.[detectionIndex];
          const sourceUrl = updatedPage.archived_photo || updatedPage.cropped_photo || updatedPage.photo_original || updatedPage.photo;
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
              { id: pageId },
              {
                $set: {
                  [`detected_images.${detectionIndex}.extracted_url`]: generated.extractedUrl,
                  [`detected_images.${detectionIndex}.thumbnail_url`]: generated.thumbnailUrl,
                }
              }
            );
            // Sync to gallery_images
            try {
              const galleryImageId = `${pageId}-${detectionIndex}`;
              const gallerySync: Record<string, unknown> = {
                extracted_url: generated.extractedUrl,
                thumbnail_url: generated.thumbnailUrl,
                updated_at: new Date(),
              };
              if (typeof body.galleryQuality === 'number') gallerySync.gallery_quality = Math.max(0, Math.min(1, body.galleryQuality));
              if (typeof body.rotation === 'number') gallerySync.rotation = body.rotation;
              if (body.bbox) gallerySync.bbox = updateFields[`detected_images.${detectionIndex}.bbox`];
              await db.collection('gallery_images').updateOne({ id: galleryImageId }, { $set: gallerySync });
            } catch { /* non-fatal */ }

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
    try {
      const galleryImageId = `${pageId}-${detectionIndex}`;

      // If quality dropped below materialization threshold, remove from gallery
      if (typeof body.galleryQuality === 'number' && body.galleryQuality < 0.5) {
        await db.collection('gallery_images').deleteOne({ id: galleryImageId });
      } else {
        const galleryUpdate: Record<string, unknown> = {};
        if (typeof body.galleryQuality === 'number') {
          galleryUpdate.gallery_quality = Math.max(0, Math.min(1, body.galleryQuality));
        }
        if (typeof body.featured === 'boolean') galleryUpdate.featured = body.featured;
        if (typeof body.museumDescription === 'string') galleryUpdate.museum_description = body.museumDescription;
        if (typeof body.description === 'string') galleryUpdate.description = body.description;
        if (body.metadata && typeof body.metadata === 'object') galleryUpdate.metadata = body.metadata;
        if (typeof body.rotation === 'number') galleryUpdate.rotation = body.rotation;
        if (body.bbox) galleryUpdate.bbox = updateFields[`detected_images.${detectionIndex}.bbox`];

        if (Object.keys(galleryUpdate).length > 0) {
          galleryUpdate.updated_at = new Date();
          await db.collection('gallery_images').updateOne(
            { id: galleryImageId },
            { $set: galleryUpdate }
          );
        }
      }
    } catch (syncErr) {
      console.warn('Gallery images sync failed (non-fatal):', syncErr);
    }

    return NextResponse.json({ success: true, updated: updateFields });
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

  return parts.join(', ');
}
