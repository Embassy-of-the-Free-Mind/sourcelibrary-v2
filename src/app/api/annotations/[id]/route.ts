import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { AnnotationType, AnnotationStatus } from '@/lib/types';

// GET /api/annotations/[id] - Get a single annotation with replies
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const annotation = await db.collection('annotations').findOne({ id });

    if (!annotation) {
      return NextResponse.json(
        { error: 'Annotation not found' },
        { status: 404 }
      );
    }

    // Fetch replies if this is a top-level annotation
    let replies: unknown[] = [];
    if (!annotation.parent_id) {
      replies = await db.collection('annotations')
        .find({ parent_id: id, status: { $ne: 'hidden' } })
        .sort({ upvotes: -1, created_at: 1 })
        .toArray();
    }

    return NextResponse.json({
      ...annotation,
      replies,
    });
  } catch (error) {
    console.error('Error fetching annotation:', error);
    return NextResponse.json(
      { error: 'Failed to fetch annotation' },
      { status: 500 }
    );
  }
}

// PATCH /api/annotations/[id] - Update an annotation
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { content, type, status, encyclopedia_refs } = body;

    const db = await getDb();

    // Build update object
    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (content !== undefined) {
      if (content.length < 10) {
        return NextResponse.json(
          { error: 'Annotation content must be at least 10 characters' },
          { status: 400 }
        );
      }
      if (content.length > 10000) {
        return NextResponse.json(
          { error: 'Annotation content must be under 10,000 characters' },
          { status: 400 }
        );
      }
      updateData.content = content.trim();
    }

    if (type !== undefined) {
      const validTypes: AnnotationType[] = ['context', 'correction', 'reference', 'question', 'etymology'];
      if (!validTypes.includes(type)) {
        return NextResponse.json(
          { error: `Invalid type. Must be one of: ${validTypes.join(', ')}` },
          { status: 400 }
        );
      }
      updateData.type = type;
    }

    if (status !== undefined) {
      const validStatuses: AnnotationStatus[] = ['pending', 'approved', 'hidden'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
          { status: 400 }
        );
      }
      updateData.status = status;
    }

    if (encyclopedia_refs !== undefined) {
      updateData.encyclopedia_refs = encyclopedia_refs;
    }

    const result = await db.collection('annotations').updateOne(
      { id },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: 'Annotation not found' },
        { status: 404 }
      );
    }

    const annotation = await db.collection('annotations').findOne({ id });
    return NextResponse.json(annotation);
  } catch (error) {
    console.error('Error updating annotation:', error);
    return NextResponse.json(
      { error: 'Failed to update annotation' },
      { status: 500 }
    );
  }
}

// DELETE /api/annotations/[id] - Delete an annotation
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Get the annotation first to check if it has a parent
    const annotation = await db.collection('annotations').findOne({ id });

    if (!annotation) {
      return NextResponse.json(
        { error: 'Annotation not found' },
        { status: 404 }
      );
    }

    // If this annotation has replies, just hide it instead of deleting
    if (annotation.reply_count > 0) {
      await db.collection('annotations').updateOne(
        { id },
        { $set: { status: 'hidden', content: '[deleted]', updated_at: new Date() } }
      );
      return NextResponse.json({ success: true, hidden: true });
    }

    // Delete the annotation
    await db.collection('annotations').deleteOne({ id });

    // If this was a reply, decrement parent's reply_count
    if (annotation.parent_id) {
      await db.collection('annotations').updateOne(
        { id: annotation.parent_id },
        { $inc: { reply_count: -1 } }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting annotation:', error);
    return NextResponse.json(
      { error: 'Failed to delete annotation' },
      { status: 500 }
    );
  }
}
