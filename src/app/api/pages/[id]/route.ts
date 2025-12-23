import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const page = await db.collection('pages').findOne({ id });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    return NextResponse.json(page);
  } catch (error) {
    console.error('Error fetching page:', error);
    return NextResponse.json({ error: 'Failed to fetch page' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const body = await request.json();

    const updateData: Record<string, unknown> = {
      updated_at: new Date()
    };

    // Update OCR if provided
    if (body.ocr) {
      updateData['ocr.data'] = body.ocr.data;
      updateData['ocr.language'] = body.ocr.language;
      updateData['ocr.model'] = body.ocr.model || 'gemini-2.0-flash';
      updateData['ocr.updated_at'] = new Date();
    }

    // Update translation if provided
    if (body.translation) {
      updateData['translation.data'] = body.translation.data;
      updateData['translation.language'] = body.translation.language;
      updateData['translation.model'] = body.translation.model || 'gemini-2.0-flash';
      updateData['translation.updated_at'] = new Date();
    }

    // Update summary if provided
    if (body.summary) {
      updateData['summary.data'] = body.summary.data;
      updateData['summary.model'] = body.summary.model || 'gemini-2.0-flash';
      updateData['summary.updated_at'] = new Date();
    }

    const result = await db.collection('pages').updateOne(
      { id },
      { $set: updateData, $inc: { edit_count: 1 } }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Track edit for the book
    const page = await db.collection('pages').findOne({ id });
    if (page?.book_id) {
      await db.collection('books').updateOne(
        { id: page.book_id },
        { $inc: { edit_count: 1 } }
      );
    }

    const updatedPage = await db.collection('pages').findOne({ id });
    return NextResponse.json(updatedPage);
  } catch (error) {
    console.error('Error updating page:', error);
    return NextResponse.json({ error: 'Failed to update page' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Check if page exists
    const page = await db.collection('pages').findOne({ id });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Delete the page
    await db.collection('pages').deleteOne({ id });

    // Renumber remaining pages for this book - use bulkWrite for speed
    const remainingPages = await db.collection('pages')
      .find({ book_id: page.book_id })
      .sort({ page_number: 1 })
      .toArray();

    // Bulk update all page numbers in one operation
    if (remainingPages.length > 0) {
      const bulkOps = remainingPages.map((p, i) => ({
        updateOne: {
          filter: { id: p.id },
          update: { $set: { page_number: i + 1, updated_at: new Date() } }
        }
      }));
      await db.collection('pages').bulkWrite(bulkOps);
    }

    return NextResponse.json({ success: true, deleted: id });
  } catch (error) {
    console.error('Error deleting page:', error);
    return NextResponse.json({ error: 'Failed to delete page' }, { status: 500 });
  }
}
