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

    // Get the original image URL (prefer photo_original if available)
    const imageUrl = page.photo_original || page.photo;

    if (!imageUrl) {
      return NextResponse.json({ error: 'No image URL found' }, { status: 400 });
    }

    // Fetch the image
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.status}` },
        { status: 502 }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // Run split detection
    const result = await detectSplitFromBuffer(imageBuffer);

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
