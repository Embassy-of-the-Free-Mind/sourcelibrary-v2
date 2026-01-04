import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

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

    // Parse compound ID: pageId:index
    const [pageId, indexStr] = id.split(':');
    const detectionIndex = parseInt(indexStr, 10);

    if (!pageId || isNaN(detectionIndex)) {
      return NextResponse.json(
        { error: 'Invalid image ID format. Expected pageId:index' },
        { status: 400 }
      );
    }

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
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    const pageData = page[0];
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

    // Build the cropped image URL if bbox exists
    let croppedUrl = imageUrl;
    let highResUrl = fullResUrl;

    if (detection.bbox && imageUrl) {
      const cropParams = new URLSearchParams({
        url: imageUrl,
        x: detection.bbox.x.toString(),
        y: detection.bbox.y.toString(),
        w: detection.bbox.width.toString(),
        h: detection.bbox.height.toString()
      });
      croppedUrl = `/api/crop-image?${cropParams}`;

      // High-res version for magnifier
      const highResCropParams = new URLSearchParams({
        url: fullResUrl,
        x: detection.bbox.x.toString(),
        y: detection.bbox.y.toString(),
        w: detection.bbox.width.toString(),
        h: detection.bbox.height.toString()
      });
      highResUrl = `/api/crop-image?${highResCropParams}`;
    }

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

    // Parse compound ID: pageId:index
    const [pageId, indexStr] = id.split(':');
    const detectionIndex = parseInt(indexStr, 10);

    if (!pageId || isNaN(detectionIndex)) {
      return NextResponse.json(
        { error: 'Invalid image ID format. Expected pageId:index' },
        { status: 400 }
      );
    }

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
