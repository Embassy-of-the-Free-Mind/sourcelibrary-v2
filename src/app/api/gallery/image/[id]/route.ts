import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

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
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

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
    const imageUrl = pageData.cropped_photo || pageData.photo_original || pageData.photo;

    // Build the cropped image URL if bbox exists
    let croppedUrl = imageUrl;
    if (detection.bbox && imageUrl) {
      const cropParams = new URLSearchParams({
        url: imageUrl,
        x: detection.bbox.x.toString(),
        y: detection.bbox.y.toString(),
        w: detection.bbox.width.toString(),
        h: detection.bbox.height.toString()
      });
      croppedUrl = `/api/crop-image?${cropParams}`;
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

      // AI-generated metadata
      description: detection.description,
      type: detection.type,
      confidence: detection.confidence,
      model: detection.model,
      detectionSource: detection.detection_source,

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
