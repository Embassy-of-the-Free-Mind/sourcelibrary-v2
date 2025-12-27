import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId, Document } from 'mongodb';
import { Annotation, AnnotationType, AnnotationStatus } from '@/lib/types';

// GET /api/annotations - List annotations, optionally filtered
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('book_id');
    const pageId = searchParams.get('page_id');
    const status = searchParams.get('status') as AnnotationStatus | null;
    const parentId = searchParams.get('parent_id');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const db = await getDb();

    const query: Record<string, unknown> = {};
    if (bookId) query.book_id = bookId;
    if (pageId) query.page_id = pageId;
    if (status) query.status = status;
    if (parentId) query.parent_id = parentId;
    // By default, only show approved annotations (or pending if explicitly requested)
    if (!status) query.status = { $ne: 'hidden' };

    const annotations = await db.collection('annotations')
      .find(query)
      .sort({ upvotes: -1, created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    // Get total count for pagination
    const total = await db.collection('annotations').countDocuments(query);

    return NextResponse.json({
      annotations,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching annotations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch annotations' },
      { status: 500 }
    );
  }
}

// POST /api/annotations - Create a new annotation
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      book_id,
      page_id,
      page_number,
      anchor,
      content,
      type,
      user_name,
      user_id,
      parent_id,
      encyclopedia_refs,
    } = body;

    // Validate required fields
    if (!book_id || !page_id || !anchor?.text || !content || !type) {
      return NextResponse.json(
        { error: 'book_id, page_id, anchor.text, content, and type are required' },
        { status: 400 }
      );
    }

    // Validate type
    const validTypes: AnnotationType[] = ['comment', 'context', 'correction', 'reference', 'question', 'etymology'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate content length (shorter minimum for simple comments)
    const minLength = type === 'comment' ? 3 : 10;
    if (content.length < minLength) {
      return NextResponse.json(
        { error: `Content must be at least ${minLength} characters` },
        { status: 400 }
      );
    }

    if (content.length > 10000) {
      return NextResponse.json(
        { error: 'Annotation content must be under 10,000 characters' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // If this is a reply, verify parent exists and increment its reply_count
    if (parent_id) {
      const parent = await db.collection('annotations').findOne({ id: parent_id });
      if (!parent) {
        return NextResponse.json(
          { error: 'Parent annotation not found' },
          { status: 404 }
        );
      }
      await db.collection('annotations').updateOne(
        { id: parent_id },
        { $inc: { reply_count: 1 } }
      );
    }

    const annotation: Annotation = {
      id: new ObjectId().toHexString(),
      book_id,
      page_id,
      page_number: page_number || 0,
      anchor: {
        text: anchor.text.trim(),
        start_offset: anchor.start_offset,
        end_offset: anchor.end_offset,
      },
      content: content.trim(),
      type,
      user_id: user_id || undefined,
      user_name: user_name?.trim() || 'Anonymous',
      upvotes: 0,
      upvoted_by: [],
      status: 'approved', // Auto-approve for now; add moderation later
      parent_id: parent_id || undefined,
      reply_count: 0,
      encyclopedia_refs: encyclopedia_refs || undefined,
      created_at: new Date(),
    };

    await db.collection('annotations').insertOne(annotation as unknown as Document);

    return NextResponse.json(annotation, { status: 201 });
  } catch (error) {
    console.error('Error creating annotation:', error);
    return NextResponse.json(
      { error: 'Failed to create annotation' },
      { status: 500 }
    );
  }
}
