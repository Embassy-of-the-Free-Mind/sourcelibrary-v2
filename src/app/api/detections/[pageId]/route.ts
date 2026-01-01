import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * DELETE /api/detections/[pageId]
 *
 * Remove a specific detection from a page's detected_images array.
 * Query params:
 *   - index: the array index of the detection to remove
 *   - description: (optional) match by description instead of index
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  try {
    const { pageId } = await params;
    const { searchParams } = new URL(request.url);
    const index = searchParams.get('index');
    const description = searchParams.get('description');

    if (!index && !description) {
      return NextResponse.json(
        { error: 'Either index or description required' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Get the page first
    const page = await db.collection('pages').findOne({ id: pageId });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    if (!page.detected_images || page.detected_images.length === 0) {
      return NextResponse.json({ error: 'No detections on this page' }, { status: 400 });
    }

    let indexToRemove: number;

    if (index !== null) {
      indexToRemove = parseInt(index);
      if (isNaN(indexToRemove) || indexToRemove < 0 || indexToRemove >= page.detected_images.length) {
        return NextResponse.json({ error: 'Invalid index' }, { status: 400 });
      }
    } else {
      // Find by description
      indexToRemove = page.detected_images.findIndex(
        (d: { description: string }) => d.description === description
      );
      if (indexToRemove === -1) {
        return NextResponse.json({ error: 'Detection not found' }, { status: 404 });
      }
    }

    // Remove the detection at the specified index
    const newDetections = [...page.detected_images];
    const removed = newDetections.splice(indexToRemove, 1)[0];

    await db.collection('pages').updateOne(
      { id: pageId },
      { $set: { detected_images: newDetections } }
    );

    return NextResponse.json({
      success: true,
      removed,
      remaining: newDetections.length
    });
  } catch (error) {
    console.error('Delete detection error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete detection' },
      { status: 500 }
    );
  }
}
