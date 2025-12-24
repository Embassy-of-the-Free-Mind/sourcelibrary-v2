import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { detectSplitFromBuffer } from '@/lib/splitDetection';

/**
 * GET /api/pages/[id]/auto-split
 *
 * Automatically detect the optimal split position for a page using
 * rule-based heuristics (no AI required).
 *
 * Uses a small resized image for fast analysis (~400px wide).
 * Result is on 0-1000 scale so works for any image size.
 *
 * Returns:
 * - isTwoPageSpread: boolean
 * - splitPosition: number (0-1000 scale)
 * - hasTextAtSplit: boolean (warning if text detected at split line)
 * - confidence: 'high' | 'medium' | 'low'
 * - metrics: detailed analysis metrics
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Find the page
    const page = await db.collection('pages').findOne({
      $or: [{ _id: new ObjectId(id) }, { id }],
    });

    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Get the image URL - use thumbnail/compressed if available, otherwise original
    const imageUrl = page.photo_original || page.photo;

    if (!imageUrl) {
      return NextResponse.json({ error: 'No image URL found' }, { status: 400 });
    }

    // Use our image API to get a small resized version (much faster to download & analyze)
    // The split position is 0-1000 scale, so works regardless of image size
    const baseUrl = request.nextUrl.origin;
    const smallImageUrl = `${baseUrl}/api/image?url=${encodeURIComponent(imageUrl)}&w=500&q=60`;

    const response = await fetch(smallImageUrl, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.status}` },
        { status: 502 }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // Run split detection (analyzes at 500px width - very fast)
    const result = await detectSplitFromBuffer(imageBuffer, 500);

    return NextResponse.json({
      pageId: id,
      pageNumber: page.page_number,
      ...result,
    });
  } catch (error) {
    console.error('Auto-split detection error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Detection failed' },
      { status: 500 }
    );
  }
}
